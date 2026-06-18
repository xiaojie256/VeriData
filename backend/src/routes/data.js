const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../utils/database');
const logger = require('../utils/logger');
const { authenticate, authorize, optionalAuth } = require('../middleware/auth');
const { upload, handleUploadError, verifyFileIntegrity } = require('../middleware/upload');
const { auditLog } = require('../middleware/audit');
const { withTransaction } = require('../utils/transaction');
const { normalizeOriginalFilename, buildContentDisposition } = require('../utils/filename');

const router = express.Router();
const UPLOAD_PATH = process.env.UPLOAD_PATH || './uploads';

// CSV 格式预检函数
const validateCsvFile = (filePath) => {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/).filter(line => line.trim() !== '')

  if (lines.length < 2) {
    return { valid: false, reason: 'CSV至少需要包含表头和一行数据' }
  }

  let quoteCount = 0
  for (const char of content) {
    if (char === '"') quoteCount++
  }

  if (quoteCount % 2 !== 0) {
    return { valid: false, reason: 'CSV存在未闭合的双引号，请检查字段内容' }
  }

  const headerColumns = lines[0].split(',').length

  for (let i = 1; i < lines.length; i++) {
    const currentColumns = lines[i].split(',').length

    if (currentColumns !== headerColumns) {
      return {
        valid: false,
        reason: `CSV第 ${i + 1} 行列数为 ${currentColumns}，与表头列数 ${headerColumns} 不一致`
      }
    }
  }

  return { valid: true }
}

// 计算文件哈希
const calculateFileHash = (filePath) => {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
};

// 格式归一化：将文件扩展名映射为数据库枚举值
const normalizeDataFormat = (filename) => {
  const ext = path.extname(filename).toLowerCase();

  const formatMap = {
    ".csv": "csv",
    ".xlsx": "excel",
    ".xls": "excel",
    ".json": "json",
    ".txt": "txt",
    ".pdf": "pdf",
    ".doc": "word",
    ".docx": "word",
    ".zip": "archive",
    ".rar": "archive",
    ".jpg": "image",
    ".jpeg": "image",
    ".png": "image",
    ".gif": "image",
  };

  return formatMap[ext] || "other";
};

// 检查配额
const checkQuota = async (userId) => {
  const [users] = await pool.execute(
    'SELECT quota_total, quota_used FROM users WHERE id = ?',
    [userId]
  );

  if (users.length === 0) return { hasQuota: false };

  const { quota_total, quota_used } = users[0];
  return {
    hasQuota: quota_used < quota_total,
    total: quota_total,
    used: quota_used,
    remaining: quota_total - quota_used
  };
};

// 消耗配额
const consumeQuota = async (userId, dataId, actionType = 'data_submit') => {
  await pool.execute(
    'UPDATE users SET quota_used = quota_used + 1 WHERE id = ?',
    [userId]
  );

  await pool.execute(
    'INSERT INTO quota_usage_logs (user_id, action_type, quota_consumed, data_id) VALUES (?, ?, 1, ?)',
    [userId, actionType, dataId]
  );
};

const VISIBILITY_VALUES = new Set(['private', 'limited', 'public']);

// 公开数据允许展示的审核状态：
// expert_approved：专家审核通过
// final_approved：管理员终审通过
const PUBLIC_REVIEW_STATUSES = ['expert_approved', 'final_approved'];
const PUBLIC_REVIEW_STATUS_PLACEHOLDERS = PUBLIC_REVIEW_STATUSES.map(() => '?').join(', ');

const LIMITED_REVIEW_STATUSES = ['final_approved'];

const normalizeUserIdList = (value) => {
  if (!value) return [];

  let parsed = value;

  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value.split(',');
    }
  }

  if (!Array.isArray(parsed)) return [];

  return [...new Set(
    parsed
      .map((item) => Number.parseInt(item, 10))
      .filter((item) => Number.isSafeInteger(item) && item > 0)
  )];
};

const isTeacherOfSubmitter = async (db, teacherId, submitterId) => {
  const [relations] = await db.execute(
    `SELECT id
     FROM teacher_student_relations
     WHERE teacher_id = ? AND student_id = ? AND status = 'active'
     LIMIT 1`,
    [teacherId, submitterId]
  );

  return relations.length > 0;
};

const canReviewData = async (db, user, data) => {
  if (!user || !data) return false;

  if (Number(data.submitter_id) === Number(user.id)) return true;
  if (user.role === 'admin') return true;

  const [reviews] = await db.execute(
    `SELECT id
     FROM review_records
     WHERE data_id = ?
       AND status = 'pending'
       AND (
         reviewer_id = ?
         OR (reviewer_id IS NULL AND review_type = 'expert' AND ? = 'expert')
         OR (reviewer_id IS NULL AND review_type = 'admin' AND ? = 'admin')
       )
     LIMIT 1`,
    [data.id, user.id, user.role, user.role]
  );

  if (reviews.length > 0) return true;

  if (user.role === 'teacher') {
    return isTeacherOfSubmitter(db, user.id, data.submitter_id);
  }

  return false;
};

const canAccessData = async (db, user, data) => {
  if (!data) return false;

  if (
    data.visibility === 'public' &&
    PUBLIC_REVIEW_STATUSES.includes(data.review_status)
  ) {
    return true;
  }

  if (!user) return false;

  if (await canReviewData(db, user, data)) {
    return true;
  }

  if (
    data.visibility === 'limited' &&
    LIMITED_REVIEW_STATUSES.includes(data.review_status) &&
    data.view_permission
  ) {
    const permissionList = normalizeUserIdList(data.view_permission);
    return permissionList.includes(Number(user.id));
  }

  return false;
};

const REVIEW_TYPE_LABELS = {
  teacher: '导师一审',
  expert: '专家盲审',
  admin: '管理员终审'
};

const safeJsonArray = value => {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return value ? [value] : [];
    }
  }

  return [];
};

const serializeReviewRecord = row => {
  return {
    id: row.id,
    review_type: row.review_type,
    review_type_label: REVIEW_TYPE_LABELS[row.review_type] || row.review_type,
    status: row.status,
    completeness_score: row.completeness_score,
    accuracy_score: row.accuracy_score,
    originality_score: row.originality_score,
    methodology_score: row.methodology_score,
    overall_score: row.overall_score,
    comments: row.comments,
    issues_found: safeJsonArray(row.issues_found),
    suggestions: row.suggestions,
    ai_assisted: Boolean(row.ai_assisted),
    completed_at: row.completed_at,
    created_at: row.created_at,

    // 身份脱敏：只展示审核结果，不展示审核人身份
    reviewer_display_name: null,
    reviewer_identity_hidden: true
  };
};

const getReviewChain = async (db, dataId) => {
  const [rows] = await db.query(
    `SELECT
      id,
      data_id,
      reviewer_id,
      review_type,
      status,
      completeness_score,
      accuracy_score,
      originality_score,
      methodology_score,
      overall_score,
      comments,
      issues_found,
      suggestions,
      ai_assisted,
      completed_at,
      created_at
    FROM review_records
    WHERE data_id = ?
      AND status <> 'pending'
    ORDER BY
      FIELD(review_type, 'teacher', 'expert', 'admin'),
      completed_at ASC,
      id ASC`,
    [dataId]
  );

  return rows.map(serializeReviewRecord);
};

const attachViewPermissionUsers = async (db, data, user) => {
  if (!data || data.visibility !== 'limited') {
    return data;
  }

  const isAdmin = user?.role === 'admin';
  const isOwner = Number(user?.id) === Number(data.submitter_id);

  // 只有管理员和数据发布者能看到完整受限名单
  if (!isAdmin && !isOwner) {
    delete data.view_permission;
    data.view_permission_users = [];
    return data;
  }

  const ids = normalizeUserIdList(data.view_permission);

  if (!ids.length) {
    data.view_permission_users = [];
    return data;
  }

  const placeholders = ids.map(() => '?').join(',');

  const [users] = await db.query(
    `SELECT
      id,
      username,
      real_name,
      email,
      role
    FROM users
    WHERE id IN (${placeholders})
    ORDER BY FIELD(id, ${placeholders})`,
    [...ids, ...ids]
  );

  data.view_permission_users = users.map(item => ({
    id: item.id,
    username: item.username,
    real_name: item.real_name,
    email: item.email,
    role: item.role
  }));

  return data;
};

// 上传数据文件（使用事务+行锁防止并发额度击穿）
router.post('/upload', authenticate, authorize('student', 'teacher', 'admin', 'civilian'), (req, res, next) => {
  req.uploadType = 'data';
  next();
}, upload.single('file'), handleUploadError, verifyFileIntegrity, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未上传文件' });
    }

    const resultData = await withTransaction(async (connection) => {
      // 行级排他锁：同一用户的并发请求在此排队，防止额度击穿
      const [users] = await connection.execute(
        'SELECT quota_total, quota_used FROM users WHERE id = ? FOR UPDATE',
        [req.user.id]
      );

      if (users.length === 0 || users[0].quota_used >= users[0].quota_total) {
        throw new Error('QUOTA_EXHAUSTED');
      }

      const fileHash = calculateFileHash(req.file.path);

      // CSV 格式预检：拦截明显格式错误的 CSV 文件
      const ext = path.extname(req.file.originalname).toLowerCase()
      if (ext === '.csv') {
        const csvValidation = validateCsvFile(req.file.path)
        if (!csvValidation.valid) {
          throw new Error(`CSV_VALIDATION_FAILED:${csvValidation.reason}`)
        }
      }

      const [existing] = await connection.execute(
        'SELECT id FROM data_submissions WHERE file_hash = ? AND submitter_id = ? AND deleted_at IS NULL',
        [fileHash, req.user.id]
      );

      if (existing.length > 0) throw new Error('DUPLICATE_FILE');

      const {
        title,
        description,
        data_type = 'raw',
        visibility = 'private',
        view_permission,
        liability_statement,
        liability_accepted
      } = req.body;
      const originalFilename = normalizeOriginalFilename(req.file.originalname);

      if (!VISIBILITY_VALUES.has(visibility)) {
        throw new Error('INVALID_VISIBILITY');
      }

      const viewPermissionIds = normalizeUserIdList(view_permission);

      if (visibility === 'limited' && viewPermissionIds.length === 0) {
        throw new Error('LIMITED_PERMISSION_REQUIRED');
      }

      let storedViewPermission = null;

      if (visibility === 'limited') {
        const placeholders = viewPermissionIds.map(() => '?').join(',');

        const [validUsers] = await connection.execute(
          `SELECT id
           FROM users
           WHERE id IN (${placeholders})
             AND status = 'active'
             AND deleted_at IS NULL`,
          viewPermissionIds
        );

        if (validUsers.length !== viewPermissionIds.length) {
          throw new Error('INVALID_VIEW_PERMISSION');
        }

        storedViewPermission = JSON.stringify(validUsers.map((item) => Number(item.id)));
      }

      const liabilityAccepted =
        liability_accepted === true ||
        liability_accepted === 'true' ||
        liability_accepted === '1';

      const [insertResult] = await connection.execute(
        `INSERT INTO data_submissions (submitter_id, title, description, data_type, data_format,
         file_path, file_size, file_hash, original_filename, visibility, view_permission, liability_statement, is_liability_accepted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          title || originalFilename,
          description || null,
          data_type,
          normalizeDataFormat(originalFilename),
          req.file.path,
          req.file.size,
          fileHash,
          originalFilename,
          visibility,
          storedViewPermission,
          liability_statement || null,
          liabilityAccepted ? 1 : 0
        ]
      );

      await connection.execute('UPDATE users SET quota_used = quota_used + 1 WHERE id = ?', [req.user.id]);

      await connection.execute(
        'INSERT INTO quota_usage_logs (user_id, action_type, quota_consumed, data_id) VALUES (?, "data_submit", 1, ?)',
        [req.user.id, insertResult.insertId]
      );

      return { dataId: insertResult.insertId, fileHash, remaining: users[0].quota_total - users[0].quota_used - 1 };
    });

    logger.info(`数据上传成功: ID=${resultData.dataId}, User=${req.user.username}`);

    res.status(201).json({
      message: '上传成功',
      data_id: resultData.dataId,
      file_hash: resultData.fileHash,
      quota_remaining: resultData.remaining
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    if (error.message === 'QUOTA_EXHAUSTED') {
      return res.status(403).json({ error: '配额已用完' });
    }
    if (error.message === 'DUPLICATE_FILE') {
      return res.status(409).json({
        error: '相同内容的文件已上传过，即使文件名不同也会被识别为重复',
        code: 'DUPLICATE_FILE',
        duplicate_by: 'file_hash'
      });
    }
    if (error.message === 'INVALID_VISIBILITY') {
      return res.status(400).json({ error: '无效的可见性设置' });
    }
    if (error.message === 'LIMITED_PERMISSION_REQUIRED') {
      return res.status(400).json({ error: '受限数据必须指定至少一个可见人员' });
    }
    if (error.message === 'INVALID_VIEW_PERMISSION') {
      return res.status(400).json({ error: '指定可见人员不存在或不可用' });
    }
    if (error.message.startsWith('CSV_VALIDATION_FAILED:')) {
      return res.status(400).json({ error: error.message.replace('CSV_VALIDATION_FAILED:', '') });
    }
    logger.error('数据上传失败:', error);
    res.status(500).json({ error: '上传失败' });
  }
});

// 教师查看指定学生的数据列表
router.get('/student/:studentId', authenticate, authorize('teacher', 'admin'), async (req, res) => {
  try {
    const studentId = req.params.studentId;
    const teacherId = req.user.id;

    // 验证师生关系（admin 跳过检查）
    if (req.user.role !== 'admin') {
      const [relations] = await pool.execute(
        `SELECT id FROM teacher_student_relations
         WHERE teacher_id = ? AND student_id = ? AND status = 'active'`,
        [teacherId, studentId]
      );
      if (relations.length === 0) {
        return res.status(403).json({ error: '无权查看该学生数据' });
      }
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const { status, data_type } = req.query;
    const offset = (page - 1) * limit;

    let query = `SELECT id, title, description, data_type, data_format, file_size,
                        visibility, review_status, review_progress, ai_check_status, ai_check_score,
                        ai_anomaly_detected, version, citation_count, download_count,
                        created_at, submitted_at, completed_at
                 FROM data_submissions
                 WHERE submitter_id = ? AND deleted_at IS NULL`;
    let params = [studentId];

    if (status) {
      query += ' AND review_status = ?';
      params.push(status);
    }

    if (data_type) {
      query += ' AND data_type = ?';
      params.push(data_type);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [data] = await pool.query(query, params);

    let countQuery = 'SELECT COUNT(*) as total FROM data_submissions WHERE submitter_id = ? AND deleted_at IS NULL';
    let countParams = [studentId];
    if (status) {
      countQuery += ' AND review_status = ?';
      countParams.push(status);
    }
    if (data_type) {
      countQuery += ' AND data_type = ?';
      countParams.push(data_type);
    }
    const [countResult] = await pool.execute(countQuery, countParams);

    res.json({
      data,
      pagination: {
        page,
        limit,
        total: countResult[0].total
      }
    });
  } catch (error) {
    logger.error('获取学生数据列表失败:', error);
    res.status(500).json({ error: '获取学生数据列表失败' });
  }
});

// 获取我的数据列表
router.get('/my', authenticate, async (req, res) => {
  try {
    // 验证用户ID
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: '用户未认证' });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const { status, data_type } = req.query;
    const offset = (page - 1) * limit;

    const userId = req.user.id;

    let query = `SELECT id, title, description, data_type, data_format, file_size,
                        visibility, review_status, review_progress, ai_check_status, ai_check_score,
                        ai_anomaly_detected, version, citation_count, download_count,
                        created_at, submitted_at, completed_at
                 FROM data_submissions
                 WHERE submitter_id = ? AND deleted_at IS NULL`;
    let params = [userId];

    if (status) {
      query += ' AND review_status = ?';
      params.push(status);
    }

    if (data_type) {
      query += ' AND data_type = ?';
      params.push(data_type);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [data] = await pool.query(query, params);

    // 总数统计必须复用同样的筛选条件
    let countQuery = 'SELECT COUNT(*) as total FROM data_submissions WHERE submitter_id = ? AND deleted_at IS NULL';
    let countParams = [userId];
    if (status) {
      countQuery += ' AND review_status = ?';
      countParams.push(status);
    }
    if (data_type) {
      countQuery += ' AND data_type = ?';
      countParams.push(data_type);
    }
    const [countResult] = await pool.execute(countQuery, countParams);

    res.json({
      data,
      pagination: {
        page,
        limit,
        total: countResult[0].total
      }
    });
  } catch (error) {
    logger.error('获取数据列表失败:', error);
    res.status(500).json({ error: '获取数据列表失败' });
  }
});

// 获取公开数据列表：返回设置为公开，且已通过专家审核或管理员终审的数据
router.get('/public', optionalAuth, async (req, res) => {
  try {
    const pageNum = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 100);
    const offset = (pageNum - 1) * limitNum;

    const [data] = await pool.query(
      `SELECT
         d.id,
         d.title,
         d.description,
         d.data_type,
         d.data_format,
         d.file_size,
         d.citation_count,
         d.download_count,
         d.completed_at,
         d.updated_at,
         d.created_at,
         COALESCE(d.completed_at, d.updated_at, d.created_at) AS public_approved_at,
         d.review_status,
         u.real_name AS submitter_real_name
       FROM data_submissions d
       JOIN users u ON d.submitter_id = u.id
       WHERE d.visibility = 'public'
         AND d.review_status IN (${PUBLIC_REVIEW_STATUS_PLACEHOLDERS})
         AND d.deleted_at IS NULL
       ORDER BY public_approved_at DESC, d.id DESC
       LIMIT ? OFFSET ?`,
      [...PUBLIC_REVIEW_STATUSES, limitNum, offset]
    );

    const [countResult] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM data_submissions
       WHERE visibility = 'public'
         AND review_status IN (${PUBLIC_REVIEW_STATUS_PLACEHOLDERS})
         AND deleted_at IS NULL`,
      PUBLIC_REVIEW_STATUSES
    );

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countResult[0].total
      }
    });
  } catch (error) {
    logger.error('获取公开数据列表失败:', error);
    res.status(500).json({ error: '获取公开数据列表失败' });
  }
});

// 获取可见数据列表：公开且审核通过的数据 + 当前用户被授权查看的受限且终审通过的数据
router.get('/visible', optionalAuth, async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const offset = (page - 1) * limit;

    const whereParts = [
      `(
        d.visibility = 'public'
        AND d.review_status IN (${PUBLIC_REVIEW_STATUS_PLACEHOLDERS})
        AND d.deleted_at IS NULL
      )`
    ];

    const baseParams = [...PUBLIC_REVIEW_STATUSES];

    if (req.user?.id) {
      whereParts.push(
        `(
          d.visibility = 'limited'
          AND d.review_status = 'final_approved'
          AND d.deleted_at IS NULL
          AND d.view_permission IS NOT NULL
          AND JSON_VALID(d.view_permission)
          AND (
            JSON_CONTAINS(d.view_permission, CAST(? AS JSON), '$')
            OR JSON_CONTAINS(d.view_permission, JSON_QUOTE(?), '$')
          )
        )`
      );

      baseParams.push(String(req.user.id), String(req.user.id));
    }

    const whereSql = whereParts.map(w => `(${w})`).join(' OR ');

    const [rows] = await pool.query(
      `SELECT
        d.id,
        d.title,
        d.description,
        d.data_type,
        d.data_format,
        d.file_size,
        d.visibility,
        d.review_status,
        d.ai_check_status,
        d.ai_check_score,
        d.ai_anomaly_detected,
        d.submitted_at,
        d.download_count,
        u.username AS submitter_name,
        u.real_name AS submitter_real_name
      FROM data_submissions d
      JOIN users u ON d.submitter_id = u.id
      WHERE ${whereSql}
      ORDER BY d.submitted_at DESC
      LIMIT ? OFFSET ?`,
      [...baseParams, limit, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
      FROM data_submissions d
      WHERE ${whereSql}`,
      baseParams
    );

    const total = countRows[0]?.total || 0;

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total
      }
    });
  } catch (error) {
    next(error);
  }
});

// 获取数据详情
router.get('/:id', optionalAuth, auditLog('data', 'view'), async (req, res) => {
  try {
    const dataId = req.params.id;

    const [dataList] = await pool.execute(
      `SELECT d.*, u.username as submitter_name, u.real_name as submitter_real_name
       FROM data_submissions d
       JOIN users u ON d.submitter_id = u.id
       WHERE d.id = ? AND d.deleted_at IS NULL`,
      [dataId]
    );

    if (dataList.length === 0) {
      return res.status(404).json({ error: '数据不存在' });
    }

    const data = dataList[0];

    const hasPermission = await canAccessData(pool, req.user, data);

    if (!hasPermission) {
      return res.status(403).json({ error: '无权查看此数据' });
    }

    // 盲审模式处理：如果是专家审核中，隐藏提交者信息
    if (data.review_status === 'expert_reviewing' && req.user?.role === 'expert') {
      data.submitter_name = null;
      data.submitter_real_name = null;
      data.submitter_id = null;
    }

    data.review_chain = await getReviewChain(pool, data.id);
    data.prior_reviews = data.review_chain;

    await attachViewPermissionUsers(pool, data, req.user);

    res.json({ data });
  } catch (error) {
    logger.error('获取数据详情失败:', error);
    res.status(500).json({ error: '获取数据详情失败' });
  }
});

// 下载数据
router.get('/:id/download', optionalAuth, auditLog('data', 'download'), async (req, res) => {
  try {
    const dataId = req.params.id;

    const [dataList] = await pool.execute(
      'SELECT id, file_path, original_filename, file_hash, submitter_id, visibility, view_permission, review_status FROM data_submissions WHERE id = ? AND deleted_at IS NULL',
      [dataId]
    );

    if (dataList.length === 0) {
      return res.status(404).json({ error: '数据不存在' });
    }

    const data = dataList[0];

    const hasPermission = await canAccessData(pool, req.user, data);

    if (!hasPermission) {
      return res.status(403).json({ error: '无权下载此数据' });
    }

    if (!fs.existsSync(data.file_path)) {
      return res.status(404).json({ error: '文件不存在' });
    }

    // 验证文件哈希
    const currentHash = calculateFileHash(data.file_path);
    if (currentHash !== data.file_hash) {
      logger.error(`文件完整性校验失败: data_id=${dataId}`);
      return res.status(500).json({ error: '文件完整性校验失败' });
    }

    // 更新下载计数
    await pool.execute(
      'UPDATE data_submissions SET download_count = download_count + 1 WHERE id = ?',
      [dataId]
    );

    const downloadFilename = normalizeOriginalFilename(data.original_filename || path.basename(data.file_path));

    res.setHeader('Content-Type', 'application/octet-stream; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', buildContentDisposition(downloadFilename));

    return res.sendFile(path.resolve(data.file_path), (sendError) => {
      if (sendError) {
        logger.error('发送下载文件失败:', sendError);

        if (!res.headersSent) {
          res.status(500).json({ error: '下载失败' });
        }
      }
    });
  } catch (error) {
    logger.error('下载数据失败:', error);
    res.status(500).json({ error: '下载失败' });
  }
});

// 提交审核
router.post(
  '/:id/submit',
  authenticate,
  authorize('student', 'teacher', 'admin', 'civilian'),
  auditLog('data', 'create'),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const dataId = Number.parseInt(req.params.id, 10);
      const teacherId =
        req.body.teacher_id === undefined || req.body.teacher_id === null || req.body.teacher_id === ''
          ? null
          : Number.parseInt(req.body.teacher_id, 10);

      const liabilityAccepted = Boolean(req.body.liability_accepted);

      if (!Number.isFinite(dataId) || dataId <= 0) {
        return res.status(400).json({ error: '无效的数据ID' });
      }

      if (!liabilityAccepted) {
        return res.status(400).json({ error: '提交审核前必须确认责任声明' });
      }

      await connection.beginTransaction();

      const [dataList] = await connection.execute(
        `SELECT id, submitter_id, title, review_status, ai_check_status
         FROM data_submissions
         WHERE id = ? AND deleted_at IS NULL
         FOR UPDATE`,
        [dataId]
      );

      if (dataList.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: '数据不存在' });
      }

      const data = dataList[0];

      if (data.submitter_id !== req.user.id) {
        await connection.rollback();
        return res.status(403).json({ error: '无权操作此数据' });
      }

      // 检查 AI 检测状态，学生和普通账号必须通过 AI 检测才能提交审核
      if (['student', 'civilian'].includes(req.user.role) && data.ai_check_status !== 'completed') {
        await connection.rollback();
        return res.status(400).json({
          error: 'AI检测未完成或检测失败，暂不能提交审核'
        });
      }

      const allowedStatuses = ['draft', 'teacher_rejected', 'expert_rejected', 'final_rejected'];

      if (!allowedStatuses.includes(data.review_status)) {
        await connection.rollback();
        return res.status(400).json({ error: '该数据当前状态不允许提交审核' });
      }

      await connection.execute(
        `DELETE FROM review_records
         WHERE data_id = ? AND status = 'pending'`,
        [dataId]
      );

      if (req.user.role === 'student') {
        if (!Number.isFinite(teacherId) || teacherId <= 0) {
          await connection.rollback();
          return res.status(400).json({ error: '请指定有效的导师' });
        }

        const [teacherRows] = await connection.execute(
          `SELECT id, status
           FROM users
           WHERE id = ?
             AND role = 'teacher'
             AND status = 'active'
             AND deleted_at IS NULL`,
          [teacherId]
        );

        if (teacherRows.length === 0) {
          await connection.rollback();
          return res.status(400).json({ error: '指定导师不存在或未通过身份验证' });
        }

        const [relations] = await connection.execute(
          `SELECT id
           FROM teacher_student_relations
           WHERE teacher_id = ?
             AND student_id = ?
             AND status = 'active'`,
          [teacherId, req.user.id]
        );

        if (relations.length === 0) {
          await connection.rollback();
          return res.status(403).json({ error: '只能提交给已确认绑定的导师审核' });
        }

        await connection.execute(
          `UPDATE data_submissions
           SET review_status = 'teacher_reviewing',
               submitted_at = NOW(),
               is_liability_accepted = 1,
               review_progress = 10
           WHERE id = ?`,
          [dataId]
        );

        await connection.execute(
          `INSERT INTO review_records
           (data_id, reviewer_id, review_type, status, is_blind_review)
           VALUES (?, ?, 'teacher', 'pending', 0)`,
          [dataId, teacherId]
        );

        await connection.execute(
          `INSERT INTO notifications (user_id, type, title, content, related_type, related_id)
           VALUES (?, 'review', '新的导师审核任务', ?, 'data', ?)`,
          [
            teacherId,
            `学生 ${req.user.real_name || req.user.username} 提交了数据《${data.title}》，请进行导师一审。`,
            dataId
          ]
        );

        await connection.commit();

        return res.json({
          message: '数据已提交导师审核',
          review_status: 'teacher_reviewing',
          review_progress: 10
        });
      }

      // 普通账号：无导师，直接进入专家审核队列
      if (req.user.role === 'civilian') {
        await connection.execute(
          `UPDATE data_submissions
           SET review_status = 'expert_reviewing',
               submitted_at = NOW(),
               is_liability_accepted = 1,
               review_progress = 40
           WHERE id = ?`,
          [dataId]
        );

        await connection.execute(
          `INSERT INTO review_records
           (data_id, reviewer_id, review_type, status, is_blind_review)
           VALUES (?, NULL, 'expert', 'pending', 1)`,
          [dataId]
        );

        await connection.execute(
          `INSERT INTO notifications (user_id, type, title, content, related_type, related_id)
           SELECT id, 'review', '新的专家审核任务', ?, 'data', ?
           FROM users
           WHERE role = 'expert'
             AND status = 'active'
             AND deleted_at IS NULL`,
          [
            `普通账号 ${req.user.real_name || req.user.username} 提交了数据《${data.title}》，请进行专家审核。`,
            dataId
          ]
        );

        await connection.commit();
        return res.json({
          message: '数据已提交专家审核',
          review_status: 'expert_reviewing',
          review_progress: 40
        });
      }

      // 管理员/教师：跳过导师一审，直接进入管理员最终审核队列
      await connection.execute(
        `UPDATE data_submissions
         SET review_status = 'expert_approved',
             submitted_at = NOW(),
             is_liability_accepted = 1,
             review_progress = 70
         WHERE id = ?`,
        [dataId]
      );

      await connection.execute(
        `INSERT INTO review_records
         (data_id, reviewer_id, review_type, status, is_blind_review)
         VALUES (?, NULL, 'admin', 'pending', 0)`,
        [dataId]
      );

      await connection.execute(
        `INSERT INTO notifications (user_id, type, title, content, related_type, related_id)
         SELECT id, 'review', '新的最终审核任务', ?, 'data', ?
         FROM users
         WHERE role = 'admin'
           AND status = 'active'
           AND deleted_at IS NULL`,
        [
          `用户 ${req.user.real_name || req.user.username} 提交了数据《${data.title}》，请进行管理员最终审核。`,
          dataId
        ]
      );

      await connection.commit();

      return res.json({
        message: '数据已提交管理员最终审核',
        review_status: 'expert_approved',
        review_progress: 70
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        logger.error('提交审核回滚失败:', rollbackError);
      }

      logger.error('提交审核失败:', {
        message: error.message,
        code: error.code,
        errno: error.errno,
        sqlMessage: error.sqlMessage,
        stack: error.stack
      });

      const clientMessage =
        process.env.NODE_ENV === 'production'
          ? '提交审核失败'
          : (error.sqlMessage || error.message || '提交审核失败');

      res.status(500).json({ error: clientMessage });
    } finally {
      connection.release();
    }
  }
);

// 删除数据
router.delete('/:id', authenticate, auditLog('data', 'delete'), async (req, res) => {
  try {
    const dataId = req.params.id;
    const [dataList] = await pool.execute(
      `SELECT id, submitter_id, review_status FROM data_submissions WHERE id = ? AND deleted_at IS NULL`,
      [dataId]
    );
    if (dataList.length === 0) {
      return res.status(404).json({ error: '数据不存在' });
    }
    const data = dataList[0];
    const isOwner = data.submitter_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    const canDeleteStatus = ['draft', 'final_rejected'].includes(data.review_status);
    if (!isAdmin && (!isOwner || !canDeleteStatus)) {
      return res.status(403).json({ error: '当前状态不允许删除该数据' });
    }
    await pool.execute(`UPDATE data_submissions SET deleted_at = NOW() WHERE id = ?`, [dataId]);
    res.json({ message: '删除成功' });
  } catch (error) {
    logger.error('删除数据失败:', error);
    res.status(500).json({ error: '删除数据失败' });
  }
});

module.exports = router;

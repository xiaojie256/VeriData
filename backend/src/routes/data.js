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

const router = express.Router();
const UPLOAD_PATH = process.env.UPLOAD_PATH || './uploads';

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
        liability_statement,
        liability_accepted
      } = req.body;

      const liabilityAccepted =
        liability_accepted === true ||
        liability_accepted === 'true' ||
        liability_accepted === '1';

      const [insertResult] = await connection.execute(
        `INSERT INTO data_submissions (submitter_id, title, description, data_type, data_format,
         file_path, file_size, file_hash, original_filename, visibility, liability_statement, is_liability_accepted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          title || req.file.originalname,
          description || null,
          data_type,
          normalizeDataFormat(req.file.originalname),
          req.file.path,
          req.file.size,
          fileHash,
          req.file.originalname,
          visibility,
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
      return res.status(409).json({ error: '该文件已上传过' });
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

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const { status } = req.query;
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

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [data] = await pool.query(query, params);

    let countQuery = 'SELECT COUNT(*) as total FROM data_submissions WHERE submitter_id = ? AND deleted_at IS NULL';
    let countParams = [studentId];
    if (status) {
      countQuery += ' AND review_status = ?';
      countParams.push(status);
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

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const { status } = req.query;
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

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [data] = await pool.query(query, params);

    // 修正：总数统计必须动态复用相同的过滤条件，防止分页总数失真
    let countQuery = 'SELECT COUNT(*) as total FROM data_submissions WHERE submitter_id = ? AND deleted_at IS NULL';
    let countParams = [userId];
    if (status) {
      countQuery += ' AND review_status = ?';
      countParams.push(status);
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

// 获取数据详情
router.get('/:id', authenticate, auditLog('data', 'view'), async (req, res) => {
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

    // 修正：只有最终终审通过(final_approved)的公开数据才允许全员免签查看
    let hasPermission =
      data.submitter_id === req.user.id ||
      (data.visibility === 'public' && data.review_status === 'final_approved') ||
      req.user.role === 'admin';

    // 检查limited权限
    if (data.visibility === 'limited' && data.view_permission) {
      try {
        const permissionList = JSON.parse(data.view_permission);
        if (permissionList.includes(req.user.id)) {
          hasPermission = true;
        }
      } catch (e) {
        logger.error("解析view_permission失败:", e);
      }
    }

    if (!hasPermission) {
      return res.status(403).json({ error: '无权查看此数据' });
    }

    // 盲审模式处理：如果是专家审核中，隐藏提交者信息
    if (data.review_status === 'expert_reviewing' && req.user.role === 'expert') {
      data.submitter_name = null;
      data.submitter_real_name = null;
      data.submitter_id = null;
    }

    res.json({ data });
  } catch (error) {
    logger.error('获取数据详情失败:', error);
    res.status(500).json({ error: '获取数据详情失败' });
  }
});

// 下载数据
router.get('/:id/download', authenticate, auditLog('data', 'download'), async (req, res) => {
  try {
    const dataId = req.params.id;

    const [dataList] = await pool.execute(
      'SELECT file_path, original_filename, file_hash, submitter_id, visibility, view_permission, review_status FROM data_submissions WHERE id = ? AND deleted_at IS NULL',
      [dataId]
    );

    if (dataList.length === 0) {
      return res.status(404).json({ error: '数据不存在' });
    }

    const data = dataList[0];

    // 权限检查
    let hasPermission =
      data.submitter_id === req.user.id ||
      (data.visibility === 'public' && data.review_status === 'final_approved') ||
      req.user.role === 'admin';

    // 教师可以查看自己学生的数据
    if (!hasPermission && req.user.role === 'teacher') {
      const [relations] = await pool.execute(
        `SELECT id FROM teacher_student_relations
         WHERE teacher_id = ? AND student_id = ? AND status = 'active'`,
        [req.user.id, data.submitter_id]
      );
      if (relations.length > 0) {
        hasPermission = true;
      }
    }

    // 检查limited权限
    if (data.visibility === 'limited' && data.view_permission) {
      try {
        const permissionList = JSON.parse(data.view_permission);
        if (permissionList.includes(req.user.id)) {
          hasPermission = true;
        }
      } catch (e) {
        logger.error("解析view_permission失败:", e);
      }
    }

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

    res.download(data.file_path, data.original_filename);
  } catch (error) {
    logger.error('下载数据失败:', error);
    res.status(500).json({ error: '下载失败' });
  }
});

// 提交审核
router.post(
  '/:id/submit',
  authenticate,
  authorize('student', 'teacher'),
  auditLog('data', 'create'),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const dataId = Number.parseInt(req.params.id, 10);
      const teacherId = Number.parseInt(req.body.teacher_id, 10);
      const liabilityAccepted = Boolean(req.body.liability_accepted);

      if (!Number.isFinite(dataId) || dataId <= 0) {
        return res.status(400).json({ error: '无效的数据ID' });
      }

      if (!Number.isFinite(teacherId) || teacherId <= 0) {
        return res.status(400).json({ error: '请指定有效的导师' });
      }

      if (!liabilityAccepted) {
        return res.status(400).json({ error: '提交审核前必须确认责任声明' });
      }

      await connection.beginTransaction();

      const [dataList] = await connection.execute(
        `SELECT id, submitter_id, title, review_status
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

      const allowedStatuses = ['draft', 'teacher_rejected', 'expert_rejected', 'final_rejected'];

      if (!allowedStatuses.includes(data.review_status)) {
        await connection.rollback();
        return res.status(400).json({ error: '该数据当前状态不允许提交审核' });
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
        `DELETE FROM review_records
         WHERE data_id = ? AND status = 'pending'`,
        [dataId]
      );

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

      res.json({
        message: '数据已提交导师审核',
        review_status: 'teacher_reviewing',
        review_progress: 10
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

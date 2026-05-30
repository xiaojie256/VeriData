const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../utils/database');
const logger = require('../utils/logger');
const { authenticate, authorize, optionalAuth } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');
const { auditLog } = require('../middleware/audit');

const router = express.Router();
const UPLOAD_PATH = process.env.UPLOAD_PATH || './uploads';

// 计算文件哈希
const calculateFileHash = (filePath) => {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
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

// 上传数据文件
router.post('/upload', authenticate, authorize('student', 'teacher', 'admin', 'civilian'), (req, res, next) => {
  req.uploadType = 'data';
  next();
}, upload.single('file'), handleUploadError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未上传文件' });
    }

    // 检查配额
    const quota = await checkQuota(req.user.id);
    if (!quota.hasQuota) {
      // 删除已上传文件
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ 
        error: '配额已用完', 
        quota: { total: quota.total, used: quota.used }
      });
    }

    const fileHash = calculateFileHash(req.file.path);

    // 检查文件是否已存在（防止重复上传）
    const [existing] = await pool.execute(
      'SELECT id FROM data_submissions WHERE file_hash = ? AND submitter_id = ? AND deleted_at IS NULL',
      [fileHash, req.user.id]
    );

    if (existing.length > 0) {
      fs.unlinkSync(req.file.path);
      return res.status(409).json({ error: '该文件已上传过', data_id: existing[0].id });
    }

    const { title, description, data_type = 'raw', visibility = 'private', liability_statement } = req.body;

    // 创建数据记录
    const [result] = await pool.execute(
      `INSERT INTO data_submissions (submitter_id, title, description, data_type, data_format, 
       file_path, file_size, file_hash, original_filename, visibility, liability_statement, is_liability_accepted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        title || req.file.originalname,
        description || null,
        data_type,
        path.extname(req.file.originalname).replace('.', ''),
        req.file.path,
        req.file.size,
        fileHash,
        req.file.originalname,
        visibility,
        liability_statement || null,
        liability_statement ? 1 : 0
      ]
    );

    // 消耗配额
    await consumeQuota(req.user.id, result.insertId);

    logger.info(`数据上传成功: ID=${result.insertId}, User=${req.user.username}`);

    res.status(201).json({
      message: '上传成功',
      data_id: result.insertId,
      file_hash: fileHash,
      quota_remaining: quota.remaining - 1
    });
  } catch (error) {
    logger.error('数据上传失败:', error);
    // 清理文件
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: '上传失败' });
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

    const userId = req.user.id.toString();
    
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

    // 获取总数
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM data_submissions WHERE submitter_id = ? AND deleted_at IS NULL',
      [req.user.id.toString()]
    );

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

    // 权限检查
    const hasPermission = 
      data.submitter_id === req.user.id || // 提交者本人
      data.visibility === 'public' || // 公开数据
      req.user.role === 'admin' || // 管理员
      (data.visibility === 'limited' && data.view_permission && 
       JSON.parse(data.view_permission).includes(req.user.id)); // 在权限列表中

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
      'SELECT file_path, original_filename, file_hash, submitter_id, visibility, view_permission FROM data_submissions WHERE id = ? AND deleted_at IS NULL',
      [dataId]
    );

    if (dataList.length === 0) {
      return res.status(404).json({ error: '数据不存在' });
    }

    const data = dataList[0];

    // 权限检查
    const hasPermission = 
      data.submitter_id === req.user.id ||
      data.visibility === 'public' ||
      req.user.role === 'admin' ||
      (data.visibility === 'limited' && data.view_permission && 
       JSON.parse(data.view_permission).includes(req.user.id));

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
router.post('/:id/submit', authenticate, authorize('student', 'teacher'), auditLog('data', 'create'), async (req, res) => {
  try {
    const dataId = req.params.id;
    const { teacher_id, liability_accepted } = req.body;

    // 验证数据所有权
    const [dataList] = await pool.execute(
      'SELECT submitter_id, review_status FROM data_submissions WHERE id = ? AND deleted_at IS NULL',
      [dataId]
    );

    if (dataList.length === 0) {
      return res.status(404).json({ error: '数据不存在' });
    }

    if (dataList[0].submitter_id !== req.user.id) {
      return res.status(403).json({ error: '无权操作此数据' });
    }

    if (dataList[0].review_status !== 'draft') {
      return res.status(400).json({ error: '该数据已提交审核，无法重复提交' });
    }

    // 更新状态
    await pool.execute(
      `UPDATE data_submissions 
       SET review_status = 'submitted', submitted_at = NOW(), 
           is_liability_accepted = ?, review_progress = 10
       WHERE id = ?`,
      [liability_accepted ? 1 : 0, dataId]
    );

    // 创建审核记录（导师一审）
    await pool.execute(
      `INSERT INTO review_records (data_id, reviewer_id, review_type, status, is_blind_review)
       VALUES (?, ?, 'teacher', 'pending', 0)`,
      [dataId, teacher_id]
    );

    // 发送通知
    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, content, related_type, related_id)
       VALUES (?, 'review', '新的数据审核请求', ?, 'data', ?)`,
      [teacher_id, `学生${req.user.real_name || req.user.username}提交了数据《${dataList[0].title}》等待您审核`, dataId]
    );

    logger.info(`数据提交审核: data_id=${dataId}`);

    res.json({ message: '提交审核成功' });
  } catch (error) {
    logger.error('提交审核失败:', error);
    res.status(500).json({ error: '提交审核失败' });
  }
});

// 更新数据信息
router.put('/:id', authenticate, async (req, res) => {
  try {
    const dataId = req.params.id;
    const { title, description, visibility } = req.body;

    // 验证数据所有权
    const [dataList] = await pool.execute(
      'SELECT submitter_id, review_status FROM data_submissions WHERE id = ? AND deleted_at IS NULL',
      [dataId]
    );

    if (dataList.length === 0) {
      return res.status(404).json({ error: '数据不存在' });
    }

    if (dataList[0].submitter_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '无权操作此数据' });
    }

    // 只有草稿或已拒绝的数据可以修改
    const editableStatuses = ['draft', 'teacher_rejected', 'expert_rejected', 'final_rejected'];
    if (!editableStatuses.includes(dataList[0].review_status) && req.user.role !== 'admin') {
      return res.status(400).json({ error: '当前状态下无法修改数据' });
    }

    await pool.execute(
      'UPDATE data_submissions SET title = ?, description = ?, visibility = ? WHERE id = ?',
      [title, description, visibility, dataId]
    );

    res.json({ message: '更新成功' });
  } catch (error) {
    logger.error('更新数据失败:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除数据
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const dataId = req.params.id;

    const [dataList] = await pool.execute(
      'SELECT submitter_id, file_path FROM data_submissions WHERE id = ? AND deleted_at IS NULL',
      [dataId]
    );

    if (dataList.length === 0) {
      return res.status(404).json({ error: '数据不存在' });
    }

    if (dataList[0].submitter_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '无权删除此数据' });
    }

    // 软删除
    await pool.execute(
      'UPDATE data_submissions SET deleted_at = NOW() WHERE id = ?',
      [dataId]
    );

    logger.info(`数据已删除: data_id=${dataId}`);

    res.json({ message: '删除成功' });
  } catch (error) {
    logger.error('删除数据失败:', error);
    res.status(500).json({ error: '删除失败' });
  }
});

module.exports = router;

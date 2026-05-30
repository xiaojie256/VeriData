const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../utils/database');
const logger = require('../utils/logger');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// 获取仪表盘统计
router.get('/dashboard', authenticate, authorize('admin'), async (req, res) => {
  try {
    // 用户统计
    const [userStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) as students,
        SUM(CASE WHEN role = 'teacher' THEN 1 ELSE 0 END) as teachers,
        SUM(CASE WHEN role = 'expert' THEN 1 ELSE 0 END) as experts,
        SUM(CASE WHEN status = 'pending_verification' THEN 1 ELSE 0 END) as pending_verification
       FROM users WHERE deleted_at IS NULL`
    );

    // 数据统计
    const [dataStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_data,
        SUM(CASE WHEN review_status = 'draft' THEN 1 ELSE 0 END) as drafts,
        SUM(CASE WHEN review_status IN ('submitted', 'teacher_reviewing') THEN 1 ELSE 0 END) as teacher_pending,
        SUM(CASE WHEN review_status IN ('teacher_approved', 'expert_reviewing') THEN 1 ELSE 0 END) as expert_pending,
        SUM(CASE WHEN review_status = 'final_approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN review_status IN ('teacher_rejected', 'expert_rejected', 'final_rejected') THEN 1 ELSE 0 END) as rejected
       FROM data_submissions WHERE deleted_at IS NULL`
    );

    // 审核统计
    const [reviewStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_reviews,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_reviews,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_reviews,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_reviews
       FROM review_records`
    );

    // 最近7天数据提交趋势
    const [weeklyTrend] = await pool.execute(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM data_submissions
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND deleted_at IS NULL
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    );

    res.json({
      user_stats: userStats[0],
      data_stats: dataStats[0],
      review_stats: reviewStats[0],
      weekly_trend: weeklyTrend
    });
  } catch (error) {
    logger.error('获取仪表盘数据失败:', error);
    res.status(500).json({ error: '获取统计数据失败' });
  }
});

// 获取用户列表
router.get('/users', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { page = 1, limit = 20, role, status, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE deleted_at IS NULL';
    let params = [];

    if (role) {
      whereClause += ' AND role = ?';
      params.push(role);
    }

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    if (search) {
      whereClause += ' AND (username LIKE ? OR email LIKE ? OR real_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [users] = await pool.query(
      `SELECT id, username, email, real_name, role, status, phone_verified, id_verified,
              quota_total, quota_used, last_login_at, created_at
       FROM users ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM users ${whereClause}`,
      params
    );

    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total
      }
    });
  } catch (error) {
    logger.error('获取用户列表失败:', error);
    res.status(500).json({ error: '获取用户列表失败' });
  }
});

// 审核用户（验证身份）
router.post('/users/:id/verify', authenticate, authorize('admin'), async (req, res) => {
  try {
    const userId = req.params.id;
    const { status, reason } = req.body; // status: active, rejected

    const [users] = await pool.execute(
      'SELECT username, email, role FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    await pool.execute(
      'UPDATE users SET status = ? WHERE id = ?',
      [status, userId]
    );

    // 发送通知
    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, content)
       VALUES (?, 'system', ?, ?)`,
      [userId, 
       status === 'active' ? '身份验证通过' : '身份验证未通过',
       status === 'active' 
         ? '您的身份验证已通过，可以正常使用系统功能' 
         : `您的身份验证未通过，原因：${reason || '资料不完整'}`]
    );

    logger.info(`用户审核: user_id=${userId}, status=${status}`);

    res.json({ message: status === 'active' ? '审核通过' : '已拒绝' });
  } catch (error) {
    logger.error('用户审核失败:', error);
    res.status(500).json({ error: '审核失败' });
  }
});

// 调整用户配额
router.post('/users/:id/quota', authenticate, authorize('admin'), async (req, res) => {
  try {
    const userId = req.params.id;
    const { quota_total, reason } = req.body;

    await pool.execute(
      'UPDATE users SET quota_total = ? WHERE id = ?',
      [quota_total, userId]
    );

    // 发送通知
    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, content)
       VALUES (?, 'quota', '配额调整通知', ?)`,
      [userId, `您的配额已调整为 ${quota_total} 条，原因：${reason || '系统调整'}`]
    );

    logger.info(`配额调整: user_id=${userId}, quota=${quota_total}`);

    res.json({ message: '配额调整成功' });
  } catch (error) {
    logger.error('调整配额失败:', error);
    res.status(500).json({ error: '调整配额失败' });
  }
});

// 获取数据列表
router.get('/data', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { page = 1, limit = 20, status, data_type } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE d.deleted_at IS NULL';
    let params = [];

    if (status) {
      whereClause += ' AND d.review_status = ?';
      params.push(status);
    }

    if (data_type) {
      whereClause += ' AND d.data_type = ?';
      params.push(data_type);
    }

    const [data] = await pool.query(
      `SELECT d.*, u.username as submitter_name, u.real_name as submitter_real_name
       FROM data_submissions d
       JOIN users u ON d.submitter_id = u.id
       ${whereClause}
       ORDER BY d.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM data_submissions d ${whereClause}`,
      params
    );

    res.json({
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total
      }
    });
  } catch (error) {
    logger.error('获取数据列表失败:', error);
    res.status(500).json({ error: '获取数据列表失败' });
  }
});

// 管理员终审
router.post('/final-review/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const dataId = req.params.id;
    const { decision, comments } = req.body; // decision: approved, rejected

    const [dataList] = await pool.execute(
      'SELECT title, submitter_id FROM data_submissions WHERE id = ?',
      [dataId]
    );

    if (dataList.length === 0) {
      return res.status(404).json({ error: '数据不存在' });
    }

    const newStatus = decision === 'approved' ? 'final_approved' : 'final_rejected';
    const progress = decision === 'approved' ? 100 : 0;

    await pool.execute(
      'UPDATE data_submissions SET review_status = ?, review_progress = ?, completed_at = NOW() WHERE id = ?',
      [newStatus, progress, dataId]
    );

    // 创建审核记录
    await pool.execute(
      `INSERT INTO review_records (data_id, reviewer_id, review_type, status, comments, completed_at)
       VALUES (?, ?, 'admin', ?, ?, NOW())`,
      [dataId, Number(req.user.id), decision, comments]
    );

    // 通知提交者
    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, content, related_type, related_id)
       VALUES (?, 'review', ?, ?, 'data', ?)`,
      [dataList[0].submitter_id,
       decision === 'approved' ? '数据审核通过' : '数据审核未通过',
       `您的数据《${dataList[0].title}》${decision === 'approved' ? '已通过最终审核' : '未通过最终审核'}`
       + (comments ? `，审核意见：${comments}` : ''),
       dataId]
    );

    logger.info(`管理员终审: data_id=${dataId}, decision=${decision}`);

    res.json({ message: decision === 'approved' ? '审核通过' : '已拒绝' });
  } catch (error) {
    logger.error('管理员审核失败:', error);
    res.status(500).json({ error: '审核失败' });
  }
});

// 获取系统日志
router.get('/logs', authenticate, authorize('admin'), async (req, res) => {
  try {
    // 验证用户ID
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: '用户未认证' });
    }
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const { action, start_date, end_date } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '';
    let params = [];

    if (action) {
      whereClause += ' AND action = ?';
      params.push(action);
    }

    if (start_date && end_date) {
      whereClause += ' AND created_at BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    const [logs] = await pool.query(
      `SELECT l.*, u.username, u.real_name
       FROM access_logs l
       LEFT JOIN users u ON l.user_id = u.id
       WHERE 1=1 ${whereClause}
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ logs });
  } catch (error) {
    logger.error('获取日志失败:', error);
    res.status(500).json({ error: '获取日志失败' });
  }
});

// 系统设置
router.get('/settings', authenticate, authorize('admin'), async (req, res) => {
  // 返回系统设置（可从配置文件或数据库读取）
  res.json({
    settings: {
      default_quota: { student: 10, teacher: 50, expert: 30, civilian: 5 },
      max_file_size: '100MB',
      allowed_formats: ['csv', 'xlsx', 'json', 'txt', 'pdf'],
      review_flow: ['teacher', 'expert', 'admin']
    }
  });
});

module.exports = router;

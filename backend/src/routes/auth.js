const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../utils/database');
const logger = require('../utils/logger');
const { authenticate } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// 注册
router.post('/register', [
  body('username').isLength({ min: 3, max: 50 }).withMessage('用户名长度应为3-50个字符'),
  body('email').isEmail().withMessage('邮箱格式不正确'),
  body('password').isLength({ min: 6 }).withMessage('密码长度至少为6个字符'),
  body('role').optional().isIn(['student', 'teacher', 'expert', 'civilian']).withMessage('无效的角色类型')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: '验证失败', details: errors.array() });
    }

    const { username, email, password, real_name, role = 'civilian', phone } = req.body;

    // 检查用户是否已存在
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ error: '用户名或邮箱已被注册' });
    }

    // 密码加密
    const passwordHash = await bcrypt.hash(password, 10);

    // 创建用户（确保没有 undefined 值）
    const [result] = await pool.execute(
      `INSERT INTO users (username, email, password_hash, real_name, role, phone, status, quota_total) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, email, passwordHash, real_name || null, role, phone || null, 
       role === 'civilian' ? 'active' : 'pending_verification', // 平民用户直接激活，其他需审核
       role === 'civilian' ? 5 : 10] // 平民用户初始配额5，其他10
    );

    logger.info(`新用户注册: ${username}, ID: ${result.insertId}`);

    // 生成JWT
    const token = jwt.sign({ userId: result.insertId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    res.status(201).json({
      message: '注册成功',
      token,
      user: {
        id: result.insertId,
        username,
        email,
        role,
        real_name
      }
    });
  } catch (error) {
    logger.error('注册失败:', error);
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

// 登录
router.post('/login', [
  body('account').notEmpty().withMessage('账号不能为空'),
  body('password').notEmpty().withMessage('密码不能为空')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: '验证失败', details: errors.array() });
    }

    const { account, password } = req.body;
    const ip = req.ip || req.connection.remoteAddress;

    // 查询用户
    const [users] = await pool.execute(
      `SELECT id, username, email, password_hash, role, real_name, avatar_url, status, 
              login_fail_count, locked_until, quota_total, quota_used
       FROM users WHERE (username = ? OR email = ?) AND deleted_at IS NULL`,
      [account, account]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: '账号或密码错误' });
    }

    const user = users[0];

    // 检查账号锁定
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(403).json({ 
        error: '账号已锁定', 
        lockedUntil: user.locked_until 
      });
    }

    // 检查账号状态
    if (user.status === 'suspended') {
      return res.status(403).json({ error: '账号已被封禁' });
    }

    // 验证密码
    const isValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isValid) {
      // 更新失败次数
      await pool.execute(
        'UPDATE users SET login_fail_count = login_fail_count + 1 WHERE id = ?',
        [user.id]
      );
      
      // 失败5次锁定30分钟
      if (user.login_fail_count + 1 >= 5) {
        await pool.execute(
          'UPDATE users SET locked_until = DATE_ADD(NOW(), INTERVAL 30 MINUTE), login_fail_count = 0 WHERE id = ?',
          [user.id]
        );
      }
      
      return res.status(401).json({ error: '账号或密码错误' });
    }

    // 登录成功，重置失败次数并更新登录信息
    await pool.execute(
      `UPDATE users SET login_fail_count = 0, last_login_at = NOW(), last_login_ip = ? WHERE id = ?`,
      [ip, user.id]
    );

    // 生成JWT
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    logger.info(`用户登录: ${user.username}`);

    res.json({
      message: '登录成功',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        real_name: user.real_name,
        avatar_url: user.avatar_url,
        quota_total: user.quota_total,
        quota_used: user.quota_used
      }
    });
  } catch (error) {
    logger.error('登录失败:', error);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

// 获取当前用户信息
router.get('/me', authenticate, async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT id, username, email, phone, real_name, avatar_url, role, status,
              email_verified, phone_verified, id_verified, quota_total, quota_used,
              created_at, last_login_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({ user: users[0] });
  } catch (error) {
    logger.error('获取用户信息失败:', error);
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

// 修改密码
router.post('/change-password', authenticate, [
  body('oldPassword').notEmpty().withMessage('旧密码不能为空'),
  body('newPassword').isLength({ min: 6 }).withMessage('新密码长度至少为6个字符')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: '验证失败', details: errors.array() });
    }

    const { oldPassword, newPassword } = req.body;

    // 获取用户当前密码
    const [users] = await pool.execute(
      'SELECT password_hash FROM users WHERE id = ?',
      [req.user.id]
    );

    // 验证旧密码
    const isValid = await bcrypt.compare(oldPassword, users[0].password_hash);
    if (!isValid) {
      return res.status(400).json({ error: '旧密码错误' });
    }

    // 加密新密码
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await pool.execute(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [newPasswordHash, req.user.id]
    );

    logger.info(`用户修改密码: ${req.user.username}`);
    res.json({ message: '密码修改成功' });
  } catch (error) {
    logger.error('修改密码失败:', error);
    res.status(500).json({ error: '修改密码失败' });
  }
});

// 上传头像
router.post('/avatar', authenticate, (req, res, next) => {
  req.uploadType = 'avatar';
  next();
}, upload.single('avatar'), handleUploadError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未上传文件' });
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    await pool.execute(
      'UPDATE users SET avatar_url = ? WHERE id = ?',
      [avatarUrl, req.user.id]
    );

    res.json({ 
      message: '头像上传成功', 
      avatar_url: avatarUrl 
    });
  } catch (error) {
    logger.error('上传头像失败:', error);
    res.status(500).json({ error: '上传头像失败' });
  }
});

module.exports = router;

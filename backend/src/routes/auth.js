const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../utils/database');
const logger = require('../utils/logger');
const { authenticate } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');
const { UserDTO, ApiResponse } = require('../dto');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const redisClient = require('../utils/redis'); // 利用系统已配置的 Redis
const { sendCodeEmail } = require('../utils/mailer');

// 确保JWT密钥已设置
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET 环境变量未设置');
}

router.post('/send-code', [
  body('email').isEmail().withMessage('邮箱格式不正确'),
  body('type').isIn(['register', 'reset']).withMessage('无效的业务类型')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: '验证失败', details: errors.array() });

    const { email, type } = req.body;

    // 限制单邮箱发送频率（1分钟只能发一次，防止被刷）
    const rateLimitKey = `mail_limit:${email}:${type}`;
    const isLimited = await redisClient.get(rateLimitKey);
    if (isLimited) return res.status(429).json({ error: '验证码发送过于频繁，请1分钟后再试' });

    // 生成6位随机数字验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // 存入 Redis，有效期 5 分钟 (300秒)
    const redisKey = `mail_code:${email}:${type}`;
    await redisClient.set(redisKey, code, { EX: 300 });
    // 设置 60 秒的限频标记
    await redisClient.set(rateLimitKey, '1', { EX: 60 });

    // 发送邮件
    await sendCodeEmail(email, code, type);
    
    logger.info(`验证码已发往: ${email}, 类型: ${type}`);
    res.json({ message: '验证码已成功发送至您的邮箱' });
  } catch (error) {
    logger.error('发送验证码邮件失败:', error);
    res.status(500).json({ error: '邮件服务异常，请稍后再试' });
  }
});

// 注册
router.post('/register', [
  body('username').isLength({ min: 3, max: 50 }).matches(/^[a-zA-Z0-9\u4e00-\u9fa5]+$/).withMessage('用户名只能由字母、数字与汉字组成'),
  body('email').isEmail().withMessage('邮箱格式不正确'),
  body('password').isLength({ min: 6 }).matches(/^(?=.*[a-zA-Z])(?=.*\d)/).withMessage('密码必须同时包含字母与数字'),
  body('code').isLength({ min: 6, max: 6 }).withMessage('请输入6位邮箱验证码')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: '验证失败', details: errors.array() });
    }

    const { username, email, password, code, real_name, role = 'civilian', phone } = req.body;

    // 1. 验证码 Redis 一致性核验
    const redisKey = `mail_code:${email}:register`;
    const cachedCode = await redisClient.get(redisKey);
    if (!cachedCode || cachedCode !== code) {
      return res.status(400).json({ error: '验证码错误或已过期' });
    }

    // 2. 同名处理：单独精准检查用户名
    const [existingUsername] = await pool.execute(
      'SELECT id FROM users WHERE username = ? AND deleted_at IS NULL',
      [username]
    );
    if (existingUsername.length > 0) {
      return res.status(409).json({ error: '用户名已被注册' });
    }

    // 3. 同邮箱处理：单独精准检查邮箱
    const [existingEmail] = await pool.execute(
      'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL',
      [email]
    );
    if (existingEmail.length > 0) {
      return res.status(409).json({ error: '该邮箱已被注册' });
    }

    // 4. 密码加盐加密（确保此行未丢失）
    const passwordHash = await bcrypt.hash(password, 10);

    // 5. 执行数据库安全插入
    const [result] = await pool.execute(
      `INSERT INTO users (username, email, password_hash, real_name, role, phone, status, quota_total) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        username, 
        email, 
        passwordHash, 
        real_name || null, 
        role, 
        phone || null, 
        role === 'civilian' ? 'active' : 'pending_verification', 
        role === 'civilian' ? 5 : 10
      ]
    );

    logger.info(`新用户注册成功: ${username}, 分配ID: ${result.insertId}`);

    // 6. 注册成功后，立刻销毁 Redis 验证码，防止被恶意复用
    await redisClient.del(redisKey);

    // 7. 签发登录凭证 JWT
    const token = jwt.sign({ userId: result.insertId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    const newUser = {
      id: result.insertId,
      username,
      email,
      role,
      real_name
    };

    res.status(201).json(ApiResponse.success({
      token,
      user: UserDTO.toResponse(newUser)
    }, '注册成功'));

  } catch (error) {
    // 捕获并记录核心崩溃日志
    logger.error('注册路由执行崩溃:', error);
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

    res.json(ApiResponse.success({
      token,
      user: UserDTO.toResponse(user)
    }, '登录成功'));
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
      return res.status(404).json(ApiResponse.error('用户不存在', 'USER_NOT_FOUND'));
    }

    res.json(ApiResponse.success(UserDTO.toResponse(users[0])));
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

router.post('/reset-password', [
  body('email').isEmail().withMessage('邮箱格式不正确'),
  body('code').isLength({ min: 6, max: 6 }).withMessage('请输入6位验证码'),
  body('newPassword').isLength({ min: 6 }).matches(/^(?=.*[a-zA-Z])(?=.*\d)/).withMessage('新密码强度不足')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: '验证失败', details: errors.array() });

    const { email, code, newPassword } = req.body;

    // 1. 核验验证码
    const redisKey = `mail_code:${email}:reset`;
    const cachedCode = await redisClient.get(redisKey);
    if (!cachedCode || cachedCode !== code) {
      return res.status(400).json({ error: '验证码错误或已过期' });
    }

    // 2. 检查账号是否存在
    const [users] = await pool.execute('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL', [email]);
    if (users.length === 0) return res.status(404).json({ error: '该邮箱尚未注册任何账号' });

    // 3. 加密并重写密码
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await pool.execute('UPDATE users SET password_hash = ? WHERE email = ?', [newPasswordHash, email]);

    // 4. 清除已被成功消耗的验证码
    await redisClient.del(redisKey);

    logger.info(`用户成功通过邮箱重置密码: ${email}`);
    res.json({ message: '密码重置成功，请使用新密码登录' });
  } catch (error) {
    logger.error('重置密码失败:', error);
    res.status(500).json({ error: '服务器内部错误，请稍后再试' });
  }
});

module.exports = router;

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const {
  createLoginSession,
  destroyLoginSession,
  destroyAllLoginSessions
} = require('../utils/session');
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

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const normalizeText = (value) => String(value || '').trim();

const buildValidationErrorResponse = (errors) => {
  const list = errors.array();

  const fieldMap = {};
  for (const item of list) {
    if (!fieldMap[item.path]) {
      fieldMap[item.path] = item.msg;
    }
  }

  return {
    error: list[0]?.msg || '表单填写有误，请检查后重试',
    details: list,
    fieldErrors: fieldMap
  };
};

const getDuplicateRegisterMessage = (error) => {
  const message = String(error?.sqlMessage || error?.message || '');

  if (message.includes('users.username') || message.includes('username')) {
    return '用户名已被注册，请更换用户名';
  }

  if (message.includes('users.email') || message.includes('email')) {
    return '该邮箱已被注册，请更换邮箱';
  }

  return '用户名或邮箱已被占用，请更换后重试';
};

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

    // 生成6位随机数字验证码，使用密码学安全随机数
    const code = String(crypto.randomInt(100000, 1000000));

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
  body('username')
    .trim()
    .notEmpty().withMessage('请输入用户名')
    .bail()
    .isLength({ min: 3, max: 50 }).withMessage('用户名长度必须为3到50个字符')
    .bail()
    .matches(/^[a-zA-Z0-9一-龥]+$/).withMessage('用户名只能由字母、数字与汉字组成'),

  body('email')
    .trim()
    .normalizeEmail()
    .notEmpty().withMessage('请输入邮箱')
    .bail()
    .isEmail().withMessage('邮箱格式不正确'),

  body('password')
    .notEmpty().withMessage('请输入密码')
    .bail()
    .isLength({ min: 6 }).withMessage('密码长度至少为6个字符')
    .bail()
    .matches(/^(?=.*[a-zA-Z])(?=.*\d)/).withMessage('密码必须同时包含字母与数字'),

  body('code')
    .trim()
    .notEmpty().withMessage('请输入邮箱验证码')
    .bail()
    .matches(/^\d{6}$/).withMessage('请输入6位数字邮箱验证码'),

  body('real_name')
    .trim()
    .notEmpty().withMessage('请输入真实姓名'),

  body('role')
    .trim()
    .notEmpty().withMessage('请选择注册角色')
    .bail()
    .isIn(['civilian', 'student', 'teacher', 'expert'])
    .withMessage('无效的注册角色')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(buildValidationErrorResponse(errors));
    }

    const username = normalizeText(req.body.username);
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;
    const code = normalizeText(req.body.code);
    const real_name = normalizeText(req.body.real_name);
    const phone = req.body.phone ? normalizeText(req.body.phone) : null;

    const role = normalizeText(req.body.role || 'civilian');

    const allowedSelfRegisterRoles = ['civilian', 'student', 'teacher', 'expert'];
    if (!allowedSelfRegisterRoles.includes(role)) {
      return res.status(400).json({ error: '无效的注册角色' });
    }

    // 1. 验证码 Redis 一致性核验
    const redisKey = `mail_code:${email}:register`;
    const cachedCode = await redisClient.get(redisKey);
    if (!cachedCode || cachedCode !== code) {
      return res.status(400).json({
        error: '验证码错误或已过期，请重新获取验证码',
        field: 'code'
      });
    }

    // 2. 同名处理：单独精准检查用户名
    const [existingUsername] = await pool.execute(
      'SELECT id, deleted_at FROM users WHERE username = ? LIMIT 1',
      [username]
    );

    if (existingUsername.length > 0) {
      return res.status(409).json({
        error: existingUsername[0].deleted_at
          ? '该用户名曾被使用并已删除，请更换用户名'
          : '用户名已被注册，请更换用户名',
        field: 'username'
      });
    }

    // 3. 同邮箱处理：单独精准检查邮箱
    const [existingEmail] = await pool.execute(
      'SELECT id, deleted_at FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    if (existingEmail.length > 0) {
      return res.status(409).json({
        error: existingEmail[0].deleted_at
          ? '该邮箱曾被使用并已删除，请更换邮箱'
          : '该邮箱已被注册，请更换邮箱',
        field: 'email'
      });
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
        'pending_verification',
        role === 'civilian' ? 5 : 10
      ]
    );

    logger.info(`新用户注册成功: ${username}, 分配ID: ${result.insertId}`);

    // 6. 注册成功后，立刻销毁 Redis 验证码，防止被恶意复用
    await redisClient.del(redisKey);

    // 7. 签发登录凭证 JWT，并创建服务端唯一会话
    const sessionId = await createLoginSession(result.insertId);
    const token = jwt.sign(
      { userId: result.insertId, sessionId },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

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
    }, '注册成功，请等待管理员审核通过后再使用业务功能'));

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      const message = getDuplicateRegisterMessage(error);

      logger.warn('注册失败：用户名或邮箱触发唯一键冲突', {
        username: req.body?.username,
        email: req.body?.email,
        sqlMessage: error.sqlMessage
      });

      return res.status(409).json({
        error: message,
        field: message.includes('用户名') ? 'username' : message.includes('邮箱') ? 'email' : undefined
      });
    }

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

    // 生成服务端唯一会话，并把 sessionId 写入 JWT
    const sessionId = await createLoginSession(user.id);
    const token = jwt.sign(
      { userId: user.id, sessionId },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

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

// 退出登录
router.post('/logout', authenticate, async (req, res) => {
  try {
    await destroyLoginSession(req.user.id, req.auth?.sessionId);

    logger.info(`用户退出登录: ${req.user.username}`);

    res.json(ApiResponse.success(null, '退出登录成功'));
  } catch (error) {
    logger.error('退出登录失败:', error);
    res.status(500).json({ error: '退出登录失败，请稍后重试' });
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

    // 密码变更属于高风险安全事件，清空该账号所有登录会话
    await destroyAllLoginSessions(req.user.id);

    logger.info(`用户修改密码并清空登录会话: ${req.user.username}`);
    res.json({ message: '密码修改成功，请重新登录' });
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

    // 密码重置后清空该账号所有登录会话，防止旧 token 继续有效
    await destroyAllLoginSessions(users[0].id);

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

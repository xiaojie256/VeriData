const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// 环境变量验证（必须在最前面）
const { validateEnv } = require('./utils/envValidator');
validateEnv();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const dataRoutes = require('./routes/data');
const reviewRoutes = require('./routes/review');
const adminRoutes = require('./routes/admin');
const aiRoutes = require('./routes/ai');
const logger = require('./utils/logger');
const { performHealthCheck, performReadinessCheck, performLivenessCheck } = require('./utils/healthCheck');

const app = express();
const PORT = process.env.PORT || 3000;

// API版本前缀
const API_VERSION = process.env.API_VERSION || 'v1';
const API_PREFIX = `/api/${API_VERSION}`;

// 安全中间件
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? ['http://localhost', 'https://veri-data.edu.cn'] : '*',
  credentials: true
}));

// 限流配置
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 100次请求
  message: { error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false
});

// 严格限流（认证接口）
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5次
  skipSuccessfulRequests: true, // 成功请求不计入
  message: { error: '登录尝试次数过多，请15分钟后再试' }
});

// 宽松限流（公开接口）
const publicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 30,
  message: { error: '请求过于频繁' }
});

app.use(`${API_PREFIX}/`, generalLimiter);
app.use(`${API_PREFIX}/auth/login`, authLimiter);

// 日志
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// 解析中间件
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件
app.use('/uploads', express.static(process.env.UPLOAD_PATH || './uploads'));

// 路由（带版本前缀）
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/users`, userRoutes);
app.use(`${API_PREFIX}/data`, dataRoutes);
app.use(`${API_PREFIX}/review`, reviewRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);
app.use(`${API_PREFIX}/ai`, aiRoutes);

// 旧版本API兼容（保留，但建议迁移）
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/review', reviewRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ai', aiRoutes);

// 健康检查端点
// 存活检查 - 轻量级，仅检查服务是否运行
app.get('/health/live', (req, res) => {
  res.json(performLivenessCheck());
});

// 就绪检查 - 检查依赖服务
app.get('/health/ready', async (req, res) => {
  const check = await performReadinessCheck();
  const statusCode = check.ready ? 200 : 503;
  res.status(statusCode).json(check);
});

// 完整健康检查 - 详细检查所有依赖
app.get('/health', async (req, res) => {
  const check = await performHealthCheck();
  const statusCode = check.status === 'healthy' ? 200 : 
                     check.status === 'degraded' ? 200 : 503;
  res.status(statusCode).json(check);
});

// 兼容旧健康检查端点
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 错误分类处理
class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// 错误处理中间件
app.use((err, req, res, next) => {
  logger.error({
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id
  });

  // 已知错误类型
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        code: err.code
      },
      timestamp: new Date().toISOString()
    });
  }

  // JWT错误
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: { message: '令牌已过期', code: 'TOKEN_EXPIRED' },
      timestamp: new Date().toISOString()
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: { message: '无效的令牌', code: 'TOKEN_INVALID' },
      timestamp: new Date().toISOString()
    });
  }

  // 数据库错误
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      success: false,
      error: { message: '数据已存在', code: 'DUPLICATE_ENTRY' },
      timestamp: new Date().toISOString()
    });
  }

  if (err.code === 'ER_NO_REFERENCED_ROW') {
    return res.status(400).json({
      success: false,
      error: { message: '引用的数据不存在', code: 'FOREIGN_KEY_ERROR' },
      timestamp: new Date().toISOString()
    });
  }

  // 默认服务器错误
  const isDev = process.env.NODE_ENV === 'development';
  res.status(err.status || 500).json({
    success: false,
    error: {
      message: isDev ? err.message : '服务器内部错误',
      code: 'INTERNAL_ERROR',
      ...(isDev && { stack: err.stack })
    },
    timestamp: new Date().toISOString()
  });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: '接口不存在',
      code: 'NOT_FOUND',
      path: req.path
    },
    timestamp: new Date().toISOString()
  });
});

// 启动服务器
const server = app.listen(PORT, () => {
  logger.info(`========================================`);
  logger.info(`鉴真数据系统后端服务启动成功`);
  logger.info(`端口: ${PORT}`);
  logger.info(`环境: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`API版本: ${API_VERSION}`);
  logger.info(`API前缀: ${API_PREFIX}`);
  logger.info(`========================================`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

module.exports = app;
module.exports.AppError = AppError;

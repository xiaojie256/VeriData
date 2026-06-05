const jwt = require("jsonwebtoken");
const pool = require("../utils/database");

const JWT_SECRET = process.env.JWT_SECRET;

// 确保JWT密钥已设置
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET 环境变量未设置");
}

// 验证JWT令牌（支持 Authorization header 和 query.token 两种方式）
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1] || req.query.token;

    if (!token) {
      return res.status(401).json({ error: "未提供认证令牌" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    // 查询用户信息
    const [users] = await pool.execute(
      "SELECT id, username, email, role, real_name, avatar_url, status, quota_total, quota_used FROM users WHERE id = ? AND deleted_at IS NULL",
      [decoded.userId],
    );

    if (users.length === 0) {
      return res.status(401).json({ error: "用户不存在或已被删除" });
    }

    const user = users[0];

    if (user.status === "suspended") {
      return res.status(403).json({ error: "账号已被封禁" });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "令牌已过期" });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "无效的令牌" });
    }
    return res.status(500).json({ error: "认证失败" });
  }
};

// 角色授权
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "请先登录" });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "没有权限执行此操作" });
    }

    // 🔴 核心安全修复：强校验账号状态，非激活状态一律拦截
    if (req.user.status !== "active") {
      return res.status(403).json({ error: "账号正在审核中，暂无权操作业务" });
    }

    next();
  };
};

// 可选认证（记录用户信息但不强制）
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      const [users] = await pool.execute(
        "SELECT id, username, role, status FROM users WHERE id = ? AND deleted_at IS NULL",
        [decoded.userId],
      );

      if (users.length > 0 && users[0].status !== "suspended") {
        req.user = users[0];
      }
    }

    next();
  } catch {
    next();
  }
};

module.exports = { authenticate, authorize, optionalAuth };

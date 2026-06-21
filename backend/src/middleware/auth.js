const jwt = require("jsonwebtoken");
const pool = require("../utils/database");
const { assertSessionIsCurrent } = require("../utils/session");

const JWT_SECRET = process.env.JWT_SECRET;

// 确保JWT密钥已设置
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET 环境变量未设置");
}

// 验证JWT令牌：只支持 Authorization header，不再支持 query.token
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "未提供认证令牌" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    await assertSessionIsCurrent(decoded.userId, decoded.sessionId);

    req.auth = {
      token,
      userId: decoded.userId,
      sessionId: decoded.sessionId
    };

    // 查询用户信息
    const [users] = await pool.execute(
      "SELECT id, username, email, role, real_name, avatar_url, status, id_verified, quota_total, quota_used FROM users WHERE id = ? AND deleted_at IS NULL",
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
      return res.status(401).json({ error: "令牌已过期", code: "TOKEN_EXPIRED" });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "无效的令牌", code: "TOKEN_INVALID" });
    }

    if (error.code === "SESSION_REPLACED") {
      return res.status(401).json({
        error: "账号已在其他设备登录，本次会话已失效",
        code: "SESSION_REPLACED"
      });
    }

    if (error.code === "SESSION_EXPIRED" || error.code === "SESSION_INVALID") {
      return res.status(401).json({
        error: error.message || "登录会话已失效，请重新登录",
        code: error.code
      });
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

    // 业务接口统一要求账号处于 active 状态
    if (req.user.status !== "active") {
      return res.status(403).json({ error: "账号正在审核中，暂无权操作业务" });
    }

    // 强身份角色要求完成身份认证；普通用户只要求账号审核通过，不要求身份认证
    const rolesNeedIdVerified = ["student", "teacher", "expert", "admin"];
    if (rolesNeedIdVerified.includes(req.user.role) && req.user.id_verified !== 1) {
      return res.status(403).json({ error: "账号身份尚未认证，暂无权操作业务" });
    }

    next();
  };
};

// 可选认证（记录用户信息但不强制）
// 只支持 Authorization header，不再支持 ?token=xxx，避免 JWT 出现在 URL 中
const optionalAuth = async (req, res, next) => {
  try {
    const headerToken = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.split(" ")[1]
      : null;

    const token = headerToken;

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);

      await assertSessionIsCurrent(decoded.userId, decoded.sessionId);

      const [users] = await pool.execute(
        "SELECT id, username, email, role, real_name, avatar_url, status, id_verified, quota_total, quota_used FROM users WHERE id = ? AND deleted_at IS NULL",
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

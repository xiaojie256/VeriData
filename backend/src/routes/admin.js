const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../utils/database");
const logger = require("../utils/logger");
const { authenticate, authorize } = require("../middleware/auth");

const router = express.Router();

const ALLOWED_USER_ROLES = new Set([
  'student',
  'teacher',
  'expert',
  'admin',
  'civilian'
]);

const ALLOWED_USER_STATUSES = new Set([
  'active',
  'inactive',
  'suspended',
  'pending_verification'
]);

const normalizePositiveInt = (value, defaultValue, maxValue) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.min(n, maxValue);
};

// 获取仪表盘统计
router.get("/dashboard", authenticate, authorize("admin"), async (req, res) => {
  try {
    // 用户统计
    const [userStats] = await pool.execute(
      `SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) as students,
        SUM(CASE WHEN role = 'teacher' THEN 1 ELSE 0 END) as teachers,
        SUM(CASE WHEN role = 'expert' THEN 1 ELSE 0 END) as experts,
        SUM(CASE WHEN status = 'pending_verification' THEN 1 ELSE 0 END) as pending_verification
       FROM users WHERE deleted_at IS NULL`,
    );

    // 数据统计
    const [dataStats] = await pool.execute(
      `SELECT
        COUNT(*) as total_data,
        SUM(CASE WHEN review_status = 'draft' THEN 1 ELSE 0 END) as drafts,
        SUM(CASE WHEN review_status IN ('submitted', 'teacher_reviewing') THEN 1 ELSE 0 END) as teacher_pending,
        SUM(CASE WHEN review_status IN ('teacher_approved', 'expert_reviewing') THEN 1 ELSE 0 END) as expert_pending,
        SUM(CASE WHEN review_status = 'expert_approved' THEN 1 ELSE 0 END) as final_pending,
        SUM(CASE WHEN review_status = 'final_approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN review_status IN ('teacher_rejected', 'expert_rejected', 'final_rejected') THEN 1 ELSE 0 END) as rejected
       FROM data_submissions WHERE deleted_at IS NULL`,
    );

    // 审核统计
    const [reviewStats] = await pool.execute(
      `SELECT
        COUNT(*) as total_reviews,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_reviews,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_reviews,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_reviews
       FROM review_records`,
    );

    // 最近7天数据提交趋势
    const [weeklyTrend] = await pool.execute(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM data_submissions
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND deleted_at IS NULL
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
    );

    res.json({
      user_stats: userStats[0],
      data_stats: dataStats[0],
      review_stats: reviewStats[0],
      weekly_trend: weeklyTrend,
    });
  } catch (error) {
    logger.error("获取仪表盘数据失败:", error);
    res.status(500).json({ error: "获取统计数据失败" });
  }
});

// 获取用户列表
router.get("/users", authenticate, authorize("admin"), async (req, res) => {
  try {
    const page = normalizePositiveInt(req.query.page, 1, 100000);
    const limit = normalizePositiveInt(req.query.limit, 20, 100);
    const offset = (page - 1) * limit;

    const role = String(req.query.role || "").trim();
    const status = String(req.query.status || "").trim();
    const search = String(req.query.search || "").trim();

    if (role && !ALLOWED_USER_ROLES.has(role)) {
      return res.status(400).json({ error: "无效的角色筛选条件" });
    }

    if (status && !ALLOWED_USER_STATUSES.has(status)) {
      return res.status(400).json({ error: "无效的状态筛选条件" });
    }

    if (search.length > 100) {
      return res.status(400).json({ error: "搜索关键词过长" });
    }

    let whereClause = "WHERE deleted_at IS NULL";
    const params = [];

    if (role) {
      whereClause += " AND role = ?";
      params.push(role);
    }

    if (status) {
      whereClause += " AND status = ?";
      params.push(status);
    }

    if (search) {
      whereClause += " AND (username LIKE ? OR email LIKE ? OR real_name LIKE ?)";
      const keyword = `%${search.replace(/[%_]/g, "\\$&")}%`;
      params.push(keyword, keyword, keyword);
    }

    const [users] = await pool.query(
      `SELECT id, username, email, phone, real_name, avatar_url, role, status,
              email_verified, phone_verified, id_verified, quota_total, quota_used,
              created_at, last_login_at
       FROM users
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
    );

    const [countResult] = await pool.execute(
      `SELECT COUNT(*) AS total FROM users ${whereClause}`,
      params
    );

    res.json({
      users,
      pagination: {
        page,
        limit,
        total: countResult[0].total
      }
    });
  } catch (error) {
    logger.error("获取用户列表失败:", error);
    res.status(500).json({ error: "获取用户列表失败" });
  }
});

// 审核用户（验证身份）
router.post(
  "/users/:id/verify",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    try {
      const userId = Number.parseInt(req.params.id, 10);
      const rawStatus = String(req.body.status || "").trim();
      const reason = String(req.body.reason || "").trim();

      if (!Number.isFinite(userId) || userId <= 0) {
        return res.status(400).json({ error: "无效的用户ID" });
      }

      // 兼容旧前端或旧接口：如果误传 rejected，统一落到 inactive
      const targetStatus = rawStatus === "rejected" ? "inactive" : rawStatus;

      if (!ALLOWED_USER_STATUSES.has(targetStatus)) {
        return res.status(400).json({ error: "无效的用户状态" });
      }

      const [users] = await pool.execute(
        `SELECT id, username, email, real_name, role, status,
                id_card_front, id_card_back, id_verified, deleted_at
         FROM users
         WHERE id = ? AND deleted_at IS NULL`,
        [userId]
      );

      if (users.length === 0) {
        return res.status(404).json({ error: "用户不存在" });
      }

      const user = users[0];

      if (user.role === "admin" && targetStatus !== "active") {
        const [adminCount] = await pool.execute(
          "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL"
        );

        if (adminCount[0].count <= 1) {
          return res.status(400).json({ error: "不能停用或拒绝最后一个有效管理员" });
        }
      }

      const allowedTransitions = {
        pending_verification: new Set(["active", "inactive", "suspended"]),
        inactive: new Set(["pending_verification", "active", "suspended"]),
        active: new Set(["suspended", "inactive"]),
        suspended: new Set(["active", "inactive"])
      };

      if (
        user.status !== targetStatus &&
        !allowedTransitions[user.status]?.has(targetStatus)
      ) {
        return res.status(409).json({
          error: `不允许从 ${user.status} 直接切换到 ${targetStatus}`
        });
      }

      const hasIdCard = Boolean(user.id_card_front && user.id_card_back);

      const updateFields = ["status = ?"];
      const updateParams = [targetStatus];

      if (targetStatus === "active" && hasIdCard) {
        updateFields.push("id_verified = 1");
      }

      if (targetStatus === "inactive") {
        updateFields.push("id_verified = 0");
      }

      await pool.execute(
        `UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`,
        [...updateParams, userId]
      );

      const noticeMap = {
        active: {
          title: "身份验证通过",
          content: "您的身份验证已通过，可以正常使用系统功能。"
        },
        inactive: {
          title: "身份验证未通过",
          content: `您的身份验证未通过。${reason ? `原因：${reason}` : "请检查资料后重新提交。"}`
        },
        suspended: {
          title: "账号已被封禁",
          content: `您的账号已被封禁。${reason ? `原因：${reason}` : "如有疑问请联系管理员。"}`
        },
        pending_verification: {
          title: "身份验证状态已重置",
          content: "您的身份验证状态已重置为待审核。"
        }
      };

      const notice = noticeMap[targetStatus];

      await pool.execute(
        `INSERT INTO notifications (user_id, type, title, content)
         VALUES (?, 'system', ?, ?)`,
        [userId, notice.title, notice.content]
      );

      logger.info(
        `管理员更新用户状态: admin=${req.user.id}, user=${userId}, from=${user.status}, to=${targetStatus}`
      );

      const messageMap = {
        active: "用户审核已通过",
        inactive: "用户审核已拒绝",
        suspended: "用户已封禁",
        pending_verification: "用户状态已重置为待审核"
      };

      res.json({
        message: messageMap[targetStatus],
        status: targetStatus,
        id_verified: targetStatus === "active" && hasIdCard ? 1 : targetStatus === "inactive" ? 0 : user.id_verified
      });
    } catch (error) {
      logger.error("用户身份审核失败:", error);
      res.status(500).json({ error: "审核操作失败" });
    }
  }
);

// 单独设置用户身份验证状态（不影响账号状态）
router.post(
  "/users/:id/id-verified",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    try {
      const userId = req.params.id;
      const { id_verified } = req.body; // true/false

      const [users] = await pool.execute(
        "SELECT id FROM users WHERE id = ?",
        [userId],
      );
      if (users.length === 0) {
        return res.status(404).json({ error: "用户不存在" });
      }

      await pool.execute("UPDATE users SET id_verified = ? WHERE id = ?", [
        id_verified ? 1 : 0,
        userId,
      ]);

      logger.info(
        `管理员手动设置身份验证: user_id=${userId}, id_verified=${id_verified}`,
      );

      res.json({
        message: id_verified ? "已标记为已验证" : "已取消身份验证",
      });
    } catch (error) {
      logger.error("设置身份验证状态失败:", error);
      res.status(500).json({ error: "操作失败" });
    }
  },
);

// 调整用户配额
router.post(
  "/users/:id/quota",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    try {
      const userId = req.params.id;
      const { quota_total, reason } = req.body;

      await pool.execute("UPDATE users SET quota_total = ? WHERE id = ?", [
        quota_total,
        userId,
      ]);

      // 发送通知
      await pool.execute(
        `INSERT INTO notifications (user_id, type, title, content)
       VALUES (?, 'quota', '配额调整通知', ?)`,
        [
          userId,
          `您的配额已调整为 ${quota_total} 条，原因：${reason || "系统调整"}`,
        ],
      );

      logger.info(`配额调整: user_id=${userId}, quota=${quota_total}`);

      res.json({ message: "配额调整成功" });
    } catch (error) {
      logger.error("调整配额失败:", error);
      res.status(500).json({ error: "调整配额失败" });
    }
  },
);

// 获取数据列表
router.get("/data", authenticate, authorize("admin"), async (req, res) => {
  try {
    const { page = 1, limit = 20, status, data_type } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = "WHERE d.deleted_at IS NULL";
    let params = [];

    if (status) {
      whereClause += " AND d.review_status = ?";
      params.push(status);
    }

    if (data_type) {
      whereClause += " AND d.data_type = ?";
      params.push(data_type);
    }

    // 支持管理员输入 标题 / 提交者账号 / 真实姓名 进行模糊搜索
    const { search } = req.query;
    if (search) {
      whereClause += " AND (d.title LIKE ? OR u.username LIKE ? OR u.real_name LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [data] = await pool.query(
      `SELECT d.*, u.username as submitter_name, u.real_name as submitter_real_name
       FROM data_submissions d
       JOIN users u ON d.submitter_id = u.id
       ${whereClause}
       ORDER BY d.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset],
    );

    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total
       FROM data_submissions d
       JOIN users u ON d.submitter_id = u.id
       ${whereClause}`,
      params,
    );

    res.json({
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
      },
    });
  } catch (error) {
    logger.error("获取数据列表失败:", error);
    res.status(500).json({ error: "获取数据列表失败" });
  }
});

// 管理员终审
router.post(
  "/final-review/:id",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    try {
      const dataId = req.params.id;
      const { decision, comments } = req.body; // decision: approved, rejected

      const [dataList] = await pool.execute(
        "SELECT title, submitter_id, review_status FROM data_submissions WHERE id = ? AND deleted_at IS NULL",
        [dataId],
      );

      if (dataList.length === 0) {
        return res.status(404).json({ error: "数据不存在" });
      }

      if (dataList[0].review_status !== "expert_approved") {
        return res.status(400).json({
          error: `当前数据状态为 ${dataList[0].review_status}，只有待终审数据允许管理员终审`,
        });
      }

      if (!["approved", "rejected"].includes(decision)) {
        return res.status(400).json({
          error: "无效的审核结果",
        });
      }

      const newStatus =
        decision === "approved" ? "final_approved" : "final_rejected";
      const progress = decision === "approved" ? 100 : 0;

      await pool.execute(
        "UPDATE data_submissions SET review_status = ?, review_progress = ?, completed_at = NOW() WHERE id = ?",
        [newStatus, progress, dataId],
      );

      // 创建审核记录
      await pool.execute(
        `INSERT INTO review_records (data_id, reviewer_id, review_type, status, comments, completed_at)
       VALUES (?, ?, 'admin', ?, ?, NOW())`,
        [dataId, Number(req.user.id), decision, comments],
      );

      // 通知提交者
      await pool.execute(
        `INSERT INTO notifications (user_id, type, title, content, related_type, related_id)
       VALUES (?, 'review', ?, ?, 'data', ?)`,
        [
          dataList[0].submitter_id,
          decision === "approved" ? "数据审核通过" : "数据审核未通过",
          `您的数据《${dataList[0].title}》${decision === "approved" ? "已通过最终审核" : "未通过最终审核"}` +
            (comments ? `，审核意见：${comments}` : ""),
          dataId,
        ],
      );

      logger.info(`管理员终审: data_id=${dataId}, decision=${decision}`);

      res.json({ message: decision === "approved" ? "审核通过" : "已拒绝" });
    } catch (error) {
      logger.error("管理员审核失败:", error);
      res.status(500).json({ error: "审核失败" });
    }
  },
);

// 获取系统日志
router.get("/logs", authenticate, authorize("admin"), async (req, res) => {
  try {
    // 验证用户ID
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "用户未认证" });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const { action, start_date, end_date } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = "";
    let params = [];

    if (action) {
      whereClause += " AND l.action = ?";
      params.push(action);
    }

    if (start_date && end_date) {
      whereClause += " AND l.created_at BETWEEN ? AND ?";
      params.push(start_date, end_date);
    }

    // 支持按用户名/真实姓名/IP地址进行模糊检索
    const { search } = req.query;
    if (search) {
      whereClause += " AND (u.username LIKE ? OR u.real_name LIKE ? OR l.ip_address LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // 计算满足当前筛选条件的日志总记录数
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM access_logs l LEFT JOIN users u ON l.user_id = u.id WHERE 1=1 ${whereClause}`,
      params,
    );

    const [logs] = await pool.query(
      `SELECT l.*, u.username, u.real_name
       FROM access_logs l
       LEFT JOIN users u ON l.user_id = u.id
       WHERE 1=1 ${whereClause}
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      logs,
      pagination: {
        page,
        limit,
        total: countResult[0].total,
      },
    });
  } catch (error) {
    logger.error("获取日志失败:", error);
    res.status(500).json({ error: "获取日志失败" });
  }
});

// 系统设置
router.get("/settings", authenticate, authorize("admin"), async (req, res) => {
  // 返回系统设置（可从配置文件或数据库读取）
  res.json({
    settings: {
      default_quota: { student: 10, teacher: 50, expert: 30, civilian: 5 },
      max_file_size: "100MB",
      allowed_formats: ["csv", "xlsx", "json", "txt", "pdf"],
      review_flow: ["teacher", "expert", "admin"],
    },
  });
});

// 管理员软删除用户接口
router.delete(
  "/users/:id",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    try {
      const targetUserId = req.params.id;

      if (
        !targetUserId ||
        isNaN(Number(targetUserId)) ||
        targetUserId === "undefined"
      ) {
        return res.status(400).json({ error: "无效的用户ID参数" });
      }

      const [targetUser] = await pool.execute(
        "SELECT role FROM users WHERE id = ? AND deleted_at IS NULL",
        [targetUserId],
      );
      if (targetUser.length === 0) {
        return res.status(404).json({ error: "目标用户不存在或已被软删除" });
      }

      if (targetUser[0].role === "admin") {
        const [adminCount] = await pool.execute(
          "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND deleted_at IS NULL",
        );
        if (adminCount[0].count <= 1) {
          return res.status(403).json({
            error: "安全拦截：无法删除系统中最后一个管理员账号，否则将导致系统锁死",
          });
        }
      }

      await pool.execute(
        `UPDATE users SET
           deleted_at = NOW(),
           status = 'suspended',
           username = CONCAT(username, '_deleted_', id),
           email = CONCAT('deleted_', id, '_', email)
         WHERE id = ?`,
        [targetUserId],
      );

      logger.warn(
        `操作审计: 管理员 [ID=${req.user.id}] 软删除了用户 [ID=${targetUserId}]`,
      );
      res.json({ message: "用户已成功软删除" });
    } catch (error) {
      logger.error("软删除用户失败:", error);
      res.status(500).json({ error: "删除用户失败" });
    }
  },
);

// 管理员通用修改用户信息接口
router.put("/users/:id", authenticate, authorize("admin"), async (req, res) => {
  try {
    const targetUserId = req.params.id;

    if (
      !targetUserId ||
      isNaN(Number(targetUserId)) ||
      targetUserId === "undefined"
    ) {
      return res.status(400).json({ error: "无效的用户ID参数" });
    }

    const dataSource = req.body.form || req.body.user || req.body;

    const username = dataSource.username;
    const email = dataSource.email;
    const real_name =
      dataSource.real_name !== undefined
        ? dataSource.real_name
        : dataSource.realName;
    const role = dataSource.role;
    const status = dataSource.status;
    const quota_total =
      dataSource.quota_total !== undefined
        ? dataSource.quota_total
        : dataSource.quotaTotal;

    const [targetUser] = await pool.execute(
      "SELECT id, role FROM users WHERE id = ? AND deleted_at IS NULL",
      [targetUserId],
    );
    if (targetUser.length === 0) {
      return res.status(404).json({ error: "用户不存在" });
    }
    const currentRole = targetUser[0].role;

    if (username !== undefined) {
      if (username.length < 3 || username.length > 50) {
        return res
          .status(400)
          .json({ error: "用户名长度必须在 3 到 50 个字符之间" });
      }
      const usernameRegex = /^[a-zA-Z0-9一-龥]+$/;
      if (!usernameRegex.test(username)) {
        return res
          .status(400)
          .json({ error: "用户名只能由字母、数字与汉字组成" });
      }

      const [dupUser] = await pool.execute(
        "SELECT id FROM users WHERE username = ? AND id != ? AND deleted_at IS NULL",
        [username, targetUserId],
      );
      if (dupUser.length > 0) {
        return res.status(409).json({ error: "用户名已存在" });
      }
    }

    if (role !== undefined) {
      const allowedRoles = [
        "student",
        "teacher",
        "expert",
        "admin",
        "civilian",
      ];
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ error: "无效的变更目标角色类型" });
      }

      if (currentRole === "admin" && role !== "admin") {
        const [adminCount] = await pool.execute(
          "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND deleted_at IS NULL",
        );
        if (adminCount[0].count <= 1) {
          return res.status(403).json({
            error: "安全拦截：该用户是系统中唯一的活跃管理员，禁止将其降级或更改角色",
          });
        }
      }
    }

    if (email) {
      const [dupEmail] = await pool.execute(
        "SELECT id FROM users WHERE email = ? AND id != ? AND deleted_at IS NULL",
        [email, targetUserId],
      );
      if (dupEmail.length > 0)
        return res.status(409).json({ error: "该邮箱已被其他账号绑定" });
    }

    const updateFields = [];
    const queryParams = [];

    if (username !== undefined) {
      updateFields.push("username = ?");
      queryParams.push(username);
    }
    if (email !== undefined) {
      updateFields.push("email = ?");
      queryParams.push(email);
    }
    if (real_name !== undefined) {
      updateFields.push("real_name = ?");
      queryParams.push(real_name);
    }
    if (role !== undefined) {
      updateFields.push("role = ?");
      queryParams.push(role);
    }
    if (status !== undefined) {
      updateFields.push("status = ?");
      queryParams.push(status);
    }
    if (quota_total !== undefined) {
      updateFields.push("quota_total = ?");
      queryParams.push(quota_total);
    }

    if (updateFields.length === 0) {
      return res
        .status(400)
        .json({ error: "未检测到任何可变更的有效变动字段" });
    }

    queryParams.push(targetUserId);

    const sql = `UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`;
    await pool.execute(sql, queryParams);

    logger.info(
      `操作审计: 管理员 [ID=${req.user.id}] 动态更新了用户 [ID=${targetUserId}] 的关键资料（已变更字段数: ${updateFields.length}）`,
    );
    res.json({ message: "用户信息更新成功" });
  } catch (error) {
    logger.error("管理员更新用户信息失败:", error);
    res.status(500).json({ error: "更新用户信息失败" });
  }
});

// 管理员强制重置任意用户密码接口
router.post(
  "/users/:id/reset-password",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    try {
      const targetUserId = req.params.id;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: "新密码长度至少为6个字符" });
      }

      const [targetUser] = await pool.execute(
        "SELECT id FROM users WHERE id = ? AND deleted_at IS NULL",
        [targetUserId],
      );
      if (targetUser.length === 0) {
        return res.status(404).json({ error: "目标用户不存在" });
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);

      await pool.execute("UPDATE users SET password_hash = ? WHERE id = ?", [
        passwordHash,
        targetUserId,
      ]);

      logger.warn(
        `高级审计: 管理员 [ID=${req.user.id}] 强制重置了用户 [ID=${targetUserId}] 的登录密码`,
      );
      res.json({ message: "用户密码重置成功" });
    } catch (error) {
      logger.error("管理员重置用户密码失败:", error);
      res.status(500).json({ error: "重置密码失败" });
    }
  },
);

module.exports = router;

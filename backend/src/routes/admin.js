const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../utils/database");
const logger = require("../utils/logger");
const { authenticate, authorize } = require("../middleware/auth");

const router = express.Router();

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
    const { page = 1, limit = 20, role, status, search } = req.query;

    // 严格计算并拦截安全限制上限，强制单次查询最大上限为 100 条记录，防止高并发下内存溢出 (OOM)
    let safeLimit = parseInt(limit);
    if (isNaN(safeLimit) || safeLimit <= 0) safeLimit = 20;
    if (safeLimit > 100) safeLimit = 100;

    const offset = (parseInt(page) - 1) * safeLimit;

    let whereClause = "WHERE deleted_at IS NULL";
    let params = [];

    if (role) {
      whereClause += " AND role = ?";
      params.push(role);
    }

    if (status) {
      whereClause += " AND status = ?";
      params.push(status);
    }

    if (search) {
      whereClause +=
        " AND (username LIKE ? OR email LIKE ? OR real_name LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [users] = await pool.query(
      `SELECT id, username, email, real_name, role, status, phone_verified, id_verified,
              quota_total, quota_used, last_login_at, created_at
       FROM users ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, safeLimit, offset],
    );

    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM users ${whereClause}`,
      params,
    );

    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
      },
    });
  } catch (error) {
    logger.error("获取用户列表失败:", error);
    res.status(500).json({ error: "获取用户列表失败" });
  }
});

// 审核用户（验证身份 - 补齐对 suspended 封禁状态的业务流支持）
router.post(
  "/users/:id/verify",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    try {
      const userId = req.params.id;
      const { status, reason } = req.body; // status: active, rejected, suspended

      const [users] = await pool.execute(
        "SELECT username, email, role FROM users WHERE id = ?",
        [userId],
      );

      if (users.length === 0) {
        return res.status(404).json({ error: "用户不存在" });
      }

      await pool.execute("UPDATE users SET status = ? WHERE id = ?", [
        status,
        userId,
      ]);

      // 审核通过时同步标记身份验证状态
      if (status === "active") {
        await pool.execute("UPDATE users SET id_verified = 1 WHERE id = ?", [userId]);
      }

      // 动态推断通知标题与具体通知文本内容
      let title = "身份验证未通过";
      let content = `您的身份验证未通过，原因：${reason || "资料不完整"}`;

      if (status === "active") {
        title = "身份验证通过";
        content = "您的身份验证已通过，可以正常使用系统功能";
      } else if (status === "suspended") {
        title = "账号封禁通知";
        content = `您的账号在审核阶段已被管理员强制封禁，原因：${reason || "检测到注册信息存在安全合规风险"}`;
      }

      // 发送系统内精准通知
      await pool.execute(
        `INSERT INTO notifications (user_id, type, title, content)
       VALUES (?, 'system', ?, ?)`,
        [userId, title, content],
      );

      logger.info(
        `用户审核状态变更: user_id=${userId}, 最终状态设为=${status}`,
      );

      res.json({
        message:
          status === "active"
            ? "审核通过"
            : status === "suspended"
              ? "已封禁"
              : "已拒绝",
      });
    } catch (error) {
      logger.error("用户审核状态变更失败:", error);
      res.status(500).json({ error: "审核或封禁状态应用失败" });
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
      `SELECT COUNT(*) as total FROM data_submissions d ${whereClause}`,
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
        "SELECT title, submitter_id FROM data_submissions WHERE id = ?",
        [dataId],
      );

      if (dataList.length === 0) {
        return res.status(404).json({ error: "数据不存在" });
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

// 管理员软删除用户接口 (已修复路径拼接错乱及归属不规范问题)
router.delete(
  "/users/:id",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    try {
      const targetUserId = req.params.id;

      // 强校验：防止因前端未传参引入恶意或无效路径标识
      if (
        !targetUserId ||
        isNaN(Number(targetUserId)) ||
        targetUserId === "undefined"
      ) {
        return res.status(400).json({ error: "无效的用户ID参数" });
      }

      // 1. 拦截最高管理员自毁风险（引入未删除限制条件）
      const [targetUser] = await pool.execute(
        "SELECT role FROM users WHERE id = ? AND deleted_at IS NULL",
        [targetUserId],
      );
      if (targetUser.length === 0) {
        return res.status(404).json({ error: "目标用户不存在或已被软删除" });
      }

      if (targetUser[0].role === "admin") {
        // 检查系统中剩余未被删除的管理员数量
        const [adminCount] = await pool.execute(
          "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND deleted_at IS NULL",
        );
        if (adminCount[0].count <= 1) {
          return res.status(403).json({
            error:
              "安全拦截：无法删除系统中最后一个管理员账号，否则将导致系统锁死",
          });
        }
      }

      // 2. 拒绝硬删除（Hard Delete），执行软删除（Soft Delete），防止破坏外键约束与审计日志关联
      await pool.execute(
        "UPDATE users SET deleted_at = NOW(), status = 'suspended' WHERE id = ?",
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

// 管理员通用修改用户信息接口 (全面支持提权、配额入库，并增加了对恶意传参或特殊包裹请求体的兼容)
router.put("/users/:id", authenticate, authorize("admin"), async (req, res) => {
  try {
    const targetUserId = req.params.id;

    // 严格防御：防止前端由于参数处理不当传入包含 "undefined" 的无效路径引发数据库逻辑错乱
    if (
      !targetUserId ||
      isNaN(Number(targetUserId)) ||
      targetUserId === "undefined"
    ) {
      return res.status(400).json({ error: "无效的用户ID参数" });
    }

    // 健壮性增强：完美兼容前端直接传递平铺字段，或将其包裹在 form/user 对象中发送的各种变体
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

    // 验证目标用户是否存在并拉取其当前角色信息
    const [targetUser] = await pool.execute(
      "SELECT id, role FROM users WHERE id = ? AND deleted_at IS NULL",
      [targetUserId],
    );
    if (targetUser.length === 0) {
      return res.status(404).json({ error: "用户不存在" });
    }
    const currentRole = targetUser[0].role;

    // 1. 精准执行唯一性约束与用户名合法性核验
    if (username !== undefined) {
      // 增加长度限制防御
      if (username.length < 3 || username.length > 50) {
        return res
          .status(400)
          .json({ error: "用户名长度必须在 3 到 50 个字符之间" });
      }
      // 增加字符合法性正则校验，拦截恶意注入或非法特殊字符
      const usernameRegex = /^[a-zA-Z0-9\u4e00-\u9fa5]+$/;
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

    // 2. 提权角色合法性核验与末位管理员降级风险拦截
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

      // 如果当前被修改用户为管理员，但试图将其变更为非管理员角色（触发降级）
      if (currentRole === "admin" && role !== "admin") {
        const [adminCount] = await pool.execute(
          "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND deleted_at IS NULL",
        );
        if (adminCount[0].count <= 1) {
          return res.status(403).json({
            error:
              "安全拦截：该用户是系统中唯一的活跃管理员，禁止将其降级或更改角色",
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

    // 2. 采用安全的动态 SQL 拼接，补充配额(quota_total)与角色提权(role)的动态入库映射
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

    // 压入 WHERE 语句的查询 ID
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

// 管理员强制重置任意用户密码接口 (彻底补齐密码修改逻辑缺失问题)
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

      // 密码强加盐加密
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

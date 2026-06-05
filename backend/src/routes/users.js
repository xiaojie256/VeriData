const express = require("express");
const pool = require("../utils/database");
const logger = require("../utils/logger");
const { authenticate, authorize } = require("../middleware/auth");
const { upload, handleUploadError } = require("../middleware/upload");

const router = express.Router();

// ==================== 1. 静态常量路由（优先匹配） ====================

// 获取用户列表（仅限教师/专家查看）
router.get(
  "/",
  authenticate,
  authorize("teacher", "expert", "admin"),
  async (req, res) => {
    try {
      const { role, search, page = 1, limit = 20 } = req.query;

      // 1. 严格计算安全限制上限
      let safeLimit = parseInt(limit);
      if (isNaN(safeLimit) || safeLimit <= 0) safeLimit = 20;
      if (safeLimit > 100) safeLimit = 100; // 强制单次查询最大上限为 100 条记录

      // 2. 修正：使用控制后的 safeLimit 计算偏移量，防止逻辑越界
      const offset = (parseInt(page) - 1) * safeLimit;

      let whereClause = "WHERE deleted_at IS NULL";
      let params = [];

      // 教师只能查看自己的学生
      if (req.user.role === "teacher") {
        whereClause +=
          ' AND id IN (SELECT student_id FROM teacher_student_relations WHERE teacher_id = ? AND status = "active")';
        params.push(req.user.id);
      }

      if (role) {
        whereClause += " AND role = ?";
        params.push(role);
      }

      if (search) {
        whereClause += " AND (username LIKE ? OR real_name LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
      }

      // 3. 修正：将参数绑定的限制项替换为安全的 safeLimit 变量
      const [users] = await pool.query(
        `SELECT id, username, real_name, avatar_url, role, status, created_at
       FROM users ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
        [...params, safeLimit, offset],
      );

      res.json({ users });
    } catch (error) {
      logger.error("获取用户列表失败:", error);
      res.status(500).json({ error: "获取用户列表失败" });
    }
  },
);

// 获取通知列表
router.get("/notifications/list", authenticate, async (req, res) => {
  try {
    // 验证用户ID
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "用户未认证" });
    }

    const userId = req.user.id.toString();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const { unread_only = false } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = "WHERE user_id = ?";
    let params = [userId];

    if (unread_only === "true") {
      whereClause += " AND is_read = 0";
    }

    const [notifications] = await pool.query(
      `SELECT id, type, title, content, is_read, related_type, related_id, created_at
       FROM notifications ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    // 获取未读数量
    const [unreadCount] = await pool.execute(
      "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0",
      [userId],
    );

    // 计算满足当前筛选条件的通知总条数
    const [totalCount] = await pool.execute(
      `SELECT COUNT(*) as total FROM notifications ${whereClause}`,
      params,
    );

    res.json({
      notifications,
      unread_count: unreadCount[0].count,
      pagination: {
        page,
        limit,
        total: totalCount[0].total,
      },
    });
  } catch (error) {
    logger.error("获取通知失败:", error);
    res.status(500).json({ error: "获取通知失败" });
  }
});

// 获取配额使用记录
router.get("/quota-logs", authenticate, async (req, res) => {
  try {
    const [logs] = await pool.execute(
      `SELECT action_type, quota_consumed, description, created_at
       FROM quota_usage_logs 
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id],
    );

    res.json({ logs });
  } catch (error) {
    logger.error("获取配额记录失败:", error);
    res.status(500).json({ error: "获取配额记录失败" });
  }
});

// 获取我的学生列表（导师专享）
router.get(
  "/my-students",
  authenticate,
  authorize("teacher"),
  async (req, res) => {
    try {
      const [students] = await pool.execute(
        `SELECT u.id, u.username, u.real_name, u.avatar_url, u.status, u.created_at,
              tsr.status as relation_status, tsr.created_at as added_at
       FROM users u
       JOIN teacher_student_relations tsr ON u.id = tsr.student_id
       WHERE tsr.teacher_id = ? AND u.deleted_at IS NULL
       ORDER BY tsr.created_at DESC`,
        [req.user.id],
      );

      res.json({ students });
    } catch (error) {
      logger.error("获取学生列表失败:", error);
      res.status(500).json({ error: "获取学生列表失败" });
    }
  },
);

// 获取我的导师（学生专享）
router.get(
  "/my-teacher",
  authenticate,
  authorize("student"),
  async (req, res) => {
    try {
      const [teachers] = await pool.execute(
        `SELECT u.id, u.username, u.real_name, u.avatar_url, u.email,
              tsr.status as relation_status
       FROM users u
       JOIN teacher_student_relations tsr ON u.id = tsr.teacher_id
       WHERE tsr.student_id = ? AND tsr.status = 'active' AND u.deleted_at IS NULL`,
        [req.user.id],
      );

      res.json({ teachers: teachers[0] || null });
    } catch (error) {
      logger.error("获取导师信息失败:", error);
      res.status(500).json({ error: "获取导师信息失败" });
    }
  },
);

// ==================== 2. 操作类 POST 路由 ====================

// 标记通知已读
router.post("/notifications/:id/read", authenticate, async (req, res) => {
  try {
    await pool.execute(
      "UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id],
    );

    res.json({ message: "已标记为已读" });
  } catch (error) {
    logger.error("标记通知失败:", error);
    res.status(500).json({ error: "操作失败" });
  }
});

// 标记所有通知已读
router.post("/notifications/read-all", authenticate, async (req, res) => {
  try {
    await pool.execute(
      "UPDATE notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0",
      [req.user.id],
    );

    res.json({ message: "所有通知已标记为已读" });
  } catch (error) {
    logger.error("标记所有通知失败:", error);
    res.status(500).json({ error: "操作失败" });
  }
});

// 教师添加学生
router.post(
  "/students",
  authenticate,
  authorize("teacher"),
  async (req, res) => {
    try {
      const { student_username } = req.body;

      // 查找学生
      const [students] = await pool.execute(
        'SELECT id FROM users WHERE username = ? AND role = "student"',
        [student_username],
      );

      if (students.length === 0) {
        return res.status(404).json({ error: "学生不存在" });
      }

      const studentId = students[0].id;

      // 检查是否已建立关系
      const [existing] = await pool.execute(
        "SELECT id FROM teacher_student_relations WHERE teacher_id = ? AND student_id = ?",
        [req.user.id, studentId],
      );

      if (existing.length > 0) {
        return res.status(409).json({ error: "该学生已添加" });
      }

      await pool.execute(
        "INSERT INTO teacher_student_relations (teacher_id, student_id) VALUES (?, ?)",
        [req.user.id, studentId],
      );

      // 通知学生
      await pool.execute(
        `INSERT INTO notifications (user_id, type, title, content)
       VALUES (?, 'system', '导师关联通知', ?)`,
        [
          studentId,
          `导师 ${req.user.real_name || req.user.username} 已将您添加为学生`,
        ],
      );

      res.json({ message: "学生添加成功" });
    } catch (error) {
      logger.error("添加学生失败:", error);
      res.status(500).json({ error: "添加学生失败" });
    }
  },
);

// ==================== 3. 动态拦截路由（垫底） ====================

// 提交身份验证资料（身份证号 + 正反面照片）
router.post(
  "/verify/id-card",
  authenticate,
  (req, res, next) => {
    req.uploadType = "id-card";
    next();
  },
  upload.fields([
    { name: "id_card_front", maxCount: 1 },
    { name: "id_card_back", maxCount: 1 },
  ]),
  handleUploadError,
  async (req, res) => {
    try {
      const { id_card_number } = req.body;

      if (!id_card_number || id_card_number.length < 15 || id_card_number.length > 18) {
        return res.status(400).json({ error: "请输入有效的身份证号码（15或18位）" });
      }

      const frontFile = req.files?.id_card_front?.[0];
      const backFile = req.files?.id_card_back?.[0];

      if (!frontFile || !backFile) {
        return res.status(400).json({ error: "请上传身份证正反面照片" });
      }

      const frontUrl = `/uploads/id-cards/${frontFile.filename}`;
      const backUrl = `/uploads/id-cards/${backFile.filename}`;

      await pool.execute(
        "UPDATE users SET id_card_number = ?, id_card_front = ?, id_card_back = ?, status = 'pending_verification' WHERE id = ?",
        [id_card_number, frontUrl, backUrl, req.user.id],
      );

      logger.info(`用户提交身份验证资料: user_id=${req.user.id}`);
      res.json({ message: "身份验证资料已提交，等待管理员审核" });
    } catch (error) {
      logger.error("提交身份验证资料失败:", error);
      res.status(500).json({ error: "提交失败，请稍后重试" });
    }
  },
);

// 获取用户详情
router.get("/:id", authenticate, async (req, res) => {
  try {
    const userId = req.params.id;

    // 只能查看自己或有权限查看的用户
    if (
      userId != req.user.id &&
      !["admin", "teacher"].includes(req.user.role)
    ) {
      return res.status(403).json({ error: "无权查看此用户信息" });
    }

    const [users] = await pool.execute(
      `SELECT id, username, real_name, avatar_url, role, status, 
              email_verified, phone_verified, id_verified,
              quota_total, quota_used, created_at, last_login_at
       FROM users WHERE id = ? AND deleted_at IS NULL`,
      [userId],
    );

    if (users.length === 0) {
      return res.status(404).json({ error: "用户不存在" });
    }

    res.json({ user: users[0] });
  } catch (error) {
    logger.error("获取用户详情失败:", error);
    res.status(500).json({ error: "获取用户详情失败" });
  }
});

router.put("/me", authenticate, async (req, res) => {
  try {
    const { real_name, email, phone } = req.body;
    const userId = req.user.id;

    // 1. 唯一性约束核验：防止修改后的邮箱与其他现存活跃用户的邮箱冲突
    if (email) {
      const [existingEmail] = await pool.execute(
        "SELECT id FROM users WHERE email = ? AND id != ? AND deleted_at IS NULL",
        [email, userId],
      );
      if (existingEmail.length > 0) {
        return res.status(409).json({ error: "该邮箱已被其他账号绑定" });
      }
    }

    // 2. 强类型字段防御：严禁直接解构入库，只允许修改 real_name, email, phone
    // 彻底隔绝普通用户通过此接口提权修改 role, status 或 quota_total 的红线风险
    await pool.execute(
      "UPDATE users SET real_name = ?, email = ?, phone = ? WHERE id = ?",
      [real_name || null, email || null, phone || null, userId],
    );

    logger.info(`用户资料更新成功: ID=${userId}`);
    res.json({ message: "个人资料更新成功" });
  } catch (error) {
    logger.error("更新个人资料失败:", error);
    res.status(500).json({ error: "更新个人资料失败" });
  }
});

module.exports = router;

const express = require("express");
const pool = require("../utils/database");
const logger = require("../utils/logger");
const { authenticate, authorize } = require("../middleware/auth");
const { auditLog } = require("../middleware/audit");

const router = express.Router();

const ALLOWED_REVIEW_DECISIONS = new Set([
  'approved',
  'rejected',
  'revision_required'
]);

const normalizeReviewScore = (score) => {
  if (score === undefined || score === null || score === '') return null;
  const n = Number.parseInt(score, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
};

// 获取待审核列表
router.get(
  "/pending",
  authenticate,
  authorize("teacher", "expert", "admin"),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 100);
      const offset = (page - 1) * limit;
      const reviewType = String(req.query.review_type || "").trim();

      if (reviewType && !["teacher", "expert", "admin"].includes(reviewType)) {
        return res.status(400).json({ error: "无效的审核类型" });
      }

      const where = ["r.status = 'pending'", "d.deleted_at IS NULL"];
      const params = [];

      if (reviewType) {
        where.push("r.review_type = ?");
        params.push(reviewType);
      }

      if (req.user.role === "teacher") {
        where.push("r.review_type = 'teacher'");
        where.push("r.reviewer_id = ?");
        where.push(`
          EXISTS (
            SELECT 1
            FROM teacher_student_relations tsr
            WHERE tsr.teacher_id = ?
              AND tsr.student_id = d.submitter_id
              AND tsr.status = 'active'
          )
        `);
        params.push(userId, userId);
      } else if (req.user.role === "expert") {
        where.push("r.review_type = 'expert'");
        where.push("(r.reviewer_id IS NULL OR r.reviewer_id = ?)");
        params.push(userId);
      } else if (req.user.role === "admin") {
        if (!reviewType) {
          where.push("r.review_type IN ('admin', 'teacher', 'expert')");
        }
      }

      const [reviews] = await pool.query(
        `SELECT
           r.id AS review_id,
           r.data_id,
           r.review_type,
           r.status,
           r.created_at AS assigned_at,
           d.title,
           d.description,
           d.data_type,
           d.data_format,
           d.submitted_at,
           d.review_status,
           d.ai_check_status,
           d.ai_check_score,
           d.ai_anomaly_detected,
           CASE WHEN r.is_blind_review = 1 THEN NULL ELSE u.username END AS submitter_name,
           CASE WHEN r.is_blind_review = 1 THEN NULL ELSE u.real_name END AS submitter_real_name
         FROM review_records r
         JOIN data_submissions d ON r.data_id = d.id
         LEFT JOIN users u ON d.submitter_id = u.id
         WHERE ${where.join(" AND ")}
         ORDER BY d.submitted_at ASC, r.created_at ASC
         LIMIT ? OFFSET ?`,
        [...params, Number(limit), Number(offset)]
      );

      const [countRows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM review_records r
         JOIN data_submissions d ON r.data_id = d.id
         WHERE ${where.join(" AND ")}`,
        params
      );

      res.json({
        reviews,
        pagination: {
          page,
          limit,
          total: countRows[0].total
        }
      });
    } catch (error) {
      logger.error("获取待审核列表失败:", error);
      res.status(500).json({ error: "获取待审核列表失败" });
    }
  }
);

// 获取审核历史
router.get("/history", authenticate, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "用户未认证" });
    }

    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [reviews] = await pool.query(
      `SELECT r.id, r.data_id, r.review_type, r.status, r.overall_score, r.completed_at,
              d.title, r.comments, r.ai_assisted
       FROM review_records r
       JOIN data_submissions d ON r.data_id = d.id
       WHERE r.reviewer_id = ? AND r.status != 'pending'
       ORDER BY r.completed_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset],
    );

    res.json({ reviews });
  } catch (error) {
    logger.error("获取审核历史失败:", error);
    res.status(500).json({ error: "获取审核历史失败" });
  }
});

// 执行审核（导师一审）
router.post(
  "/:id/teacher",
  authenticate,
  authorize("teacher", "admin"),
  auditLog("review", "review"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const reviewId = Number.parseInt(req.params.id, 10);
      const {
        status,
        completeness_score,
        accuracy_score,
        originality_score,
        methodology_score,
        overall_score,
        comments,
        issues_found,
        suggestions
      } = req.body;

      if (!Number.isFinite(reviewId) || reviewId <= 0) {
        return res.status(400).json({ error: "无效的审核记录ID" });
      }

      if (!ALLOWED_REVIEW_DECISIONS.has(status)) {
        return res.status(400).json({ error: "无效的审核结论" });
      }

      await connection.beginTransaction();

      const params = [reviewId];
      let permissionClause = "";

      if (req.user.role !== "admin") {
        permissionClause = `
          AND r.reviewer_id = ?
          AND EXISTS (
            SELECT 1
            FROM teacher_student_relations tsr
            WHERE tsr.teacher_id = ?
              AND tsr.student_id = d.submitter_id
              AND tsr.status = 'active'
          )
        `;
        params.push(req.user.id, req.user.id);
      }

      const [reviews] = await connection.execute(
        `SELECT r.*, d.id AS data_id, d.title, d.submitter_id, d.review_status
         FROM review_records r
         JOIN data_submissions d ON r.data_id = d.id
         WHERE r.id = ?
           AND r.review_type = 'teacher'
           AND r.status = 'pending'
           AND d.deleted_at IS NULL
           ${permissionClause}
         FOR UPDATE`,
        params
      );

      if (reviews.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: "审核记录不存在、已处理或无权限" });
      }

      const review = reviews[0];

      if (review.review_status !== "teacher_reviewing") {
        await connection.rollback();
        return res.status(409).json({
          error: `当前数据状态为 ${review.review_status}，不能进行导师一审`
        });
      }

      await connection.execute(
        `UPDATE review_records
         SET status = ?,
             completeness_score = ?,
             accuracy_score = ?,
             originality_score = ?,
             methodology_score = ?,
             overall_score = ?,
             comments = ?,
             issues_found = ?,
             suggestions = ?,
             completed_at = NOW()
         WHERE id = ?`,
        [
          status,
          normalizeReviewScore(completeness_score),
          normalizeReviewScore(accuracy_score),
          normalizeReviewScore(originality_score),
          normalizeReviewScore(methodology_score),
          normalizeReviewScore(overall_score),
          comments || null,
          JSON.stringify(issues_found || []),
          suggestions || null,
          reviewId
        ]
      );

      let newStatus;
      let progress;
      let message;
      let notificationTitle;
      let notificationContent;

      if (status === "approved") {
        newStatus = "expert_reviewing";
        progress = 40;
        message = "导师一审通过，进入专家盲审阶段";
        notificationTitle = "导师审核通过";
        notificationContent = `您的数据《${review.title}》已通过导师一审，进入专家盲审阶段。`;

        await connection.execute(
          `INSERT INTO review_records (data_id, reviewer_id, review_type, status, is_blind_review)
           VALUES (?, NULL, 'expert', 'pending', 1)`,
          [review.data_id]
        );
      } else if (status === "rejected") {
        newStatus = "teacher_rejected";
        progress = 0;
        message = "导师审核未通过";
        notificationTitle = "导师审核未通过";
        notificationContent = `您的数据《${review.title}》未通过导师审核，请修改后重新提交。`;
      } else {
        newStatus = "teacher_rejected";
        progress = 0;
        message = "需要修改后重新提交";
        notificationTitle = "数据需要修改";
        notificationContent = `您的数据《${review.title}》需要修改，请根据导师意见完善后重新提交。`;
      }

      await connection.execute(
        "UPDATE data_submissions SET review_status = ?, review_progress = ? WHERE id = ?",
        [newStatus, progress, review.data_id]
      );

      await connection.execute(
        `INSERT INTO notifications (user_id, type, title, content, related_type, related_id)
         VALUES (?, 'review', ?, ?, 'data', ?)`,
        [
          review.submitter_id,
          notificationTitle,
          notificationContent,
          review.data_id
        ]
      );

      await connection.commit();

      logger.info(`导师审核完成: review_id=${reviewId}, status=${status}`);

      res.json({ message, new_status: newStatus });
    } catch (error) {
      await connection.rollback();
      logger.error("导师审核失败:", error);
      res.status(500).json({ error: "审核失败" });
    } finally {
      connection.release();
    }
  }
);

// 执行专家盲审
router.post(
  "/:id/expert",
  authenticate,
  authorize("expert", "admin"),
  auditLog("review", "review"),
  async (req, res) => {
    try {
      const reviewId = req.params.id;
      const {
        status,
        completeness_score,
        accuracy_score,
        originality_score,
        methodology_score,
        overall_score,
        comments,
        issues_found,
        suggestions,
        ai_analysis,
      } = req.body;

      if (!ALLOWED_REVIEW_DECISIONS.has(status)) {
        return res.status(400).json({ error: "无效的审核结论" });
      }

      // 验证审核记录
      const [reviews] = await pool.execute(
        `SELECT r.*, d.id as data_id, d.title, d.submitter_id, d.review_status
       FROM review_records r
       JOIN data_submissions d ON r.data_id = d.id
       WHERE r.id = ?
         AND r.review_type = 'expert'
         AND r.status = 'pending'
         AND d.deleted_at IS NULL
         AND (r.reviewer_id IS NULL OR r.reviewer_id = ?)`,
        [reviewId, req.user.id],
      );

      if (reviews.length === 0) {
        return res.status(404).json({ error: "审核记录不存在" });
      }

      const review = reviews[0];

      if (review.review_status !== "expert_reviewing") {
        return res.status(409).json({
          error: `当前数据状态为 ${review.review_status}，不能进行专家盲审`
        });
      }

      // 如果原记录未分配专家，则第一次提交时锁定到当前专家
      if (!review.reviewer_id) {
        const [claimResult] = await pool.execute(
          "UPDATE review_records SET reviewer_id = ? WHERE id = ? AND reviewer_id IS NULL AND status = 'pending'",
          [req.user.id, reviewId],
        );

        if (claimResult.affectedRows !== 1) {
          return res.status(409).json({ error: "该审核已被其他专家领取，请刷新列表" });
        }
      }

      // 更新审核记录
      await pool.execute(
        `UPDATE review_records
       SET status = ?, completeness_score = ?, accuracy_score = ?, originality_score = ?,
           methodology_score = ?, overall_score = ?, comments = ?, issues_found = ?,
           suggestions = ?, ai_assisted = ?, ai_analysis = ?, completed_at = NOW()
       WHERE id = ?`,
        [
          status,
          completeness_score,
          accuracy_score,
          originality_score,
          methodology_score,
          overall_score,
          comments,
          JSON.stringify(issues_found || []),
          suggestions,
          ai_analysis ? 1 : 0,
          ai_analysis,
          reviewId,
        ],
      );

      let newStatus, progress, message;

      if (status === "approved") {
        newStatus = "expert_approved";
        progress = 70;
        message = "专家盲审通过，等待最终审核";

        // 创建管理员终审记录
        await pool.execute(
          `INSERT INTO review_records (data_id, reviewer_id, review_type, status, is_blind_review)
         VALUES (?, NULL, 'admin', 'pending', 0)`,
          [review.data_id],
        );
      } else if (status === "rejected") {
        newStatus = "expert_rejected";
        progress = 0;
      } else {
        newStatus = "expert_rejected";
        progress = 0;
        message = "需要修改后重新提交";
      }

      await pool.execute(
        "UPDATE data_submissions SET review_status = ?, review_progress = ? WHERE id = ?",
        [newStatus, progress, review.data_id],
      );

      // 通知提交者（盲审不透露专家信息）
      await pool.execute(
        `INSERT INTO notifications (user_id, type, title, content, related_type, related_id)
       VALUES (?, 'review', ?, ?, 'data', ?)`,
        [
          review.submitter_id,
          status === "approved" ? "专家盲审通过" : "专家盲审未通过",
          `您的数据《${review.title}》${status === "approved" ? "已通过专家盲审" : "未通过专家盲审，请修改后重新提交"}`,
          review.data_id,
        ],
      );

      logger.info(`专家审核完成: review_id=${reviewId}, status=${status}`);

      res.json({ message, new_status: newStatus });
    } catch (error) {
      logger.error("专家审核失败:", error);
      res.status(500).json({ error: "审核失败" });
    }
  },
);

// 获取AI辅助分析结果
router.get(
  "/:id/ai-analysis",
  authenticate,
  authorize("teacher", "expert", "admin"),
  async (req, res) => {
    try {
      const dataId = req.params.id;

      const [dataList] = await pool.execute(
        `SELECT id, submitter_id, review_status, ai_check_result, ai_check_score, ai_anomaly_detected
         FROM data_submissions
         WHERE id = ? AND deleted_at IS NULL`,
        [dataId]
      );

      if (dataList.length === 0) {
        return res.status(404).json({ error: "数据不存在" });
      }

      const data = dataList[0];

      let hasPermission = req.user.role === "admin";

      if (!hasPermission && req.user.role === "teacher") {
        const [relations] = await pool.execute(
          `SELECT id FROM teacher_student_relations
           WHERE teacher_id = ? AND student_id = ? AND status = 'active'`,
          [req.user.id, data.submitter_id]
        );
        hasPermission = relations.length > 0;
      }

      if (!hasPermission && req.user.role === "expert") {
        const [reviews] = await pool.execute(
          `SELECT id FROM review_records
           WHERE data_id = ? AND review_type = 'expert' AND (reviewer_id IS NULL OR reviewer_id = ?)`,
          [dataId, req.user.id]
        );
        hasPermission = reviews.length > 0;
      }

      if (!hasPermission) {
        return res.status(403).json({ error: "无权查看该数据的AI分析结果" });
      }

      let rawResult = {};
      try {
        rawResult = data.ai_check_result ? JSON.parse(data.ai_check_result) : {};
      } catch (e) {
        logger.error("解析AI检查结果失败:", e);
      }
      res.json({
        score: data.ai_check_score,
        has_anomaly: data.ai_anomaly_detected === 1,
        anomalies: rawResult.anomaly_detection?.anomalies || [],
        llm_insight: rawResult.llm_insight || "该数据集尚无大模型审计报告。",
      });
    } catch (error) {
      logger.error("获取AI分析失败:", error);
      res.status(500).json({ error: "获取AI分析失败" });
    }
  },
);

module.exports = router;

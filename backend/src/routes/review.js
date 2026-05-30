const express = require('express');
const pool = require('../utils/database');
const logger = require('../utils/logger');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

const router = express.Router();

// 获取待审核列表
router.get('/pending', authenticate, authorize('teacher', 'expert', 'admin'), async (req, res) => {
  try {
    const { page = 1, limit = 10, review_type } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = '';
    let params = [req.user.id];

    // 导师只查看自己学生的数据
    if (req.user.role === 'teacher') {
      whereClause = 'AND d.submitter_id IN (SELECT student_id FROM teacher_student_relations WHERE teacher_id = ? AND status = "active")';
    } else if (req.user.role === 'expert') {
      // 专家查看所有待盲审的数据（只能查看未分配或分配给自己的）
      whereClause = 'AND (r.reviewer_id IS NULL OR r.reviewer_id = ?)';
      params = [req.user.id];
    }

    const [reviews] = await pool.execute(
      `SELECT r.id as review_id, r.data_id, r.review_type, r.status, r.created_at as assigned_at,
              d.title, d.description, d.data_type, d.data_format, d.submitted_at,
              d.ai_check_status, d.ai_check_score, d.ai_anomaly_detected,
              CASE WHEN r.is_blind_review = 1 THEN NULL ELSE u.username END as submitter_name,
              CASE WHEN r.is_blind_review = 1 THEN NULL ELSE u.real_name END as submitter_real_name
       FROM review_records r
       JOIN data_submissions d ON r.data_id = d.id
       LEFT JOIN users u ON d.submitter_id = u.id
       WHERE r.status = 'pending' AND d.deleted_at IS NULL
       ${review_type ? 'AND r.review_type = ?' : ''}
       ${whereClause}
       ORDER BY d.submitted_at ASC
       LIMIT ? OFFSET ?`,
      [...params, ...(review_type ? [review_type] : []), parseInt(limit), offset]
    );

    res.json({ reviews });
  } catch (error) {
    logger.error('获取待审核列表失败:', error);
    res.status(500).json({ error: '获取待审核列表失败' });
  }
});

// 获取审核历史
router.get('/history', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [reviews] = await pool.execute(
      `SELECT r.id, r.data_id, r.review_type, r.status, r.overall_score, r.completed_at,
              d.title, r.comments, r.ai_assisted
       FROM review_records r
       JOIN data_submissions d ON r.data_id = d.id
       WHERE r.reviewer_id = ? AND r.status != 'pending'
       ORDER BY r.completed_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, parseInt(limit), offset]
    );

    res.json({ reviews });
  } catch (error) {
    logger.error('获取审核历史失败:', error);
    res.status(500).json({ error: '获取审核历史失败' });
  }
});

// 执行审核（导师一审）
router.post('/:id/teacher', authenticate, authorize('teacher', 'admin'), auditLog('review', 'review'), async (req, res) => {
  try {
    const reviewId = req.params.id;
    const { 
      status, // approved, rejected, revision_required
      completeness_score,
      accuracy_score,
      originality_score,
      methodology_score,
      overall_score,
      comments,
      issues_found,
      suggestions
    } = req.body;

    // 验证审核记录
    const [reviews] = await pool.execute(
      `SELECT r.*, d.id as data_id, d.title, d.submitter_id, d.review_status
       FROM review_records r
       JOIN data_submissions d ON r.data_id = d.id
       WHERE r.id = ? AND r.reviewer_id = ? AND r.review_type = 'teacher' AND r.status = 'pending'`,
      [reviewId, req.user.id]
    );

    if (reviews.length === 0) {
      return res.status(404).json({ error: '审核记录不存在或无权限' });
    }

    const review = reviews[0];

    // 更新审核记录
    await pool.execute(
      `UPDATE review_records 
       SET status = ?, completeness_score = ?, accuracy_score = ?, originality_score = ?,
           methodology_score = ?, overall_score = ?, comments = ?, issues_found = ?, 
           suggestions = ?, completed_at = NOW()
       WHERE id = ?`,
      [status, completeness_score, accuracy_score, originality_score, methodology_score, 
       overall_score, comments, JSON.stringify(issues_found || []), suggestions, reviewId]
    );

    let newStatus, progress, message;
    
    if (status === 'approved') {
      newStatus = 'teacher_approved';
      progress = 40;
      message = '导师一审通过，进入专家盲审阶段';
      
      // 创建专家盲审记录
      await pool.execute(
        `INSERT INTO review_records (data_id, review_type, status, is_blind_review)
         VALUES (?, 'expert', 'pending', 1)`,
        [review.data_id]
      );
      
      // 更新数据状态
      await pool.execute(
        'UPDATE data_submissions SET review_status = ?, review_progress = ? WHERE id = ?',
        [newStatus, progress, review.data_id]
      );
      
      // 通知提交者
      await pool.execute(
        `INSERT INTO notifications (user_id, type, title, content, related_type, related_id)
         VALUES (?, 'review', '导师审核通过', ?, 'data', ?)`,
        [review.submitter_id, `您的数据《${review.title}》已通过导师一审，进入专家盲审阶段`, review.data_id]
      );
      
    } else if (status === 'rejected') {
      newStatus = 'teacher_rejected';
      progress = 0;
      message = '导师审核未通过';
      
      await pool.execute(
        'UPDATE data_submissions SET review_status = ?, review_progress = ? WHERE id = ?',
        [newStatus, progress, review.data_id]
      );
      
      // 通知提交者
      await pool.execute(
        `INSERT INTO notifications (user_id, type, title, content, related_type, related_id)
         VALUES (?, 'review', '导师审核未通过', ?, 'data', ?)`,
        [review.submitter_id, `您的数据《${review.title}》未通过导师审核，请修改后重新提交`, review.data_id]
      );
      
    } else { // revision_required
      newStatus = 'draft';
      progress = 0;
      message = '需要修改后重新提交';
      
      await pool.execute(
        'UPDATE data_submissions SET review_status = ?, review_progress = ? WHERE id = ?',
        [newStatus, progress, review.data_id]
      );
      
      // 通知提交者
      await pool.execute(
        `INSERT INTO notifications (user_id, type, title, content, related_type, related_id)
         VALUES (?, 'review', '数据需要修改', ?, 'data', ?)`,
        [review.submitter_id, `您的数据《${review.title}》需要修改，请根据审核意见完善后重新提交`, review.data_id]
      );
    }

    logger.info(`导师审核完成: review_id=${reviewId}, status=${status}`);

    res.json({ message, new_status: newStatus });
  } catch (error) {
    logger.error('导师审核失败:', error);
    res.status(500).json({ error: '审核失败' });
  }
});

// 执行专家盲审
router.post('/:id/expert', authenticate, authorize('expert', 'admin'), auditLog('review', 'review'), async (req, res) => {
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
      ai_analysis // AI辅助分析结果
    } = req.body;

    // 验证审核记录
    const [reviews] = await pool.execute(
      `SELECT r.*, d.id as data_id, d.title, d.submitter_id, d.review_status
       FROM review_records r
       JOIN data_submissions d ON r.data_id = d.id
       WHERE r.id = ? AND r.review_type = 'expert' AND r.status = 'pending'`,
      [reviewId]
    );

    if (reviews.length === 0) {
      return res.status(404).json({ error: '审核记录不存在' });
    }

    const review = reviews[0];

    // 如果没有指定reviewer，则分配给当前专家
    if (!review.reviewer_id) {
      await pool.execute(
        'UPDATE review_records SET reviewer_id = ? WHERE id = ?',
        [req.user.id, reviewId]
      );
    } else if (review.reviewer_id !== req.user.id) {
      return res.status(403).json({ error: '该审核已被其他专家领取' });
    }

    // 更新审核记录
    await pool.execute(
      `UPDATE review_records 
       SET status = ?, completeness_score = ?, accuracy_score = ?, originality_score = ?,
           methodology_score = ?, overall_score = ?, comments = ?, issues_found = ?, 
           suggestions = ?, ai_assisted = ?, ai_analysis = ?, completed_at = NOW()
       WHERE id = ?`,
      [status, completeness_score, accuracy_score, originality_score, methodology_score, 
       overall_score, comments, JSON.stringify(issues_found || []), suggestions, 
       ai_analysis ? 1 : 0, ai_analysis, reviewId]
    );

    let newStatus, progress, message;
    
    if (status === 'approved') {
      newStatus = 'expert_approved';
      progress = 70;
      message = '专家盲审通过，等待最终审核';
      
      // 创建管理员终审记录
      await pool.execute(
        `INSERT INTO review_records (data_id, reviewer_id, review_type, status, is_blind_review)
         VALUES (?, ?, 'admin', 'pending', 0)`,
        [review.data_id, req.user.id] // 这里简化处理，实际应由特定管理员处理
      );
      
    } else if (status === 'rejected') {
      newStatus = 'expert_rejected';
      progress = 0;
      message = '专家盲审未通过';
    } else {
      newStatus = 'draft';
      progress = 0;
      message = '需要修改后重新提交';
    }

    await pool.execute(
      'UPDATE data_submissions SET review_status = ?, review_progress = ? WHERE id = ?',
      [newStatus, progress, review.data_id]
    );

    // 通知提交者（盲审不透露专家信息）
    await pool.execute(
      `INSERT INTO notifications (user_id, type, title, content, related_type, related_id)
       VALUES (?, 'review', ?, ?, 'data', ?)`,
      [review.submitter_id, 
       status === 'approved' ? '专家盲审通过' : '专家盲审未通过',
       `您的数据《${review.title}》${status === 'approved' ? '已通过专家盲审' : '未通过专家盲审，请修改后重新提交'}`,
       review.data_id]
    );

    logger.info(`专家审核完成: review_id=${reviewId}, status=${status}`);

    res.json({ message, new_status: newStatus });
  } catch (error) {
    logger.error('专家审核失败:', error);
    res.status(500).json({ error: '审核失败' });
  }
});

// 获取AI辅助分析结果
router.get('/:id/ai-analysis', authenticate, authorize('teacher', 'expert', 'admin'), async (req, res) => {
  try {
    const dataId = req.params.id;

    const [dataList] = await pool.execute(
      'SELECT ai_check_result, ai_check_score, ai_anomaly_detected FROM data_submissions WHERE id = ?',
      [dataId]
    );

    if (dataList.length === 0) {
      return res.status(404).json({ error: '数据不存在' });
    }

    res.json({
      ai_analysis: dataList[0].ai_check_result,
      ai_score: dataList[0].ai_check_score,
      has_anomaly: dataList[0].ai_anomaly_detected
    });
  } catch (error) {
    logger.error('获取AI分析失败:', error);
    res.status(500).json({ error: '获取AI分析失败' });
  }
});

module.exports = router;

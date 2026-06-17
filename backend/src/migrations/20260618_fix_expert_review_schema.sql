-- Fix old local database schema for expert review flow.

ALTER TABLE data_submissions
  MODIFY COLUMN review_status ENUM(
    'draft',
    'submitted',
    'teacher_reviewing',
    'teacher_approved',
    'teacher_rejected',
    'expert_reviewing',
    'expert_approved',
    'expert_rejected',
    'final_approved',
    'final_rejected'
  ) NOT NULL DEFAULT 'draft';

ALTER TABLE review_records
  MODIFY COLUMN status ENUM(
    'pending',
    'approved',
    'rejected',
    'revision_required'
  ) NOT NULL DEFAULT 'pending';

ALTER TABLE review_records
  MODIFY COLUMN reviewer_id BIGINT UNSIGNED DEFAULT NULL COMMENT '审核人ID；NULL表示未分配到具体审核人的专家/管理员审核池';

ALTER TABLE review_records
  ADD COLUMN IF NOT EXISTS ai_assisted TINYINT(1) DEFAULT 0 COMMENT '是否使用AI辅助';

ALTER TABLE review_records
  ADD COLUMN IF NOT EXISTS ai_analysis TEXT COMMENT 'AI分析结果';

ALTER TABLE review_records
  ADD COLUMN IF NOT EXISTS issues_found JSON DEFAULT NULL COMMENT '发现的问题';

ALTER TABLE review_records
  ADD COLUMN IF NOT EXISTS suggestions TEXT COMMENT '改进建议';

ALTER TABLE review_records
  ADD COLUMN IF NOT EXISTS completed_at DATETIME DEFAULT NULL COMMENT '完成时间';

ALTER TABLE data_submissions
  ADD COLUMN IF NOT EXISTS review_progress INT DEFAULT 0 COMMENT '审核进度百分比';

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
  MODIFY COLUMN reviewer_id BIGINT UNSIGNED DEFAULT NULL;

ALTER TABLE review_records
  ADD COLUMN ai_assisted TINYINT(1) DEFAULT 0;

ALTER TABLE review_records
  ADD COLUMN ai_analysis TEXT;

ALTER TABLE review_records
  ADD COLUMN issues_found JSON DEFAULT NULL;

ALTER TABLE review_records
  ADD COLUMN suggestions TEXT;

ALTER TABLE review_records
  ADD COLUMN completed_at DATETIME DEFAULT NULL;

ALTER TABLE data_submissions
  ADD COLUMN review_progress INT DEFAULT 0;
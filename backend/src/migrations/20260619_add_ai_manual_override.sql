ALTER TABLE data_submissions
  ADD COLUMN ai_manual_override_status ENUM('none', 'requested', 'approved', 'rejected') NOT NULL DEFAULT 'none' COMMENT 'AI技术失败人工放行状态' AFTER ai_anomaly_detected;

ALTER TABLE data_submissions
  ADD COLUMN ai_manual_override_reason TEXT DEFAULT NULL COMMENT 'AI人工放行申请/审批说明' AFTER ai_manual_override_status;

ALTER TABLE data_submissions
  ADD COLUMN ai_manual_override_by BIGINT UNSIGNED DEFAULT NULL COMMENT 'AI人工放行审批管理员ID' AFTER ai_manual_override_reason;

ALTER TABLE data_submissions
  ADD COLUMN ai_manual_override_at DATETIME DEFAULT NULL COMMENT 'AI人工放行更新时间' AFTER ai_manual_override_by;

ALTER TABLE data_submissions
  ADD INDEX idx_ai_manual_override (ai_manual_override_status);

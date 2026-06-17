CREATE TABLE IF NOT EXISTS ai_review_config (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用外部大模型语义审计',
  provider VARCHAR(50) NOT NULL DEFAULT 'openai_compatible' COMMENT '服务商类型',
  base_url VARCHAR(500) NOT NULL DEFAULT '' COMMENT 'OpenAI Compatible API Base URL，例如 https://api.example.com/v1',
  model VARCHAR(120) NOT NULL DEFAULT '' COMMENT '模型名称',
  api_key_cipher TEXT DEFAULT NULL COMMENT '加密后的 API Key',
  temperature DECIMAL(3,2) NOT NULL DEFAULT 0.30 COMMENT '采样温度',
  max_tokens INT NOT NULL DEFAULT 500 COMMENT '最大输出 token',
  timeout_ms INT NOT NULL DEFAULT 30000 COMMENT '请求超时时间，毫秒',
  last_test_status ENUM('untested', 'success', 'failed') NOT NULL DEFAULT 'untested',
  last_test_message VARCHAR(500) DEFAULT NULL,
  last_test_at DATETIME DEFAULT NULL,
  updated_by BIGINT UNSIGNED DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_updated_by (updated_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI审查外部大模型配置表';

INSERT IGNORE INTO ai_review_config (
  id,
  enabled,
  provider,
  base_url,
  model,
  temperature,
  max_tokens,
  timeout_ms
) VALUES (
  1,
  0,
  'openai_compatible',
  '',
  '',
  0.30,
  500,
  30000
);

-- 鉴真数据系统 - 数据库初始化脚本

CREATE DATABASE IF NOT EXISTS veri_data CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE veri_data;

-- 用户表
CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
  password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希',
  email VARCHAR(100) NOT NULL UNIQUE COMMENT '邮箱',
  phone VARCHAR(20) DEFAULT NULL COMMENT '手机号',
  real_name VARCHAR(50) DEFAULT NULL COMMENT '真实姓名',
  avatar_url VARCHAR(255) DEFAULT NULL COMMENT '头像URL',
  role ENUM('student', 'teacher', 'expert', 'admin', 'civilian') NOT NULL DEFAULT 'civilian',
  status ENUM('active', 'inactive', 'suspended', 'pending_verification') NOT NULL DEFAULT 'pending_verification',
  role_info JSON DEFAULT NULL COMMENT '角色专属信息',
  email_verified TINYINT(1) DEFAULT 0,
  phone_verified TINYINT(1) DEFAULT 0,
  id_verified TINYINT(1) DEFAULT 0,
  id_card_number VARCHAR(18) DEFAULT NULL,
  id_card_front VARCHAR(255) DEFAULT NULL,
  id_card_back VARCHAR(255) DEFAULT NULL,
  last_login_at DATETIME DEFAULT NULL,
  last_login_ip VARCHAR(45) DEFAULT NULL,
  login_fail_count INT DEFAULT 0,
  locked_until DATETIME DEFAULT NULL,
  quota_total INT DEFAULT 10,
  quota_used INT DEFAULT 0,
  quota_reset_date DATE DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL,
  INDEX idx_role (role),
  INDEX idx_status (status),
  INDEX idx_email (email),
  INDEX idx_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- 导师-学生关系表
CREATE TABLE teacher_student_relations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  teacher_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
   status ENUM('active', 'inactive', 'pending', 'pending_confirm') DEFAULT 'pending_confirm',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_relation (teacher_id, student_id),
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 专家领域表
CREATE TABLE expert_fields (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  expert_id BIGINT UNSIGNED NOT NULL,
  field_name VARCHAR(100) NOT NULL,
  proficiency ENUM('beginner', 'intermediate', 'advanced', 'expert') DEFAULT 'intermediate',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (expert_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 数据提交表
CREATE TABLE data_submissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  submitter_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL COMMENT '数据标题',
  description TEXT COMMENT '数据描述',
  data_type ENUM('raw', 'processed', 'analysis', 'summary') NOT NULL DEFAULT 'raw',
  data_format ENUM('csv', 'excel', 'json', 'txt', 'pdf', 'image', 'other') NOT NULL,
  file_path VARCHAR(500) NOT NULL COMMENT '文件存储路径',
  file_size BIGINT UNSIGNED DEFAULT 0 COMMENT '文件大小（字节）',
  file_hash VARCHAR(64) NOT NULL COMMENT '文件哈希值（SHA256）',
  original_filename VARCHAR(255) NOT NULL,
  
  -- 权限设置
  visibility ENUM('private', 'public', 'limited') NOT NULL DEFAULT 'private',
  view_permission JSON DEFAULT NULL COMMENT '可查看用户ID列表',
  
  -- 审核状态
  review_status ENUM('draft', 'submitted', 'teacher_reviewing', 'teacher_approved', 'teacher_rejected', 'expert_reviewing', 'expert_approved', 'expert_rejected', 'final_approved', 'final_rejected') NOT NULL DEFAULT 'draft',
  review_progress INT DEFAULT 0 COMMENT '审核进度百分比',
  
  -- AI检测结果
  ai_check_status ENUM('pending', 'running', 'completed', 'failed') DEFAULT 'pending',
  ai_check_result JSON DEFAULT NULL,
  ai_check_score DECIMAL(5,2) DEFAULT NULL COMMENT 'AI可信度评分',
  ai_anomaly_detected TINYINT(1) DEFAULT 0,
  
  -- 责任声明
  liability_statement TEXT COMMENT '责任声明内容',
  is_liability_accepted TINYINT(1) DEFAULT 0,
  
  -- 版本控制
  version INT DEFAULT 1,
  parent_id BIGINT UNSIGNED DEFAULT NULL COMMENT '父版本ID',
  
  -- 引用计数
  citation_count INT DEFAULT 0,
  download_count INT DEFAULT 0,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  submitted_at DATETIME DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  deleted_at DATETIME DEFAULT NULL,
  
  INDEX idx_submitter (submitter_id),
  INDEX idx_status (review_status),
  INDEX idx_visibility (visibility),
  INDEX idx_data_type (data_type),
  FOREIGN KEY (submitter_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES data_submissions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数据提交表';

-- 审核记录表
CREATE TABLE review_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  data_id BIGINT UNSIGNED NOT NULL,
  reviewer_id BIGINT UNSIGNED NOT NULL,
  review_type ENUM('teacher', 'expert', 'admin') NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'revision_required') NOT NULL DEFAULT 'pending',
  
  -- 评分维度
  completeness_score INT DEFAULT NULL COMMENT '完整性评分',
  accuracy_score INT DEFAULT NULL COMMENT '准确性评分',
  originality_score INT DEFAULT NULL COMMENT '原创性评分',
  methodology_score INT DEFAULT NULL COMMENT '方法论评分',
  overall_score INT DEFAULT NULL COMMENT '综合评分',
  
  -- 盲审设置
  is_blind_review TINYINT(1) DEFAULT 0 COMMENT '是否盲审',
  blinded_info JSON DEFAULT NULL COMMENT '脱敏信息',
  
  -- 审核意见
  comments TEXT COMMENT '审核意见',
  issues_found JSON DEFAULT NULL COMMENT '发现的问题',
  suggestions TEXT COMMENT '改进建议',
  
  -- AI辅助分析
  ai_assisted TINYINT(1) DEFAULT 0,
  ai_analysis TEXT COMMENT 'AI分析结果',
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME DEFAULT NULL,
  
  INDEX idx_data_id (data_id),
  INDEX idx_reviewer (reviewer_id),
  INDEX idx_review_type (review_type),
  FOREIGN KEY (data_id) REFERENCES data_submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审核记录表';

-- 数据版本历史表
CREATE TABLE data_version_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  data_id BIGINT UNSIGNED NOT NULL,
  version INT NOT NULL,
  change_description TEXT COMMENT '变更描述',
  changed_fields JSON COMMENT '变更字段',
  previous_file_path VARCHAR(500),
  changed_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (data_id) REFERENCES data_submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 访问日志表
CREATE TABLE access_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED DEFAULT NULL,
  target_type ENUM('data', 'user', 'system') NOT NULL,
  target_id BIGINT UNSIGNED DEFAULT NULL,
  action ENUM('view', 'download', 'create', 'update', 'delete', 'review', 'login', 'logout') NOT NULL,
  ip_address VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(500) DEFAULT NULL,
  request_data JSON DEFAULT NULL,
  response_status INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_target (target_type, target_id),
  INDEX idx_action (action),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='访问日志表';

-- 通知消息表
CREATE TABLE notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  type ENUM('system', 'review', 'data', 'security', 'quota') NOT NULL DEFAULT 'system',
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  is_read TINYINT(1) DEFAULT 0,
  related_type VARCHAR(50) DEFAULT NULL,
  related_id BIGINT UNSIGNED DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME DEFAULT NULL,
  INDEX idx_user (user_id),
  INDEX idx_read (is_read),
  INDEX idx_created (created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 配额使用记录表
CREATE TABLE quota_usage_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  action_type VARCHAR(50) NOT NULL COMMENT '操作类型',
  quota_consumed INT DEFAULT 1 COMMENT '消耗的配额',
  data_id BIGINT UNSIGNED DEFAULT NULL,
  description VARCHAR(255) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_created (created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 迁移脚本：为 teacher_student_relations.status ENUM 添加 pending_confirm 值
-- 对应后端导师添加学生时的初始状态变更
ALTER TABLE teacher_student_relations
  MODIFY COLUMN status ENUM('active', 'inactive', 'pending', 'pending_confirm') NOT NULL DEFAULT 'pending_confirm';

-- Migration 001: Fix teacher_student_relations.status ENUM to include 'pending_confirm'
-- The original schema may have been created with only ('active','inactive','pending'),
-- but the application code uses 'pending_confirm' for new teacher-student binding requests.

ALTER TABLE teacher_student_relations MODIFY COLUMN status ENUM('active','inactive','pending','pending_confirm') DEFAULT 'pending_confirm';

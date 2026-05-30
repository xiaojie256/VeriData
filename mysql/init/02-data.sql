-- 初始数据
USE veri_data;

-- 创建管理员账号 (密码: admin123)
INSERT INTO users (username, password_hash, email, real_name, role, status, email_verified, id_verified, quota_total) VALUES
('admin', '$2b$10$ClJwUfEgquqS4AcdSzeX2.U255yQ4oCAswx2tzJNkzBRc/O8eS5IK', 'admin@veridata.edu.cn', '系统管理员', 'admin', 'active', 1, 1, 9999);

-- 创建默认配置
-- 系统配置可以存储在另一个表中，这里仅作为占位

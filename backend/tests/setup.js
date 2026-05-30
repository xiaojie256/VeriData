const pool = require('../src/utils/database');

// 测试前清理数据库
beforeAll(async () => {
  // 清理测试数据
  await pool.execute('DELETE FROM quota_usage_logs WHERE 1');
  await pool.execute('DELETE FROM notifications WHERE 1');
  await pool.execute('DELETE FROM review_records WHERE 1');
  await pool.execute('DELETE FROM data_submissions WHERE 1');
  await pool.execute('DELETE FROM teacher_student_relations WHERE 1');
  await pool.execute('DELETE FROM users WHERE id > 1');
});

// 测试后清理
afterAll(async () => {
  await pool.end();
});

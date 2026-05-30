const bcrypt = require('bcryptjs');

const password = 'admin123';
const saltRounds = 10;

bcrypt.hash(password, saltRounds, (err, hash) => {
  if (err) {
    console.error('生成失败:', err);
    process.exit(1);
  }
  console.log('密码明文: admin123');
  console.log('Bcrypt哈希:');
  console.log(hash);
});

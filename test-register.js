const pool = require('./backend/src/utils/database');
const bcrypt = require('bcrypt');

async function testRegister() {
  const username = 'testuser' + Date.now();
  const email = 'test' + Date.now() + '@test.com';
  const password = 'testpass123';
  const real_name = '测试用户';
  const role = 'student';
  const phone = null;
  
  try {
    console.log('1. Checking if user exists...');
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );
    console.log('   Existing users:', existingUsers.length);
    
    if (existingUsers.length > 0) {
      console.log('   User already exists!');
      return;
    }
    
    console.log('2. Hashing password...');
    const passwordHash = await bcrypt.hash(password, 10);
    console.log('   Hash generated:', passwordHash.substring(0, 30) + '...');
    
    console.log('3. Inserting user...');
    const status = role === 'civilian' ? 'active' : 'pending_verification';
    const quota = role === 'civilian' ? 5 : 10;
    
    const [result] = await pool.execute(
      `INSERT INTO users (username, email, password_hash, real_name, role, phone, status, quota_total) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, email, passwordHash, real_name, role, phone, status, quota]
    );
    
    console.log('4. Success! User ID:', result.insertId);
  } catch (error) {
    console.error('ERROR:', error.message);
    console.error('SQL State:', error.sqlState);
    console.error('Code:', error.code);
    if (error.sqlMessage) {
      console.error('SQL Message:', error.sqlMessage);
    }
  } finally {
    process.exit(0);
  }
}

testRegister();

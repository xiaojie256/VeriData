const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'veri_data',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000, // 每10秒发送一次TCP心跳包，阻止Docker或MySQL强制断连
  
  // 🟢 增加限制闲置生命周期，在MySQL超时前（通常很长），连接池主动回收
  maxIdle: 10, // 最大闲置连接数
  idleTimeout: 60000, // 闲置连接超过60秒自动释放重连
});

// 测试连接
pool.getConnection()
  .then(conn => {
    console.log('MySQL数据库连接成功');
    conn.release();
  })
  .catch(err => {
    console.error('MySQL数据库连接失败:', err.message);
  });

module.exports = pool;

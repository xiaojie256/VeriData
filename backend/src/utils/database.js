const mysql = require('mysql2/promise');

const normalizeDbTimezone = (value) => {
  const timezone = String(value || '').trim();

  if (/^[+-](0\d|1[0-4]):[0-5]\d$/.test(timezone)) {
    return timezone;
  }

  return '+08:00';
};

const dbTimezone = normalizeDbTimezone(process.env.DB_TIMEZONE || '+08:00');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'veri_data',

  timezone: dbTimezone,
  dateStrings: true,

  charset: 'utf8mb4',

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

if (pool.pool && typeof pool.pool.on === 'function') {
  pool.pool.on('connection', (connection) => {
    connection.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
    connection.query("SET time_zone = '" + dbTimezone + "'");
  });
}

pool.getConnection()
  .then(async (conn) => {
    try {
      await conn.query("SET time_zone = '" + dbTimezone + "'");
      console.log('MySQL database connected, session timezone=' + dbTimezone);
    } finally {
      conn.release();
    }
  })
  .catch(err => {
    console.error('MySQL connection failed:', err.message);
  });

module.exports = pool;

const redis = require('redis');

const client = redis.createClient({
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`
});

client.on('error', (err) => {
  console.error('Redis错误:', err);
});

client.on('connect', () => {
  console.log('Redis连接成功');
});

(async () => {
  try {
    await client.connect();
  } catch (err) {
    console.error('Redis连接失败:', err.message);
  }
})();

module.exports = client;

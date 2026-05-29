const pool = require('../utils/database');
const logger = require('../utils/logger');

// 记录访问日志
const auditLog = (targetType, action) => {
  return async (req, res, next) => {
    // 保存原始的end方法
    const originalEnd = res.end;
    
    // 重写end方法以捕获响应状态
    res.end = function(chunk, encoding) {
      res.end = originalEnd;
      res.end(chunk, encoding);
      
      // 异步记录日志
      const logData = {
        user_id: req.user?.id || null,
        target_type: targetType,
        target_id: req.params?.id || req.body?.id || null,
        action: action,
        ip_address: req.ip || req.connection.remoteAddress,
        user_agent: req.headers['user-agent'],
        request_data: JSON.stringify({
          params: req.params,
          query: req.query,
          body: req.body ? { ...req.body, password: undefined } : undefined
        }),
        response_status: res.statusCode
      };
      
      pool.execute(
        `INSERT INTO access_logs (user_id, target_type, target_id, action, ip_address, user_agent, request_data, response_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [logData.user_id, logData.target_type, logData.target_id, logData.action, 
         logData.ip_address, logData.user_agent, logData.request_data, logData.response_status]
      ).catch(err => {
        logger.error('记录访问日志失败:', err);
      });
    };
    
    next();
  };
};

module.exports = { auditLog };

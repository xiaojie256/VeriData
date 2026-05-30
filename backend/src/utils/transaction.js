const pool = require('./database');
const logger = require('./logger');

/**
 * 执行数据库事务
 * @param {Function} callback - 事务回调函数，接收connection参数
 * @returns {Promise<any>} 回调函数的返回值
 * @throws {Error} 事务执行错误
 * 
 * 使用示例：
 * const result = await withTransaction(async (connection) => {
 *   await connection.execute('INSERT INTO users...', [params]);
 *   await connection.execute('INSERT INTO logs...', [params]);
 *   return { success: true };
 * });
 */
async function withTransaction(callback) {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const result = await callback(connection);
    
    await connection.commit();
    logger.debug('事务提交成功');
    
    return result;
  } catch (error) {
    await connection.rollback();
    logger.error('事务回滚:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 批量执行事务
 * @param {Array<{sql: string, params: Array}>} operations - SQL操作数组
 * @returns {Promise<Array>} 执行结果数组
 */
async function executeBatch(operations) {
  return withTransaction(async (connection) => {
    const results = [];
    
    for (const op of operations) {
      const [result] = await connection.execute(op.sql, op.params);
      results.push(result);
    }
    
    return results;
  });
}

module.exports = {
  withTransaction,
  executeBatch
};

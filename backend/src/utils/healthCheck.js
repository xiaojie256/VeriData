const pool = require('./database');
const redis = require('./redis');
const logger = require('./logger');
const axios = require('axios');

/**
 * 健康检查工具
 * 检查所有依赖服务的健康状态
 */

const HEALTH_CHECK_TIMEOUT = 5000; // 5秒超时

/**
 * 检查MySQL连接
 */
async function checkMySQL() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return { status: 'up', responseTime: 'ok' };
  } catch (error) {
    logger.error('MySQL健康检查失败:', error);
    return { status: 'down', error: error.message };
  }
}

/**
 * 检查Redis连接
 */
async function checkRedis() {
  try {
    // 使用 Redis v4 Promise API ping 命令
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis连接超时')), HEALTH_CHECK_TIMEOUT))
    ]);
    return { status: 'up', responseTime: 'ok' };
  } catch (error) {
    logger.error('Redis健康检查失败:', error);
    return { status: 'down', error: error.message };
  }
}

/**
 * 检查AI服务
 */
async function checkAIService() {
  try {
    const aiUrl = process.env.AI_SERVICE_URL || 'http://localhost:5000';
    const response = await axios.get(`${aiUrl}/health`, {
      timeout: HEALTH_CHECK_TIMEOUT
    });
    
    if (response.status === 200) {
      return { status: 'up', responseTime: 'ok' };
    }
    
    return { status: 'degraded', error: '非预期响应' };
  } catch (error) {
    logger.error('AI服务健康检查失败:', error);
    return { status: 'down', error: error.message };
  }
}

/**
 * 检查磁盘空间
 */
async function checkDiskSpace() {
  try {
    const fs = require('fs');
    const path = require('path');
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    
    // 确保目录存在
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    
    const stats = fs.statfsSync(uploadPath);
    const totalSpace = stats.blocks * stats.blksize;
    const freeSpace = stats.bavail * stats.blksize;
    const usedSpace = totalSpace - freeSpace;
    const usedPercent = (usedSpace / totalSpace * 100).toFixed(2);
    
    const status = usedPercent > 90 ? 'critical' : usedPercent > 75 ? 'warning' : 'ok';
    
    return {
      status,
      usedPercent: `${usedPercent}%`,
      freeSpace: formatBytes(freeSpace)
    };
  } catch (error) {
    logger.error('磁盘空间检查失败:', error);
    return { status: 'unknown', error: error.message };
  }
}

/**
 * 格式化字节
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 执行完整健康检查
 */
async function performHealthCheck() {
  const checks = await Promise.all([
    checkMySQL().then(result => ({ service: 'mysql', ...result })),
    checkRedis().then(result => ({ service: 'redis', ...result })),
    checkAIService().then(result => ({ service: 'ai-service', ...result })),
    checkDiskSpace().then(result => ({ service: 'disk', ...result }))
  ]);
  
  const allUp = checks.every(check => check.status === 'up');
  const anyCritical = checks.some(check => check.status === 'critical');
  
  const overallStatus = anyCritical ? 'critical' : allUp ? 'healthy' : 'degraded';
  
  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    checks: checks.reduce((acc, check) => {
      acc[check.service] = {
        status: check.status,
        ...(check.responseTime && { responseTime: check.responseTime }),
        ...(check.error && { error: check.error }),
        ...(check.usedPercent && { usedPercent: check.usedPercent }),
        ...(check.freeSpace && { freeSpace: check.freeSpace })
      };
      return acc;
    }, {})
  };
}

/**
 * 就绪检查 - 检查服务是否准备好接受请求
 */
async function performReadinessCheck() {
  // 就绪检查只需要核心依赖
  const mysql = await checkMySQL();
  
  const ready = mysql.status === 'up';
  
  return {
    ready,
    timestamp: new Date().toISOString(),
    checks: {
      mysql: mysql.status
    }
  };
}

/**
 * 存活检查 - 轻量级检查
 */
function performLivenessCheck() {
  return {
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  };
}

module.exports = {
  performHealthCheck,
  performReadinessCheck,
  performLivenessCheck,
  checkMySQL,
  checkRedis,
  checkAIService
};

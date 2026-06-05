const express = require('express');
const axios = require('axios');
const fs = require('fs');
const pool = require('../utils/database');
const logger = require('../utils/logger');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:5000';

// 触发AI检测
router.post('/analyze/:dataId', authenticate, async (req, res) => {
  try {
    const dataId = req.params.dataId;

    // 验证数据所有权
    const [dataList] = await pool.execute(
      'SELECT id, file_path, file_hash, ai_check_status, submitter_id FROM data_submissions WHERE id = ? AND deleted_at IS NULL',
      [dataId]
    );

    if (dataList.length === 0) {
      return res.status(404).json({ error: '数据不存在' });
    }

    const data = dataList[0];

    // 检查权限
    if (data.submitter_id !== req.user.id && !['admin', 'teacher', 'expert'].includes(req.user.role)) {
      return res.status(403).json({ error: '无权分析此数据' });
    }

    // 检查是否正在分析中
    if (data.ai_check_status === 'running') {
      return res.status(400).json({ error: 'AI检测正在进行中' });
    }

    // 强制内核将写缓存同步到物理磁盘，规避 Docker 挂载下的异步 I/O 延迟死锁
    try {
      const fd = fs.openSync(data.file_path, 'r+');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch (ioErr) {
      logger.error(`磁盘同步失败: ${ioErr.message}`);
    }

    // 更新状态为分析中
    await pool.execute(
      'UPDATE data_submissions SET ai_check_status = ? WHERE id = ?',
      ['running', dataId]
    );

    // 异步调用AI服务
    axios.post(`${AI_SERVICE_URL}/analyze`, {
      data_id: dataId,
      file_path: data.file_path,
      file_hash: data.file_hash
    }).then(async (response) => {
      const result = response.data;
      
      await pool.execute(
        `UPDATE data_submissions 
         SET ai_check_status = 'completed', 
             ai_check_result = ?, 
             ai_check_score = ?, 
             ai_anomaly_detected = ?
         WHERE id = ?`,
        [
          JSON.stringify(result.details),
          result.score,
          result.has_anomaly ? 1 : 0,
          dataId
        ]
      );
      
      logger.info(`AI检测完成: data_id=${dataId}, score=${result.score}`);
    }).catch(async (error) => {
      await pool.execute(
        'UPDATE data_submissions SET ai_check_status = ? WHERE id = ?',
        ['failed', dataId]
      );
      logger.error(`AI检测失败: data_id=${dataId}, error=${error.message}`);
    });

    res.json({ message: 'AI检测已启动' });
  } catch (error) {
    logger.error('启动AI检测失败:', error);
    res.status(500).json({ error: '启动AI检测失败' });
  }
});

// 获取AI检测结果
router.get('/result/:dataId', authenticate, async (req, res) => {
  try {
    const dataId = req.params.dataId;

    const [dataList] = await pool.execute(
      'SELECT ai_check_status, ai_check_result, ai_check_score, ai_anomaly_detected FROM data_submissions WHERE id = ?',
      [dataId]
    );

    if (dataList.length === 0) {
      return res.status(404).json({ error: '数据不存在' });
    }

    const data = dataList[0];

    res.json({
      status: data.ai_check_status,
      score: data.ai_check_score,
      has_anomaly: data.ai_anomaly_detected === 1,
      details: data.ai_check_result ? JSON.parse(data.ai_check_result) : null
    });
  } catch (error) {
    logger.error('获取AI结果失败:', error);
    res.status(500).json({ error: '获取AI结果失败' });
  }
});

// 数据质量预测
router.post('/predict-quality', authenticate, authorize('teacher', 'expert', 'admin'), async (req, res) => {
  try {
    const { data_preview } = req.body;

    const response = await axios.post(`${AI_SERVICE_URL}/predict`, {
      data_preview
    });

    res.json(response.data);
  } catch (error) {
    logger.error('质量预测失败:', error);
    res.status(500).json({ error: '质量预测失败' });
  }
});

// 异常检测接口（无需认证，用于公开数据检测）
router.post('/public-check', async (req, res) => {
  try {
    const { data_content } = req.body;

    if (!data_content) {
      return res.status(400).json({ error: '请提供数据内容' });
    }

    const response = await axios.post(`${AI_SERVICE_URL}/quick-check`, {
      data_content,
      is_public: true
    });

    res.json({
      ...response.data,
      disclaimer: '本检测结果仅供参考，不构成最终审核意见'
    });
  } catch (error) {
    logger.error('公开检测失败:', error);
    res.status(500).json({ error: '检测服务暂时不可用' });
  }
});

module.exports = router;

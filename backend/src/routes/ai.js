const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const pool = require('../utils/database');
const logger = require('../utils/logger');
const { authenticate, authorize } = require('../middleware/auth');
const { getAiConfig, getRuntimeAiReviewConfig } = require('../utils/aiConfig');

const router = express.Router();
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:5000';

const AI_SUPPORTED_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls', '.json', '.txt'])

const buildAiResult = (payload) => {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    ...payload
  })
}

const markAiFailed = async (dataId, reason, extra = {}) => {
  await pool.execute(
    `UPDATE data_submissions
     SET ai_check_status = 'failed',
         ai_check_result = ?,
         ai_check_score = NULL,
         ai_anomaly_detected = 0
     WHERE id = ?`,
    [
      buildAiResult({
        error: reason,
        ...extra
      }),
      dataId
    ]
  )
}

const markAiSkipped = async (dataId, reason, extra = {}) => {
  await pool.execute(
    `UPDATE data_submissions
     SET ai_check_status = 'completed',
         ai_check_result = ?,
         ai_check_score = NULL,
         ai_anomaly_detected = 0
     WHERE id = ?`,
    [
      buildAiResult({
        skipped: true,
        reason,
        ...extra
      }),
      dataId
    ]
  )
}

const normalizeAiResponse = (result) => {
  return buildAiResult({
    summary: result.summary || '',
    risk_level: result.risk_level || 'unknown',
    details: result.details || {},
    suggestions: result.suggestions || []
  })
}

const runAiAnalysis = async (dataId, data, llmConfig) => {
  try {
    const timeoutMs = Math.max(
      60000,
      Number(llmConfig?.timeout_ms || 30000) + 10000
    )

    const response = await axios.post(
      `${AI_SERVICE_URL}/analyze`,
      {
        data_id: dataId,
        file_path: data.file_path,
        file_hash: data.file_hash,
        llm_config: llmConfig
      },
      {
        timeout: timeoutMs
      }
    )

    const result = response.data || {}

    await pool.execute(
      `UPDATE data_submissions
       SET ai_check_status = 'completed',
           ai_check_score = ?,
           ai_check_result = ?,
           ai_anomaly_detected = ?
       WHERE id = ?`,
      [
        result.score ?? null,
        normalizeAiResponse(result),
        result.anomaly_detected || result.has_anomaly ? 1 : 0,
        dataId
      ]
    )

    logger.info('AI检测完成', {
      dataId,
      score: result.score,
      anomaly_detected: result.anomaly_detected || result.has_anomaly
    })
  } catch (error) {
    const reason =
      error.response?.data?.error ||
      error.message ||
      'AI服务调用失败'

    logger.error('AI检测执行失败:', {
      dataId,
      reason,
      status: error.response?.status
    })

    await markAiFailed(dataId, reason, {
      status: error.response?.status || null
    })
  }
}

// 触发AI检测
router.post('/analyze/:dataId', authenticate, async (req, res) => {
  const dataId = Number(req.params.dataId)

  if (!Number.isSafeInteger(dataId) || dataId <= 0) {
    return res.status(400).json({
      error: '无效的数据ID'
    })
  }

  try {
    const [dataList] = await pool.execute(
      `SELECT id, submitter_id, title, file_path, file_hash, data_format, ai_check_status
       FROM data_submissions
       WHERE id = ? AND deleted_at IS NULL`,
      [dataId]
    )

    if (dataList.length === 0) {
      return res.status(404).json({
        error: '数据不存在'
      })
    }

    const data = dataList[0]

    const canAnalyze =
      Number(data.submitter_id) === Number(req.user.id) ||
      ['admin', 'teacher', 'expert'].includes(req.user.role)

    if (!canAnalyze) {
      return res.status(403).json({
        error: '权限不足'
      })
    }

    if (data.ai_check_status === 'running') {
      return res.status(409).json({
        error: 'AI检测正在进行中，请稍后查看结果'
      })
    }

    if (!data.file_path || !fs.existsSync(data.file_path)) {
      await markAiFailed(dataId, '文件不存在或存储路径不可访问', {
        file_path: data.file_path || null
      })

      return res.status(409).json({
        error: '文件不存在或存储路径不可访问，无法启动AI检测'
      })
    }

    const ext = path.extname(data.file_path).toLowerCase()

    if (!AI_SUPPORTED_EXTENSIONS.has(ext)) {
      await markAiSkipped(dataId, `当前文件类型 ${ext || 'unknown'} 暂不支持自动AI检测`, {
        supported_extensions: Array.from(AI_SUPPORTED_EXTENSIONS)
      })

      return res.status(200).json({
        message: '当前文件类型暂不支持自动AI检测，已跳过',
        status: 'completed',
        skipped: true,
        supported_extensions: Array.from(AI_SUPPORTED_EXTENSIONS)
      })
    }

    try {
      const fd = fs.openSync(data.file_path, 'r')
      fs.closeSync(fd)
    } catch (fileError) {
      await markAiFailed(dataId, '文件无法读取', {
        file_path: data.file_path,
        detail: fileError.message
      })

      return res.status(409).json({
        error: '文件无法读取，无法启动AI检测'
      })
    }

    await pool.execute(
      `UPDATE data_submissions
       SET ai_check_status = 'running',
           ai_check_result = NULL
       WHERE id = ?`,
      [dataId]
    )

    let llmConfig = {
      enabled: false,
      disabled_reason: '管理员未启用大模型语义审计'
    }

    try {
      llmConfig = await getRuntimeAiReviewConfig()
    } catch (configError) {
      logger.warn('读取AI审查配置失败，将仅使用本地基础检测:', {
        message: configError.message
      })

      llmConfig = {
        enabled: false,
        disabled_reason: 'AI审查配置读取失败，仅执行本地基础检测'
      }
    }

    res.status(202).json({
      message: 'AI检测已进入队列',
      status: 'running'
    })

    setImmediate(() => {
      runAiAnalysis(dataId, data, llmConfig)
    })
  } catch (error) {
    logger.error('启动AI检测失败:', {
      dataId,
      message: error.message,
      stack: error.stack
    })

    res.status(500).json({
      error: '启动AI检测失败，请查看后端日志'
    })
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

    if (!data_content || typeof data_content !== 'string') {
      return res.status(400).json({ error: '请提供有效的数据内容' });
    }

    // 限制请求体大小，防止 DoS 攻击（最大 1MB 文本）
    if (data_content.length > 1024 * 1024) {
      return res.status(413).json({ error: '数据内容过大，最大支持 1MB' });
    }

    const response = await axios.post(
      `${AI_SERVICE_URL}/quick-check`,
      {
        data_content,
        is_public: true
      },
      {
        timeout: 30000
      }
    );

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

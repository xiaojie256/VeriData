const express = require("express");
const axios = require("axios");
const logger = require("../utils/logger");
const { authenticate, authorize } = require("../middleware/auth");
const {
  getAiConfig,
  saveAiConfig,
  updateAiTestResult,
  normalizeBaseUrl,
} = require("../utils/aiConfig");

const router = express.Router();

const buildTestConfig = async (body) => {
  const saved = await getAiConfig({ includeSecret: true });

  const apiKey =
    typeof body.api_key === "string" && body.api_key.trim()
      ? body.api_key.trim()
      : saved.api_key;

  const baseUrl =
    body.base_url !== undefined
      ? normalizeBaseUrl(body.base_url)
      : saved.base_url;

  return {
    enabled: body.enabled !== undefined ? body.enabled : saved.enabled,
    provider: body.provider || saved.provider,
    base_url: baseUrl,
    model: body.model || saved.model,
    api_key: apiKey,
    temperature: Number(body.temperature ?? saved.temperature ?? 0),
    max_tokens: Number(body.max_tokens ?? saved.max_tokens ?? 20),
    timeout_ms: Number(body.timeout_ms ?? saved.timeout_ms ?? 30000),
  };
};

router.get("/config", authenticate, authorize("admin"), async (req, res) => {
  try {
    const config = await getAiConfig({ includeSecret: false });
    res.json({ config });
  } catch (error) {
    logger.error("获取AI审查配置失败:", error);
    res.status(500).json({ error: "获取AI审查配置失败" });
  }
});

router.put("/config", authenticate, authorize("admin"), async (req, res) => {
  try {
    const config = await saveAiConfig(req.body || {}, req.user.id);

    logger.warn(
      `管理员更新AI审查配置: admin=${req.user.id}, provider=${config.provider}, model=${config.model}, enabled=${config.enabled}`,
    );

    res.json({
      message: "AI审查配置已保存",
      config,
    });
  } catch (error) {
    logger.error("保存AI审查配置失败:", error);
    res.status(400).json({ error: error.message || "保存AI审查配置失败" });
  }
});

router.post("/test", authenticate, authorize("admin"), async (req, res) => {
  const startedAt = Date.now();

  try {
    const config = await buildTestConfig(req.body || {});

    if (!config.base_url) {
      return res.status(400).json({ error: "请先填写 API Base URL" });
    }

    if (!config.model) {
      return res.status(400).json({ error: "请先填写模型名称" });
    }

    if (!config.api_key) {
      return res.status(400).json({ error: "请先填写或保存 API Key" });
    }

    const endpoint = `${config.base_url.replace(/\/+$/, "")}/chat/completions`;

    const response = await axios.post(
      endpoint,
      {
        model: config.model,
        messages: [
          {
            role: "user",
            content: "请只回复 pong，用于连通性测试。",
          },
        ],
        temperature: 0,
        max_tokens: 20,
      },
      {
        timeout: config.timeout_ms || 30000,
        headers: {
          Authorization: `Bearer ${config.api_key}`,
          "Content-Type": "application/json",
        },
        validateStatus: () => true,
      },
    );

    const latencyMs = Date.now() - startedAt;

    if (response.status >= 200 && response.status < 300) {
      await updateAiTestResult({
        status: "success",
        message: `连通成功，状态码 ${response.status}，耗时 ${latencyMs}ms`,
      });

      return res.json({
        success: true,
        status_code: response.status,
        latency_ms: latencyMs,
        message: "连通性测试成功",
      });
    }

    const errorMessage =
      response.data?.error?.message ||
      response.data?.message ||
      `模型接口返回状态码 ${response.status}`;

    await updateAiTestResult({
      status: "failed",
      message: errorMessage,
    });

    return res.status(502).json({
      success: false,
      status_code: response.status,
      latency_ms: latencyMs,
      error: errorMessage,
    });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error.response?.data?.error?.message || error.message || "连通性测试失败";

    await updateAiTestResult({
      status: "failed",
      message,
    });

    logger.error("AI审查配置连通性测试失败:", {
      admin: req.user.id,
      message,
      latencyMs,
    });

    res.status(502).json({
      success: false,
      latency_ms: latencyMs,
      error: message,
    });
  }
});

module.exports = router;

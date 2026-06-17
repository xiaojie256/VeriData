const crypto = require("crypto");
const pool = require("./database");

const CONFIG_ID = 1;
const SECRET_PREFIX = "v1";

function getEncryptionKey() {
  const raw =
    process.env.SETTINGS_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    "veri-data-development-ai-config-secret";

  return crypto.createHash("sha256").update(String(raw)).digest();
}

function encryptSecret(value) {
  if (!value) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    SECRET_PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

function decryptSecret(cipherText) {
  if (!cipherText) return "";

  try {
    const parts = String(cipherText).split(":");
    if (parts.length !== 4 || parts[0] !== SECRET_PREFIX) {
      return "";
    }

    const [, ivText, tagText, encryptedText] = parts;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(ivText, "base64"),
    );

    decipher.setAuthTag(Buffer.from(tagText, "base64"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64")),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    return "";
  }
}

function normalizeBaseUrl(baseUrl) {
  if (baseUrl === undefined || baseUrl === null) {
    return "";
  }

  let value = String(baseUrl).trim();
  if (!value) {
    return "";
  }

  value = value.replace(/\/+$/, "");

  if (value.endsWith("/chat/completions")) {
    value = value.slice(0, -"/chat/completions".length).replace(/\/+$/, "");
  }

  if (!/^https?:\/\//i.test(value)) {
    throw new Error("API Base URL 必须以 http:// 或 https:// 开头");
  }

  return value;
}

function toBool(value) {
  return value === true || value === 1 || value === "1";
}

function toNumber(value, defaultValue, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return defaultValue;
  }

  if (min !== undefined && number < min) {
    return min;
  }

  if (max !== undefined && number > max) {
    return max;
  }

  return number;
}

function isMaskedSecret(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    trimmed === "******" ||
    trimmed === "********" ||
    trimmed.includes("已配置") ||
    trimmed.toLowerCase() === "__masked__"
  );
}

async function ensureConfigTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ai_review_config (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用外部大模型语义审计',
      provider VARCHAR(50) NOT NULL DEFAULT 'openai_compatible' COMMENT '服务商类型',
      base_url VARCHAR(500) NOT NULL DEFAULT '' COMMENT 'OpenAI Compatible API Base URL',
      model VARCHAR(120) NOT NULL DEFAULT '' COMMENT '模型名称',
      api_key_cipher TEXT DEFAULT NULL COMMENT '加密后的 API Key',
      temperature DECIMAL(3,2) NOT NULL DEFAULT 0.30 COMMENT '采样温度',
      max_tokens INT NOT NULL DEFAULT 500 COMMENT '最大输出 token',
      timeout_ms INT NOT NULL DEFAULT 30000 COMMENT '请求超时时间，毫秒',
      last_test_status ENUM('untested', 'success', 'failed') NOT NULL DEFAULT 'untested',
      last_test_message VARCHAR(500) DEFAULT NULL,
      last_test_at DATETIME DEFAULT NULL,
      updated_by BIGINT UNSIGNED DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_updated_by (updated_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI审查外部大模型配置表'
  `);

  await pool.execute(
    `
    INSERT IGNORE INTO ai_review_config
      (id, enabled, provider, base_url, model, temperature, max_tokens, timeout_ms)
    VALUES
      (?, 0, 'openai_compatible', '', '', 0.30, 500, 30000)
    `,
    [CONFIG_ID],
  );
}

async function getConfigRow() {
  await ensureConfigTable();

  const [rows] = await pool.execute(
    "SELECT * FROM ai_review_config WHERE id = ? LIMIT 1",
    [CONFIG_ID],
  );

  if (!rows.length) {
    await pool.execute(
      `
      INSERT INTO ai_review_config
        (id, enabled, provider, base_url, model, temperature, max_tokens, timeout_ms)
      VALUES
        (?, 0, 'openai_compatible', '', '', 0.30, 500, 30000)
      `,
      [CONFIG_ID],
    );

    const [createdRows] = await pool.execute(
      "SELECT * FROM ai_review_config WHERE id = ? LIMIT 1",
      [CONFIG_ID],
    );

    return createdRows[0];
  }

  return rows[0];
}

function formatConfig(row, options = {}) {
  const includeSecret = options.includeSecret === true;
  const apiKey = decryptSecret(row.api_key_cipher);

  return {
    enabled: toBool(row.enabled),
    provider: row.provider || "openai_compatible",
    base_url: row.base_url || "",
    model: row.model || "",
    api_key: includeSecret ? apiKey : "",
    api_key_configured: Boolean(apiKey),
    temperature: Number(row.temperature ?? 0.3),
    max_tokens: Number(row.max_tokens ?? 500),
    timeout_ms: Number(row.timeout_ms ?? 30000),
    last_test_status: row.last_test_status || "untested",
    last_test_message: row.last_test_message || "",
    last_test_at: row.last_test_at || null,
    updated_by: row.updated_by || null,
    updated_at: row.updated_at || null,
  };
}

async function getAiConfig(options = {}) {
  const row = await getConfigRow();
  return formatConfig(row, options);
}

async function saveAiConfig(input = {}, updatedBy = null) {
  await ensureConfigTable();

  const current = await getConfigRow();

  const provider = String(input.provider || current.provider || "openai_compatible").trim();
  const baseUrl =
    input.base_url !== undefined
      ? normalizeBaseUrl(input.base_url)
      : current.base_url || "";
  const model =
    input.model !== undefined
      ? String(input.model || "").trim()
      : current.model || "";

  const enabled =
    input.enabled !== undefined ? toBool(input.enabled) : toBool(current.enabled);

  const temperature = toNumber(
    input.temperature !== undefined ? input.temperature : current.temperature,
    0.3,
    0,
    2,
  );

  const maxTokens = Math.round(
    toNumber(
      input.max_tokens !== undefined ? input.max_tokens : current.max_tokens,
      500,
      1,
      200000,
    ),
  );

  const timeoutMs = Math.round(
    toNumber(
      input.timeout_ms !== undefined ? input.timeout_ms : current.timeout_ms,
      30000,
      1000,
      300000,
    ),
  );

  let apiKeyCipher = current.api_key_cipher || null;

  if (input.clear_api_key === true) {
    apiKeyCipher = null;
  } else if (
    Object.prototype.hasOwnProperty.call(input, "api_key") &&
    typeof input.api_key === "string" &&
    input.api_key.trim() &&
    !isMaskedSecret(input.api_key)
  ) {
    apiKeyCipher = encryptSecret(input.api_key.trim());
  }

  await pool.execute(
    `
    UPDATE ai_review_config
    SET
      enabled = ?,
      provider = ?,
      base_url = ?,
      model = ?,
      api_key_cipher = ?,
      temperature = ?,
      max_tokens = ?,
      timeout_ms = ?,
      updated_by = ?,
      updated_at = NOW()
    WHERE id = ?
    `,
    [
      enabled ? 1 : 0,
      provider,
      baseUrl,
      model,
      apiKeyCipher,
      temperature,
      maxTokens,
      timeoutMs,
      updatedBy || null,
      CONFIG_ID,
    ],
  );

  return getAiConfig({ includeSecret: false });
}

async function updateAiTestResult(result = {}) {
  await ensureConfigTable();

  const allowedStatuses = new Set(["untested", "success", "failed"]);
  const status = allowedStatuses.has(result.status) ? result.status : "failed";
  const message = String(result.message || "").slice(0, 500);

  await pool.execute(
    `
    UPDATE ai_review_config
    SET
      last_test_status = ?,
      last_test_message = ?,
      last_test_at = NOW(),
      updated_at = NOW()
    WHERE id = ?
    `,
    [status, message, CONFIG_ID],
  );
}

module.exports = {
  getAiConfig,
  saveAiConfig,
  updateAiTestResult,
  normalizeBaseUrl,
};

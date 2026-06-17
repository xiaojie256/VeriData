<template>
  <div class="ai-settings-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <div>
            <h2>AI审查配置</h2>
            <p>统一管理外部大模型 API 地址、模型与 Key。API Key 仅加密保存，前端不会回显明文。</p>
          </div>
          <el-tag :type="form.enabled ? 'success' : 'info'">
            {{ form.enabled ? '已启用' : '未启用' }}
          </el-tag>
        </div>
      </template>

      <el-alert
        class="security-alert"
        title="安全提示"
        type="warning"
        show-icon
        :closable="false"
        description="API Key 不会明文返回。保存时如不填写 Key，则保持原 Key 不变；如需清除 Key，请使用"清除已保存 Key"。"
      />

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="150px"
        class="config-form"
      >
        <el-form-item label="启用语义审计">
          <el-switch v-model="form.enabled" />
        </el-form-item>

        <el-form-item label="服务商" prop="provider">
          <el-select v-model="form.provider" placeholder="请选择服务商">
            <el-option label="OpenAI Compatible" value="openai_compatible" />
            <el-option label="小米 Mimo" value="xiaomi_mimo" />
            <el-option label="DeepSeek" value="deepseek" />
            <el-option label="自定义" value="custom" />
          </el-select>
        </el-form-item>

        <el-form-item label="API Base URL" prop="base_url">
          <el-input
            v-model.trim="form.base_url"
            placeholder="例如：https://api.example.com/v1，不要填写 /chat/completions"
            clearable
          />
        </el-form-item>

        <el-form-item label="模型名称" prop="model">
          <el-input
            v-model.trim="form.model"
            placeholder="例如：mimo-v2.5-flash / deepseek-chat / gpt-4o-mini"
            clearable
          />
        </el-form-item>

        <el-form-item label="API Key">
          <el-input
            v-model="form.api_key"
            type="password"
            show-password
            autocomplete="new-password"
            :placeholder="apiKeyPlaceholder"
            clearable
          />
          <div class="form-tip">
            不填写表示保持原 Key 不变。后端只返回脱敏状态，不返回明文。
          </div>
        </el-form-item>

        <el-form-item label="Temperature" prop="temperature">
          <el-input-number
            v-model="form.temperature"
            :min="0"
            :max="2"
            :step="0.1"
            :precision="2"
          />
        </el-form-item>

        <el-form-item label="Max Tokens" prop="max_tokens">
          <el-input-number
            v-model="form.max_tokens"
            :min="1"
            :max="16000"
            :step="100"
          />
        </el-form-item>

        <el-form-item label="超时时间(ms)" prop="timeout_ms">
          <el-input-number
            v-model="form.timeout_ms"
            :min="1000"
            :max="120000"
            :step="1000"
          />
        </el-form-item>

        <el-form-item label="最近测试">
          <div class="test-status">
            <el-tag :type="lastTestTagType">
              {{ lastTestStatusText }}
            </el-tag>
            <span v-if="lastTestAt" class="test-time">{{ lastTestAt }}</span>
            <span v-if="lastTestMessage" class="test-message">{{ lastTestMessage }}</span>
          </div>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="saving" @click="saveConfig">
            保存配置
          </el-button>
          <el-button :loading="testing" @click="testConfig">
            测试连通性
          </el-button>
          <el-button type="warning" plain :disabled="!hasSavedKey" @click="clearApiKey">
            清除已保存 Key
          </el-button>
          <el-button @click="loadConfig">
            重新加载
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../store'

const formRef = ref(null)
const saving = ref(false)
const testing = ref(false)
const hasSavedKey = ref(false)
const apiKeyMasked = ref('')
const lastTestStatus = ref('untested')
const lastTestMessage = ref('')
const lastTestAt = ref('')

const form = reactive({
  enabled: false,
  provider: 'openai_compatible',
  base_url: '',
  model: '',
  api_key: '',
  temperature: 0.3,
  max_tokens: 500,
  timeout_ms: 30000,
})

const rules = {
  provider: [{ required: true, message: '请选择服务商', trigger: 'change' }],
  base_url: [
    {
      validator: (_rule, value, callback) => {
        if (form.enabled && !value) {
          callback(new Error('启用时必须填写 API Base URL'))
          return
        }

        if (value && !/^https?:\/\//i.test(value)) {
          callback(new Error('API Base URL 必须以 http:// 或 https:// 开头'))
          return
        }

        callback()
      },
      trigger: 'blur',
    },
  ],
  model: [
    {
      validator: (_rule, value, callback) => {
        if (form.enabled && !value) {
          callback(new Error('启用时必须填写模型名称'))
          return
        }

        callback()
      },
      trigger: 'blur',
    },
  ],
  temperature: [{ type: 'number', min: 0, max: 2, message: 'Temperature 必须在 0 到 2 之间', trigger: 'change' }],
  max_tokens: [{ type: 'number', min: 1, max: 16000, message: 'Max Tokens 必须在 1 到 16000 之间', trigger: 'change' }],
  timeout_ms: [{ type: 'number', min: 1000, max: 120000, message: '超时时间必须在 1000 到 120000ms 之间', trigger: 'change' }],
}

const apiKeyPlaceholder = computed(() => {
  if (hasSavedKey.value) {
    return `已配置：${apiKeyMasked.value || '********'}；不填写则保持不变`
  }

  return '请输入 API Key'
})

const lastTestTagType = computed(() => {
  if (lastTestStatus.value === 'success') return 'success'
  if (lastTestStatus.value === 'failed') return 'danger'
  return 'info'
})

const lastTestStatusText = computed(() => {
  if (lastTestStatus.value === 'success') return '成功'
  if (lastTestStatus.value === 'failed') return '失败'
  return '未测试'
})

const applyConfig = (config) => {
  form.enabled = Boolean(config.enabled)
  form.provider = config.provider || 'openai_compatible'
  form.base_url = config.base_url || ''
  form.model = config.model || ''
  form.api_key = ''
  form.temperature = Number(config.temperature ?? 0.3)
  form.max_tokens = Number(config.max_tokens ?? 500)
  form.timeout_ms = Number(config.timeout_ms ?? 30000)

  hasSavedKey.value = Boolean(config.has_api_key)
  apiKeyMasked.value = config.api_key_masked || ''
  lastTestStatus.value = config.last_test_status || 'untested'
  lastTestMessage.value = config.last_test_message || ''
  lastTestAt.value = config.last_test_at || ''
}

const buildPayload = () => {
  const payload = {
    enabled: form.enabled,
    provider: form.provider,
    base_url: form.base_url,
    model: form.model,
    temperature: form.temperature,
    max_tokens: form.max_tokens,
    timeout_ms: form.timeout_ms,
  }

  if (form.api_key && form.api_key.trim()) {
    payload.api_key = form.api_key.trim()
  }

  return payload
}

const loadConfig = async () => {
  try {
    const response = await api.get('/admin/ai/config')
    applyConfig(response.config)
  } catch (error) {
    ElMessage.error(error.error || '加载AI审查配置失败')
  }
}

const saveConfig = async () => {
  try {
    await formRef.value.validate()

    saving.value = true
    const response = await api.put('/admin/ai/config', buildPayload())

    applyConfig(response.config)
    ElMessage.success(response.message || '配置已保存')
  } catch (error) {
    if (error?.error) {
      ElMessage.error(error.error)
    }
  } finally {
    saving.value = false
  }
}

const testConfig = async () => {
  try {
    await formRef.value.validate()

    testing.value = true
    const response = await api.post('/admin/ai/test', buildPayload())

    lastTestStatus.value = 'success'
    lastTestMessage.value = `${response.message || '连通成功'}，耗时 ${response.latency_ms || 0}ms`
    lastTestAt.value = new Date().toLocaleString()
    ElMessage.success(lastTestMessage.value)
  } catch (error) {
    lastTestStatus.value = 'failed'
    lastTestMessage.value = error.error || '连通性测试失败'
    lastTestAt.value = new Date().toLocaleString()
    ElMessage.error(lastTestMessage.value)
  } finally {
    testing.value = false
  }
}

const clearApiKey = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要清除已保存的 API Key 吗？清除后大模型语义审计将无法调用外部模型。',
      '安全确认',
      {
        type: 'warning',
        confirmButtonText: '确认清除',
        cancelButtonText: '取消',
      },
    )

    saving.value = true
    const response = await api.put('/admin/ai/config', {
      ...buildPayload(),
      clear_api_key: true,
    })

    applyConfig(response.config)
    ElMessage.success('已清除 API Key')
  } catch (error) {
    if (error?.error) {
      ElMessage.error(error.error)
    }
  } finally {
    saving.value = false
  }
}

onMounted(loadConfig)
</script>

<style scoped>
.ai-settings-page {
  padding: 0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.card-header h2 {
  margin: 0 0 8px;
  font-size: 22px;
}

.card-header p {
  margin: 0;
  color: #666;
  font-size: 14px;
}

.security-alert {
  margin-bottom: 20px;
}

.config-form {
  max-width: 880px;
}

.form-tip {
  margin-top: 6px;
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
}

.test-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.test-time {
  color: #909399;
  font-size: 13px;
}

.test-message {
  color: #606266;
  font-size: 13px;
}
</style>

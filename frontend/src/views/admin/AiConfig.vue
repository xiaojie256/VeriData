<template>
  <div class="page-container ai-config-page">
    <div class="page-header">
      <div>
        <h2>AI审查配置</h2>
        <p>由管理员统一维护 AI 审查服务地址、模型、密钥和连通性测试。</p>
      </div>
    </div>

    <el-card class="config-status-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>当前已保存配置</span>
          <el-button size="small" @click="loadConfig">刷新状态</el-button>
        </div>
      </template>

      <el-descriptions :column="2" border>
        <el-descriptions-item label="启用状态">
          <el-tag :type="savedConfig.enabled ? 'success' : 'info'">
            {{ savedConfig.enabled ? '已启用' : '未启用' }}
          </el-tag>
        </el-descriptions-item>

        <el-descriptions-item label="服务商">
          {{ savedConfig.provider || '未配置' }}
        </el-descriptions-item>

        <el-descriptions-item label="API Base URL">
          {{ savedConfig.base_url || '未配置' }}
        </el-descriptions-item>

        <el-descriptions-item label="模型">
          {{ savedConfig.model || '未配置' }}
        </el-descriptions-item>

        <el-descriptions-item label="API Key">
          <el-tag :type="savedConfig.api_key_configured ? 'success' : 'warning'">
            {{ savedConfig.api_key_configured ? '已配置（不回显明文）' : '未配置' }}
          </el-tag>
        </el-descriptions-item>

        <el-descriptions-item label="最近测试">
          <el-tag :type="savedConfig.last_test_status === 'success' ? 'success' : savedConfig.last_test_status === 'failed' ? 'danger' : 'info'">
            {{ savedConfig.last_test_status || '未测试' }}
          </el-tag>
          <span style="margin-left: 8px;">{{ savedConfig.last_test_message || '' }}</span>
        </el-descriptions-item>

        <el-descriptions-item label="最近测试时间">
          {{ formatDate(savedConfig.last_test_at) }}
        </el-descriptions-item>

        <el-descriptions-item label="更新时间">
          {{ formatDate(savedConfig.updated_at) }}
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card class="config-card" shadow="never">
      <el-alert
        title="安全提示"
        type="info"
        show-icon
        :closable="false"
        description="API Key 只在后端保存和加密处理。页面不会回显完整密钥；输入框留空保存时不会覆盖已保存的密钥。"
      />

      <el-form
        :model="form"
        label-width="150px"
        class="config-form"
        v-loading="loading"
      >
        <el-form-item label="启用 AI 审查">
          <el-switch
            v-model="form.enabled"
            active-text="启用"
            inactive-text="停用"
          />
        </el-form-item>

        <el-form-item label="服务类型">
          <el-select v-model="form.provider" placeholder="请选择服务类型">
            <el-option
              label="OpenAI 兼容接口"
              value="openai_compatible"
            />
          </el-select>
          <div class="form-tip">
            当前后端按 OpenAI Chat Completions 兼容格式进行连通性测试。
          </div>
        </el-form-item>

        <el-form-item label="API 地址">
          <el-input
            v-model="form.base_url"
            clearable
            placeholder="例如：https://api.openai.com/v1 或兼容服务的 /v1 地址"
          />
          <div class="form-tip">
            填写基础地址即可，不要填写前端页面路由。后端会按兼容接口拼接 chat/completions。
          </div>
        </el-form-item>

        <el-form-item label="模型名称">
          <el-input
            v-model="form.model"
            clearable
            placeholder="例如：gpt-4o-mini、qwen-plus、deepseek-chat 等"
          />
        </el-form-item>

        <el-form-item label="API Key">
          <el-input
            v-model="form.api_key"
            type="password"
            show-password
            clearable
            autocomplete="new-password"
            :placeholder="savedConfig.api_key_configured ? '已配置；留空表示不修改，输入新 Key 可替换' : '请输入 API Key'"
          />
          <div class="form-tip">
            {{ form.api_key_configured ? '当前后端已有已保存密钥。重新输入后保存会替换旧密钥。' : '当前尚未保存密钥。首次启用前请填写并保存。' }}
          </div>
        </el-form-item>

        <el-form-item label="Temperature">
          <el-input-number
            v-model="form.temperature"
            :min="0"
            :max="2"
            :step="0.1"
            :precision="2"
          />
        </el-form-item>

        <el-form-item label="最大输出 Token">
          <el-input-number
            v-model="form.max_tokens"
            :min="1"
            :max="8000"
            :step="100"
          />
        </el-form-item>

        <el-form-item label="超时时间">
          <el-input-number
            v-model="form.timeout_ms"
            :min="1000"
            :max="120000"
            :step="1000"
          />
          <span class="unit-text">毫秒</span>
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            :loading="saving"
            @click="saveConfig"
          >
            保存配置
          </el-button>

          <el-button
            :loading="testing"
            @click="testConfig"
          >
            测试连通性
          </el-button>

          <el-button
            :loading="loading"
            @click="loadConfig"
          >
            刷新
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="status-card" shadow="never">
      <template #header>
        <span>最近一次连通性测试</span>
      </template>

      <el-descriptions :column="1" border>
        <el-descriptions-item label="测试状态">
          <el-tag :type="testResult?.status === 'success' ? 'success' : testResult?.status === 'failed' ? 'danger' : statusTagType">
            {{ testResult?.status === 'success' ? '成功' : testResult?.status === 'failed' ? '失败' : statusText }}
          </el-tag>
        </el-descriptions-item>

        <el-descriptions-item label="测试信息">
          {{ testResult?.message || form.last_test_message || '暂无测试信息' }}
        </el-descriptions-item>

        <el-descriptions-item label="测试时间">
          {{ formatDate(testResult?.tested_at) || form.last_test_at || '暂无测试时间' }}
        </el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../../store'

const DEFAULT_FORM = {
  enabled: false,
  provider: 'openai_compatible',
  base_url: '',
  model: '',
  api_key: '',
  api_key_configured: false,
  temperature: 0.3,
  max_tokens: 500,
  timeout_ms: 30000,
  last_test_status: 'untested',
  last_test_message: '',
  last_test_at: ''
}

const form = reactive({ ...DEFAULT_FORM })

const testResult = ref(null)

const savedConfig = reactive({
  enabled: false,
  provider: '',
  base_url: '',
  model: '',
  api_key_configured: false,
  last_test_status: '',
  last_test_message: '',
  last_test_at: '',
  updated_at: ''
})

const formatDate = (value) => {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

const loading = ref(false)
const saving = ref(false)
const testing = ref(false)

const statusText = computed(() => {
  const map = {
    success: '成功',
    failed: '失败',
    untested: '未测试'
  }
  return map[form.last_test_status] || '未测试'
})

const statusTagType = computed(() => {
  if (form.last_test_status === 'success') return 'success'
  if (form.last_test_status === 'failed') return 'danger'
  return 'info'
})

const copyConfigToForm = (config = {}) => {
  Object.assign(form, {
    ...DEFAULT_FORM,
    ...config,
    api_key: ''
  })
}

const getErrorMessage = (error, fallback) => {
  return (
    error?.error ||
    error?.message ||
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    fallback
  )
}

const loadConfig = async () => {
  loading.value = true

  try {
    const res = await api.get('/admin/ai/config')
    const config = res.config || {}
    copyConfigToForm(config)
    Object.assign(savedConfig, config)
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '加载 AI 审查配置失败'))
  } finally {
    loading.value = false
  }
}

const buildPayload = () => {
  const payload = {
    enabled: Boolean(form.enabled),
    provider: form.provider || 'openai_compatible',
    base_url: (form.base_url || '').trim(),
    model: (form.model || '').trim(),
    temperature: Number(form.temperature),
    max_tokens: Number(form.max_tokens),
    timeout_ms: Number(form.timeout_ms)
  }

  const apiKey = (form.api_key || '').trim()
  if (apiKey) {
    payload.api_key = apiKey
  }

  return payload
}

const validateRequiredFields = () => {
  if (!form.base_url || !form.base_url.trim()) {
    ElMessage.warning('请填写 API 地址')
    return false
  }

  if (!form.model || !form.model.trim()) {
    ElMessage.warning('请填写模型名称')
    return false
  }

  if (!form.api_key_configured && !form.api_key.trim()) {
    ElMessage.warning('首次配置请填写 API Key')
    return false
  }

  return true
}

const saveConfig = async () => {
  if (!validateRequiredFields()) return

  saving.value = true

  try {
    const res = await api.put('/admin/ai/config', buildPayload())
    const config = res.config || {}

    Object.assign(savedConfig, config)
    copyConfigToForm(config)

    // 保存成功后清空输入框中的明文 Key，避免长期停留在页面上
    form.api_key = ''

    ElMessage.success(res.message || 'AI审查配置已保存')
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '保存失败'))
  } finally {
    saving.value = false
  }
}

const testConfig = async () => {
  if (!validateRequiredFields()) return

  testing.value = true

  try {
    const res = await api.post('/admin/ai/test', buildPayload())

    testResult.value = {
      status: 'success',
      message: res.message || `连通成功，状态码 ${res.status_code || 200}，耗时 ${res.latency_ms || '-'}ms`,
      latency_ms: res.latency_ms,
      tested_at: res.tested_at || new Date().toISOString(),
      from_unsaved_draft: true
    }

    ElMessage.success('连通性测试成功')
  } catch (error) {
    testResult.value = {
      status: 'failed',
      message: getErrorMessage(error, '连通性测试失败'),
      tested_at: new Date().toISOString(),
      from_unsaved_draft: true
    }

    ElMessage.error(testResult.value.message)
  } finally {
    testing.value = false
  }
}

onMounted(() => {
  loadConfig()
})
</script>

<style scoped>
.ai-config-page {
  padding: 0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0 0 8px;
  font-size: 24px;
  color: #303133;
}

.page-header p {
  margin: 0;
  color: #909399;
}

.config-card,
.config-status-card,
.status-card {
  max-width: 980px;
  margin-bottom: 20px;
}

.config-form {
  margin-top: 20px;
}

.form-tip {
  width: 100%;
  margin-top: 6px;
  color: #909399;
  font-size: 12px;
  line-height: 1.6;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.unit-text {
  margin-left: 10px;
  color: #606266;
}

@media (max-width: 768px) {
  .config-card,
  .status-card {
    max-width: 100%;
  }
}
</style>

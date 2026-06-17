<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <el-button link @click="$router.push('/data/list')">
          <el-icon><ArrowLeft /></el-icon>
          返回列表
        </el-button>
        <h2 class="page-title" style="margin-top: 10px;">{{ data?.title }}</h2>
      </div>
      <div class="header-actions">
        <el-button
          v-if="canGoReviewCenter"
          type="success"
          @click="router.push('/review/pending')"
        >
          去审核中心
        </el-button>

        <el-button type="primary" @click="downloadData">
          <el-icon><Download /></el-icon>
          下载
        </el-button>
      </div>
    </div>
    
    <el-row :gutter="20">
      <el-col :span="16">
        <!-- 基本信息 -->
        <el-card class="detail-card">
          <template #header>
            <div class="card-header">
              <span>基本信息</span>
              <el-tag :type="statusType[data?.review_status]">{{ statusMap[data?.review_status] }}</el-tag>
            </div>
          </template>
          
          <el-descriptions :column="2" border>
            <el-descriptions-item label="数据类型">{{ typeMap[data?.data_type] }}</el-descriptions-item>
            <el-descriptions-item label="文件格式">{{ data?.data_format?.toUpperCase() }}</el-descriptions-item>
            <el-descriptions-item label="文件大小">{{ formatFileSize(data?.file_size) }}</el-descriptions-item>
            <el-descriptions-item label="可见性">{{ visibilityMap[data?.visibility] }}</el-descriptions-item>
            <el-descriptions-item label="版本">V{{ data?.version }}</el-descriptions-item>
            <el-descriptions-item label="引用次数">{{ data?.citation_count }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ formatDate(data?.created_at) }}</el-descriptions-item>
            <el-descriptions-item label="提交时间">{{ formatDate(data?.submitted_at) }}</el-descriptions-item>
          </el-descriptions>
          
          <div class="description-section">
            <h4>数据描述</h4>
            <p>{{ data?.description || '暂无描述' }}</p>
          </div>
        </el-card>
        
        <!-- AI检测结果 -->
        <el-card class="detail-card">
          <template #header>
            <div class="card-header">
              <span>AI检测结果</span>
              <div class="ai-header-actions">
                <el-tag v-if="data?.ai_check_status === 'completed'" type="success">已完成</el-tag>
                <el-tag v-else-if="data?.ai_check_status === 'running'" type="warning">检测中</el-tag>
                <el-tag v-else-if="data?.ai_check_status === 'failed'" type="danger">检测失败</el-tag>
                <el-tag v-else type="info">待检测</el-tag>

                <el-button
                  v-if="canTriggerAiCheck"
                  size="small"
                  type="primary"
                  :loading="aiRetryLoading"
                  @click="triggerAiAnalysis"
                >
                  {{ data?.ai_check_status === 'failed' || data?.ai_check_status === 'completed' ? '重新检测' : '启动AI检测' }}
                </el-button>
              </div>
            </div>
          </template>
          
          <div v-if="aiResult">
            <el-alert
              v-if="aiResult.skipped"
              :title="aiResult.reason || '当前文件类型暂不支持自动 AI 检测，已跳过'"
              type="info"
              show-icon
              :closable="false"
            />

            <template v-else>
              <div class="ai-score-section">
                <h4>综合评分</h4>
                <el-progress
                  :percentage="aiResult.score"
                  :color="scoreColors"
                  :stroke-width="20"
                  style="width: 300px;"
                />
                <span :class="['score-text', getScoreClass(aiResult.score)]">
                  {{ aiResult.score }}分
                </span>
              </div>

              <el-descriptions :column="2" border class="ai-summary">
                <el-descriptions-item label="数据行数">
                  {{ aiResult.details?.file_info?.rows ?? '-' }}
                </el-descriptions-item>
                <el-descriptions-item label="数据列数">
                  {{ aiResult.details?.file_info?.columns ?? '-' }}
                </el-descriptions-item>
                <el-descriptions-item label="重复行">
                  {{ aiResult.details?.data_quality?.duplicate_rows ?? 0 }}
                </el-descriptions-item>
                <el-descriptions-item label="异常数量">
                  {{ aiResult.details?.anomaly_detection?.anomaly_count ?? anomalyItems.length }}
                </el-descriptions-item>
                <el-descriptions-item label="一致性问题">
                  {{ consistencyIssues.length }}
                </el-descriptions-item>
                <el-descriptions-item label="风险等级">
                  {{ aiResult.riskLevel || '未标记' }}
                </el-descriptions-item>
              </el-descriptions>

              <el-divider />

              <el-tabs type="border-card" class="ai-detail-tabs">
                <el-tab-pane label="质量问题">
                  <h5>缺失值统计</h5>
                  <el-table
                    v-if="missingValueRows.length"
                    :data="missingValueRows"
                    border
                    size="small"
                  >
                    <el-table-column prop="column" label="字段" min-width="160" />
                    <el-table-column prop="count" label="缺失数量" width="110" />
                    <el-table-column label="缺失比例" width="120">
                      <template #default="{ row }">
                        <el-tag
                          :type="Number(row.percentage) > 20 ? 'danger' : Number(row.percentage) > 5 ? 'warning' : 'success'"
                          size="small"
                        >
                          {{ row.percentage }}%
                        </el-tag>
                      </template>
                    </el-table-column>
                  </el-table>
                  <el-alert
                    v-else
                    title="未发现缺失值问题"
                    type="success"
                    :closable="false"
                    show-icon
                  />

                  <el-divider />

                  <h5>字段类型</h5>
                  <el-table
                    v-if="dataTypeRows.length"
                    :data="dataTypeRows"
                    border
                    size="small"
                  >
                    <el-table-column prop="column" label="字段" min-width="160" />
                    <el-table-column prop="type" label="识别类型" min-width="120" />
                  </el-table>
                  <el-empty v-else description="暂无字段类型信息" />
                </el-tab-pane>

                <el-tab-pane label="异常检测">
                  <el-alert
                    v-for="(anomaly, index) in anomalyItems"
                    :key="index"
                    :title="anomaly.description || anomaly.type || '异常项'"
                    :description="anomaly.column ? `字段：${anomaly.column}` : ''"
                    type="warning"
                    show-icon
                    :closable="false"
                    class="ai-alert-item"
                  />

                  <el-empty v-if="!anomalyItems.length" description="未发现明显异常" />
                </el-tab-pane>

                <el-tab-pane label="统计分析">
                  <el-table
                    v-if="statisticRows.length"
                    :data="statisticRows"
                    border
                    size="small"
                  >
                    <el-table-column prop="column" label="数值字段" min-width="140" />
                    <el-table-column prop="mean" label="均值" width="100" />
                    <el-table-column prop="std" label="标准差" width="100" />
                    <el-table-column prop="min" label="最小值" width="100" />
                    <el-table-column prop="median" label="中位数" width="100" />
                    <el-table-column prop="max" label="最大值" width="100" />
                    <el-table-column prop="outliers" label="离群点" width="100" />
                  </el-table>

                  <el-empty v-else description="暂无数值字段统计分析" />
                </el-tab-pane>

                <el-tab-pane label="一致性与审计建议">
                  <h5>一致性问题</h5>
                  <el-alert
                    v-for="(issue, index) in consistencyIssues"
                    :key="index"
                    :title="issue.description || issue.issue || '一致性问题'"
                    :description="issue.column ? `字段：${issue.column}` : ''"
                    type="warning"
                    show-icon
                    :closable="false"
                    class="ai-alert-item"
                  />
                  <el-alert
                    v-if="!consistencyIssues.length"
                    title="未发现一致性问题"
                    type="success"
                    :closable="false"
                    show-icon
                  />

                  <el-divider />

                  <h5>语义审计 / 后续审核重点</h5>
                  <el-card
                    v-if="aiResult.llmInsight"
                    shadow="never"
                    class="ai-insight-card"
                  >
                    <div class="ai-insight-text">{{ aiResult.llmInsight }}</div>
                  </el-card>
                  <el-empty
                    v-else
                    description="暂无语义审计建议；可能未启用大模型配置，或本次只执行了本地基础检测"
                  />

                  <template v-if="aiResult.suggestions.length">
                    <el-divider />
                    <h5>系统建议</h5>
                    <el-alert
                      v-for="(suggestion, index) in aiResult.suggestions"
                      :key="index"
                      :title="suggestion"
                      type="info"
                      show-icon
                      :closable="false"
                      class="ai-alert-item"
                    />
                  </template>
                </el-tab-pane>

                <el-tab-pane label="原始结果">
                  <pre class="ai-raw-json">{{ JSON.stringify(aiResult.raw, null, 2) }}</pre>
                </el-tab-pane>
              </el-tabs>
            </template>
          </div>

          <template v-else-if="data?.ai_check_status === 'failed'">
            <el-alert
              type="error"
              show-icon
              :closable="false"
              title="AI检测失败"
              style="margin-bottom: 16px;"
            >
              <template #default>
                {{ aiFailureReason || 'AI检测失败，请检查文件格式或查看后端日志。' }}
              </template>
            </el-alert>

            <el-button
              v-if="canTriggerAiCheck"
              type="primary"
              :loading="aiRetryLoading"
              @click="triggerAiAnalysis"
            >
              重新检测
            </el-button>
          </template>

          <template v-else-if="data?.ai_check_status === 'running'">
            <el-alert
              type="info"
              show-icon
              :closable="false"
              title="AI检测进行中"
            />
          </template>

          <el-empty
            v-else
            description="AI检测尚未完成或当前文件类型不支持 AI 检测"
          />
        </el-card>
        
        <!-- 审核记录 -->
        <el-card class="detail-card">
          <template #header>
            <span>审核记录</span>
          </template>
          
          <el-timeline v-if="reviewRecords.length">
            <el-timeline-item
              v-for="record in reviewRecords"
              :key="record.id"
              :type="record.status === 'approved' ? 'success' : record.status === 'rejected' ? 'danger' : 'primary'"
              :icon="record.review_type === 'teacher' ? 'User' : record.review_type === 'expert' ? 'Medal' : 'Setting'"
            >
              <h4>{{ reviewTypeMap[record.review_type] }} - {{ statusMap[record.status] }}</h4>
              <p v-if="record.comments">审核意见：{{ record.comments }}</p>
              <p v-if="record.overall_score">综合评分：{{ record.overall_score }}</p>
              <p class="time">{{ formatDate(record.completed_at || record.created_at) }}</p>
            </el-timeline-item>
          </el-timeline>
          
          <el-empty v-else description="暂无审核记录" />
        </el-card>
      </el-col>
      
      <el-col :span="8">
        <!-- 审核进度 -->
        <el-card class="detail-card">
          <template #header>
            <span>审核进度</span>
          </template>
          
          <el-steps direction="vertical" :active="currentStep" class="review-steps">
            <el-step title="数据上传" description="提交成功" />
            <el-step title="AI检测" :description="aiStatusText" />
            <el-step title="导师一审" :description="teacherStatusText" />
            <el-step title="专家盲审" :description="expertStatusText" />
            <el-step title="最终审核" :description="adminStatusText" />
          </el-steps>
        </el-card>
        
        <!-- 操作按钮 -->
        <el-card class="detail-card" v-if="canSubmit">
          <el-button type="primary" @click="showSubmitDialog" class="w-full">
            提交审核
          </el-button>
        </el-card>
      </el-col>
    </el-row>

    <!-- 提交审核对话框 -->
    <el-dialog v-model="submitDialogVisible" title="提交审核" width="480px" :close-on-click-modal="false">
      <template v-if="needsTeacherReview">
        <div v-if="teacher">
          <p style="margin-bottom: 16px;">将提交给您的导师进行一审审核：</p>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="导师姓名">
              {{ teacher.real_name || teacher.username }}
            </el-descriptions-item>
            <el-descriptions-item label="邮箱">
              {{ teacher.email }}
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <el-empty
          v-else-if="!teacherLoading"
          description="您尚未绑定导师，请先在'我的导师'页面绑定导师后再提交审核"
        >
          <div style="display: flex; gap: 10px; justify-content: center;">
            <el-button type="primary" @click="$router.push('/teacher')">去绑定导师</el-button>
            <el-button @click="showSubmitDialog">重新加载</el-button>
          </div>
        </el-empty>

        <div v-else v-loading="true" style="height: 80px;"></div>
      </template>

      <template v-else>
        <el-alert
          type="info"
          show-icon
          :closable="false"
          title="当前账号无需导师绑定"
        >
          <template #default>
            普通账号提交后将直接进入专家审核队列；管理员/教师账号提交的数据将跳过导师一审，直接进入管理员最终审核队列。
          </template>
        </el-alert>
      </template>

      <template #footer>
        <el-button @click="submitDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="submitLoading"
          :disabled="needsTeacherReview && !teacher"
          @click="submitReview"
        >
          确认提交
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Download } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { api } from '../../store'
import { useStore } from 'vuex'

const route = useRoute()
const router = useRouter()
const store = useStore()
const data = ref(null)
const aiResult = ref(null)
const reviewRecords = ref([])
const submitDialogVisible = ref(false)
const teacher = ref(null)
const teacherLoading = ref(false)
const submitLoading = ref(false)
const aiRetryLoading = ref(false)

const AI_POLLING_STATUSES = new Set(['pending', 'queued', 'running'])
let aiPollingTimer = null
let aiPollingActive = false

const isAiPollingStatus = (status) => {
  return AI_POLLING_STATUSES.has(status || '')
}

const stopAiPolling = () => {
  if (aiPollingTimer) {
    window.clearInterval(aiPollingTimer)
    aiPollingTimer = null
  }
}

const startAiPollingIfNeeded = () => {
  if (!isAiPollingStatus(data.value?.ai_check_status)) {
    stopAiPolling()
    return
  }

  if (aiPollingTimer) return

  aiPollingTimer = window.setInterval(async () => {
    if (aiPollingActive) return

    aiPollingActive = true
    try {
      await fetchData({ silent: true })
    } finally {
      aiPollingActive = false
    }
  }, 3000)
}

const currentUser = computed(() => {
  return store.state.user || JSON.parse(localStorage.getItem('user') || '{}')
})

const currentUserRole = computed(() => currentUser.value?.role || '')

const canGoReviewCenter = computed(() => {
  return ['teacher', 'expert', 'admin'].includes(currentUser.value?.role)
})

const needsTeacherReview = computed(() => currentUserRole.value === 'student')

const canTriggerAiCheck = computed(() => {
  if (!data.value || data.value.ai_check_status === 'running') return false
  const role = currentUserRole.value
  return ['admin', 'teacher', 'expert'].includes(role) ||
    Number(data.value.submitter_id) === Number(currentUser.value?.id)
})

const statusMap = {
  'draft': '草稿',
  'submitted': '已提交',
  'teacher_reviewing': '导师审核中',
  'teacher_approved': '导师通过',
  'teacher_rejected': '导师拒绝',
  'expert_reviewing': '专家审核中',
  'expert_approved': '专家通过',
  'expert_rejected': '专家拒绝',
  'final_approved': '最终通过',
  'final_rejected': '最终拒绝',
  'pending': '待审核',
  'revision_required': '需要修改'
}

const statusType = {
  'draft': 'info',
  'submitted': 'warning',
  'teacher_reviewing': 'warning',
  'teacher_approved': 'success',
  'teacher_rejected': 'danger',
  'expert_reviewing': 'warning',
  'expert_approved': 'success',
  'expert_rejected': 'danger',
  'final_approved': 'success',
  'final_rejected': 'danger'
}

const typeMap = {
  'raw': '原始数据',
  'processed': '处理数据',
  'analysis': '分析结果',
  'summary': '总结报告'
}

const visibilityMap = {
  'private': '私有',
  'limited': '受限',
  'public': '公开'
}

const reviewTypeMap = {
  'teacher': '导师审核',
  'expert': '专家盲审',
  'admin': '管理员终审'
}

const scoreColors = [
  { color: '#f56c6c', percentage: 60 },
  { color: '#e6a23c', percentage: 80 },
  { color: '#67c23a', percentage: 100 }
]

const formatDate = (date) => date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-'

const formatFileSize = (bytes) => {
  if (!bytes) return '-'
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i]
}

const getScoreClass = (score) => {
  if (score >= 80) return 'score-good'
  if (score >= 60) return 'score-warning'
  return 'score-bad'
}

const canSubmit = computed(() => {
  return ['draft', 'teacher_rejected', 'expert_rejected', 'final_rejected'].includes(data.value?.review_status)
})

const currentStep = computed(() => {
  const status = data.value?.review_status
  if (status === 'draft') return 0
  if (status === 'submitted') return 1
  if (status === 'teacher_reviewing') return 2
  if (status === 'teacher_approved') return 3
  if (status === 'expert_reviewing') return 3
  if (status === 'expert_approved') return 4
  if (status === 'final_approved') return 5
  return 1
})

const aiStatusText = computed(() => {
  if (!data.value) return '待检测'

  if (data.value.ai_check_status === 'completed') {
    return `评分: ${data.value.ai_check_score ?? '-'}`
  }

  if (data.value.ai_check_status === 'running') return '检测中'

  if (data.value.ai_check_status === 'failed') return '检测失败，可重新检测'

  return '待检测'
})

const teacherStatusText = computed(() => {
  const record = reviewRecords.value.find(r => r.review_type === 'teacher')
  return record ? statusMap[record.status] : '待审核'
})

const expertStatusText = computed(() => {
  const record = reviewRecords.value.find(r => r.review_type === 'expert')
  return record ? statusMap[record.status] : '待审核'
})

const adminStatusText = computed(() => {
  const record = reviewRecords.value.find(r => r.review_type === 'admin')
  return record ? statusMap[record.status] : '待审核'
})

const parseJsonMaybe = (value) => {
  if (!value) return null

  if (typeof value === 'object') {
    return value
  }

  try {
    return JSON.parse(value)
  } catch (error) {
    console.error('解析AI检测结果失败:', error, value)
    return null
  }
}

const clampScore = (value) => {
  const score = Number(value)
  if (!Number.isFinite(score)) return 0
  return Math.min(100, Math.max(0, score))
}

const normalizeAiResult = (rawResult, scoreFromTable) => {
  if (!rawResult) return null

  const details = rawResult.details && typeof rawResult.details === 'object'
    ? rawResult.details
    : rawResult

  const score = rawResult.score ?? scoreFromTable ?? details.score ?? 0

  return {
    score: clampScore(score),
    raw: rawResult,
    details,
    skipped: Boolean(rawResult.skipped || details.skipped),
    reason: rawResult.reason || details.reason || '',
    summary: rawResult.summary || details.summary || '',
    riskLevel: rawResult.risk_level || details.risk_level || '',
    suggestions: Array.isArray(rawResult.suggestions)
      ? rawResult.suggestions
      : Array.isArray(details.suggestions)
        ? details.suggestions
        : [],
    hasAnomaly: Boolean(
      rawResult.has_anomaly ??
      rawResult.anomaly_detected ??
      details.anomaly_detection?.has_anomaly
    ),
    llmInsight: rawResult.llm_insight || details.llm_insight || ''
  }
}

const missingValueRows = computed(() => {
  const missingValues = aiResult.value?.details?.data_quality?.missing_values || {}

  return Object.entries(missingValues)
    .map(([column, info]) => ({
      column,
      count: info?.count ?? 0,
      percentage: info?.percentage ?? 0
    }))
    .filter(row => Number(row.count) > 0 || Number(row.percentage) > 0)
    .sort((a, b) => Number(b.percentage) - Number(a.percentage))
})

const dataTypeRows = computed(() => {
  const dataTypes = aiResult.value?.details?.data_quality?.data_types || {}

  return Object.entries(dataTypes).map(([column, type]) => ({
    column,
    type
  }))
})

const statisticRows = computed(() => {
  const statistics = aiResult.value?.details?.statistical_analysis || {}

  return Object.entries(statistics).map(([column, stats]) => ({
    column,
    mean: stats?.mean ?? '-',
    std: stats?.std ?? '-',
    min: stats?.min ?? '-',
    median: stats?.median ?? '-',
    max: stats?.max ?? '-',
    outliers: stats?.outliers ?? 0
  }))
})

const anomalyItems = computed(() => {
  return aiResult.value?.details?.anomaly_detection?.anomalies || []
})

const consistencyIssues = computed(() => {
  return aiResult.value?.details?.consistency_check?.issues || []
})

const aiFailureReason = computed(() => {
  const result = data.value?.ai_check_result

  if (!result) return ''

  try {
    const parsed = typeof result === 'string' ? JSON.parse(result) : result
    return parsed.error || parsed.details?.error || parsed.reason || ''
  } catch (error) {
    return String(result)
  }
})

const fetchData = async ({ silent = false } = {}) => {
  try {
    const response = await api.get(`/data/${route.params.id}`)
    data.value = response.data

    const aiDetails = parseJsonMaybe(response.data?.ai_check_result)
    aiResult.value = normalizeAiResult(aiDetails, response.data?.ai_check_score)

    startAiPollingIfNeeded()
  } catch (error) {
    if (!silent) {
      if (error?.error) {
        ElMessage.error(error.error)
      } else {
        ElMessage.error('获取数据详情失败')
      }
    }

    // 404或403时才跳转到列表页，401由响应拦截器处理
    if (error?.error === '数据不存在' || error?.error === '无权查看此数据') {
      stopAiPolling()
      router.push('/data/list')
    }
  }
}

const triggerAiAnalysis = async () => {
  aiRetryLoading.value = true

  try {
    const result = await api.post(`/ai/analyze/${route.params.id}`)

    if (result?.skipped) {
      ElMessage.info(result.message || '当前文件类型暂不支持AI检测')
    } else {
      ElMessage.success(result?.message || 'AI检测已启动')
    }

    await fetchData()
  } catch (err) {
    const msg = err?.error || 'AI检测启动失败，请检查AI服务是否正常'
    ElMessage.error(msg)
  } finally {
    aiRetryLoading.value = false
  }
}

const fetchReviewRecords = async () => {
  try {
    // 这里需要添加获取审核记录的API
    // reviewRecords.value = response.reviews
  } catch (error) {
    console.error('获取审核记录失败', error)
  }
}

const downloadData = () => {
  const token = localStorage.getItem('token')

  if (!token) {
    ElMessage.warning('请先登录后再下载')
    return
  }

  window.open(`/api/data/${route.params.id}/download?token=${encodeURIComponent(token)}`, '_blank')
}

const showSubmitDialog = async () => {
  // 检查 AI 检测状态，学生和普通账号必须通过 AI 检测才能提交
  if (data.value && ['student', 'civilian'].includes(currentUserRole.value) && data.value.ai_check_status !== 'completed') {
    ElMessage.warning('AI检测未通过或尚未完成，暂不能提交审核。请先完成AI检测。')
    return
  }

  submitDialogVisible.value = true
  teacher.value = null

  if (!needsTeacherReview.value) {
    teacherLoading.value = false
    return
  }

  teacherLoading.value = true

  try {
    const response = await api.get('/users/my-tutor')

    if (response.teachers) {
      teacher.value = response.teachers
    } else {
      ElMessage.warning('您尚未绑定导师，请先前往"我的导师"页面完成绑定后再提交')
    }
  } catch (err) {
    console.error('获取导师信息失败', err)
    ElMessage.warning('获取导师信息失败，请稍后重试')
  } finally {
    teacherLoading.value = false
  }
}

const submitReview = async () => {
  if (needsTeacherReview.value && (!teacher.value || !teacher.value.id)) {
    ElMessage.warning('无法提交：未成功加载导师信息，请先前往"我的导师"页面完成绑定')
    return
  }

  submitLoading.value = true

  try {
    const payload = {
      liability_accepted: true
    }

    if (needsTeacherReview.value) {
      payload.teacher_id = teacher.value.id
    }

    await api.post(`/data/${route.params.id}/submit`, payload)

    ElMessage.success(
      needsTeacherReview.value
        ? '提交审核成功，已进入AI检测与导师一审环节'
        : currentUserRole.value === 'civilian'
          ? '提交审核成功，已进入专家审核环节'
          : '提交审核成功，已进入管理员最终审核环节'
    )

    submitDialogVisible.value = false
    await fetchData()
  } catch (err) {
    const msg = err?.error || '提交审核失败，请稍后重试'
    ElMessage.error(msg)
  } finally {
    submitLoading.value = false
  }
}

onMounted(() => {
  fetchData()
  fetchReviewRecords()
})

onBeforeUnmount(() => {
  stopAiPolling()
})
</script>

<style scoped>
.detail-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ai-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.description-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #ebeef5;
}

.description-section h4 {
  margin-bottom: 10px;
}

.ai-score-section {
  display: flex;
  align-items: center;
  gap: 20px;
}

.score-text {
  font-size: 24px;
  font-weight: bold;
}

.score-good { color: #67c23a; }
.score-warning { color: #e6a23c; }
.score-bad { color: #f56c6c; }

.ai-section {
  margin-top: 20px;
}

.ai-section h4, .ai-section h5 {
  margin-bottom: 15px;
}

.missing-values {
  margin-top: 15px;
}

.value-tag {
  margin: 5px;
}

.review-steps {
  min-height: 400px;
}

.ai-summary {
  margin-top: 16px;
}

.ai-detail-tabs {
  margin-top: 16px;
}

.ai-alert-item {
  margin-bottom: 10px;
}

.ai-insight-card {
  background: #f8fafc;
}

.ai-insight-text {
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-raw-json {
  max-height: 360px;
  overflow: auto;
  padding: 12px;
  border-radius: 4px;
  background: #f5f7fa;
  color: #303133;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>

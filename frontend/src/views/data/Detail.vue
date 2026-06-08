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
              <el-tag v-if="data?.ai_check_status === 'completed'" type="success">已完成</el-tag>
              <el-tag v-else-if="data?.ai_check_status === 'running'" type="warning">检测中</el-tag>
              <el-tag v-else type="info">待检测</el-tag>
            </div>
          </template>
          
          <div v-if="aiResult">
            <div class="ai-score-section">
              <h4>综合评分</h4>
              <el-progress 
                :percentage="aiResult.score" 
                :color="scoreColors"
                :stroke-width="20"
                style="width: 300px;"
              />
              <span :class="['score-text', getScoreClass(aiResult.score)]">{{ aiResult.score }}分</span>
            </div>
            
            <el-divider />
            
            <!-- 数据质量 -->
            <div v-if="aiResult.details?.data_quality" class="ai-section">
              <h4>数据质量分析</h4>
              <el-descriptions :column="1" border>
                <el-descriptions-item label="数据行数">{{ aiResult.details.file_info?.rows }}</el-descriptions-item>
                <el-descriptions-item label="数据列数">{{ aiResult.details.file_info?.columns }}</el-descriptions-item>
                <el-descriptions-item label="重复行">{{ aiResult.details.data_quality?.duplicate_rows }}</el-descriptions-item>
              </el-descriptions>
              
              <div v-if="aiResult.details.data_quality?.missing_values" class="missing-values">
                <h5>缺失值统计</h5>
                <el-tag 
                  v-for="(info, col) in aiResult.details.data_quality.missing_values" 
                  :key="col"
                  :type="info.percentage > 20 ? 'danger' : info.percentage > 5 ? 'warning' : 'success'"
                  class="value-tag"
                >
                  {{ col }}: {{ info.percentage }}%
                </el-tag>
              </div>
            </div>
            
            <!-- 异常检测 -->
            <div v-if="aiResult.details?.anomaly_detection?.anomalies?.length" class="ai-section">
              <h4>异常检测结果</h4>
              <el-alert
                v-for="(anomaly, index) in aiResult.details.anomaly_detection.anomalies"
                :key="index"
                :title="anomaly.type"
                :description="anomaly.description"
                type="warning"
                show-icon
                :closable="false"
                style="margin-bottom: 10px;"
              />
            </div>
          </div>
          
          <el-empty v-else description="AI检测尚未完成" />
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
      <div v-if="teacher">
        <p style="margin-bottom: 16px;">将提交给您的导师进行一审审核：</p>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="导师姓名">{{ teacher.real_name || teacher.username }}</el-descriptions-item>
          <el-descriptions-item label="邮箱">{{ teacher.email }}</el-descriptions-item>
        </el-descriptions>
      </div>
      <el-empty v-else-if="!teacherLoading" description="您尚未绑定导师，请先在'我的导师'页面绑定导师后再提交审核">
        <div style="display: flex; gap: 10px; justify-content: center;">
          <el-button type="primary" @click="$router.push('/teacher')">去绑定导师</el-button>
          <el-button @click="showSubmitDialog">重新加载</el-button>
        </div>
      </el-empty>
      <div v-else v-loading="true" style="height: 80px;"></div>
      <template #footer>
        <el-button @click="submitDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" :disabled="!teacher" @click="submitReview">
          确认提交
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Download } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { api } from '../../store'

const route = useRoute()
const router = useRouter()
const data = ref(null)
const aiResult = ref(null)
const reviewRecords = ref([])
const submitDialogVisible = ref(false)
const teacher = ref(null)
const teacherLoading = ref(false)
const submitLoading = ref(false)

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
  if (data.value.ai_check_status === 'completed') return `评分: ${data.value.ai_check_score}`
  if (data.value.ai_check_status === 'running') return '检测中'
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

const fetchData = async () => {
  try {
    const response = await api.get(`/data/${route.params.id}`)
    data.value = response.data
    
    // 解析AI结果
    if (response.data.ai_check_result) {
      aiResult.value = {
        score: response.data.ai_check_score,
        details: JSON.parse(response.data.ai_check_result)
      }
    }
  } catch (error) {
    if (error?.error) {
      ElMessage.error(error.error)
    } else {
      ElMessage.error('获取数据详情失败')
    }
    // 404或403时才跳转到列表页，401由响应拦截器处理
    if (error?.error === '数据不存在' || error?.error === '无权查看此数据') {
      router.push('/data/list')
    }
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
  window.open(`/api/data/${route.params.id}/download?token=${token}`, '_blank')
}

const showSubmitDialog = async () => {
  teacherLoading.value = true
  submitDialogVisible.value = true
  teacher.value = null
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
  if (!teacher.value || !teacher.value.id) {
    ElMessage.warning('无法提交：未成功加载导师信息，请先前往"我的导师"页面完成绑定')
    return
  }
  submitLoading.value = true
  try {
    await api.post(`/data/${route.params.id}/submit`, {
      teacher_id: teacher.value.id,
      liability_accepted: true
    })
    ElMessage.success('提交审核成功，已进入AI检测与导师一审环节')
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
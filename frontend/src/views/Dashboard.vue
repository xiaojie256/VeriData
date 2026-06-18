<template>
  <div class="page-container">
    <!-- 欢迎区 -->
    <el-card class="welcome-card">
      <div class="welcome-content">
        <div class="welcome-text">
          <h2>欢迎回来，{{ userName }}</h2>
          <p>{{ welcomeMessage }}</p>
        </div>
        <div class="quick-actions">
          <el-button type="primary" @click="$router.push('/data/upload')">
            <el-icon><Upload /></el-icon>
            上传数据
          </el-button>
          <el-button @click="$router.push('/public-check')">
            <el-icon><Search /></el-icon>
            公开检测
          </el-button>
        </div>
      </div>
    </el-card>
    
    <!-- 统计卡片 -->
    <el-row :gutter="20" class="stats-row">
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <el-icon class="stat-icon" size="40" color="#409EFF"><Document /></el-icon>
            <div class="stat-info">
              <div class="stat-value">{{ stats.myData }}</div>
              <div class="stat-label">我的数据</div>
            </div>
          </div>
        </el-card>
      </el-col>
      
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <el-icon class="stat-icon" size="40" color="#67C23A"><CircleCheck /></el-icon>
            <div class="stat-info">
              <div class="stat-value">{{ stats.approved }}</div>
              <div class="stat-label">已通过</div>
            </div>
          </div>
        </el-card>
      </el-col>
      
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <el-icon class="stat-icon" size="40" color="#E6A23C"><Clock /></el-icon>
            <div class="stat-info">
              <div class="stat-value">{{ stats.pending }}</div>
              <div class="stat-label">审核中</div>
            </div>
          </div>
        </el-card>
      </el-col>
      
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <el-icon class="stat-icon" size="40" color="#F56C6C"><Coin /></el-icon>
            <div class="stat-info">
              <div class="stat-value">{{ quotaRemaining }}</div>
              <div class="stat-label">剩余额度</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
    
    <!-- 审核状态流程 -->
    <el-card v-if="showReviewFlowCard" class="status-card">
      <template #header>
        <div class="card-header">
          <span>
            最近数据审核流程
            <small v-if="reviewFlowData?.title" class="flow-data-title">：{{ reviewFlowData.title }}</small>
          </span>
        </div>
      </template>

      <el-steps
        :active="currentStep"
        align-center
        finish-status="success"
        :process-status="isReviewCompleted ? 'success' : 'process'"
      >
        <el-step title="数据上传" description="提交原始数据" />
        <el-step title="AI检测" description="自动质量分析" />
        <el-step title="导师一审" description="初步审核" />
        <el-step title="专家盲审" description="专业评审" />
        <el-step title="最终审核" description="管理员确认" />
        <el-step title="审核完成" description="数据发布" />
      </el-steps>
    </el-card>
    
    <!-- 🔴 导师申请通知 -->
    <el-card v-if="pendingTeachers.length > 0" style="margin-bottom: 20px;">
      <template #header>
        <div class="card-header">
          <span>🔔 收到导师绑定申请（{{ pendingTeachers.length }}件）</span>
        </div>
      </template>
      <el-alert
        v-for="item in pendingTeachers"
        :key="item.relation_id"
        :title="`${item.real_name} 老师申请认领你为学生`"
        type="warning"
        show-icon
        style="margin-bottom: 10px;"
      >
        <template #default>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>{{ item.email }}</span>
            <div>
              <el-button type="success" size="small" @click="handleInvitation(item.relation_id, 'accept')">接受</el-button>
              <el-button type="danger" size="small" @click="handleInvitation(item.relation_id, 'reject')">拒绝</el-button>
            </div>
          </div>
        </template>
      </el-alert>
    </el-card>

    <!-- 🔴 我的导师 -->
    <el-card v-if="teacher" style="margin-bottom: 20px;">
      <template #header>
        <div class="card-header">
          <span>✅ 我的导师</span>
        </div>
      </template>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="导师姓名">{{ teacher.real_name }}</el-descriptions-item>
        <el-descriptions-item label="导师邮箱">{{ teacher.email }}</el-descriptions-item>
      </el-descriptions>
      <div style="margin-top: 15px;">
        <el-button type="danger" @click="handleUnbind(teacher.id)">解除师生关系</el-button>
      </div>
    </el-card>

    <!-- 最近数据 -->
    <el-card>
      <template #header>
        <div class="card-header">
          <span>最近上传的数据</span>
          <el-button link @click="$router.push('/data/list')">查看全部</el-button>
        </div>
      </template>
      
      <el-table :data="recentData" v-loading="loading">
        <el-table-column prop="title" label="标题" min-width="200">
          <template #default="{ row }">
            <el-link type="primary" @click="viewData(row.id)">{{ row.title }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="data_type" label="类型" width="100">
          <template #default="{ row }">
            <el-tag>{{ getDataTypeLabel(row.data_type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="review_status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getReviewStatusType(row.review_status)">{{ getReviewStatusLabel(row.review_status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="ai_check_score" label="AI评分" width="100">
          <template #default="{ row }">
            <el-progress 
              :percentage="row.ai_check_score || 0" 
              :color="scoreColors"
              :show-text="true"
            />
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="上传时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useStore } from 'vuex'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Upload, Search, Document, CircleCheck, Clock, Coin } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { api } from '../store'
import {
  getReviewStatusLabel,
  getReviewStatusType,
  getDataTypeLabel,
} from '@/utils/reviewStatus'

const store = useStore()
const router = useRouter()
const loading = ref(false)
const recentData = ref([])
const reviewFlowData = ref(null)
const pendingTeachers = ref([])
const teacher = ref(null)
const stats = ref({
  myData: 0,
  approved: 0,
  pending: 0
})

const userName = computed(() => store.getters.userName)
const user = computed(() => store.state.user)
const quotaRemaining = computed(() => (user.value?.quota_total || 0) - (user.value?.quota_used || 0))

const welcomeMessage = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return '早上好，开始新的一天科研工作吧！'
  if (hour < 18) return '下午好，继续推进您的研究进度！'
  return '晚上好，记得适当休息哦！'
})

const REVIEW_STEP_COUNT = 6

const reviewStepMap = {
  draft: 0,
  submitted: 1,
  teacher_reviewing: 2,
  teacher_approved: 3,
  teacher_rejected: 2,
  expert_reviewing: 3,
  expert_approved: 4,
  expert_rejected: 3,

  // 审核通过后表示 6 个节点全部完成，而不是只激活第 6 个节点
  final_approved: REVIEW_STEP_COUNT,

  // 兼容历史/异常别名，防止后端或旧数据出现 approved
  approved: REVIEW_STEP_COUNT,

  // 终审拒绝仍停留在最终审核节点，表示流程在终审处结束但未通过
  final_rejected: 4
}

const getStepFromProgress = (progress) => {
  const value = Number(progress)

  if (!Number.isFinite(value)) return 0
  if (value >= 100) return REVIEW_STEP_COUNT
  if (value >= 70) return 4
  if (value >= 40) return 3
  if (value >= 10) return 1

  return 0
}

const getReviewStep = (data) => {
  if (!data) return 0

  const status = data.review_status

  if (status === 'final_approved' || status === 'approved') {
    return REVIEW_STEP_COUNT
  }

  if (Number(data.review_progress) >= 100 && data.completed_at) {
    return REVIEW_STEP_COUNT
  }

  return reviewStepMap[status] ?? getStepFromProgress(data.review_progress)
}

const showReviewFlowCard = computed(() => {
  const role = user.value?.role

  return role !== 'admin' && !!reviewFlowData.value
})

const currentStep = computed(() => {
  return getReviewStep(reviewFlowData.value)
})

const isReviewCompleted = computed(() => {
  return currentStep.value >= REVIEW_STEP_COUNT
})

const scoreColors = [
  { color: '#f56c6c', percentage: 60 },
  { color: '#e6a23c', percentage: 80 },
  { color: '#67c23a', percentage: 100 }
]

const formatDate = (date) => {
  return dayjs(date).format('YYYY-MM-DD HH:mm')
}

const viewData = (id) => {
  router.push(`/data/${id}`)
}

// 🔴 处理导师邀请
const handleInvitation = async (relationId, action) => {
  try {
    await api.put(`/users/relations/${relationId}`, { action })
    ElMessage.success(action === 'accept' ? '已接受导师' : '已拒绝邀请')
    fetchData()
  } catch (error) {
    ElMessage.error(error.error || '操作失败')
  }
}

// 🔴 解除师生关系
const handleUnbind = async () => {
  if (!teacher.value) return
  
  try {
    await api.delete(`/users/relations/${teacher.value.relation_id}`)
    ElMessage.success('师生关系已解除')
    teacher.value = null
  } catch (error) {
    ElMessage.error(error.error || '解除失败')
  }
}

const fetchData = async () => {
  loading.value = true
  try {
    // 同步用户配额信息（对应后端 auth.js 中的 /me 接口）
    const response = await api.get('/auth/me')
    // 后端返回格式为 { success: true, data: user }，Axios 拦截器已提取第一层 data
    store.commit('SET_USER', response.data)

    // 🔴 获取导师申请列表
    try {
      const pendingRes = await api.get('/users/pending-teachers')
      pendingTeachers.value = pendingRes.invitations || []
    } catch (e) {
      // 接口不存在或无权，忽略
      pendingTeachers.value = []
    }

    // 🔴 获取已绑定的导师
    try {
      const teacherRes = await api.get('/users/my-tutor')
      teacher.value = teacherRes.teachers || null
    } catch (e) {
      // 接口不存在或无权，忽略
      teacher.value = null
    }

    // 并行获取所有统计数据，减少串行等待时间
    const [dataResponse, flowResponse, statsResponse, approvedRes, pendingRes] = await Promise.all([
      api.get('/data/my?page=1&limit=5'),
      api.get('/data/my?page=1&limit=1&sort=review_activity'),
      api.get('/data/my?page=1&limit=1'),
      api.get('/data/my?status=final_approved'),
      api.get('/data/my?status=submitted')
    ])

    recentData.value = dataResponse.data || []

    reviewFlowData.value = flowResponse.data?.[0] || recentData.value[0] || null

    stats.value.myData = statsResponse.pagination.total
    stats.value.approved = approvedRes.pagination.total
    stats.value.pending = pendingRes.pagination.total
  } catch (error) {
    ElMessage.error('获取数据失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.welcome-card {
  margin-bottom: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.welcome-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.welcome-text h2 {
  margin: 0 0 8px 0;
  font-size: 24px;
}

.welcome-text p {
  margin: 0;
  opacity: 0.9;
}

.quick-actions {
  display: flex;
  gap: 12px;
}

.stats-row {
  margin-bottom: 20px;
}

.stat-card {
  .stat-content {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  
  .stat-value {
    font-size: 28px;
    font-weight: bold;
    color: #303133;
  }
  
  .stat-label {
    font-size: 14px;
    color: #909399;
    margin-top: 4px;
  }
}

.status-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.flow-data-title {
  margin-left: 6px;
  color: #909399;
  font-weight: normal;
}
</style>
  
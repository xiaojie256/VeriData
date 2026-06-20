<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">
        {{ isViewingStudent ? `${studentName} 的数据` : '我的数据' }}
      </h2>

      <el-button v-if="!isViewingStudent" type="primary" @click="$router.push('/data/upload')">
        <el-icon>
          <Plus />
        </el-icon>
        上传新数据
      </el-button>

      <el-button v-else @click="$router.back()">返回</el-button>
    </div>

    <el-card class="filter-card">
      <el-form class="filter-form" :model="filters" inline>
        <el-form-item label="状态" class="filter-item">
          <el-select
            v-model="filters.status"
            placeholder="全部状态"
            clearable
            class="filter-select"
          >
            <el-option
              v-for="option in REVIEW_STATUS_OPTIONS"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="数据类型" class="filter-item">
          <el-select
            v-model="filters.data_type"
            placeholder="全部类型"
            clearable
            class="filter-select filter-select--type"
          >
            <el-option
              v-for="option in DATA_TYPE_OPTIONS"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item class="filter-actions">
          <el-button type="primary" @click="applyFilters">筛选</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card>
      <el-table :data="dataList" v-loading="loading" style="width: 100%">
        <el-table-column prop="title" label="标题" min-width="200">
          <template #default="{ row }">
            <el-link type="primary" @click="viewDetail(row.id)">
              {{ row.title }}
            </el-link>
          </template>
        </el-table-column>

        <el-table-column prop="data_type" label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">
              {{ getDataTypeLabel(row.data_type) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="review_status" label="审核状态" width="140">
          <template #default="{ row }">
            <el-tag
              v-if="row.review_status"
              :type="getReviewStatusType(row.review_status)"
              size="small"
            >
              {{ getReviewStatusLabel(row.review_status) }}
            </el-tag>
            <span v-else class="empty-placeholder">-</span>
          </template>
        </el-table-column>

        <el-table-column prop="review_progress" label="进度" width="120">
          <template #default="{ row }">
            <el-progress :percentage="row.review_progress" :stroke-width="8" />
          </template>
        </el-table-column>

        <el-table-column prop="ai_check_status" label="AI检测" width="110">
          <template #default="{ row }">
            <el-tag :type="getAiStatusType(row.ai_check_status)" size="small">
              {{ getAiStatusText(row.ai_check_status) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="ai_check_score" label="AI评分" width="100">
          <template #default="{ row }">
            <el-tag
              v-if="hasAiScore(row.ai_check_score)"
              :type="getScoreType(Number(row.ai_check_score))"
              size="small"
            >
              {{ formatAiScore(row.ai_check_score) }}
            </el-tag>
            <span v-else class="empty-placeholder">-</span>
          </template>
        </el-table-column>

        <el-table-column prop="ai_anomaly_detected" label="异常" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.ai_anomaly_detected === 1" type="danger" size="small">
              有
            </el-tag>
            <el-tag v-else-if="row.ai_check_status === 'completed'" type="success" size="small">
              无
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>

        <el-table-column prop="created_at" label="上传时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewDetail(row.id)">
              查看
            </el-button>
            <el-button
              v-if="row.ai_check_status === 'completed'"
              link
              type="warning"
              @click="viewDetail(row.id)"
            >
              AI详情
            </el-button>

            <el-button
              v-if="canShowSubmit(row)"
              link
              type="success"
              @click="submitReview(row)"
            >
              提交审核
            </el-button>

            <el-button
              v-if="canShowDelete(row)"
              link
              type="danger"
              @click="deleteData(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-container">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :page-sizes="[10, 20, 50]"
          :total="pagination.total"
          layout="total, sizes, prev, pager, next"
          @size-change="handleSizeChange"
          @current-change="handlePageChange"
        />
      </div>
    </el-card>

    <el-dialog v-model="submitDialogVisible" title="提交审核" width="500px">
      <el-form :model="submitForm" label-width="100px">
        <el-form-item v-if="needsTeacherReview" label="选择导师" required>
          <el-select v-model="submitForm.teacher_id" placeholder="请选择导师" class="w-full">
            <el-option
              v-for="teacher in teachers"
              :key="teacher.id"
              :label="teacher.real_name || teacher.username"
              :value="teacher.id"
            />
          </el-select>
        </el-form-item>

        <el-alert
          v-else
          title="普通账号无需选择导师，提交后将直接进入专家审核队列。"
          type="info"
          show-icon
          :closable="false"
          style="margin-bottom: 16px;"
        />

        <el-form-item>
          <el-checkbox v-model="submitForm.liability_accepted">
            确认数据真实有效，接受责任声明
          </el-checkbox>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="submitDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmSubmit">确认提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { api } from '../../store'
import {
  REVIEW_STATUS_OPTIONS,
  DATA_TYPE_OPTIONS,
  getReviewStatusLabel,
  getReviewStatusType,
  getDataTypeLabel,
  hasAiScore,
  formatAiScore,
} from '@/utils/reviewStatus'

const router = useRouter()
const route = useRoute()
const loading = ref(false)
const dataList = ref([])
const teachers = ref([])
const submitDialogVisible = ref(false)
const currentData = ref(null)

// 是否为教师查看学生数据模式
const studentId = computed(() => route.query.student_id)
const studentName = computed(() => route.query.student_name || '学生')
const isViewingStudent = computed(() => !!studentId.value)

const filters = reactive({
  status: '',
  data_type: ''
})

const pagination = reactive({
  page: 1,
  limit: 10,
  total: 0
})

const submitForm = reactive({
  teacher_id: '',
  liability_accepted: false
})

const formatDate = (date) => {
  if (!date) return '-'
  return dayjs(date).format('YYYY-MM-DD HH:mm')
}

const getScoreType = (score) => {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'danger'
}

const getAiStatusText = (status) => {
  const statusMap = {
    pending: '待检测',
    queued: '排队中',
    running: '检测中',
    completed: '已完成',
    failed: '失败'
  }
  return statusMap[status] || '待检测'
}

const getAiStatusType = (status) => {
  const typeMap = {
    pending: 'info',
    queued: 'warning',
    running: 'warning',
    completed: 'success',
    failed: 'danger'
  }
  return typeMap[status] || 'info'
}

const canSubmit = (status) => ['draft', 'teacher_rejected', 'expert_rejected', 'final_rejected'].includes(status)

const currentUserRole = computed(() => {
  try {
    const u = JSON.parse(localStorage.getItem('user'))
    return u?.role || ''
  } catch {
    return ''
  }
})

const canShowSubmit = (row) => {
  return !isViewingStudent.value &&
    ['student', 'civilian', 'teacher', 'admin'].includes(currentUserRole.value) &&
    canSubmit(row.review_status) &&
    !['pending', 'queued', 'running'].includes(row.ai_check_status)
}

const canShowDelete = (row) => {
  return !isViewingStudent.value && Boolean(row?.id)
}

const needsTeacherReview = computed(() => currentUserRole.value === 'student')

const fetchData = async ({ silent = false } = {}) => {
  if (!silent) {
    loading.value = true
  }

  try {
    let url
    if (isViewingStudent.value) {
      url = `/data/student/${studentId.value}?page=${pagination.page}&limit=${pagination.limit}`
    } else {
      url = `/data/my?page=${pagination.page}&limit=${pagination.limit}`
    }
    if (filters.status) url += `&status=${filters.status}`
    if (filters.data_type) url += `&data_type=${filters.data_type}`

    const response = await api.get(url)
    dataList.value = Array.isArray(response.data) ? response.data : []
    pagination.total = response.pagination?.total || 0

    startAiPollingIfNeeded()
  } catch (error) {
    if (!silent) {
      if (error?.error) {
        ElMessage.error(error.error)
      } else {
        ElMessage.error('获取数据失败')
      }
    }
  } finally {
    if (!silent) {
      loading.value = false
    }
  }
}

const AI_POLLING_STATUSES = new Set(['pending', 'queued', 'running'])
let aiPollingTimer = null
let aiPollingActive = false

const isAiPollingStatus = (status) => {
  return AI_POLLING_STATUSES.has(status || '')
}

const hasAiPollingRows = () => {
  return dataList.value.some((item) => isAiPollingStatus(item.ai_check_status))
}

const stopAiPolling = () => {
  if (aiPollingTimer) {
    window.clearInterval(aiPollingTimer)
    aiPollingTimer = null
  }
}

const startAiPollingIfNeeded = () => {
  if (!hasAiPollingRows()) {
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

const applyFilters = () => {
  pagination.page = 1
  fetchData()
}

const resetFilters = () => {
  filters.status = ''
  filters.data_type = ''
  pagination.page = 1
  fetchData()
}

const handleSizeChange = (size) => {
  pagination.limit = size
  pagination.page = 1
  fetchData()
}

const handlePageChange = (page) => {
  pagination.page = page
  fetchData()
}

const viewDetail = (id) => {
  router.push(`/data/${id}`)
}

const submitReview = async (row) => {
  currentData.value = row

  // 重置表单状态
  submitForm.teacher_id = ''
  submitForm.liability_accepted = false

  // 1. 安全提取当前登录用户的角色
  let userRole = 'student'
  try {
    const user = JSON.parse(localStorage.getItem('user'))
    userRole = user?.role || 'student'
  } catch (e) {
    console.error(e)
  }

  // 2. 不支持的角色，禁止提交审核
  if (!['student', 'civilian', 'teacher', 'admin'].includes(userRole)) {
    ElMessage.warning('当前角色不支持提交审核');
    return;
  }

  // 3. 学生角色：获取导师列表
  if (userRole === 'student') {
    try {
      const response = await api.get('/users/my-tutor')
      if (response.teachers) {
        teachers.value = [response.teachers]
        submitForm.teacher_id = response.teachers.id
      } else {
        teachers.value = []
        ElMessage.warning('您尚未绑定导师，请先前往"我的导师"页面完成绑定后再提交')
        return
      }
    } catch (error) {
      // 获取导师失败时仍打开对话框，允许用户稍后重试
      teachers.value = []
      ElMessage.warning('获取导师信息失败，请稍后重试')
    }
  } else {
    // 普通账号不需要导师
    teachers.value = []
    submitForm.teacher_id = null
  }
  submitDialogVisible.value = true
}

const confirmSubmit = async () => {
  if (needsTeacherReview.value && !submitForm.teacher_id) {
    ElMessage.warning('请选择导师')
    return
  }
  if (!submitForm.liability_accepted) {
    ElMessage.warning('请接受责任声明')
    return
  }

  try {
    const payload = {
      liability_accepted: submitForm.liability_accepted
    }

    if (needsTeacherReview.value) {
      payload.teacher_id = submitForm.teacher_id
    }

    await api.post(`/data/${currentData.value.id}/submit`, payload)
    ElMessage.success(
      needsTeacherReview.value
        ? '提交审核成功，已进入导师一审'
        : '提交审核成功，已进入专家审核'
    )
    submitDialogVisible.value = false
    fetchData()
  } catch (error) {
    ElMessage.error(error.error || '提交失败')
  }
}

const deleteData = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除数据「${row.title}」吗？删除后该记录将从列表、公开数据和待审核队列中移除。`,
      '删除确认',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    await api.delete(`/data/${row.id}`)
    ElMessage.success('删除成功')
    fetchData()
  } catch (error) {
    if (error === 'cancel' || error === 'close') {
      return
    }

    ElMessage.error(error?.error || '删除失败')
  }
}

onMounted(() => {
  fetchData()
})

onBeforeUnmount(() => {
  stopAiPolling()
})
</script>

<style scoped>
.page-container {
  padding: 20px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.page-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}

.filter-card {
  margin-bottom: 16px;
}

.filter-card :deep(.el-card__body) {
  padding: 20px 24px;
}

.filter-form {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  column-gap: 24px;
  row-gap: 12px;
}

.filter-form :deep(.el-form-item) {
  margin-right: 0;
  margin-bottom: 0;
}

.filter-select {
  width: 160px;
}

.filter-select--type {
  width: 180px;
}

.filter-actions {
  margin-left: 4px;
}

@media (max-width: 768px) {
  .filter-form {
    align-items: stretch;
  }

  .filter-form :deep(.el-form-item) {
    width: 100%;
  }

  .filter-select,
  .filter-select--type {
    width: 100%;
  }

  .filter-actions :deep(.el-form-item__content) {
    display: flex;
    gap: 12px;
  }
}

.pagination-container {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.w-full {
  width: 100%;
}
</style>

  
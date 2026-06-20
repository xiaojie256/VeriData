<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">数据管理</h2>
    </div>
    
    <el-card class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="搜索">
          <el-input v-model="filters.search" placeholder="请输入标题/提交者" clearable style="width: 200px;" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 150px;">
            <el-option
              v-for="item in REVIEW_STATUS_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="数据类型">
          <el-select v-model="filters.data_type" placeholder="全部类型" clearable style="width: 150px;">
            <el-option
              v-for="item in DATA_TYPE_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    
    <el-card>
      <el-table :data="dataList" v-loading="loading" style="width: 100%">
        <el-table-column prop="title" label="标题" min-width="200" />
        <el-table-column
          prop="original_filename"
          label="原始文件名"
          min-width="180"
          show-overflow-tooltip
        />
        <el-table-column
          prop="description"
          label="描述"
          min-width="220"
          show-overflow-tooltip
        />
        <el-table-column
          prop="data_format"
          label="格式"
          width="90"
        />
        <el-table-column
          prop="visibility"
          label="可见性"
          width="100"
        />
        <el-table-column label="提交者" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span>
              {{ row.submitter_real_name || row.submitter_name || '-' }}
            </span>
            <span
              v-if="row.submitter_real_name && row.submitter_name"
              class="muted-text"
            >
              （{{ row.submitter_name }}）
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="data_type" label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ getDataTypeLabel(row.data_type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="review_status" label="状态" width="120">
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
        <el-table-column prop="created_at" label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewDetail(row)">查看</el-button>
            <el-button v-if="canFinalReview(row)" link type="success" @click="finalReview(row)">终审</el-button>
            <el-button link type="danger" @click="deleteData(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      
      <div class="pagination-container">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :total="pagination.total"
          layout="total, prev, pager, next"
          @current-change="fetchData"
        />
      </div>
    </el-card>
    
    <!-- 终审对话框 -->
    <el-dialog v-model="reviewDialogVisible" title="管理员终审" width="500px">
      <el-form :model="reviewForm" label-width="80px">
        <el-form-item label="审核结果">
          <el-radio-group v-model="reviewForm.decision">
            <el-radio label="approved">通过</el-radio>
            <el-radio label="rejected">拒绝</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="审核意见">
          <el-input v-model="reviewForm.comments" type="textarea" :rows="4" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitReview">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
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
const loading = ref(false)
const dataList = ref([])
const reviewDialogVisible = ref(false)
const currentData = ref(null)
const reviewForm = reactive({
  decision: 'approved',
  comments: ''
})

const filters = reactive({
  status: '',
  data_type: '',
  search: ''
})

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0
})

const getScoreType = (score) => {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'danger'
}

const canFinalReview = (row) => row.review_status === 'expert_approved'

const formatDate = (date) => {
  if (!date) return '-'
  return dayjs(date).format('YYYY-MM-DD HH:mm')
}

const fetchData = async () => {
  loading.value = true
  try {
    let url = `/admin/data?page=${pagination.page}&limit=${pagination.limit}`
    if (filters.status) url += `&status=${filters.status}`
    if (filters.data_type) url += `&data_type=${filters.data_type}`
    if (filters.search) url += `&search=${encodeURIComponent(filters.search)}`

    const response = await api.get(url)
    dataList.value = response.data
    pagination.total = response.pagination.total
  } catch (error) {
    ElMessage.error('获取数据列表失败')
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  pagination.page = 1
  fetchData()
}

const resetFilters = () => {
  filters.status = ''
  filters.data_type = ''
  filters.search = ''
  pagination.page = 1
  fetchData()
}

const viewDetail = (row) => {
  router.push(`/data/${row.id}`)
}

const finalReview = (row) => {
  currentData.value = row
  reviewForm.decision = 'approved'
  reviewForm.comments = ''
  reviewDialogVisible.value = true
}

const submitReview = async () => {
  try {
    await api.post(`/admin/final-review/${currentData.value.id}`, reviewForm)
    ElMessage.success('终审提交成功')
    reviewDialogVisible.value = false
    fetchData()
  } catch (error) {
    ElMessage.error('提交失败')
  }
}

const deleteData = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除数据「${row.title}」吗？删除后该数据将从数据管理、公开数据和待审核队列中移除。`,
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
</script>

<style scoped>
.filter-card {
  margin-bottom: 20px;
}

.pagination-container {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
.muted-text {
  color: #909399;
  font-size: 12px;
}
</style>

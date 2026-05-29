<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">数据管理</h2>
    </div>
    
    <el-card class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部状态" clearable>
            <el-option label="草稿" value="draft" />
            <el-option label="待审核" value="submitted" />
            <el-option label="已通过" value="final_approved" />
            <el-option label="已拒绝" value="final_rejected" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="fetchData">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    
    <el-card>
      <el-table :data="dataList" v-loading="loading" style="width: 100%">
        <el-table-column prop="title" label="标题" min-width="200" />
        <el-table-column prop="submitter_name" label="提交者" min-width="120" />
        <el-table-column prop="data_type" label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ typeMap[row.data_type] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="review_status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusType[row.review_status]" size="small">
              {{ statusMap[row.review_status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="ai_check_score" label="AI评分" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.ai_check_score" :type="getScoreType(row.ai_check_score)" size="small">
              {{ row.ai_check_score }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewDetail(row)">查看</el-button>
            <el-button v-if="canFinalReview(row)" link type="success" @click="finalReview(row)">终审</el-button>
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
  status: ''
})

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0
})

const typeMap = {
  'raw': '原始数据',
  'processed': '处理数据',
  'analysis': '分析结果',
  'summary': '总结报告'
}

const statusMap = {
  'draft': '草稿',
  'submitted': '待审核',
  'expert_approved': '待终审',
  'final_approved': '已通过',
  'final_rejected': '已拒绝'
}

const statusType = {
  'draft': 'info',
  'submitted': 'warning',
  'expert_approved': 'warning',
  'final_approved': 'success',
  'final_rejected': 'danger'
}

const formatDate = (date) => dayjs(date).format('YYYY-MM-DD HH:mm')

const getScoreType = (score) => {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'danger'
}

const canFinalReview = (row) => row.review_status === 'expert_approved'

const fetchData = async () => {
  loading.value = true
  try {
    let url = `/admin/data?page=${pagination.page}&limit=${pagination.limit}`
    if (filters.status) url += `&status=${filters.status}`
    
    const response = await api.get(url)
    dataList.value = response.data
    pagination.total = response.pagination.total
  } catch (error) {
    ElMessage.error('获取数据列表失败')
  } finally {
    loading.value = false
  }
}

const resetFilters = () => {
  filters.status = ''
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
</style>

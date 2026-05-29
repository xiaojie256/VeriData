<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">审核历史</h2>
    </div>
    
    <el-card>
      <el-table :data="reviewList" v-loading="loading" style="width: 100%">
        <el-table-column prop="title" label="数据标题" min-width="200" />
        
        <el-table-column prop="review_type" label="审核类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ typeMap[row.review_type] }}</el-tag>
          </template>
        </el-table-column>
        
        <el-table-column prop="status" label="审核结果" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType[row.status]" size="small">
              {{ statusMap[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        
        <el-table-column prop="overall_score" label="评分" width="100">
          <template #default="{ row }">
            <span v-if="row.overall_score">{{ row.overall_score }}/10</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        
        <el-table-column prop="comments" label="审核意见" min-width="200">
          <template #default="{ row }">
            <el-text line-clamp="2">{{ row.comments || '-' }}</el-text>
          </template>
        </el-table-column>
        
        <el-table-column prop="ai_assisted" label="AI辅助" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.ai_assisted" type="success" size="small">是</el-tag>
            <el-tag v-else type="info" size="small">否</el-tag>
          </template>
        </el-table-column>
        
        <el-table-column prop="completed_at" label="审核时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.completed_at) }}
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
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import { api } from '../../store'

const loading = ref(false)
const reviewList = ref([])

const pagination = ref({
  page: 1,
  limit: 10,
  total: 0
})

const typeMap = {
  'teacher': '导师一审',
  'expert': '专家盲审',
  'admin': '管理员终审'
}

const statusMap = {
  'approved': '通过',
  'rejected': '拒绝',
  'revision_required': '需修改'
}

const statusType = {
  'approved': 'success',
  'rejected': 'danger',
  'revision_required': 'warning'
}

const formatDate = (date) => dayjs(date).format('YYYY-MM-DD HH:mm')

const fetchData = async () => {
  loading.value = true
  try {
    const response = await api.get(`/review/history?page=${pagination.value.page}&limit=${pagination.value.limit}`)
    reviewList.value = response.reviews
    pagination.value.total = response.reviews.length
  } catch (error) {
    ElMessage.error('获取审核历史失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.pagination-container {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
</style>

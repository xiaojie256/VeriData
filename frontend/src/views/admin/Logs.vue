<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">系统日志</h2>
    </div>
    
    <el-card class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="操作类型">
          <el-select v-model="filters.action" placeholder="全部" clearable>
            <el-option label="登录" value="login" />
            <el-option label="查看" value="view" />
            <el-option label="下载" value="download" />
            <el-option label="创建" value="create" />
            <el-option label="审核" value="review" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="fetchLogs">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    
    <el-card>
      <el-table :data="logs" v-loading="loading" style="width: 100%">
        <el-table-column prop="created_at" label="时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column prop="username" label="用户" width="120">
          <template #default="{ row }">
            {{ row.username || '游客' }}
          </template>
        </el-table-column>
        <el-table-column prop="action" label="操作" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ actionMap[row.action] || row.action }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="target_type" label="对象类型" width="100" />
        <el-table-column prop="ip_address" label="IP地址" width="140" />
        <el-table-column prop="user_agent" label="设备信息" min-width="200" show-overflow-tooltip />
      </el-table>
      
      <div class="pagination-container">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :total="pagination.total"
          layout="total, prev, pager, next"
          @current-change="fetchLogs"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import { api } from '../../store'

const loading = ref(false)
const logs = ref([])

const filters = reactive({
  action: ''
})

const pagination = reactive({
  page: 1,
  limit: 50,
  total: 0
})

const actionMap = {
  'login': '登录',
  'logout': '登出',
  'view': '查看',
  'download': '下载',
  'create': '创建',
  'update': '更新',
  'delete': '删除',
  'review': '审核'
}

const formatDate = (date) => dayjs(date).format('YYYY-MM-DD HH:mm:ss')

const fetchLogs = async () => {
  loading.value = true
  try {
    let url = `/admin/logs?page=${pagination.page}&limit=${pagination.limit}`
    if (filters.action) url += `&action=${filters.action}`
    
    const response = await api.get(url)
    logs.value = response.logs
    pagination.total = response.logs.length
  } catch (error) {
    ElMessage.error('获取日志失败')
  } finally {
    loading.value = false
  }
}

const resetFilters = () => {
  filters.action = ''
  fetchLogs()
}

onMounted(() => {
  fetchLogs()
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

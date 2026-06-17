<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">公开数据</h2>
      <el-alert
        title="这里只展示已通过终审并设置为公开的数据。"
        type="info"
        :closable="false"
        show-icon
        style="max-width: 600px;"
      />
    </div>

    <el-card>
      <el-table :data="dataList" v-loading="loading">
        <el-table-column label="标题" min-width="220">
          <template #default="{ row }">
            <el-link type="primary" @click="$router.push(`/data/${row.id}`)">
              {{ row.title }}
            </el-link>
          </template>
        </el-table-column>

        <el-table-column prop="data_type" label="数据类型" width="120" />

        <el-table-column prop="data_format" label="格式" width="100" />

        <el-table-column label="文件大小" width="120">
          <template #default="{ row }">
            {{ formatFileSize(row.file_size) }}
          </template>
        </el-table-column>

        <el-table-column prop="submitter_real_name" label="提交者" width="140" />

        <el-table-column label="下载次数" width="100">
          <template #default="{ row }">
            {{ row.download_count || 0 }}
          </template>
        </el-table-column>

        <el-table-column label="公开时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.completed_at) }}
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrapper">
        <el-pagination
          background
          layout="prev, pager, next, total"
          :current-page="pagination.page"
          :page-size="pagination.limit"
          :total="pagination.total"
          @current-change="loadData"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../../store'

const loading = ref(false)
const dataList = ref([])
const pagination = ref({
  page: 1,
  limit: 10,
  total: 0
})

const formatFileSize = (size) => {
  const value = Number(size || 0)

  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`

  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

const formatDate = (value) => {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

const loadData = async (page = 1) => {
  loading.value = true

  try {
    const res = await api.get('/data/public', {
      params: {
        page,
        limit: pagination.value.limit
      }
    })

    dataList.value = res.data || []
    pagination.value = {
      page: res.pagination?.page || page,
      limit: res.pagination?.limit || pagination.value.limit,
      total: res.pagination?.total || 0
    }
  } catch (error) {
    ElMessage.error(error.error || '获取公开数据失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.pagination-wrapper {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>

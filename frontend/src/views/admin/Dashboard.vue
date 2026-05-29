<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">管理仪表盘</h2>
    </div>
    
    <!-- 统计卡片 -->
    <el-row :gutter="20" class="stats-row">
      <el-col :span="6" v-for="stat in statsCards" :key="stat.key">
        <el-card class="stat-card" @click="navigateTo(stat.route)">
          <div class="stat-content">
            <el-icon class="stat-icon" :size="40" :color="stat.color">
              <component :is="stat.icon" />
            </el-icon>
            <div class="stat-info">
              <div class="stat-value">{{ stat.value }}</div>
              <div class="stat-label">{{ stat.label }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
    
    <!-- 图表 -->
    <el-row :gutter="20" style="margin-top: 20px;">
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>近7天数据提交趋势</span>
          </template>
          <v-chart class="chart" :option="weeklyChartOption" autoresize />
        </el-card>
      </el-col>
      
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>用户角色分布</span>
          </template>
          <v-chart class="chart" :option="roleChartOption" autoresize />
        </el-card>
      </el-col>
    </el-row>
    
    <!-- 待处理事项 -->
    <el-row :gutter="20" style="margin-top: 20px;">
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>待审核数据</span>
            <el-button link @click="$router.push('/review/pending')">查看全部</el-button>
          </template>
          <el-table :data="pendingData" size="small">
            <el-table-column prop="title" label="标题" min-width="150" />
            <el-table-column prop="submitter_name" label="提交者" width="100" />
            <el-table-column prop="submitted_at" label="提交时间" width="150">
              <template #default="{ row }">
                {{ formatDate(row.submitted_at) }}
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>待验证用户</span>
            <el-button link @click="$router.push('/admin/users')">查看全部</el-button>
          </template>
          <el-table :data="pendingUsers" size="small">
            <el-table-column prop="username" label="用户名" min-width="120" />
            <el-table-column prop="role" label="角色" width="100">
              <template #default="{ row }">
                <el-tag size="small">{{ roleMap[row.role] }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="注册时间" width="150">
              <template #default="{ row }">
                {{ formatDate(row.created_at) }}
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Document, Check, Warning } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { api } from '../../store'

const router = useRouter()
const stats = ref({
  user_stats: {},
  data_stats: {},
  review_stats: {}
})
const weeklyTrend = ref([])
const pendingData = ref([])
const pendingUsers = ref([])

const roleMap = {
  'student': '学生',
  'teacher': '导师',
  'expert': '专家',
  'admin': '管理员'
}

const statsCards = computed(() => [
  {
    key: 'users',
    label: '总用户数',
    value: stats.value.user_stats?.total_users || 0,
    icon: 'User',
    color: '#409EFF',
    route: '/admin/users'
  },
  {
    key: 'data',
    label: '总数据量',
    value: stats.value.data_stats?.total_data || 0,
    icon: 'Document',
    color: '#67C23A',
    route: '/admin/data'
  },
  {
    key: 'pending',
    label: '待审核',
    value: stats.value.data_stats?.teacher_pending || 0,
    icon: 'Warning',
    color: '#E6A23C',
    route: '/review/pending'
  },
  {
    key: 'approved',
    label: '已通过',
    value: stats.value.data_stats?.approved || 0,
    icon: 'Check',
    color: '#F56C6C',
    route: '/admin/data'
  }
])

const weeklyChartOption = computed(() => ({
  xAxis: {
    type: 'category',
    data: weeklyTrend.value.map(d => d.date)
  },
  yAxis: {
    type: 'value'
  },
  series: [{
    data: weeklyTrend.value.map(d => d.count),
    type: 'line',
    smooth: true,
    areaStyle: {
      color: {
        type: 'linear',
        x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [
          { offset: 0, color: 'rgba(64, 158, 255, 0.5)' },
          { offset: 1, color: 'rgba(64, 158, 255, 0.1)' }
        ]
      }
    }
  }]
}))

const roleChartOption = computed(() => ({
  tooltip: {
    trigger: 'item'
  },
  legend: {
    orient: 'vertical',
    left: 'left'
  },
  series: [{
    type: 'pie',
    radius: '50%',
    data: [
      { value: stats.value.user_stats?.students || 0, name: '学生' },
      { value: stats.value.user_stats?.teachers || 0, name: '导师' },
      { value: stats.value.user_stats?.experts || 0, name: '专家' }
    ]
  }]
}))

const formatDate = (date) => dayjs(date).format('MM-DD HH:mm')

const navigateTo = (route) => {
  router.push(route)
}

const fetchDashboardData = async () => {
  try {
    const response = await api.get('/admin/dashboard')
    stats.value = {
      user_stats: response.user_stats,
      data_stats: response.data_stats,
      review_stats: response.review_stats
    }
    weeklyTrend.value = response.weekly_trend
  } catch (error) {
    ElMessage.error('获取仪表盘数据失败')
  }
}

const fetchPendingData = async () => {
  try {
    const dataResponse = await api.get('/admin/data?status=submitted&limit=5')
    pendingData.value = dataResponse.data
    
    const userResponse = await api.get('/admin/users?status=pending_verification&limit=5')
    pendingUsers.value = userResponse.users
  } catch (error) {
    console.error('获取待处理数据失败', error)
  }
}

onMounted(() => {
  fetchDashboardData()
  fetchPendingData()
})
</script>

<style scoped>
.stats-row {
  .stat-card {
    cursor: pointer;
    transition: all 0.3s;
    
    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
  }
  
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

.chart {
  height: 300px;
}
</style>

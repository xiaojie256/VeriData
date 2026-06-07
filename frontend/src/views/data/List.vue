<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">我的数据</h2>
      <el-button type="primary" @click="$router.push('/data/upload')">
        <el-icon><Plus /></el-icon>
        上传新数据
      </el-button>
    </div>
    
    <!-- 筛选栏 -->
    <el-card class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部状态" clearable>
            <el-option label="草稿" value="draft" />
            <el-option label="待审核" value="submitted" />
            <el-option label="审核中" value="teacher_reviewing" />
            <el-option label="已通过" value="final_approved" />
            <el-option label="已拒绝" value="final_rejected" />
          </el-select>
        </el-form-item>
        
        <el-form-item label="数据类型">
          <el-select v-model="filters.data_type" placeholder="全部类型" clearable>
            <el-option label="原始数据" value="raw" />
            <el-option label="处理数据" value="processed" />
            <el-option label="分析结果" value="analysis" />
            <el-option label="总结报告" value="summary" />
          </el-select>
        </el-form-item>
        
        <el-form-item>
          <el-button type="primary" @click="fetchData">筛选</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    
    <!-- 数据列表 -->
    <el-card>
      <el-table :data="dataList" v-loading="loading" style="width: 100%">
        <el-table-column prop="title" label="标题" min-width="200">
          <template #default="{ row }">
            <el-link type="primary" @click="viewDetail(row.id)">{{ row.title }}</el-link>
          </template>
        </el-table-column>
        
        <el-table-column prop="data_type" label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ typeMap[row.data_type] }}</el-tag>
          </template>
        </el-table-column>
        
        <el-table-column prop="review_status" label="审核状态" width="140">
          <template #default="{ row }">
            <el-tag :type="statusType[row.review_status]" size="small">
              {{ statusMap[row.review_status] }}
            </el-tag>
          </template>
        </el-table-column>
        
        <el-table-column prop="review_progress" label="进度" width="120">
          <template #default="{ row }">
            <el-progress :percentage="row.review_progress" :stroke-width="8" />
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
        
        <el-table-column prop="ai_anomaly_detected" label="异常" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.ai_anomaly_detected === 1" type="danger" size="small">有</el-tag>
            <el-tag v-else-if="row.ai_check_status === 'completed'" type="success" size="small">无</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        
        <el-table-column prop="created_at" label="上传时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewDetail(row.id)">查看</el-button>
            <el-button 
              v-if="canSubmit(row.review_status)" 
              link 
              type="success" 
              @click="submitReview(row)"
            >
              提交审核
            </el-button>
            <el-button 
              v-if="canDelete(row.review_status)" 
              link 
              type="danger" 
              @click="deleteData(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      
      <!-- 分页 -->
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
    
    <!-- 提交审核对话框 -->
    <el-dialog v-model="submitDialogVisible" title="提交审核" width="500px">
      <el-form :model="submitForm" label-width="100px">
        <el-form-item label="选择导师">
          <el-select v-model="submitForm.teacher_id" placeholder="请选择导师" class="w-full">
            <el-option 
              v-for="teacher in teachers" 
              :key="teacher.id" 
              :label="teacher.real_name || teacher.username" 
              :value="teacher.id" 
            />
          </el-select>
        </el-form-item>
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
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { api } from '../../store'

const router = useRouter()
const loading = ref(false)
const dataList = ref([])
const teachers = ref([])
const submitDialogVisible = ref(false)
const currentData = ref(null)

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

const statusMap = {
  'draft': '草稿',
  'submitted': '待审核',
  'teacher_reviewing': '导师审核中',
  'teacher_approved': '导师通过',
  'teacher_rejected': '导师拒绝',
  'expert_reviewing': '专家审核中',
  'expert_approved': '专家通过',
  'expert_rejected': '专家拒绝',
  'final_approved': '已通过',
  'final_rejected': '已拒绝'
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

const formatDate = (date) => dayjs(date).format('YYYY-MM-DD HH:mm')

const getScoreType = (score) => {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'danger'
}

const canSubmit = (status) => ['draft', 'teacher_rejected', 'expert_rejected', 'final_rejected'].includes(status)

const canDelete = (status) => ['draft', 'final_rejected'].includes(status)

const fetchData = async () => {
  loading.value = true
  try {
    let url = `/data/my?page=${pagination.page}&limit=${pagination.limit}`
    if (filters.status) url += `&status=${filters.status}`
    if (filters.data_type) url += `&data_type=${filters.data_type}`
    
    const response = await api.get(url)
    dataList.value = response.data
    pagination.total = response.pagination.total
  } catch (error) {
    if (error?.error) {
      ElMessage.error(error.error)
    } else {
      ElMessage.error('获取数据失败')
    }
  } finally {
    loading.value = false
  }
}

const resetFilters = () => {
  filters.status = ''
  filters.data_type = ''
  fetchData()
}

const handleSizeChange = (size) => {
  pagination.limit = size
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
  
  // 1. 安全提取当前登录用户的角色，避免盲目请求
  let userRole = 'student';
  try {
    const user = JSON.parse(localStorage.getItem('user'));
    userRole = user?.role || 'student';
  } catch (e) {
    console.error(e);
  }

  // 2. 如果不是学生（是教师、专家或管理员），跳过获取导师步骤，直接指派给系统默认审批人（ID 1 为系统内置管理员）
  if (userRole !== 'student') {
    submitForm.teacher_id = 1; 
    submitForm.liability_accepted = false;
    teachers.value = [{ id: 1, real_name: '系统审查员（管理员）' }];
    submitDialogVisible.value = true;
    return;
  }

  // 3. 学生角色维持原状，去请求属于自己的导师
  try {
    const response = await api.get('/users/my-tutor')
    if (response.teachers) {
      teachers.value = [response.teachers]
      submitForm.teacher_id = response.teachers.id
    } else {
      ElMessage.warning('您尚未绑定导师，请先前往"我的导师"页面完成绑定后再提交')
      return
    }
    submitDialogVisible.value = true
  } catch (error) {
    ElMessage.error('获取导师信息失败，请检查网络连接或刷新页面重试')
  }
}

const confirmSubmit = async () => {
  if (!submitForm.teacher_id) {
    ElMessage.warning('请选择导师')
    return
  }
  if (!submitForm.liability_accepted) {
    ElMessage.warning('请接受责任声明')
    return
  }
  
  try {
    await api.post(`/data/${currentData.value.id}/submit`, {
      teacher_id: submitForm.teacher_id,
      liability_accepted: submitForm.liability_accepted
    })
    ElMessage.success('提交审核成功')
    submitDialogVisible.value = false
    fetchData()
  } catch (error) {
    ElMessage.error(error.error || '提交失败')
  }
}

const deleteData = (row) => {
  ElMessageBox.confirm('确定要删除这条数据吗？此操作不可恢复。', '确认删除', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await api.delete(`/data/${row.id}`)
      ElMessage.success('删除成功')
      fetchData()
    } catch (error) {
      ElMessage.error('删除失败')
    }
  })
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

.w-full {
  width: 100%;
}
</style>

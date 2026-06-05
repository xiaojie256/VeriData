<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">我的学生</h2>
      <el-button type="primary" @click="showAddDialog = true">
        <el-icon><Plus /></el-icon>
        添加学生
      </el-button>
    </div>
    
    <el-card>
      <el-table :data="students" v-loading="loading" style="width: 100%">
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="real_name" label="真实姓名" min-width="100" />
        <el-table-column prop="status" label="账户状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'warning'">
              {{ row.status === 'active' ? '正常' : '待激活' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="relation_status" label="绑定状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.relation_status === 'accepted' ? 'success' : 'warning'">
              {{ row.relation_status === 'accepted' ? '已绑定' : '等待确认' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="added_at" label="添加时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.added_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewStudentData(row)" size="small">查看数据</el-button>
            <el-divider direction="vertical" />
            <el-button 
              v-if="row.relation_status === 'accepted'" 
              link type="danger" 
              @click="handleTerminate(row.relation_id)"
              size="small"
            >
              移除学生
            </el-button>
            <el-button 
              v-else 
              link type="warning" 
              @click="handleTerminate(row.relation_id)"
              size="small"
            >
              撤回申请
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    
    <!-- 添加学生对话框 -->
    <el-dialog v-model="showAddDialog" title="添加学生" width="400px">
      <el-form :model="addForm" label-width="80px">
        <el-form-item label="学生账号">
          <el-input v-model="addForm.student_username" placeholder="请输入学生用户名" />
        </el-form-item>
      </el-form>
      <div style="color: #e64545; font-size: 12px; margin-top: 12px;">
        ⚠️ 重要提示：系统采用强绑定机制。请务必输入学生注册时使用的【唯一账号/学号】，输入真实姓名将导致绑定失败。如存在同名学生，只能用账号绑定。
      </div>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" @click="addStudent">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { api } from '../store'

const router = useRouter()
const loading = ref(false)
const students = ref([])
const showAddDialog = ref(false)
const addForm = ref({ student_username: '' })

const formatDate = (date) => dayjs(date).format('YYYY-MM-DD HH:mm')

const fetchStudents = async () => {
  loading.value = true
  try {
    const response = await api.get('/users/my-students')
    students.value = response.students
  } catch (error) {
    ElMessage.error('获取学生列表失败')
  } finally {
    loading.value = false
  }
}

const addStudent = async () => {
  if (!addForm.value.student_username) {
    ElMessage.warning('请输入学生账号')
    return
  }
  
  try {
    await api.post('/users/students', {
      student_username: addForm.value.student_username
    })
    ElMessage.success('添加成功')
    showAddDialog.value = false
    addForm.value.student_username = ''
    fetchStudents()
  } catch (error) {
    ElMessage.error(error.error || '添加失败')
  }
}

const viewStudentData = (row) => {
  // 跳转到数据列表，筛选该学生的数据
  router.push('/data/list')
}

// 🔴 移除学生或撤回申请
const handleTerminate = async (relationId) => {
  try {
    await api.delete(`/users/relations/${relationId}`)
    ElMessage.success('操作成功')
    fetchStudents()
  } catch (error) {
    ElMessage.error(error.error || '操作失败')
  }
}

onMounted(() => {
  fetchStudents()
})
</script>

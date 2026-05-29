<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">用户管理</h2>
    </div>
    
    <!-- 筛选栏 -->
    <el-card class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="角色">
          <el-select v-model="filters.role" placeholder="全部角色" clearable>
            <el-option label="学生" value="student" />
            <el-option label="导师" value="teacher" />
            <el-option label="专家" value="expert" />
            <el-option label="管理员" value="admin" />
            <el-option label="普通用户" value="civilian" />
          </el-select>
        </el-form-item>
        
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部状态" clearable>
            <el-option label="正常" value="active" />
            <el-option label="待验证" value="pending_verification" />
            <el-option label="已封禁" value="suspended" />
          </el-select>
        </el-form-item>
        
        <el-form-item label="搜索">
          <el-input v-model="filters.search" placeholder="用户名/邮箱/姓名" clearable />
        </el-form-item>
        
        <el-form-item>
          <el-button type="primary" @click="fetchData">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    
    <!-- 用户列表 -->
    <el-card>
      <el-table :data="userList" v-loading="loading" style="width: 100%">
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="real_name" label="真实姓名" min-width="100" />
        <el-table-column prop="role" label="角色" width="100">
          <template #default="{ row }">
            <el-tag :type="roleType[row.role]" size="small">{{ roleMap[row.role] }}</el-tag>
          </template>
        </el-table-column>
        
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType[row.status]" size="small">{{ statusMap[row.status] }}</el-tag>
          </template>
        </el-table-column>
        
        <el-table-column prop="email" label="邮箱" min-width="180" />
        <el-table-column prop="quota_total" label="额度" width="120">
          <template #default="{ row }">
            {{ row.quota_used }} / {{ row.quota_total }}
          </template>
        </el-table-column>
        
        <el-table-column prop="id_verified" label="身份验证" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.id_verified" type="success" size="small">已验证</el-tag>
            <el-tag v-else type="info" size="small">未验证</el-tag>
          </template>
        </el-table-column>
        
        <el-table-column prop="created_at" label="注册时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="editUser(row)">编辑</el-button>
            <el-button v-if="row.status === 'pending_verification'" link type="success" @click="verifyUser(row)">审核</el-button>
            <el-button link type="danger" @click="suspendUser(row)">封禁</el-button>
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
    
    <!-- 编辑用户对话框 -->
    <el-dialog v-model="editDialogVisible" title="编辑用户" width="500px">
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="用户名">
          <el-input v-model="editForm.username" disabled />
        </el-form-item>
        <el-form-item label="真实姓名">
          <el-input v-model="editForm.real_name" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="editForm.email" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="editForm.role">
            <el-option label="学生" value="student" />
            <el-option label="导师" value="teacher" />
            <el-option label="专家" value="expert" />
            <el-option label="管理员" value="admin" />
            <el-option label="普通用户" value="civilian" />
          </el-select>
        </el-form-item>
        <el-form-item label="总配额">
          <el-input-number v-model="editForm.quota_total" :min="0" :max="9999" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveUser">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import { api } from '../../store'

const loading = ref(false)
const userList = ref([])
const editDialogVisible = ref(false)
const editForm = reactive({
  id: null,
  username: '',
  real_name: '',
  email: '',
  role: '',
  quota_total: 0
})

const filters = reactive({
  role: '',
  status: '',
  search: ''
})

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0
})

const roleMap = {
  'student': '学生',
  'teacher': '导师',
  'expert': '专家',
  'admin': '管理员',
  'civilian': '普通用户'
}

const roleType = {
  'student': '',
  'teacher': 'success',
  'expert': 'warning',
  'admin': 'danger',
  'civilian': 'info'
}

const statusMap = {
  'active': '正常',
  'pending_verification': '待验证',
  'suspended': '已封禁',
  'inactive': '未激活'
}

const statusType = {
  'active': 'success',
  'pending_verification': 'warning',
  'suspended': 'danger',
  'inactive': 'info'
}

const formatDate = (date) => dayjs(date).format('YYYY-MM-DD HH:mm')

const fetchData = async () => {
  loading.value = true
  try {
    let url = `/admin/users?page=${pagination.page}&limit=${pagination.limit}`
    if (filters.role) url += `&role=${filters.role}`
    if (filters.status) url += `&status=${filters.status}`
    if (filters.search) url += `&search=${filters.search}`
    
    const response = await api.get(url)
    userList.value = response.users
    pagination.total = response.pagination.total
  } catch (error) {
    ElMessage.error('获取用户列表失败')
  } finally {
    loading.value = false
  }
}

const resetFilters = () => {
  filters.role = ''
  filters.status = ''
  filters.search = ''
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

const editUser = (row) => {
  Object.assign(editForm, row)
  editDialogVisible.value = true
}

const saveUser = async () => {
  try {
    await api.post(`/admin/users/${editForm.id}/quota`, {
      quota_total: editForm.quota_total
    })
    ElMessage.success('保存成功')
    editDialogVisible.value = false
    fetchData()
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

const verifyUser = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要审核通过用户 ${row.username} 吗？`, '确认审核', {
      confirmButtonText: '通过',
      cancelButtonText: '拒绝',
      type: 'warning'
    })
    
    await api.post(`/admin/users/${row.id}/verify`, { status: 'active' })
    ElMessage.success('审核通过')
    fetchData()
  } catch {
    // 用户取消
  }
}

const suspendUser = (row) => {
  ElMessageBox.confirm(`确定要封禁用户 ${row.username} 吗？`, '确认封禁', {
    confirmButtonText: '封禁',
    cancelButtonText: '取消',
    type: 'danger'
  }).then(async () => {
    try {
      await api.post(`/admin/users/${row.id}/verify`, { status: 'suspended' })
      ElMessage.success('已封禁')
      fetchData()
    } catch (error) {
      ElMessage.error('操作失败')
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
</style>

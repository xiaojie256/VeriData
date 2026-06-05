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
        
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="editUser(row)">编辑</el-button>
            <el-button v-if="row.status === 'pending_verification'" link type="success" @click="verifyUser(row)">审核通过</el-button>
            <el-button v-if="row.status === 'pending_verification'" link type="danger" @click="rejectUser(row)">驳回</el-button>
            <el-button v-if="row.status === 'active' && !row.id_verified" link type="warning" @click="toggleIdVerified(row, true)">验证身份</el-button>
            <el-button v-if="row.status === 'active' && row.id_verified" link type="info" @click="toggleIdVerified(row, false)">取消验证</el-button>
            <el-button v-if="row.status === 'active'" link type="danger" @click="suspendUser(row)">封禁</el-button>
            <el-button v-if="row.status === 'suspended'" link type="success" @click="activateUser(row)">解封</el-button>
            <el-button link type="danger" @click="deleteUser(row)">删除</el-button>
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

// 激活弹框编辑赋初值
const editUser = (row) => {
  editDialogVisible.value = true
  editForm.id = row.id
  editForm.username = row.username
  editForm.real_name = row.real_name
  editForm.email = row.email
  editForm.role = row.role
  editForm.quota_total = row.quota_total
}

// 执行保存修改与提权操作
const saveUser = async () => {
  try {
    // 调用已经增强健壮性的 PUT 通用更新路由
    await api.put(`/admin/users/${editForm.id}`, {
      username: editForm.username,
      real_name: editForm.real_name,
      email: editForm.email,
      role: editForm.role,         // 下拉选择实现角色一键提权变更
      quota_total: editForm.quota_total // 数字输入框实现额度精准更改
    })
    ElMessage.success('用户信息保存与权限应用成功')
    editDialogVisible.value = false
    fetchData() // 刷新列表查看最新修改数据
  } catch (error) {
    ElMessage.error(error.error || '保存用户信息失败')
  }
}

// 执行高危保底软删除动作
const deleteUser = (row) => {
  ElMessageBox.confirm(
    `警示：确定要软删除用户 "${row.real_name || row.username}" 吗？该操作将阻断其登录状态并封存历史数据！`,
    '高危管理行为警告',
    {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning'
    }
  ).then(async () => {
    try {
      await api.delete(`/admin/users/${row.id}`)
      ElMessage.success('用户已成功执行软删除封存')
      fetchData()
    } catch (error) {
      ElMessage.error(error.error || '删除用户失败')
    }
  }).catch(() => {})
}

const handleSizeChange = (size) => {
  pagination.limit = size
  fetchData()
}

const handlePageChange = (page) => {
  pagination.page = page
  fetchData()
}


const verifyUser = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要审核通过用户 ${row.username} 吗？`, '确认审核', {
      confirmButtonText: '通过',
      cancelButtonText: '取消',
      type: 'warning'
    })

    await api.post(`/admin/users/${row.id}/verify`, { status: 'active' })
    ElMessage.success('审核通过')
    fetchData()
  } catch {
    // 用户取消
  }
}

const rejectUser = async (row) => {
  try {
    const { value: reason } = await ElMessageBox.prompt(`请输入驳回用户 ${row.username} 的原因`, '驳回审核', {
      confirmButtonText: '驳回',
      cancelButtonText: '取消',
      inputPlaceholder: '资料不完整等',
      type: 'error'
    })

    await api.post(`/admin/users/${row.id}/verify`, { status: 'pending_verification', reason: reason || '资料不完整' })
    ElMessage.success('已驳回')
    fetchData()
  } catch {
    // 用户取消
  }
}

const toggleIdVerified = async (row, verified) => {
  const action = verified ? '验证' : '取消验证'
  try {
    await ElMessageBox.confirm(`确定要${action}用户 ${row.username} 的身份吗？`, `确认${action}`, {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: verified ? 'warning' : 'info'
    })

    await api.post(`/admin/users/${row.id}/id-verified`, { id_verified: verified })
    ElMessage.success(verified ? '已标记为已验证' : '已取消身份验证')
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

const activateUser = (row) => {
  ElMessageBox.confirm(`确定要解封用户 ${row.username} 吗？`, '确认解封', {
    confirmButtonText: '解封',
    cancelButtonText: '取消',
    type: 'success'
  }).then(async () => {
    try {
      // 同样调用 verify 接口，将状态改回 active
      await api.post(`/admin/users/${row.id}/verify`, { status: 'active' })
      ElMessage.success('账号解封成功')
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

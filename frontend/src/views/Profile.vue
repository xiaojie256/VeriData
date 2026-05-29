<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">个人中心</h2>
    </div>
    
    <el-row :gutter="20">
      <el-col :span="8">
        <el-card>
          <div class="profile-card">
            <el-avatar :size="100" :src="user?.avatar_url">
              <el-icon :size="50"><UserFilled /></el-icon>
            </el-avatar>
            <h3>{{ user?.real_name || user?.username }}</h3>
            <p class="role-tag">
              <el-tag>{{ roleMap[user?.role] }}</el-tag>
            </p>
            <p class="email">{{ user?.email }}</p>
            
            <el-upload
              class="avatar-uploader"
              action="#"
              :auto-upload="false"
              :show-file-list="false"
              :on-change="handleAvatarChange"
            >
              <el-button type="primary" link>更换头像</el-button>
            </el-upload>
          </div>
        </el-card>
        
        <el-card style="margin-top: 20px;">
          <template #header>
            <span>额度信息</span>
          </template>
          <div class="quota-display">
            <el-progress 
              :percentage="quotaPercent" 
              :color="quotaColors"
              type="dashboard"
            />
            <p>已使用 {{ user?.quota_used || 0 }} / 总额度 {{ user?.quota_total || 0 }}</p>
          </div>
        </el-card>
      </el-col>
      
      <el-col :span="16">
        <el-card>
          <template #header>
            <span>基本信息</span>
          </template>
          
          <el-form :model="profileForm" label-width="100px">
            <el-form-item label="用户名">
              <el-input v-model="profileForm.username" disabled />
            </el-form-item>
            
            <el-form-item label="真实姓名">
              <el-input v-model="profileForm.real_name" />
            </el-form-item>
            
            <el-form-item label="邮箱">
              <el-input v-model="profileForm.email" />
            </el-form-item>
            
            <el-form-item label="手机号">
              <el-input v-model="profileForm.phone" />
            </el-form-item>
            
            <el-form-item>
              <el-button type="primary" @click="saveProfile">保存修改</el-button>
            </el-form-item>
          </el-form>
        </el-card>
        
        <el-card style="margin-top: 20px;">
          <template #header>
            <span>修改密码</span>
          </template>
          
          <el-form :model="passwordForm" :rules="passwordRules" ref="passwordFormRef" label-width="100px">
            <el-form-item label="旧密码" prop="oldPassword">
              <el-input v-model="passwordForm.oldPassword" type="password" show-password />
            </el-form-item>
            
            <el-form-item label="新密码" prop="newPassword">
              <el-input v-model="passwordForm.newPassword" type="password" show-password />
            </el-form-item>
            
            <el-form-item label="确认密码" prop="confirmPassword">
              <el-input v-model="passwordForm.confirmPassword" type="password" show-password />
            </el-form-item>
            
            <el-form-item>
              <el-button type="primary" @click="changePassword">修改密码</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useStore } from 'vuex'
import { ElMessage } from 'element-plus'
import { UserFilled } from '@element-plus/icons-vue'
import { api } from '../store'

const store = useStore()
const passwordFormRef = ref()

const user = computed(() => store.state.user)

const quotaPercent = computed(() => {
  const total = user.value?.quota_total || 1
  const used = user.value?.quota_used || 0
  return Math.round((used / total) * 100)
})

const quotaColors = [
  { color: '#67c23a', percentage: 50 },
  { color: '#e6a23c', percentage: 80 },
  { color: '#f56c6c', percentage: 100 }
]

const roleMap = {
  'student': '学生',
  'teacher': '导师',
  'expert': '专家',
  'admin': '管理员',
  'civilian': '普通用户'
}

const profileForm = ref({
  username: '',
  real_name: '',
  email: '',
  phone: ''
})

const passwordForm = ref({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const validatePass = (rule, value, callback) => {
  if (value !== passwordForm.value.newPassword) {
    callback(new Error('两次输入密码不一致'))
  } else {
    callback()
  }
}

const passwordRules = {
  oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码长度至少为6个字符', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    { validator: validatePass, trigger: 'blur' }
  ]
}

const handleAvatarChange = async (file) => {
  try {
    const formData = new FormData()
    formData.append('avatar', file.raw)
    
    await api.post('/auth/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    
    ElMessage.success('头像上传成功')
    await store.dispatch('fetchUser')
  } catch (error) {
    ElMessage.error('头像上传失败')
  }
}

const saveProfile = async () => {
  try {
    await api.put('/users/me', profileForm.value)
    ElMessage.success('保存成功')
    await store.dispatch('fetchUser')
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

const changePassword = async () => {
  try {
    await passwordFormRef.value.validate()
    await api.post('/auth/change-password', {
      oldPassword: passwordForm.value.oldPassword,
      newPassword: passwordForm.value.newPassword
    })
    ElMessage.success('密码修改成功')
    passwordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
  } catch (error) {
    ElMessage.error(error.error || '密码修改失败')
  }
}

onMounted(() => {
  if (user.value) {
    profileForm.value = {
      username: user.value.username,
      real_name: user.value.real_name || '',
      email: user.value.email || '',
      phone: user.value.phone || ''
    }
  }
})
</script>

<style scoped>
.profile-card {
  text-align: center;
  padding: 20px;
}

.profile-card h3 {
  margin: 15px 0 5px;
}

.role-tag {
  margin: 5px 0;
}

.email {
  color: #909399;
  font-size: 14px;
}

.avatar-uploader {
  margin-top: 15px;
}

.quota-display {
  text-align: center;
}
</style>

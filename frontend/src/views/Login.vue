<template>
  <div class="login-container">
    <div class="login-box">
      <div class="login-header">
        <h1>鉴真数据</h1>
        <p>科研数据验证平台</p>
      </div>
      
      <el-form 
        ref="formRef" 
        :model="form" 
        :rules="rules" 
        @submit.prevent="handleLogin"
        class="login-form"
      >
        <el-form-item prop="account">
          <el-input
            v-model="form.account"
            placeholder="用户名或邮箱"
            size="large"
            :prefix-icon="User"
          />
        </el-form-item>
        
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            size="large"
            :prefix-icon="Lock"
            show-password
            @keyup.enter="handleLogin"
          />
        </el-form-item>
        
        <el-form-item>
          <el-button
            type="primary"
            size="large"
            :loading="loading"
            @click="handleLogin"
            class="login-btn"
          >
            登录
          </el-button>
        </el-form-item>
      </el-form>
      
      <div class="login-footer">
        <el-link type="primary" @click="$router.push('/register')">还没有账号？立即注册</el-link>
        <el-link type="info" style="margin-left: 20px;" @click="openResetModal">忘记密码？</el-link>
      </div>
    </div>
    
    <div class="login-bg">
      <div class="bg-content">
        <h2>多重检测机制</h2>
        <p>AI辅助 + 导师一审 + 专家盲审</p>
        <p>确保科研数据的真实性和可靠性</p>
      </div>
    </div>
  </div>

  <el-dialog v-model="showResetDialog" title="安全重置密码" width="460px" append-to-body>
    <el-form ref="resetFormRef" :model="resetForm" :rules="resetRules" label-width="0px">
      <el-form-item prop="email">
        <el-input v-model="resetForm.email" placeholder="请输入注册绑定的邮箱" :prefix-icon="Message" size="large" />
      </el-form-item>
      
      <el-form-item prop="code">
        <div style="display: flex; gap: 10px; width: 100%;">
          <el-input v-model="resetForm.code" placeholder="6位邮箱验证码" size="large" />
          <el-button :disabled="resetCountdown > 0" @click="sendResetCode" size="large">
            {{ resetCountdown > 0 ? `${resetCountdown}s 后重发` : '获取验证码' }}
          </el-button>
        </div>
      </el-form-item>
      
      <el-form-item prop="newPassword">
        <el-input v-model="resetForm.newPassword" type="password" placeholder="请输入新密码（需同时包含字母和数字）" :prefix-icon="Lock" show-password size="large" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showResetDialog = false">取消</el-button>
      <el-button type="primary" :loading="resetLoading" @click="handleResetPassword">确认修改</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, onUnmounted } from 'vue' // 修改：引入 onUnmounted
import { useRouter } from 'vue-router'
import { useStore } from 'vuex'
import { ElMessage } from 'element-plus'
import { User, Lock, Message } from '@element-plus/icons-vue' // 修改：引入 Message 图标
import { api } from '@/store' // 新增：引入 Axios 实例组件

const router = useRouter()
const store = useStore()
const formRef = ref()
const loading = ref(false)

const form = reactive({
  account: '',
  password: ''
})

const rules = {
  account: [{ required: true, message: '请输入用户名或邮箱', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

const handleLogin = async () => {
  try {
    await formRef.value.validate()
    loading.value = true
    
    await store.dispatch('login', form)
    ElMessage.success('登录成功')
    router.push('/dashboard')
  } catch (error) {
    if (error === false) return
    ElMessage.error(error.error || '账号或密码错误')
  } finally {
    loading.value = false
  }
}

// ==================== 新增：忘记密码核心业务控制流 ====================
const showResetDialog = ref(false)
const resetLoading = ref(false)
const resetCountdown = ref(0)
const resetFormRef = ref(null)
let resetTimer = null

const resetForm = reactive({
  email: '',
  code: '',
  newPassword: ''
})

const resetRules = {
  email: [
    { required: true, message: '请输入邮箱地址', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' }
  ],
  code: [
    { required: true, message: '请输入验证码', trigger: 'blur' },
    { len: 6, message: '验证码必须为6位数字', trigger: 'blur' }
  ],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码长度至少为6个字符', trigger: 'blur' },
    { pattern: /^(?=.*[a-zA-Z])(?=.*\d)/, message: '密码必须同时包含字母与数字', trigger: 'blur' }
  ]
}

const openResetModal = () => {
  showResetDialog.value = true
  if (resetFormRef.value) resetFormRef.value.resetFields()
}

// 唤醒发信服务
const sendResetCode = async () => {
  if (!resetForm.email) {
    ElMessage.warning('请先输入邮箱地址')
    return
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(resetForm.email)) {
    ElMessage.warning('请输入正确的邮箱格式')
    return
  }

  try {
    await api.post('/auth/send-code', {
      email: resetForm.email,
      type: 'reset'
    })
    ElMessage.success('重置验证码已发往您的邮箱，请注意查收')
    
    resetCountdown.value = 60
    resetTimer = setInterval(() => {
      resetCountdown.value--
      if (resetCountdown.value <= 0) {
        clearInterval(resetTimer)
      }
    }, 1000)
  } catch (error) {
    ElMessage.error(error.error || '验证码发送失败')
  }
}

// 提交密码重置
const handleResetPassword = async () => {
  if (!resetFormRef.value) return
  try {
    await resetFormRef.value.validate()
    resetLoading.value = true
    
    await api.post('/auth/reset-password', {
      email: resetForm.email,
      code: resetForm.code,
      newPassword: resetForm.newPassword
    })
    
    ElMessage.success('密码重置成功，请使用新密码登录')
    showResetDialog.value = false
  } catch (error) {
    if (error === false) return
    ElMessage.error(error.error || '密码重置失败')
  } finally {
    resetLoading.value = false
  }
}

onUnmounted(() => {
  if (resetTimer) clearInterval(resetTimer)
})
// ====================================================================
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.login-box {
  width: 420px;
  background: white;
  padding: 40px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.login-header {
  text-align: center;
  margin-bottom: 40px;
}

.login-header h1 {
  font-size: 32px;
  color: #303133;
  margin-bottom: 8px;
}

.login-header p {
  color: #909399;
  font-size: 14px;
}

.login-form {
  .el-form-item {
    margin-bottom: 20px;
  }
}

.login-btn {
  width: 100%;
}

.login-footer {
  text-align: center;
  margin-top: 20px;
}

.login-bg {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  padding: 40px;
}

.bg-content {
  text-align: center;
}

.bg-content h2 {
  font-size: 48px;
  margin-bottom: 20px;
}

.bg-content p {
  font-size: 20px;
  margin: 10px 0;
  opacity: 0.9;
}
</style>
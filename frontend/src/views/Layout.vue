<template>
  <el-container class="layout-container">
    <!-- 侧边栏 -->
    <el-aside width="240px" class="sidebar">
      <div class="logo">
        <el-icon size="32" color="#409EFF"><DataAnalysis /></el-icon>
        <span>鉴真数据</span>
      </div>
      
      <el-menu
        :default-active="$route.path"
        router
        class="sidebar-menu"
        background-color="#304156"
        text-color="#bfcbd9"
        active-text-color="#409EFF"
      >
        <template v-for="route in menuRoutes" :key="route.path">
          <el-menu-item v-if="!route.children && !route.meta?.hidden" :index="'/' + route.path">
            <el-icon><component :is="route.meta?.icon || 'Menu'" /></el-icon>
            <span>{{ route.meta?.title }}</span>
          </el-menu-item>
        </template>
        
        <!-- 审核菜单（教师/专家/管理员可见） -->
        <el-sub-menu v-if="['teacher', 'expert', 'admin'].includes(userRole)" index="/review">
          <template #title>
            <el-icon><Check /></el-icon>
            <span>数据审核</span>
          </template>
          <el-menu-item index="/review/pending">
            <el-icon><Clock /></el-icon>
            <span>待审核</span>
            <el-badge v-if="pendingCount > 0" :value="pendingCount" class="menu-badge" />
          </el-menu-item>
          <el-menu-item index="/review/history">
            <el-icon><DocumentChecked /></el-icon>
            <span>审核历史</span>
          </el-menu-item>
        </el-sub-menu>
        
        <!-- 管理菜单（仅管理员可见） -->
        <el-sub-menu v-if="userRole === 'admin'" index="/admin">
          <template #title>
            <el-icon><Setting /></el-icon>
            <span>系统管理</span>
          </template>
          <el-menu-item index="/admin/dashboard">管理仪表盘</el-menu-item>
          <el-menu-item index="/admin/users">用户管理</el-menu-item>
          <el-menu-item index="/admin/data">数据管理</el-menu-item>
          <el-menu-item index="/admin/logs">系统日志</el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-aside>
    
    <el-container>
      <!-- 顶部导航 -->
      <el-header class="header">
        <div class="header-left">
          <breadcrumb />
        </div>
        
        <div class="header-right">
          <!-- 通知 -->
          <el-badge :value="unreadCount" :hidden="unreadCount === 0" class="notification-badge">
            <el-icon size="20" @click="$router.push('/notifications')" class="cursor-pointer">
              <Bell />
            </el-icon>
          </el-badge>
          
          <!-- 用户下拉 -->
          <el-dropdown @command="handleCommand">
            <div class="user-info">
              <el-avatar :size="32" :src="userAvatar">
                <el-icon><UserFilled /></el-icon>
              </el-avatar>
              <span class="username">{{ userName }}</span>
              <el-icon><ArrowDown /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">个人中心</el-dropdown-item>
                <el-dropdown-item command="quota">额度: {{ user?.quota_used }}/{{ user?.quota_total }}</el-dropdown-item>
                <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      
      <!-- 主内容区 -->
      <el-main class="main-content">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStore } from 'vuex'
import { ElMessage, ElMessageBox } from 'element-plus'
import { 
  DataAnalysis, Check, Clock, DocumentChecked, Setting, 
  Bell, UserFilled, ArrowDown 
} from '@element-plus/icons-vue'
import Breadcrumb from '../components/Breadcrumb.vue'
import { api } from '../store'
const route = useRoute()
const router = useRouter()
const store = useStore()

const user = computed(() => store.state.user)
const userName = computed(() => store.getters.userName)
const userAvatar = computed(() => store.getters.userAvatar)
const userRole = computed(() => store.getters.userRole)
const unreadCount = computed(() => store.state.unreadCount)
const pendingCount = ref(0)

// 过滤后的菜单路由
const menuRoutes = computed(() => {
  return route.matched[0]?.children?.filter(r => {
    if (r.meta?.hidden) return false
    if (r.meta?.roles && !r.meta.roles.includes(userRole.value)) return false
    return true
  }) || []
})

const handleCommand = (command) => {
  switch (command) {
    case 'profile':
      router.push('/profile')
      break
    case 'logout':
      ElMessageBox.confirm('确定要退出登录吗？', '提示', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }).then(() => {
        store.dispatch('logout')
        router.push('/login')
        ElMessage.success('已退出登录')
      })
      break
  }
}

let pollTimer = null

// 获取待审核数量
const fetchPendingCount = async () => {
  try {
    // 仅获取未读通知计数，避免每次轮询都拉取完整通知列表
    const response = await api.get('/users/notifications/list?unread_only=true&limit=1')
    store.commit('SET_UNREAD_COUNT', response.unread_count || 0)
  } catch (error) {
    // 静默失败，避免频繁弹窗干扰用户
  }
}

onMounted(() => {
  fetchPendingCount()
  // 定时刷新通知
  pollTimer = setInterval(fetchPendingCount, 60000)
})

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})
</script>

<style scoped>
.layout-container {
  min-height: 100vh;
}

.sidebar {
  background-color: #304156;
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 18px;
  font-weight: bold;
  border-bottom: 1px solid #1f2d3d;
}

.logo span {
  margin-left: 10px;
}

.sidebar-menu {
  border-right: none;
  height: calc(100vh - 60px);
}

.menu-badge {
  margin-left: 10px;
}

.header {
  background: white;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.08);
  position: fixed;
  top: 0;
  right: 0;
  left: 240px;
  z-index: 100;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 20px;
}

.notification-badge {
  cursor: pointer;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.username {
  font-size: 14px;
  color: #606266;
}

.main-content {
  margin-top: 60px;
  margin-left: 240px;
  background: #f5f7fa;
  min-height: calc(100vh - 60px);
}

.cursor-pointer {
  cursor: pointer;
}
</style>

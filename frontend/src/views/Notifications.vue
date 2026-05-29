<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">消息通知</h2>
      <el-button v-if="unreadCount > 0" @click="markAllRead">全部标为已读</el-button>
    </div>
    
    <el-card>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="全部消息" name="all">
          <notification-list :notifications="allNotifications" @read="markRead" />
        </el-tab-pane>
        <el-tab-pane :label="`未读消息 (${unreadCount})`" name="unread">
          <notification-list :notifications="unreadNotifications" @read="markRead" />
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, h } from 'vue'
import { ElMessage, ElTag, ElLink, ElEmpty } from 'element-plus'
import { api } from '../store'

const activeTab = ref('all')
const notifications = ref([])
const unreadCount = ref(0)

const allNotifications = computed(() => notifications.value)
const unreadNotifications = computed(() => notifications.value.filter(n => !n.is_read))

const typeMap = {
  'system': '系统',
  'review': '审核',
  'data': '数据',
  'security': '安全',
  'quota': '配额'
}

typeMap.color = {
  'system': '',
  'review': 'warning',
  'data': 'success',
  'security': 'danger',
  'quota': 'info'
}

const NotificationList = {
  props: ['notifications'],
  emits: ['read'],
  setup(props, { emit }) {
    return () => {
      if (!props.notifications.length) {
        return h(ElEmpty, { description: '暂无消息' })
      }
      
      return h('div', { class: 'notification-list' },
        props.notifications.map(notification => 
          h('div', { 
            class: ['notification-item', { unread: !notification.is_read }],
            key: notification.id
          }, [
            h('div', { class: 'notification-header' }, [
              h(ElTag, { 
                size: 'small', 
                type: typeMap.color[notification.type] || '' 
              }, () => typeMap[notification.type] || notification.type),
              h('span', { class: 'notification-time' }, 
                new Date(notification.created_at).toLocaleString()
              )
            ]),
            h('h4', { class: 'notification-title' }, notification.title),
            h('p', { class: 'notification-content' }, notification.content),
            !notification.is_read && h(ElLink, {
              type: 'primary',
              onClick: () => emit('read', notification.id)
            }, () => '标为已读')
          ])
        )
      )
    }
  }
}

const fetchNotifications = async () => {
  try {
    const response = await api.get('/users/notifications/list')
    notifications.value = response.notifications
    unreadCount.value = response.unread_count
  } catch (error) {
    ElMessage.error('获取通知失败')
  }
}

const markRead = async (id) => {
  try {
    await api.post(`/users/notifications/${id}/read`)
    await fetchNotifications()
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

const markAllRead = async () => {
  try {
    await api.post('/users/notifications/read-all')
    ElMessage.success('已全部标为已读')
    await fetchNotifications()
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

onMounted(() => {
  fetchNotifications()
})
</script>

<style scoped>
.notification-list {
  .notification-item {
    padding: 20px;
    border-bottom: 1px solid #ebeef5;
    transition: background-color 0.3s;
    
    &:hover {
      background-color: #f5f7fa;
    }
    
    &.unread {
      background-color: #f0f9ff;
      border-left: 3px solid #409eff;
    }
  }
  
  .notification-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  
  .notification-time {
    color: #909399;
    font-size: 13px;
  }
  
  .notification-title {
    font-size: 16px;
    margin-bottom: 8px;
    color: #303133;
  }
  
  .notification-content {
    color: #606266;
    line-height: 1.6;
  }
}
</style>

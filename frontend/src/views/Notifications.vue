<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">消息通知</h2>
      <el-button v-if="unreadCount > 0" @click="markAllRead">全部标为已读</el-button>
    </div>

    <el-card>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="全部消息" name="all">
          <notification-list :notifications="notifications" @read="markRead" />
        </el-tab-pane>
        <el-tab-pane :label="`未读消息 (${unreadCount})`" name="unread">
          <notification-list :notifications="notifications" @read="markRead" />
        </el-tab-pane>
      </el-tabs>

      <div class="pagination-container" v-if="pagination.total > pagination.limit">
        <el-pagination
          v-model:current-page="pagination.page"
          :page-size="pagination.limit"
          :total="pagination.total"
          layout="total, prev, pager, next"
          @current-change="fetchNotifications"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted, h } from 'vue'
import { useStore } from 'vuex'
import { ElMessage, ElTag, ElLink, ElEmpty } from 'element-plus'
import { api } from '../store'

const store = useStore()
const activeTab = ref('all')
const notifications = ref([])
const unreadCount = ref(0)

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0
})

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
    const unreadOnly = activeTab.value === 'unread' ? 'true' : 'false'
    const response = await api.get(`/users/notifications/list?page=${pagination.page}&limit=${pagination.limit}&unread_only=${unreadOnly}`)
    notifications.value = response.notifications
    unreadCount.value = response.unread_count
    pagination.total = response.pagination?.total || 0
  } catch (error) {
    ElMessage.error('获取通知失败')
  }
}

const markRead = async (id) => {
  try {
    await store.dispatch('markNotificationRead', id)
    await fetchNotifications()
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

const markAllRead = async () => {
  try {
    await api.post('/users/notifications/read-all')
    ElMessage.success('已全部标为已读')
    await store.dispatch('fetchNotifications')
    await fetchNotifications()
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

watch(activeTab, () => {
  pagination.page = 1
  fetchNotifications()
})

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

.pagination-container {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
</style>

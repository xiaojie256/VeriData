<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">我的导师</h2>
    </div>

    <!-- 🔴 导师申请通知 -->
    <el-card v-if="pendingTeachers.length > 0" style="margin-bottom: 20px;">
      <template #header>
        <div class="card-header">
          <span>🔔 收到导师绑定申请（{{ pendingTeachers.length }}件）</span>
        </div>
      </template>
      <el-alert
        v-for="item in pendingTeachers"
        :key="item.relation_id"
        :title="`${item.real_name || item.username} 老师申请认领你为学生`"
        type="warning"
        show-icon
        style="margin-bottom: 10px;"
      >
        <template #default>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>邮箱: {{ item.email }}</span>
            <div>
              <el-button type="success" size="small" @click="handleInvitation(item.relation_id, 'accept')">接受</el-button>
              <el-button type="danger" size="small" @click="handleInvitation(item.relation_id, 'reject')">拒绝</el-button>
            </div>
          </div>
        </template>
      </el-alert>
    </el-card>

    <!-- 🔴 已关联导师 -->
    <el-card v-if="teacher">
      <template #header>
        <div class="card-header">
          <span>✅ 我的导师</span>
        </div>
      </template>
      <div class="teacher-info">
        <el-avatar :size="80" :src="teacher.avatar_url">
          <el-icon :size="40"><UserFilled /></el-icon>
        </el-avatar>
        <div class="teacher-details">
          <h3>{{ teacher.real_name || teacher.username }}</h3>
          <p><el-icon><Message /></el-icon> {{ teacher.email }}</p>
          <p>
            <el-tag type="success">
              已关联
            </el-tag>
          </p>
          <div style="margin-top: 15px;">
            <el-button type="danger" size="small" @click="handleUnbind(teacher.relation_id)">
              解除师生关系
            </el-button>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 空状态 -->
    <el-card v-else>
      <el-empty description="您还没有关联导师">
        <template #default>
          <p style="color: #909399; margin-top: 10px;">
            请联系您的导师，让其将您添加为学生
          </p>
        </template>
      </el-empty>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { UserFilled, Message } from '@element-plus/icons-vue'
import { api } from '../store'

const teacher = ref(null)
const pendingTeachers = ref([])

const fetchTeacherData = async () => {
  try {
    const response = await api.get('/users/my-teacher')
    teacher.value = response.teachers

    const pendingRes = await api.get('/users/pending-teachers')
    pendingTeachers.value = pendingRes.invitations || []
  } catch (error) {
    ElMessage.error('获取导师信息失败')
  }
}

const handleInvitation = async (relationId, action) => {
  try {
    await api.put(`/users/relations/${relationId}`, { action })
    ElMessage.success(action === 'accept' ? '已接受导师绑定邀请' : '已拒绝该申请')
    fetchTeacherData()
  } catch (error) {
    ElMessage.error(error.error || '操作失败')
  }
}

const handleUnbind = async (relationId) => {
  try {
    await api.delete(`/users/relations/${relationId}`)
    ElMessage.success('师生关系已解除')
    fetchTeacherData()
  } catch (error) {
    ElMessage.error(error.error || '解除失败')
  }
}

onMounted(() => {
  fetchTeacherData()
})
</script>

<style scoped>
.teacher-info {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px;
}

.teacher-details {
  flex: 1;
}

.teacher-details h3 {
  margin: 0 0 10px 0;
  font-size: 18px;
}

.teacher-details p {
  margin: 5px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>

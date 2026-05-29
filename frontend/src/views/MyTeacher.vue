<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">我的导师</h2>
    </div>
    
    <el-card v-if="teacher">
      <div class="teacher-info">
        <el-avatar :size="80" :src="teacher.avatar_url">
          <el-icon :size="40"><UserFilled /></el-icon>
        </el-avatar>
        <div class="teacher-details">
          <h3>{{ teacher.real_name || teacher.username }}</h3>
          <p><el-icon><Message /></el-icon> {{ teacher.email }}</p>
          <p>
            <el-tag :type="teacher.relation_status === 'active' ? 'success' : 'warning'">
              {{ teacher.relation_status === 'active' ? '已关联' : '待确认' }}
            </el-tag>
          </p>
        </div>
      </div>
    </el-card>
    
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

const fetchTeacher = async () => {
  try {
    const response = await api.get('/users/my-teacher')
    teacher.value = response.teachers
  } catch (error) {
    ElMessage.error('获取导师信息失败')
  }
}

onMounted(() => {
  fetchTeacher()
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
  h3 {
    margin-bottom: 10px;
  }
  
  p {
    color: #606266;
    margin: 5px 0;
    display: flex;
    align-items: center;
    gap: 5px;
  }
}
</style>

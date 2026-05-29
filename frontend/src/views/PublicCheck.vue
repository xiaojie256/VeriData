<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">公开数据检测</h2>
      <p class="subtitle">无需登录，快速检测您的数据质量</p>
    </div>
    
    <el-row :gutter="20">
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>输入数据内容</span>
          </template>
          
          <el-tabs v-model="inputMode">
            <el-tab-pane label="粘贴数据" name="paste">
              <el-input
                v-model="dataContent"
                type="textarea"
                :rows="15"
                placeholder="请粘贴CSV格式的数据内容，第一行为表头...&#10;例如：&#10;姓名,年龄,分数&#10;张三,20,85&#10;李四,21,90"
              />
            </el-tab-pane>
            <el-tab-pane label="上传文件" name="upload">
              <el-upload
                drag
                action="#"
                :auto-upload="false"
                :on-change="handleFileChange"
                accept=".csv,.txt"
              >
                <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                <div class="el-upload__text">
                  拖拽文件到此处或 <em>点击上传</em>
                </div>
              </el-upload>
            </el-tab-pane>
          </el-tabs>
          
          <div class="check-actions">
            <el-button type="primary" :loading="checking" @click="startCheck" size="large">
              <el-icon><Search /></el-icon>
              开始检测
            </el-button>
            <el-button @click="clearData" size="large">清空</el-button>
          </div>
          
          <el-alert
            title="声明"
            description="本检测服务仅提供基础数据质量分析，检测结果仅供参考。对于重要研究数据，建议注册使用完整的多重审核服务。"
            type="info"
            show-icon
            :closable="false"
            style="margin-top: 20px;"
          />
        </el-card>
      </el-col>
      
      <el-col :span="12">
        <el-card v-if="result">
          <template #header>
            <div class="result-header">
              <span>检测结果</span>
              <el-tag :type="resultType">{{ resultTitle }}</el-tag>
            </div>
          </template>
          
          <!-- 检测概要 -->
          <div class="result-summary">
            <h4>数据概览</h4>
            <el-descriptions :column="2" border>
              <el-descriptions-item label="列数">{{ result.columns?.length || 0 }}</el-descriptions-item>
              <el-descriptions-item label="行数">{{ result.rows || 0 }}</el-descriptions-item>
              <el-descriptions-item label="是否有效" :span="2">
                <el-tag :type="result.is_valid ? 'success' : 'danger'">
                  {{ result.is_valid ? '有效' : '无效' }}
                </el-tag>
              </el-descriptions-item>
            </el-descriptions>
          </div>
          
          <!-- 数据预览 -->
          <div v-if="result.preview?.length" class="result-preview">
            <h4>数据预览（前5行）</h4>
            <el-table :data="result.preview" size="small" border>
              <el-table-column 
                v-for="col in result.columns" 
                :key="col" 
                :prop="col" 
                :label="col" 
                min-width="100"
              />
            </el-table>
          </div>
          
          <!-- 问题列表 -->
          <div v-if="result.issues?.length" class="result-issues">
            <h4>发现的问题</h4>
            <el-alert
              v-for="(issue, idx) in result.issues"
              :key="idx"
              :title="issue"
              type="warning"
              show-icon
              :closable="false"
              style="margin-bottom: 10px;"
            />
          </div>
          
          <!-- 建议 -->
          <div class="result-suggestions">
            <h4>改进建议</h4>
            <el-timeline>
              <el-timeline-item type="primary">
                注册账号使用完整的多重审核服务
              </el-timeline-item>
              <el-timeline-item type="primary">
                确保数据格式统一规范
              </el-timeline-item>
              <el-timeline-item type="primary">
                完善数据描述信息
              </el-timeline-item>
            </el-timeline>
          </div>
        </el-card>
        
        <el-card v-else>
          <el-empty description="请输入数据并点击检测按钮">
            <template #image>
              <el-icon :size="60" color="#909399"><Search /></el-icon>
            </template>
          </el-empty>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, Search } from '@element-plus/icons-vue'
import axios from 'axios'

const API_URL = process.env.VUE_APP_API_URL || 'http://localhost:3000/api'

const inputMode = ref('paste')
const dataContent = ref('')
const checking = ref(false)
const result = ref(null)

const resultType = computed(() => {
  if (!result.value?.is_valid) return 'danger'
  if (result.value?.issues?.length > 0) return 'warning'
  return 'success'
})

const resultTitle = computed(() => {
  if (!result.value?.is_valid) return '检测失败'
  if (result.value?.issues?.length > 0) return '发现问题'
  return '数据正常'
})

const handleFileChange = (file) => {
  const reader = new FileReader()
  reader.onload = (e) => {
    dataContent.value = e.target.result
    inputMode.value = 'paste'
  }
  reader.readAsText(file.raw)
}

const startCheck = async () => {
  if (!dataContent.value.trim()) {
    ElMessage.warning('请输入数据内容')
    return
  }
  
  checking.value = true
  try {
    const response = await axios.post(`${API_URL}/ai/public-check`, {
      data_content: dataContent.value
    })
    result.value = response.data
  } catch (error) {
    ElMessage.error('检测失败，请稍后重试')
  } finally {
    checking.value = false
  }
}

const clearData = () => {
  dataContent.value = ''
  result.value = null
}
</script>

<style scoped>
.subtitle {
  color: #909399;
  margin-top: 5px;
}

.check-actions {
  margin-top: 20px;
  display: flex;
  gap: 10px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.result-summary, .result-preview, .result-issues, .result-suggestions {
  margin-bottom: 20px;
}

.result-summary h4, .result-preview h4, .result-issues h4, .result-suggestions h4 {
  margin-bottom: 15px;
}
</style>

<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">数据上传</h2>
      <el-alert
        title="上传说明"
        description="请确保数据真实可靠，上传后将进行AI自动检测和多重人工审核。每个文件将消耗1个额度。"
        type="info"
        :closable="false"
        show-icon
        style="max-width: 600px;"
      />
    </div>
    
    <el-row :gutter="20">
      <el-col :span="16">
        <el-card>
          <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
            <el-form-item label="数据标题" prop="title">
              <el-input v-model="form.title" placeholder="请输入数据标题" />
            </el-form-item>
            
            <el-form-item label="数据描述" prop="description">
              <el-input 
                v-model="form.description" 
                type="textarea" 
                :rows="4"
                placeholder="描述数据的来源、采集方法、实验条件等信息" 
              />
            </el-form-item>
            
            <el-form-item label="数据类型" prop="data_type">
              <el-select v-model="form.data_type" placeholder="选择数据类型" class="w-full">
                <el-option label="原始数据" value="raw" />
                <el-option label="处理数据" value="processed" />
                <el-option label="分析结果" value="analysis" />
                <el-option label="总结报告" value="summary" />
              </el-select>
            </el-form-item>
            
            <el-form-item label="可见性" prop="visibility">
              <el-radio-group v-model="form.visibility">
                <el-radio label="private">私有（仅自己和审核人员可见）</el-radio>
                <el-radio label="limited">受限（指定人员可见）</el-radio>
                <el-radio label="public">公开（审核通过后公开）</el-radio>
              </el-radio-group>
            </el-form-item>
            
            <el-form-item label="责任声明">
              <el-checkbox v-model="liabilityAccepted">
                我确认此数据由我/我们团队真实采集，对数据的真实性和合法性负责。
                如有虚假数据，愿意承担相应责任。
              </el-checkbox>
            </el-form-item>
            
            <el-form-item label="上传文件" prop="file">
              <el-upload
                ref="uploadRef"
                class="upload-area"
                drag
                action="#"
                :auto-upload="false"
                :on-change="handleFileChange"
                :on-remove="handleFileRemove"
                :limit="1"
                accept=".csv,.xlsx,.xls,.json,.txt,.pdf,.zip"
              >
                <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                <div class="el-upload__text">
                  拖拽文件到此处或 <em>点击上传</em>
                </div>
                <template #tip>
                  <div class="el-upload__tip">
                    支持格式: CSV, Excel, JSON, TXT, PDF, ZIP | 最大100MB
                  </div>
                </template>
              </el-upload>
            </el-form-item>
            
            <el-form-item>
              <el-button type="primary" :loading="uploading" @click="handleSubmit" :disabled="!liabilityAccepted">
                上传并提交
              </el-button>
              <el-button @click="$router.push('/data/list')">取消</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
      
      <el-col :span="8">
        <el-card>
          <template #header>
            <span>额度信息</span>
          </template>
          <div class="quota-info">
            <el-progress 
              :percentage="quotaPercent" 
              :color="quotaColor"
              :stroke-width="15"
            />
            <p class="quota-text">
              已使用 {{ user?.quota_used || 0 }} / 总额度 {{ user?.quota_total || 0 }}
            </p>
            <p v-if="quotaPercent >= 80" class="quota-warning">
              <el-icon><Warning /></el-icon>
              额度即将用完，请合理规划使用
            </p>
          </div>
        </el-card>
        
        <el-card style="margin-top: 20px;">
          <template #header>
            <span>上传规范</span>
          </template>
          <ul class="guidelines">
            <li>数据文件需真实可靠</li>
            <li>数据格式需统一规范</li>
            <li>建议上传原始数据文件</li>
            <li>文件大小不超过100MB</li>
            <li>每个文件消耗1个额度</li>
          </ul>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useStore } from 'vuex'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { UploadFilled, Warning } from '@element-plus/icons-vue'
import { api } from '../../store'

const store = useStore()
const router = useRouter()
const formRef = ref()
const uploadRef = ref()
const uploading = ref(false)
const liabilityAccepted = ref(false)
const selectedFile = ref(null)

const user = computed(() => store.state.user)
const quotaPercent = computed(() => {
  const total = user.value?.quota_total || 1
  const used = user.value?.quota_used || 0
  return Math.round((used / total) * 100)
})

const quotaColor = computed(() => {
  if (quotaPercent.value >= 90) return '#f56c6c'
  if (quotaPercent.value >= 70) return '#e6a23c'
  return '#409eff'
})

const form = reactive({
  title: '',
  description: '',
  data_type: 'raw',
  visibility: 'private',
  file: null
})

const rules = {
  title: [{ required: true, message: '请输入数据标题', trigger: 'blur' }],
  data_type: [{ required: true, message: '请选择数据类型', trigger: 'change' }],
  visibility: [{ required: true, message: '请选择可见性', trigger: 'change' }]
}

const handleFileChange = (file) => {
  selectedFile.value = file.raw
}

const handleFileRemove = () => {
  selectedFile.value = null
}

const handleSubmit = async () => {
  if (!selectedFile.value) {
    ElMessage.warning('请选择要上传的文件')
    return
  }
  
  if (!liabilityAccepted.value) {
    ElMessage.warning('请接受责任声明')
    return
  }
  
  try {
    await formRef.value.validate()
    uploading.value = true
    
    const formData = new FormData()
    formData.append('file', selectedFile.value)
    formData.append('title', form.title)
    formData.append('description', form.description)
    formData.append('data_type', form.data_type)
    formData.append('visibility', form.visibility)
    formData.append('liability_accepted', liabilityAccepted.value)
    
    const response = await api.post('/data/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })
    
    ElMessage.success('上传成功，即将进行AI检测')
    
    // 触发AI分析
    try {
      await api.post(`/ai/analyze/${response.data_id}`)
    } catch {
      // AI分析失败不影响主流程
    }
    
    // 刷新用户额度信息
    await store.dispatch('fetchUser')
    
    router.push(`/data/${response.data_id}`)
  } catch (error) {
    ElMessage.error(error.error || '上传失败')
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.w-full {
  width: 100%;
}

.upload-area {
  width: 100%;
}

.quota-info {
  text-align: center;
}

.quota-text {
  margin-top: 10px;
  color: #606266;
}

.quota-warning {
  color: #e6a23c;
  font-size: 13px;
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}

.guidelines {
  padding-left: 20px;
  margin: 0;
  color: #606266;
  line-height: 2;
}

.guidelines li {
  margin-bottom: 5px;
}
</style>

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
                <el-radio label="private">私有（仅自己、管理员和审核人员可见）</el-radio>
                <el-radio label="limited">受限（指定人员可见）</el-radio>
                <el-radio label="public">公开（最终审核通过后公开）</el-radio>
              </el-radio-group>

              <el-alert
                v-if="form.visibility === 'private'"
                title="私有数据仅提交者本人、当前审核链人员和管理员可见。"
                type="info"
                :closable="false"
                show-icon
                class="visibility-tip"
              />

              <el-alert
                v-else-if="form.visibility === 'public'"
                title="公开数据只有终审通过后才会进入公开列表；审核未完成前不会公开。"
                type="warning"
                :closable="false"
                show-icon
                class="visibility-tip"
              />
            </el-form-item>

            <el-form-item
              v-if="form.visibility === 'limited'"
              label="指定人员"
              prop="view_permission"
            >
              <el-select
                v-model="form.view_permission"
                multiple
                filterable
                remote
                reserve-keyword
                :remote-method="searchVisibleUsers"
                :loading="visibleUserLoading"
                placeholder="输入用户名、姓名或邮箱搜索"
                class="w-full"
              >
                <el-option
                  v-for="item in visibleUserOptions"
                  :key="item.id"
                  :label="`${item.real_name || item.username}（${item.email}，${item.role}）`"
                  :value="item.id"
                />
              </el-select>
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
                :on-exceed="handleFileExceed"
                :limit="1"
                accept=".csv,.xlsx,.xls,.json,.txt,.pdf,.doc,.docx,.zip,.rar"
              >
                <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                <div class="el-upload__text">
                  拖拽文件到此处或 <em>点击上传</em>
                </div>
                <template #tip>
                  <div class="el-upload__tip upload-format-tip">
                    <div>当前每次仅支持上传 1 个文件</div>
                    <div>支持上传：CSV、Excel、JSON、TXT、PDF、Word、ZIP/RAR，最大 100MB</div>
                    <div>当前支持 AI 自动检测：CSV、Excel、JSON、制表符分隔 TXT</div>
                    <div>PDF、Word、ZIP/RAR 等文件可上传归档，但暂不参与自动 AI 检测</div>
                    <div>CSV 文件请使用 UTF-8 或 UTF-8 BOM 编码；Excel 导出的 ANSI/GBK CSV 中文可能无法正确识别</div>
                  </div>
                </template>
              </el-upload>
            </el-form-item>
            
            <el-form-item>
              <el-button type="primary" :loading="uploading" @click="handleSubmit" :disabled="!liabilityAccepted">
                {{ uploading ? '上传中...' : (isAdmin ? '上传并保存' : '上传数据') }}
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
import { ref, reactive, computed, watch } from 'vue'
import { useStore } from 'vuex'
import { useRouter } from 'vue-router'
import { ElMessage, genFileId } from 'element-plus'
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
const userRole = computed(() => user.value?.role || '')
const isAdmin = computed(() => userRole.value === 'admin')

const AI_SUPPORTED_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.json', '.txt']

const getFileExtension = (fileName = '') => {
  const index = fileName.lastIndexOf('.')
  return index >= 0 ? fileName.slice(index).toLowerCase() : ''
}

const isAiSupportedFile = (file) => {
  if (!file) return false
  return AI_SUPPORTED_EXTENSIONS.includes(getFileExtension(file.name || ''))
}

const shouldAutoStartAi = computed(() => true)

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
  view_permission: [],
  file: null
})

const rules = {
  title: [{ required: true, message: '请输入数据标题', trigger: 'blur' }],
  data_type: [{ required: true, message: '请选择数据类型', trigger: 'change' }],
  visibility: [{ required: true, message: '请选择可见性', trigger: 'change' }],
  view_permission: [
    {
      validator: (_rule, value, callback) => {
        if (form.visibility === 'limited' && (!value || value.length === 0)) {
          callback(new Error('请选择至少一个指定可见人员'))
        } else {
          callback()
        }
      },
      trigger: 'change'
    }
  ]
}

const visibleUserOptions = ref([])
const visibleUserLoading = ref(false)

const searchVisibleUsers = async (keyword) => {
  const value = String(keyword || '').trim()

  if (!value) {
    visibleUserOptions.value = []
    return
  }

  visibleUserLoading.value = true

  try {
    const res = await api.get('/users/search', {
      params: { keyword: value }
    })

    visibleUserOptions.value = res.users || []
  } catch (error) {
    ElMessage.error(error.error || '搜索用户失败')
  } finally {
    visibleUserLoading.value = false
  }
}

watch(
  () => form.visibility,
  (value) => {
    if (value !== 'limited') {
      form.view_permission = []
    }
  }
)

const handleFileChange = (file) => {
  const rawFile = file.raw || file
  selectedFile.value = rawFile
  form.file = rawFile
}

const handleFileRemove = () => {
  selectedFile.value = null
  form.file = null
}

const handleFileExceed = (files) => {
  const file = files?.[0]
  if (!file) return

  // 单文件上传场景：重新选择文件时自动清空旧文件并加入新文件
  uploadRef.value?.clearFiles()

  // Element Plus 内部文件列表依赖 uid，替换时给新文件生成新的 uid
  file.uid = genFileId()
  uploadRef.value?.handleStart(file)

  // 同步业务提交用的真实 File 对象，避免只更新 UI、不更新 FormData
  selectedFile.value = file
  form.file = file

  ElMessage.success(`已替换为：${file.name}`)
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

    if (form.visibility === 'limited') {
      formData.append('view_permission', JSON.stringify(form.view_permission))
    }

    formData.append('liability_accepted', liabilityAccepted.value)
    
    const response = await api.post('/data/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })

    const dataId = response?.data_id || response?.id

    if (!dataId) {
      throw new Error('上传成功，但后端未返回数据ID')
    }

    const uploadedFile = selectedFile.value
    const aiSupported = isAiSupportedFile(uploadedFile)

    if (aiSupported) {
      try {
        await api.post(`/ai/analyze/${dataId}`)
        ElMessage.success('上传成功，AI检测已启动')
      } catch (aiError) {
        console.error('AI分析启动失败:', aiError)

        const message =
          aiError?.error ||
          aiError?.message ||
          'AI检测暂未启动，可在详情页手动重试'

        ElMessage.warning(`上传成功；${message}`)
      }
    } else {
      ElMessage.success('上传成功；当前文件类型暂不支持自动AI检测')
    }

    // 刷新用户额度信息
    await store.dispatch('fetchUser')

    router.push(`/data/${dataId}`)
  } catch (error) {
    const message = error?.error === '该文件已上传过'
      ? '相同内容的文件已上传过，即使文件名不同也会被识别为重复'
      : (error?.error || '上传失败')

    ElMessage.error(message)
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

.upload-format-tip {
  line-height: 1.7;
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

.visibility-tip {
  margin-top: 8px;
}
</style>

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

          <el-tabs v-model="inputMode" @tab-change="handleInputModeChange">
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
                ref="uploadRef"
                v-model:file-list="uploadedFiles"
                drag
                multiple
                action="#"
                :auto-upload="false"
                :show-file-list="false"
                :on-change="handleFileChange"
                accept=".csv,.txt"
              >
                <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                <div class="el-upload__text">
                  拖拽 CSV/TXT 文件到此处或 <em>点击上传</em>
                </div>
                <template #tip>
                  <div class="upload-tip">
                    支持上传多个 CSV/TXT 文件；选择后可在下方快速切换、查看、移除。公开检测单个文件内容最大支持 1MB。
                  </div>
                </template>
              </el-upload>

              <div v-if="uploadedFiles.length" class="upload-workbench">
                <div class="upload-workbench-header">
                  <div class="upload-workbench-title">
                    <el-icon><folder-opened /></el-icon>
                    <span>已上传文件</span>
                    <el-tag size="small" type="info">{{ uploadedFiles.length }} 个</el-tag>
                  </div>

                  <el-button link type="danger" @click="clearUploadedFiles">
                    清空文件
                  </el-button>
                </div>

                <el-scrollbar max-height="220px">
                  <div
                    v-for="file in uploadedFiles"
                    :key="file.uid"
                    class="uploaded-file-item"
                    :class="{ active: file.uid === activeFileUid }"
                    @click="activateFile(file)"
                  >
                    <div class="uploaded-file-main">
                      <el-icon class="file-icon"><document /></el-icon>

                      <div class="uploaded-file-info">
                        <div class="uploaded-file-name" :title="file.name">
                          {{ file.name }}
                        </div>
                        <div class="uploaded-file-meta">
                          {{ formatFileSize(file.size) }}
                          <span class="meta-dot">·</span>
                          <span :class="{ 'error-text': file.error }">
                            {{ getFileStatusText(file) }}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div class="uploaded-file-actions" @click.stop>
                      <el-button
                        size="small"
                        text
                        type="primary"
                        :disabled="!!file.error || !file.content"
                        @click="activateFile(file)"
                      >
                        切换
                      </el-button>

                      <el-button
                        size="small"
                        text
                        :disabled="!file.content"
                        @click="openPreview(file)"
                      >
                        <el-icon><view /></el-icon>
                        查看
                      </el-button>

                      <el-button
                        size="small"
                        text
                        type="danger"
                        @click="removeUploadedFile(file)"
                      >
                        <el-icon><delete /></el-icon>
                        移除
                      </el-button>
                    </div>
                  </div>
                </el-scrollbar>
              </div>

              <el-empty
                v-else
                class="upload-empty"
                description="暂无上传文件。上传后可在这里快速切换和查看。"
              />

              <div v-if="activeUploadFile" class="active-file-preview">
                <div class="active-file-header">
                  <div>
                    <span class="active-label">当前检测文件：</span>
                    <strong>{{ activeUploadFile.name }}</strong>
                  </div>

                  <el-button link type="primary" @click="openPreview(activeUploadFile)">
                    展开查看
                  </el-button>
                </div>

                <el-input
                  :model-value="activeFilePreview"
                  type="textarea"
                  :rows="6"
                  readonly
                  resize="none"
                  placeholder="当前文件暂无可预览内容"
                />
              </div>
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
              <div class="result-title-group">
                <span>检测结果</span>
                <small v-if="resultSourceName">来源：{{ resultSourceName }}</small>
              </div>
              <el-tag :type="resultType">{{ resultTitle }}</el-tag>
            </div>
          </template>

          <div class="result-summary">
            <h4>数据概览</h4>
            <el-descriptions :column="2" border>
              <el-descriptions-item label="列数">
                {{ result.columns?.length || 0 }}
              </el-descriptions-item>

              <el-descriptions-item label="行数">
                {{ result.rows || 0 }}
              </el-descriptions-item>

              <el-descriptions-item label="是否有效" :span="2">
                <el-tag :type="result.is_valid ? 'success' : 'danger'">
                  {{ result.is_valid ? '有效' : '无效' }}
                </el-tag>
              </el-descriptions-item>
            </el-descriptions>
          </div>

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

    <el-dialog
      v-model="previewDialogVisible"
      width="760px"
      destroy-on-close
      :title="previewFile ? `文件查看：${previewFile.name}` : '文件查看'"
    >
      <div v-if="previewFile" class="preview-dialog-body">
        <div class="preview-dialog-meta">
          <el-tag size="small" type="info">{{ formatFileSize(previewFile.size) }}</el-tag>
          <el-tag size="small" :type="previewFile.error ? 'danger' : 'success'">
            {{ getFileStatusText(previewFile) }}
          </el-tag>
        </div>

        <el-input
          :model-value="previewFile.content || ''"
          type="textarea"
          :rows="18"
          readonly
          resize="none"
          placeholder="文件暂无可查看内容"
        />
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  UploadFilled,
  Search,
  Document,
  View,
  Delete,
  FolderOpened
} from '@element-plus/icons-vue'
import { api } from '@/store'

const MAX_PUBLIC_CHECK_TEXT_SIZE = 1024 * 1024

const inputMode = ref('paste')
const dataContent = ref('')
const checking = ref(false)
const result = ref(null)
const resultSourceName = ref('')

const uploadRef = ref(null)
const uploadedFiles = ref([])
const activeFileUid = ref('')
const previewDialogVisible = ref(false)
const previewFile = ref(null)

const activeUploadFile = computed(() => {
  return uploadedFiles.value.find(file => file.uid === activeFileUid.value) || null
})

const activeFileContent = computed(() => {
  return activeUploadFile.value?.content || ''
})

const activeFilePreview = computed(() => {
  const content = activeFileContent.value || ''
  if (!content) return ''

  const lines = content.split(/\r?\n/)
  const previewLines = lines.slice(0, 12).join('\n')

  return lines.length > 12
    ? `${previewLines}\n......\n共 ${lines.length} 行，点击"展开查看"可查看完整内容`
    : previewLines
})

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

const handleInputModeChange = () => {
  result.value = null
  resultSourceName.value = ''

  if (inputMode.value === 'upload' && activeUploadFile.value?.content) {
    dataContent.value = activeUploadFile.value.content
  }
}

const isSupportedFile = (fileName) => {
  return /\.(csv|txt)$/i.test(fileName || '')
}

const formatFileSize = (size) => {
  if (!Number.isFinite(size)) return '未知大小'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`

  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

const getFileStatusText = (file) => {
  if (file.error) return file.error
  if (file.loading) return '读取中'
  if (file.content) return '已读取，可检测'

  return '等待读取'
}

const updateUploadedFile = (uid, patch) => {
  const index = uploadedFiles.value.findIndex(file => file.uid === uid)

  if (index !== -1) {
    uploadedFiles.value[index] = {
      ...uploadedFiles.value[index],
      ...patch
    }
  }
}

const readUploadFile = (uploadFile) => {
  const rawFile = uploadFile.raw

  if (!rawFile) {
    updateUploadedFile(uploadFile.uid, {
      loading: false,
      error: '文件对象不存在'
    })
    return
  }

  if (!isSupportedFile(uploadFile.name)) {
    updateUploadedFile(uploadFile.uid, {
      loading: false,
      error: '仅支持 CSV/TXT'
    })
    ElMessage.warning(`${uploadFile.name} 不是支持的 CSV/TXT 文件`)
    return
  }

  if (rawFile.size > MAX_PUBLIC_CHECK_TEXT_SIZE) {
    updateUploadedFile(uploadFile.uid, {
      loading: false,
      error: '超过 1MB 限制'
    })
    ElMessage.warning(`${uploadFile.name} 超过公开检测 1MB 限制`)
    return
  }

  updateUploadedFile(uploadFile.uid, {
    loading: true,
    error: ''
  })

  const reader = new FileReader()

  reader.onload = (event) => {
    const content = String(event.target?.result || '')

    if (content.length > MAX_PUBLIC_CHECK_TEXT_SIZE) {
      updateUploadedFile(uploadFile.uid, {
        loading: false,
        content: '',
        error: '文本超过 1MB 限制'
      })
      ElMessage.warning(`${uploadFile.name} 文本内容超过公开检测 1MB 限制`)
      return
    }

    updateUploadedFile(uploadFile.uid, {
      loading: false,
      content,
      error: ''
    })

    activeFileUid.value = uploadFile.uid
    dataContent.value = content
    result.value = null
    resultSourceName.value = ''
  }

  reader.onerror = () => {
    updateUploadedFile(uploadFile.uid, {
      loading: false,
      content: '',
      error: '读取失败'
    })
    ElMessage.error(`${uploadFile.name} 读取失败`)
  }

  reader.readAsText(rawFile, 'UTF-8')
}

const handleFileChange = (uploadFile, uploadFileList) => {
  inputMode.value = 'upload'
  result.value = null
  resultSourceName.value = ''

  const oldFileMap = new Map(uploadedFiles.value.map(file => [file.uid, file]))

  uploadedFiles.value = uploadFileList.map(file => {
    const oldFile = oldFileMap.get(file.uid)

    return {
      ...file,
      content: oldFile?.content || '',
      loading: oldFile?.loading || false,
      error: oldFile?.error || ''
    }
  })

  activeFileUid.value = uploadFile.uid
  readUploadFile(uploadFile)
}

const activateFile = (file) => {
  if (!file) return

  inputMode.value = 'upload'
  activeFileUid.value = file.uid
  result.value = null
  resultSourceName.value = ''

  if (file.error) {
    ElMessage.warning(`该文件不可检测：${file.error}`)
    return
  }

  if (!file.content) {
    ElMessage.warning('文件仍在读取中或暂无内容')
    return
  }

  dataContent.value = file.content
}

const openPreview = (file) => {
  if (!file?.content) {
    ElMessage.warning('文件暂无可查看内容')
    return
  }

  previewFile.value = file
  previewDialogVisible.value = true
}

const removeUploadedFile = (file) => {
  uploadedFiles.value = uploadedFiles.value.filter(item => item.uid !== file.uid)

  if (activeFileUid.value === file.uid) {
    const nextFile = uploadedFiles.value.find(item => !item.error && item.content) || uploadedFiles.value[0] || null

    activeFileUid.value = nextFile?.uid || ''
    dataContent.value = nextFile?.content || ''
    result.value = null
    resultSourceName.value = ''
  }

  if (previewFile.value?.uid === file.uid) {
    previewDialogVisible.value = false
    previewFile.value = null
  }
}

const clearUploadedFiles = async () => {
  if (!uploadedFiles.value.length) return

  try {
    await ElMessageBox.confirm(
      '确定清空所有已上传文件吗？清空后需要重新选择文件。',
      '确认清空',
      {
        confirmButtonText: '清空',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
  } catch {
    return
  }

  uploadedFiles.value = []
  activeFileUid.value = ''
  previewFile.value = null
  previewDialogVisible.value = false

  uploadRef.value?.clearFiles?.()

  if (inputMode.value === 'upload') {
    dataContent.value = ''
  }

  result.value = null
  resultSourceName.value = ''
}

const getCurrentCheckContent = () => {
  if (inputMode.value === 'upload') {
    return activeUploadFile.value?.content || ''
  }

  return dataContent.value
}

const getCurrentCheckSourceName = () => {
  if (inputMode.value === 'upload') {
    return activeUploadFile.value?.name || ''
  }

  return '粘贴数据'
}

const startCheck = async () => {
  const checkContent = getCurrentCheckContent()

  if (!checkContent.trim()) {
    ElMessage.warning(inputMode.value === 'upload' ? '请先选择可检测的上传文件' : '请输入数据内容')
    return
  }

  if (checkContent.length > MAX_PUBLIC_CHECK_TEXT_SIZE) {
    ElMessage.warning('公开检测最大支持 1MB 文本内容，请减少数据量后重试')
    return
  }

  checking.value = true

  try {
    const response = await api.post('/ai/public-check', {
      data_content: checkContent
    })

    result.value = response
    resultSourceName.value = getCurrentCheckSourceName()
  } catch (error) {
    ElMessage.error(error?.response?.data?.error || '检测失败，请稍后重试')
  } finally {
    checking.value = false
  }
}

const clearData = () => {
  dataContent.value = ''
  result.value = null
  resultSourceName.value = ''

  uploadedFiles.value = []
  activeFileUid.value = ''
  previewFile.value = null
  previewDialogVisible.value = false

  uploadRef.value?.clearFiles?.()
}
</script>

<style scoped>
.subtitle {
  color: #909399;
  margin-top: 5px;
}

.upload-tip {
  margin-top: 8px;
  color: #909399;
  font-size: 13px;
  line-height: 1.6;
}

.upload-workbench {
  margin-top: 16px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.upload-workbench-header {
  padding: 10px 12px;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fafafa;
}

.upload-workbench-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #303133;
}

.uploaded-file-item {
  padding: 10px 12px;
  border-bottom: 1px solid #f0f2f5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  transition: background-color 0.2s ease, border-left-color 0.2s ease;
  border-left: 3px solid transparent;
}

.uploaded-file-item:last-child {
  border-bottom: none;
}

.uploaded-file-item:hover {
  background: #f5f7fa;
}

.uploaded-file-item.active {
  background: #ecf5ff;
  border-left-color: #409eff;
}

.uploaded-file-main {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
}

.file-icon {
  color: #409eff;
  flex-shrink: 0;
}

.uploaded-file-info {
  min-width: 0;
}

.uploaded-file-name {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #303133;
  font-weight: 500;
}

.uploaded-file-meta {
  margin-top: 4px;
  color: #909399;
  font-size: 12px;
}

.meta-dot {
  margin: 0 6px;
}

.error-text {
  color: #f56c6c;
}

.uploaded-file-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.upload-empty {
  margin-top: 16px;
  padding: 20px 0;
  border: 1px dashed #dcdfe6;
  border-radius: 8px;
}

.active-file-preview {
  margin-top: 16px;
  padding: 12px;
  border: 1px solid #d9ecff;
  border-radius: 8px;
  background: #f8fbff;
}

.active-file-header {
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.active-label {
  color: #606266;
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

.result-title-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.result-title-group small {
  color: #909399;
  font-size: 12px;
}

.result-summary,
.result-preview,
.result-issues,
.result-suggestions {
  margin-bottom: 20px;
}

.result-summary h4,
.result-preview h4,
.result-issues h4,
.result-suggestions h4 {
  margin-bottom: 15px;
}

.preview-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.preview-dialog-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>

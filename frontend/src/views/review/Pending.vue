<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">待审核数据</h2>
    </div>
    
    <el-card>
      <el-table :data="reviewList" v-loading="loading" style="width: 100%">
        <el-table-column prop="title" label="数据标题" min-width="200">
          <template #default="{ row }">
            <el-link type="primary" @click="viewDetail(row)">{{ row.title }}</el-link>
          </template>
        </el-table-column>
        
        <el-table-column prop="data_type" label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ typeMap[row.data_type] }}</el-tag>
          </template>
        </el-table-column>
        
        <el-table-column prop="submitter_name" label="提交者" width="120">
          <template #default="{ row }">
            {{ row.submitter_real_name || row.submitter_name || '匿名' }}
          </template>
        </el-table-column>
        
        <el-table-column prop="submitted_at" label="提交时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.submitted_at) }}
          </template>
        </el-table-column>
        
        <el-table-column prop="ai_check_score" label="AI评分" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.ai_check_score" :type="getScoreType(row.ai_check_score)" size="small">
              {{ row.ai_check_score }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        
        <el-table-column prop="ai_anomaly_detected" label="AI异常" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.ai_anomaly_detected === 1" type="danger" size="small">有异常</el-tag>
            <el-tag v-else-if="row.ai_check_status === 'completed'" type="success" size="small">正常</el-tag>
            <span v-else>检测中</span>
          </template>
        </el-table-column>
        
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="openReviewDialog(row)">
              审核
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      
      <div class="pagination-container">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :total="pagination.total"
          layout="total, prev, pager, next"
          @current-change="fetchData"
        />
      </div>
    </el-card>
    
    <!-- 审核对话框 -->
    <el-dialog v-model="reviewDialogVisible" :title="reviewDialogTitle" width="700px">
      <div v-if="currentReview" class="review-dialog-content">
        <!-- 数据预览 -->
        <el-card class="preview-card">
          <template #header>
            <span>数据信息</span>
          </template>
          <el-descriptions :column="2">
            <el-descriptions-item label="标题">{{ currentReview.title }}</el-descriptions-item>
            <el-descriptions-item label="类型">{{ typeMap[currentReview.data_type] }}</el-descriptions-item>
            <el-descriptions-item label="描述" :span="2">{{ currentReview.description || '暂无描述' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
        
        <!-- AI分析结果 -->
        <el-card class="preview-card" v-if="aiAnalysis">
          <template #header>
            <span>AI辅助分析</span>
            <el-tag v-if="aiAnalysis.score" :type="getScoreType(aiAnalysis.score)">
              评分: {{ aiAnalysis.score }}
            </el-tag>
          </template>
          <div v-if="aiAnalysis.anomalies?.length">
            <el-alert
              v-for="(anomaly, idx) in aiAnalysis.anomalies"
              :key="idx"
              :title="anomaly.description"
              type="warning"
              show-icon
              :closable="false"
              style="margin-bottom: 10px;"
            />
          </div>
          <el-empty v-else description="未检测到明显异常" />
          
          <!-- 🔴 新增：大模型智能意见 -->
          <div style="margin-top: 15px; padding: 10px; background-color: #f0f9ff; border-left: 3px solid #0ea5e9; border-radius: 4px;">
            <span style="color: #0ea5e9; font-weight: 500;">🤖 小米 MiMo 智能合规审查意见：</span>
            <p style="margin: 8px 0 0 0; color: #333; line-height: 1.6;">{{ aiAnalysis?.llm_insight }}</p>
          </div>
        </el-card>
        
        <!-- 评分表单 -->
        <el-form :model="reviewForm" label-width="100px">
          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item label="完整性">
                <el-rate v-model="reviewForm.completeness_score" :max="10" show-score />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="准确性">
                <el-rate v-model="reviewForm.accuracy_score" :max="10" show-score />
              </el-form-item>
            </el-col>
          </el-row>
          
          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item label="原创性">
                <el-rate v-model="reviewForm.originality_score" :max="10" show-score />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="方法论">
                <el-rate v-model="reviewForm.methodology_score" :max="10" show-score />
              </el-form-item>
            </el-col>
          </el-row>
          
          <el-form-item label="综合评分">
            <el-rate v-model="reviewForm.overall_score" :max="10" show-score />
          </el-form-item>
          
          <el-form-item label="审核结果">
            <el-radio-group v-model="reviewForm.status">
              <el-radio-button label="approved">通过</el-radio-button>
              <el-radio-button label="rejected">拒绝</el-radio-button>
              <el-radio-button label="revision_required">需修改</el-radio-button>
            </el-radio-group>
          </el-form-item>
          
          <el-form-item label="审核意见">
            <el-input 
              v-model="reviewForm.comments" 
              type="textarea" 
              :rows="4"
              placeholder="请输入审核意见..."
            />
          </el-form-item>
        </el-form>
      </div>
      
      <template #footer>
        <el-button @click="reviewDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitReview">提交审核</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useStore } from 'vuex'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import { api } from '../../store'

const store = useStore()
const loading = ref(false)
const reviewList = ref([])
const reviewDialogVisible = ref(false)
const currentReview = ref(null)
const aiAnalysis = ref(null)

const userRole = computed(() => store.getters.userRole)
const reviewType = computed(() => userRole.value === 'teacher' ? 'teacher' : 'expert')
const reviewDialogTitle = computed(() => reviewType.value === 'teacher' ? '导师一审' : '专家盲审')

const pagination = ref({
  page: 1,
  limit: 10,
  total: 0
})

const reviewForm = ref({
  completeness_score: 0,
  accuracy_score: 0,
  originality_score: 0,
  methodology_score: 0,
  overall_score: 0,
  status: 'approved',
  comments: ''
})

const typeMap = {
  'raw': '原始数据',
  'processed': '处理数据',
  'analysis': '分析结果',
  'summary': '总结报告'
}

const formatDate = (date) => dayjs(date).format('YYYY-MM-DD HH:mm')

const getScoreType = (score) => {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'danger'
}

const fetchData = async () => {
  loading.value = true
  try {
    const response = await api.get(`/review/pending?page=${pagination.value.page}&limit=${pagination.value.limit}`)
    reviewList.value = response.reviews
    pagination.value.total = response.reviews.length // 实际应返回总数
  } catch (error) {
    ElMessage.error('获取待审核列表失败')
  } finally {
    loading.value = false
  }
}

const openReviewDialog = async (row) => {
  currentReview.value = row
  reviewDialogVisible.value = true
  
  // 重置表单
  reviewForm.value = {
    completeness_score: 0,
    accuracy_score: 0,
    originality_score: 0,
    methodology_score: 0,
    overall_score: 0,
    status: 'approved',
    comments: ''
  }
  
  // 获取AI分析结果
  try {
    const aiResponse = await api.get(`/review/${row.review_id}/ai-analysis`)
    aiAnalysis.value = aiResponse
  } catch {
    aiAnalysis.value = null
  }
}

const viewDetail = (row) => {
  // 查看数据详情
}

const submitReview = async () => {
  try {
    await api.post(`/review/${currentReview.value.review_id}/${reviewType.value}`, {
      ...reviewForm.value,
      ai_analysis: aiAnalysis.value ? JSON.stringify(aiAnalysis.value) : null
    })
    
    ElMessage.success('审核提交成功')
    reviewDialogVisible.value = false
    fetchData()
  } catch (error) {
    ElMessage.error(error.error || '审核提交失败')
  }
}

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.preview-card {
  margin-bottom: 20px;
}

.pagination-container {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.review-dialog-content {
  max-height: 60vh;
  overflow-y: auto;
}
</style>

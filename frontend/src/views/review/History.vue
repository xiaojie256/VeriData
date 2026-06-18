<template>
  <div class="page-container">
    <div class="page-header">
      <h2 class="page-title">审核历史</h2>
    </div>

    <el-card>
      <el-table
        :data="reviewList"
        v-loading="loading"
        style="width: 100%"
        row-key="id"
        class="clickable-history-table"
        @row-dblclick="openReviewDetail"
      >
        <el-table-column prop="title" label="数据标题" min-width="220">
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click.stop="openReviewDetail(row)">
              {{ row.title || '-' }}
            </el-link>
          </template>
        </el-table-column>

        <el-table-column label="审核人" min-width="140">
          <template #default="{ row }">
            {{ row.reviewer_real_name || row.reviewer_name || '-' }}
          </template>
        </el-table-column>

        <el-table-column prop="review_type" label="审核类型" width="110">
          <template #default="{ row }">
            <el-tag size="small">{{ typeMap[row.review_type] || row.review_type || '-' }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="status" label="审核结果" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType[row.status] || 'info'" size="small">
              {{ statusMap[row.status] || row.status || '-' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="overall_score" label="评分" width="100">
          <template #default="{ row }">
            {{ formatScore(row.overall_score) }}
          </template>
        </el-table-column>

        <el-table-column prop="comments" label="审核意见" min-width="220">
          <template #default="{ row }">
            <el-text line-clamp="2">{{ row.comments || '-' }}</el-text>
          </template>
        </el-table-column>

        <el-table-column prop="ai_assisted" label="AI辅助" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.ai_assisted" type="success" size="small">是</el-tag>
            <el-tag v-else type="info" size="small">否</el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="completed_at" label="审核时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.completed_at) }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click.stop="openReviewDetail(row)">
              详情
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

    <el-dialog
      v-model="detailVisible"
      title="审核详情"
      width="780px"
      destroy-on-close
    >
      <div v-loading="detailLoading">
        <el-empty
          v-if="!detailLoading && !currentReview"
          description="暂无审核详情"
        />

        <template v-else-if="currentReview">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="数据标题" :span="2">
              {{ currentReview.title || '-' }}
            </el-descriptions-item>

            <el-descriptions-item label="数据类型">
              {{ currentReview.data_type || '-' }}
            </el-descriptions-item>

            <el-descriptions-item label="数据格式">
              {{ currentReview.data_format || '-' }}
            </el-descriptions-item>

            <el-descriptions-item label="可见性">
              {{ visibilityMap[currentReview.visibility] || currentReview.visibility || '-' }}
            </el-descriptions-item>

            <el-descriptions-item label="数据审核状态">
              {{ dataStatusMap[currentReview.review_status] || currentReview.review_status || '-' }}
            </el-descriptions-item>

            <el-descriptions-item label="提交者">
              <span v-if="currentReview.submitter_hidden">盲审隐藏</span>
              <span v-else>
                {{ currentReview.submitter_real_name || currentReview.submitter_name || '-' }}
              </span>
            </el-descriptions-item>

            <el-descriptions-item label="文件大小">
              {{ formatFileSize(currentReview.file_size) }}
            </el-descriptions-item>

            <el-descriptions-item label="审核类型">
              {{ typeMap[currentReview.review_type] || currentReview.review_type || '-' }}
            </el-descriptions-item>

            <el-descriptions-item label="审核结果">
              <el-tag :type="statusType[currentReview.status] || 'info'" size="small">
                {{ statusMap[currentReview.status] || currentReview.status || '-' }}
              </el-tag>
            </el-descriptions-item>

            <el-descriptions-item label="审核时间" :span="2">
              {{ formatDate(currentReview.completed_at) }}
            </el-descriptions-item>
          </el-descriptions>

          <el-divider content-position="left">评分详情</el-divider>

          <el-descriptions :column="2" border>
            <el-descriptions-item label="完整性">
              {{ formatScore(currentReview.completeness_score) }}
            </el-descriptions-item>
            <el-descriptions-item label="准确性">
              {{ formatScore(currentReview.accuracy_score) }}
            </el-descriptions-item>
            <el-descriptions-item label="原创性">
              {{ formatScore(currentReview.originality_score) }}
            </el-descriptions-item>
            <el-descriptions-item label="方法论">
              {{ formatScore(currentReview.methodology_score) }}
            </el-descriptions-item>
            <el-descriptions-item label="综合评分" :span="2">
              {{ formatScore(currentReview.overall_score) }}
            </el-descriptions-item>
          </el-descriptions>

          <el-divider content-position="left">审核意见</el-divider>
          <div class="review-text">
            {{ currentReview.comments || '-' }}
          </div>

          <el-divider content-position="left">发现问题</el-divider>
          <div v-if="normalIssues.length" class="issue-list">
            <el-tag
              v-for="(issue, index) in normalIssues"
              :key="index"
              type="warning"
              effect="plain"
            >
              {{ issue }}
            </el-tag>
          </div>
          <div v-else class="review-text">-</div>

          <el-divider content-position="left">修改建议</el-divider>
          <div class="review-text">
            {{ currentReview.suggestions || '-' }}
          </div>

          <template v-if="currentReview.ai_assisted || currentReview.ai_analysis">
            <el-divider content-position="left">AI辅助信息</el-divider>
            <div class="review-text">
              {{ currentReview.ai_analysis || '本次审核标记为使用 AI 辅助，但未保存详细 AI 分析内容。' }}
            </div>
          </template>

          <template v-if="currentReview.review_chain && currentReview.review_chain.length">
            <el-divider content-position="left">完整审核链路</el-divider>
            <el-timeline>
              <el-timeline-item
                v-for="item in currentReview.review_chain"
                :key="item.id"
                :timestamp="formatDate(item.completed_at)"
              >
                <div class="chain-title">
                  {{ typeMap[item.review_type] || item.review_type || '-' }}
                  <el-tag :type="statusType[item.status] || 'info'" size="small">
                    {{ statusMap[item.status] || item.status || '-' }}
                  </el-tag>
                  <span class="chain-score">{{ formatScore(item.overall_score) }}</span>
                </div>
                <div class="chain-comment">
                  {{ item.comments || '-' }}
                </div>
              </el-timeline-item>
            </el-timeline>
          </template>
        </template>
      </div>

      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import { api } from '../../store'

const loading = ref(false)
const detailLoading = ref(false)
const detailVisible = ref(false)
const reviewList = ref([])
const currentReview = ref(null)

const pagination = ref({
  page: 1,
  limit: 10,
  total: 0
})

const typeMap = {
  teacher: '导师一审',
  expert: '专家盲审',
  admin: '管理员终审'
}

const statusMap = {
  approved: '通过',
  rejected: '拒绝',
  revision_required: '需修改'
}

const statusType = {
  approved: 'success',
  rejected: 'danger',
  revision_required: 'warning'
}

const visibilityMap = {
  private: '私有',
  limited: '受限',
  public: '公开'
}

const dataStatusMap = {
  draft: '草稿',
  ai_checking: 'AI检测中',
  teacher_reviewing: '导师审核中',
  teacher_rejected: '导师退回',
  expert_reviewing: '专家审核中',
  expert_rejected: '专家退回',
  expert_approved: '专家已通过',
  final_approved: '终审通过',
  final_rejected: '终审拒绝'
}

const normalIssues = computed(() => normalizeIssues(currentReview.value?.issues_found))

const formatDate = (date) => {
  if (!date) return '-'
  return dayjs(date).format('YYYY-MM-DD HH:mm')
}

const formatScore = (score) => {
  if (score === undefined || score === null || score === '') return '-'
  return `${score} 分`
}

const formatFileSize = (size) => {
  const n = Number(size)
  if (!Number.isFinite(n) || n < 0) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

const normalizeIssues = (value) => {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean)

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.filter(Boolean)
    } catch {
      return value ? [value] : []
    }
  }

  return []
}

const fetchData = async () => {
  loading.value = true
  try {
    const response = await api.get(
      `/review/history?page=${pagination.value.page}&limit=${pagination.value.limit}`
    )

    reviewList.value = response.reviews || []
    pagination.value.total =
      response.pagination?.total ??
      response.total ??
      reviewList.value.length
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '获取审核历史失败')
  } finally {
    loading.value = false
  }
}

const openReviewDetail = async (row) => {
  if (!row?.id) return

  detailVisible.value = true
  detailLoading.value = true
  currentReview.value = null

  try {
    const response = await api.get(`/review/history/${row.id}`)
    currentReview.value = response.review || null
  } catch (error) {
    detailVisible.value = false
    ElMessage.error(error.response?.data?.error || '获取审核详情失败')
  } finally {
    detailLoading.value = false
  }
}

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.pagination-container {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.clickable-history-table :deep(.el-table__row) {
  cursor: pointer;
}

.review-text {
  white-space: pre-wrap;
  line-height: 1.7;
  color: var(--el-text-color-regular);
  word-break: break-word;
}

.issue-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chain-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.chain-score {
  color: var(--el-text-color-secondary);
  font-weight: 400;
}

.chain-comment {
  margin-top: 6px;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>

export const REVIEW_STATUS_OPTIONS = [
  { label: "草稿", value: "draft", type: "info" },
  { label: "待审核", value: "submitted", type: "warning" },
  { label: "导师审核中", value: "teacher_reviewing", type: "warning" },
  { label: "导师通过", value: "teacher_approved", type: "success" },
  { label: "导师拒绝", value: "teacher_rejected", type: "danger" },
  { label: "专家审核中", value: "expert_reviewing", type: "warning" },
  { label: "待终审", value: "expert_approved", type: "warning" },
  { label: "专家拒绝", value: "expert_rejected", type: "danger" },
  { label: "已通过", value: "final_approved", type: "success" },
  { label: "已拒绝", value: "final_rejected", type: "danger" },
];

export const DATA_TYPE_OPTIONS = [
  { label: "原始数据", value: "raw" },
  { label: "处理后数据", value: "processed" },
  { label: "分析结果", value: "analysis" },
];

export const reviewStatusMap = Object.fromEntries(
  REVIEW_STATUS_OPTIONS.map((item) => [item.value, item.label]),
);

export const reviewStatusTypeMap = Object.fromEntries(
  REVIEW_STATUS_OPTIONS.map((item) => [item.value, item.type]),
);

export const dataTypeMap = Object.fromEntries(
  DATA_TYPE_OPTIONS.map((item) => [item.value, item.label]),
);

export const getReviewStatusLabel = (status) => {
  if (!status) return "-";
  return reviewStatusMap[status] || `未知状态：${status}`;
};

export const getReviewStatusType = (status) => {
  return reviewStatusTypeMap[status] || "info";
};

export const getDataTypeLabel = (type) => {
  if (!type) return "-";
  return dataTypeMap[type] || `未知类型：${type}`;
};

export const hasAiScore = (score) => {
  return score !== null && score !== undefined && score !== "";
};

export const formatAiScore = (score) => {
  if (!hasAiScore(score)) return "-";
  const num = Number(score);
  if (Number.isNaN(num)) return String(score);
  return num.toFixed(2);
};

# 鉴真数据系统 - API接口文档

## 基础信息

- **基础URL**: `http://localhost:3000/api`
- **认证方式**: Bearer Token (JWT)
- **响应格式**: JSON

## 认证接口

### 注册
```http
POST /auth/register
Content-Type: application/json

{
  "username": "string",      // 必填，3-50字符
  "email": "string",         // 必填，邮箱格式
  "password": "string",      // 必填，至少6位
  "real_name": "string",     // 可选
  "role": "student",         // 可选，默认 civilian
  "phone": "string"          // 可选
}
```

响应：
```json
{
  "message": "注册成功",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "username": "student1",
    "email": "student1@example.com",
    "role": "student"
  }
}
```

### 登录
```http
POST /auth/login
Content-Type: application/json

{
  "account": "string",       // 用户名或邮箱
  "password": "string"
}
```

### 获取当前用户
```http
GET /auth/me
Authorization: Bearer {token}
```

### 修改密码
```http
POST /auth/change-password
Authorization: Bearer {token}
Content-Type: application/json

{
  "oldPassword": "string",
  "newPassword": "string"
}
```

## 数据接口

### 上传数据
```http
POST /data/upload
Authorization: Bearer {token}
Content-Type: multipart/form-data

file: File              // 数据文件
title: string          // 数据标题
description: string    // 数据描述
data_type: string      // raw/processed/analysis/summary
visibility: string      // private/limited/public
liability_accepted: boolean  // 是否接受责任声明
```

### 获取我的数据列表
```http
GET /data/my?page=1&limit=10&status=draft
Authorization: Bearer {token}
```

查询参数：
- `page`: 页码，默认 1
- `limit`: 每页数量，默认 10
- `status`: 筛选状态（可选）

### 获取数据详情
```http
GET /data/{id}
Authorization: Bearer {token}
```

### 下载数据
```http
GET /data/{id}/download
Authorization: Bearer {token}
```

### 提交审核
```http
POST /data/{id}/submit
Authorization: Bearer {token}
Content-Type: application/json

{
  "teacher_id": 1,              // 导师ID
  "liability_accepted": true    // 接受责任声明
}
```

### 更新数据
```http
PUT /data/{id}
Authorization: Bearer {token}
Content-Type: application/json

{
  "title": "string",
  "description": "string",
  "visibility": "private"
}
```

### 删除数据
```http
DELETE /data/{id}
Authorization: Bearer {token}
```

## 审核接口

### 获取待审核列表
```http
GET /review/pending?page=1&limit=10&review_type=teacher
Authorization: Bearer {token}
```

角色权限：
- `teacher`: 只能查看自己学生的数据
- `expert`: 查看所有待盲审数据
- `admin`: 查看所有待终审数据

### 获取审核历史
```http
GET /review/history?page=1&limit=10
Authorization: Bearer {token}
```

### 导师审核
```http
POST /review/{id}/teacher
Authorization: Bearer {token}
Content-Type: application/json

{
  "status": "approved",           // approved/rejected/revision_required
  "completeness_score": 8,        // 0-10
  "accuracy_score": 9,
  "originality_score": 8,
  "methodology_score": 7,
  "overall_score": 8,
  "comments": "审核意见",
  "issues_found": ["问题1", "问题2"],
  "suggestions": "改进建议"
}
```

### 专家审核（盲审）
```http
POST /review/{id}/expert
Authorization: Bearer {token}
Content-Type: application/json

{
  "status": "approved",
  "completeness_score": 8,
  "accuracy_score": 9,
  "originality_score": 8,
  "methodology_score": 7,
  "overall_score": 8,
  "comments": "盲审意见",
  "ai_analysis": "AI分析结果"  // 可选
}
```

### 获取AI分析结果
```http
GET /review/{id}/ai-analysis
Authorization: Bearer {token}
```

## 用户接口

### 获取用户列表
```http
GET /users?page=1&limit=20&role=student&search=keyword
Authorization: Bearer {token}
```

### 获取通知列表
```http
GET /users/notifications/list?page=1&limit=20&unread_only=true
Authorization: Bearer {token}
```

### 标记通知已读
```http
POST /users/notifications/{id}/read
Authorization: Bearer {token}
```

### 标记所有通知已读
```http
POST /users/notifications/read-all
Authorization: Bearer {token}
```

### 获取配额使用记录
```http
GET /users/quota-logs
Authorization: Bearer {token}
```

### 获取我的学生（导师）
```http
GET /users/my-students
Authorization: Bearer {token}
```

### 添加学生（导师）
```http
POST /users/students
Authorization: Bearer {token}
Content-Type: application/json

{
  "student_username": "student1"
}
```

### 获取我的导师（学生）
```http
GET /users/my-teacher
Authorization: Bearer {token}
```

## 管理接口（仅管理员）

### 仪表盘统计
```http
GET /admin/dashboard
Authorization: Bearer {token}
```

响应：
```json
{
  "user_stats": {
    "total_users": 100,
    "students": 80,
    "teachers": 10,
    "experts": 5,
    "pending_verification": 5
  },
  "data_stats": {
    "total_data": 500,
    "drafts": 100,
    "teacher_pending": 50,
    "expert_pending": 30,
    "approved": 200,
    "rejected": 120
  },
  "weekly_trend": [
    {"date": "2024-01-01", "count": 10},
    {"date": "2024-01-02", "count": 15}
  ]
}
```

### 用户列表
```http
GET /admin/users?page=1&limit=20&role=student&status=pending_verification&search=keyword
Authorization: Bearer {token}
```

### 审核用户
```http
POST /admin/users/{id}/verify
Authorization: Bearer {token}
Content-Type: application/json

{
  "status": "active",      // active/rejected
  "reason": "审核通过"    // 拒绝时需要
}
```

### 调整用户配额
```http
POST /admin/users/{id}/quota
Authorization: Bearer {token}
Content-Type: application/json

{
  "quota_total": 20,
  "reason": "额度调整原因"
}
```

### 获取所有数据
```http
GET /admin/data?page=1&limit=20&status=final_approved&data_type=raw
Authorization: Bearer {token}
```

### 管理员终审
```http
POST /admin/final-review/{id}
Authorization: Bearer {token}
Content-Type: application/json

{
  "decision": "approved",    // approved/rejected
  "comments": "终审意见"
}
```

### 获取系统日志
```http
GET /admin/logs?page=1&limit=50&action=login&start_date=2024-01-01&end_date=2024-12-31
Authorization: Bearer {token}
```

### 获取系统设置
```http
GET /admin/settings
Authorization: Bearer {token}
```

## AI接口

### 触发AI检测
```http
POST /ai/analyze/{dataId}
Authorization: Bearer {token}
```

### 获取AI检测结果
```http
GET /ai/result/{dataId}
Authorization: Bearer {token}
```

响应：
```json
{
  "status": "completed",
  "score": 85.5,
  "has_anomaly": false,
  "details": {
    "file_info": {
      "rows": 1000,
      "columns": 10
    },
    "data_quality": {
      "missing_values": {...},
      "duplicate_rows": 0
    },
    "anomaly_detection": {
      "has_anomaly": false,
      "anomalies": []
    }
  }
}
```

### 数据质量预测
```http
POST /ai/predict-quality
Authorization: Bearer {token}
Content-Type: application/json

{
  "data_preview": {
    "rows": 100,
    "columns": 5,
    "sample": [...]
  }
}
```

### 公开检测（无需认证）
```http
POST /ai/public-check
Content-Type: application/json

{
  "data_content": "姓名,年龄,分数\n张三,20,85\n李四,21,90"
}
```

## 错误响应

### 标准错误格式
```json
{
  "error": "错误描述",
  "details": [...]  // 可选，验证错误详情
}
```

### 常见HTTP状态码

| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 409 | 资源冲突 |
| 500 | 服务器错误 |

### 错误示例

**认证失败**
```json
{
  "error": "账号或密码错误"
}
```

**验证失败**
```json
{
  "error": "验证失败",
  "details": [
    {"field": "email", "message": "邮箱格式不正确"}
  ]
}
```

**配额不足**
```json
{
  "error": "配额已用完",
  "quota": {
    "total": 10,
    "used": 10
  }
}
```

## 分页说明

所有列表接口支持分页：

```http
GET /data/my?page=1&limit=10
```

响应包含分页信息：
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100
  }
}
```

## 数据类型定义

### 用户角色
- `student`: 学生
- `teacher`: 导师
- `expert`: 专家
- `admin`: 管理员
- `civilian`: 普通用户

### 数据状态
- `draft`: 草稿
- `submitted`: 已提交
- `teacher_reviewing`: 导师审核中
- `teacher_approved`: 导师通过
- `teacher_rejected`: 导师拒绝
- `expert_reviewing`: 专家审核中
- `expert_approved`: 专家通过
- `expert_rejected`: 专家拒绝
- `final_approved`: 最终通过
- `final_rejected`: 最终拒绝

### 数据类型
- `raw`: 原始数据
- `processed`: 处理数据
- `analysis`: 分析结果
- `summary`: 总结报告

### 可见性
- `private`: 私有
- `limited`: 受限
- `public`: 公开

# 鉴真数据 - 科研数据验证平台

## 项目简介

鉴真数据是一个面向科研场景的多重数据验证平台，旨在解决学生实验数据错假问题，提升数据质量，减轻导师检验压力。

### 核心特色

- **多重审核机制**: AI自动检测 → 导师一审 → 专家盲审 → 管理员终审
- **权限控制**: 精细化的数据可见性管理，保护知识产权
- **AI辅助分析**: 自动检测数据异常、缺失值、重复数据等
- **责任声明**: 数据提交者需接受责任声明，确保数据真实性
- **盲审机制**: 专家审核时隐藏提交者信息，确保公平性
- **额度管理**: 不同角色拥有不同的数据提交额度
- **公开检测**: 无需登录即可进行基础数据质量检测

### 系统角色

| 角色 | 功能权限 |
|------|----------|
| 学生 | 上传数据、查看审核进度、关联导师 |
| 导师 | 审核学生数据、管理学生列表 |
| 专家 | 盲审数据、AI辅助评审 |
| 管理员 | 系统管理、用户管理、终审数据 |
| 普通用户 | 基础额度、公开检测服务 |

## 技术架构

### 技术栈

- **前端**: Vue 3 + Element Plus + ECharts
- **后端**: Node.js + Express + MySQL + Redis
- **AI服务**: Python + Flask + Pandas + Scikit-learn
- **部署**: Docker + Docker Compose

### 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (Vue 3)                        │
│                    端口: 80 (Nginx)                         │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                    后端 API (Express)                       │
│                    端口: 3000                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  认证模块 │  │  数据模块 │  │  审核模块 │  │  AI模块   │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
┌───────▼──────┐ ┌──▼────┐ ┌─────▼──────┐
│   MySQL      │ │ Redis │ │  AI Service │
│  端口: 3306  │ │6379   │ │  端口: 5000 │
└──────────────┘ └───────┘ └─────────────┘
```

## 快速开始

### 环境要求

- Docker 20.10+
- Docker Compose 2.0+
- Git

### 安装步骤

1. **克隆项目**

```bash
git clone https://github.com/yourusername/veri-data.git
cd veri-data
```

2. **启动服务**

```bash
docker-compose up -d
```

3. **等待服务启动**

```bash
# 查看日志
docker-compose logs -f

# 等待所有服务启动完成后，访问 http://localhost
```

4. **创建管理员账号**

```bash
# 进入MySQL容器
docker-compose exec mysql mysql -u root -p
# 密码: VeriData@2024

# 在MySQL中执行
USE veri_data;
INSERT INTO users (username, password_hash, email, real_name, role, status, email_verified, id_verified, quota_total) 
VALUES ('admin', '$2b$10$YourHashedPasswordHere', 'admin@veridata.edu.cn', '系统管理员', 'admin', 'active', 1, 1, 9999);
```

### 开发环境配置

#### 后端开发

```bash
cd backend
npm install
npm run dev
```

#### 前端开发

```bash
cd frontend
npm install
npm run serve
```

#### AI服务开发

```bash
cd ai-service
pip install -r requirements.txt
python app.py
```

## 系统配置

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| DB_HOST | localhost | MySQL主机 |
| DB_PORT | 3306 | MySQL端口 |
| DB_PASSWORD | VeriData@2024 | MySQL密码 |
| REDIS_HOST | localhost | Redis主机 |
| JWT_SECRET | - | JWT密钥 |
| AI_SERVICE_URL | http://localhost:5000 | AI服务地址 |

### 默认端口

| 服务 | 端口 |
|------|------|
| 前端 | 80 |
| 后端API | 3000 |
| AI服务 | 5000 |
| MySQL | 3306 |
| Redis | 6379 |

## 功能特性

### 1. 数据上传与AI检测

- 支持 CSV, Excel, JSON, TXT, PDF 等格式
- 自动计算文件哈希值，防止重复上传
- AI自动检测数据质量、缺失值、异常值、重复数据
- 生成数据质量评分报告

### 2. 多级审核流程

```
数据上传 → AI检测 → 导师一审 → 专家盲审 → 管理员终审 → 审核完成
   ↓         ↓         ↓         ↓         ↓
 草稿      10%      40%      70%      100%
```

### 3. 权限与可见性

- **私有**: 仅提交者和审核人员可见
- **受限**: 指定人员可见
- **公开**: 审核通过后公开

### 4. 盲审机制

- 专家审核时隐藏提交者信息
- 显示脱敏后的数据描述
- 确保评审公平性

### 5. 额度管理

| 角色 | 默认额度 |
|------|----------|
| 学生 | 10 |
| 导师 | 50 |
| 专家 | 30 |
| 普通用户 | 5 |
| 管理员 | 9999 |

## API文档

### 认证接口

```
POST   /api/auth/register      # 注册
POST   /api/auth/login         # 登录
GET    /api/auth/me            # 获取当前用户
POST   /api/auth/avatar        # 上传头像
POST   /api/auth/change-password # 修改密码
```

### 数据接口

```
POST   /api/data/upload        # 上传数据
GET    /api/data/my           # 获取我的数据
GET    /api/data/:id          # 获取数据详情
GET    /api/data/:id/download # 下载数据
POST   /api/data/:id/submit    # 提交审核
PUT    /api/data/:id          # 更新数据
DELETE /api/data/:id          # 删除数据
```

### 审核接口

```
GET    /api/review/pending     # 获取待审核列表
GET    /api/review/history     # 获取审核历史
POST   /api/review/:id/teacher # 导师审核
POST   /api/review/:id/expert  # 专家审核
```

### 管理接口

```
GET    /api/admin/dashboard    # 仪表盘数据
GET    /api/admin/users        # 用户列表
POST   /api/admin/users/:id/verify # 审核用户
POST   /api/admin/users/:id/quota  # 调整额度
GET    /api/admin/data         # 数据列表
POST   /api/admin/final-review/:id # 管理员终审
GET    /api/admin/logs         # 系统日志
```

## 数据库设计

### 核心表

- **users**: 用户表
- **data_submissions**: 数据提交表
- **review_records**: 审核记录表
- **teacher_student_relations**: 导师-学生关系表
- **notifications**: 通知表
- **access_logs**: 访问日志表

详见 `mysql/init/01-schema.sql`

## 部署指南

### 生产环境部署

1. **修改配置文件**

```bash
# 复制环境变量模板
cp backend/.env.example backend/.env
# 编辑 .env 文件，设置生产环境参数
```

2. **构建并启动**

```bash
docker-compose -f docker-compose.yml up -d --build
```

3. **数据备份**

```bash
# MySQL备份
docker-compose exec mysql mysqldump -u root -p veri_data > backup.sql
```

### 监控与日志

```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f backend
docker-compose logs -f ai-service
```

## 安全说明

1. **数据安全**
   - 文件哈希校验确保数据完整性
   - 分级权限控制数据访问
   - 操作日志全程记录

2. **账号安全**
   - JWT令牌认证
   - 登录失败次数限制
   - 账号锁定机制

3. **审核公正**
   - 盲审机制防止偏见
   - 多重审核避免单一失误
   - AI辅助提供客观参考

## 贡献指南

欢迎提交 Issue 和 Pull Request。

## 许可证

MIT License

## 联系方式

- 项目主页: https://github.com/yourusername/veri-data
- 问题反馈: https://github.com/yourusername/veri-data/issues

---

**鉴真数据 - 让科研数据更可信**

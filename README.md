# 鉴真数据 VeriData

> 面向科研场景的数据可信验证平台。
> 通过“AI 自动检测 + 多角色审核 + 盲审机制 + 权限控制 + 审计日志”，帮助降低实验数据错填、漏填、重复提交、异常数据和审核责任不清的问题。

---

## 1. 项目简介

**鉴真数据（VeriData）** 是一个科研数据提交、检测、审核与管理平台，主要面向学生实验数据、导师审核、专家盲审、管理员终审等场景。

项目目标不是简单做一个“文件上传系统”，而是围绕科研数据可信度建立一套完整流程：

* 上传前后保留数据责任声明；
* 上传后自动进行基础数据质量检测；
* 不同角色按权限查看、审核、下载或管理数据；
* 专家审核阶段支持盲审，减少身份信息带来的主观影响；
* 管理员可进行用户管理、数据管理、系统日志查看与 AI 审查配置；
* 支持公开检测入口，让未登录用户也能进行基础数据质量检查。

---

## 2. 核心特色

### 2.1 多级数据审核链路

系统围绕科研数据审核设计了完整流程：

```text
数据上传
  ↓
AI 自动检测
  ↓
导师一审 / 专家审核池
  ↓
专家盲审
  ↓
管理员终审
  ↓
审核完成 / 驳回 / 修改后重提
```

不同身份的数据会进入不同审核路径：

| 提交者类型    | 典型审核路径                      |
| -------- | --------------------------- |
| 学生       | AI 检测 → 导师审核 → 专家盲审 → 管理员终审 |
| 普通用户     | AI 检测 → 专家审核 → 管理员终审        |
| 导师 / 管理员 | 上传后按权限和系统规则进入后续审核或管理流程      |

### 2.2 AI 数据质量检测

系统内置独立 AI 检测服务，主要用于结构化数据的基础质量分析：

* 缺失值检测；
* 重复行检测；
* 数值统计分析；
* IQR 异常值检测；
* 高相关字段识别；
* 日期 / 时间字段一致性检查；
* 字符串长度异常波动检查；
* 数据质量评分；
* 内容特征指纹提取；
* 可选的大模型语义审计。

说明：

* 可上传文件类型和可 AI 结构化检测文件类型不是完全等同的。
* 当前 AI 结构化检测主要适用于 `CSV`、`Excel`、`JSON`、`TXT`。
* `PDF`、`Word`、压缩包、图片等文件更适合作为科研附件归档、人工审核或后续扩展解析，不应承诺都能完成结构化 AI 评分。

### 2.3 专家盲审机制

专家审核时，系统会尽量隐藏提交者身份信息，使专家更关注数据本身：

* 隐藏提交者真实身份；
* 显示必要的数据描述和审核上下文；
* 保留审核意见、评分维度、问题和建议；
* 支持后续审核人员查看前序审核结论。

### 2.4 角色权限控制

系统内置多角色模型：

| 角色   | 主要能力                       |
| ---- | -------------------------- |
| 普通用户 | 注册、登录、基础额度上传、查看个人数据、使用公开检测 |
| 学生   | 上传数据、查看审核进度、绑定导师、接收导师审核结果  |
| 导师   | 管理学生、审核学生数据、查看学生提交记录       |
| 专家   | 查看待审核数据、进行盲审、填写评分与意见       |
| 管理员  | 用户管理、数据管理、终审、系统日志、AI 审查配置  |

### 2.5 可见性与数据保护

数据支持不同可见性策略：

| 可见性 | 说明                |
| --- | ----------------- |
| 私有  | 仅提交者、相关审核人员、管理员可见 |
| 受限  | 指定范围内用户可见         |
| 公开  | 审核通过后可进入可见数据列表    |

系统通过鉴权接口控制数据详情、下载、审核和管理操作，避免直接暴露科研数据文件。

### 2.6 审计与安全

项目内置多项安全与审计设计：

* JWT 登录认证；
* Redis 服务端会话校验；
* 默认支持单账号单处登录；
* 登录失败次数限制；
* 账号锁定机制；
* 文件哈希校验；
* 操作日志记录；
* 管理员可查看系统日志；
* 外部大模型 API Key 加密存储；
* AI 服务通过内部 Token 与后端通信；
* 上传目录、日志目录、本地数据库目录默认不应提交到 Git。

---

## 3. 技术栈

### 3.1 前端

* Vue 3
* Vue Router
* Vuex
* Element Plus
* ECharts / vue-echarts
* Axios
* Nginx

### 3.2 后端

* Node.js 18
* Express
* MySQL2
* Redis
* JWT
* Multer
* Nodemailer
* Winston 日志
* express-rate-limit
* Helmet
* Docker

### 3.3 AI 服务

* Python 3.9
* Flask
* Pandas
* NumPy
* Scikit-learn
* OpenPyXL
* OpenAI Compatible API 调用能力

### 3.4 基础设施

* Docker
* Docker Compose
* MySQL 8.0
* Redis 7

---

## 4. 项目结构

```text
VeriData/
├── ai-service/                 # Python Flask AI 检测服务
│   ├── app.py                  # AI 检测核心逻辑
│   ├── Dockerfile              # AI 服务容器构建文件
│   └── requirements.txt        # Python 依赖
│
├── backend/                    # Node.js Express 后端
│   ├── src/
│   │   ├── app.js              # 后端入口与路由注册
│   │   ├── routes/             # 业务接口
│   │   ├── middleware/         # 鉴权、上传、错误处理等中间件
│   │   ├── dto/                # 响应 DTO
│   │   ├── migrations/         # 启动迁移逻辑
│   │   └── utils/              # 数据库、Redis、日志、邮件等工具
│   ├── tests/                  # 后端测试
│   ├── scripts/                # 辅助脚本
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example            # 后端环境变量模板
│
├── docs/                       # 补充文档
│   ├── API接口文档.md
│   ├── 部署指南.md
│   └── 项目结构说明.md
│
├── frontend/                   # Vue 前端
│   ├── src/
│   │   ├── views/              # 页面视图
│   │   ├── router/             # 路由配置
│   │   ├── store/              # Vuex 状态管理
│   │   └── utils/              # 前端工具
│   ├── public/
│   ├── nginx.conf
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   └── package.json
│
├── mysql/
│   └── init/
│       ├── 01-schema.sql       # 数据库表结构
│       └── 02-data.sql         # 初始化数据
│
├── uploads/                    # 运行时上传文件目录，不应提交
├── logs/                       # 运行时日志目录，不应提交
├── docker-compose.yml          # 默认 Docker Compose 编排
├── docker-compose.dev.yml      # 开发环境 Docker Compose 编排
├── .env.example                # 环境变量示例模板
├── start.bat                   # Windows 启动脚本
├── start.sh                    # Linux / macOS 启动脚本
├── LICENSE
└── README.md
```

---

## 5. 快速开始

### 5.1 环境要求

部署或演示机器需要安装：

* Git
* Docker Desktop 或 Docker Engine
* Docker Compose v2
* 可选：VS Code / Cursor / 其他代码编辑器

不需要单独安装 MySQL、Redis、Node.js、Python。
默认使用 Docker Compose 自动构建并启动前端、后端、AI 服务、MySQL 和 Redis。

---

### 5.2 克隆项目

```bash
git clone https://github.com/xiaojie256/VeriData.git
cd VeriData
```

---

### 5.3 准备后端环境变量

Linux / macOS：

```bash
cp backend/.env.example backend/.env
```

Windows PowerShell：

```powershell
copy backend\.env.example backend\.env
```

至少需要重点检查以下配置：

```env
JWT_SECRET=CHANGE_THIS_TO_32_CHAR_RANDOM_STRING_MINIMUM_LENGTH_REQUIRED
SETTINGS_ENCRYPTION_KEY=CHANGE_THIS_TO_64_CHAR_RANDOM_HEX_STRING
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=your-email@qq.com
SMTP_PASS=your-smtp-authorization-code
```

生成随机密钥示例：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

说明：

* `JWT_SECRET` 用于登录令牌签名。
* `SETTINGS_ENCRYPTION_KEY` 用于加密数据库中的 AI API Key。
* `SMTP_USER` 与 `SMTP_PASS` 用于邮箱验证码注册、找回密码等功能。
* 演示环境可以先使用初始化管理员账号登录，再到系统里配置用户和 AI 审查参数。
* 生产环境必须更换所有默认密码和默认密钥。

---

### 5.4 配置根目录 `.env`

```bash
cp .env.example .env
```

然后打开 `.env`，至少修改以下配置：

```env
JWT_SECRET=随机字符串
AI_INTERNAL_TOKEN=随机字符串
SETTINGS_ENCRYPTION_KEY=随机字符串
```

如果是首次初始化数据库，也可以修改：

```env
MYSQL_ROOT_PASSWORD=新的数据库密码
DB_PASSWORD=新的数据库密码
```

注意：

* `.env` 是本地私密配置文件，不要提交到 Git。
* `AI_INTERNAL_TOKEN` 必须保证后端和 AI 服务一致。
* `SETTINGS_ENCRYPTION_KEY` 一旦用于生产环境，不要随意更换，否则可能导致已加密的 AI API Key 无法解密。

---

### 5.5 构建并启动

推荐使用 Docker Compose v2 命令：

```bash
docker compose up -d --build
```

查看容器状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

只看后端日志：

```bash
docker compose logs -f backend
```

只看 AI 服务日志：

```bash
docker compose logs -f ai-service
```

---

### 5.6 访问系统

默认地址：

| 服务     | 地址                                 | 说明              |
| ------ | ---------------------------------- | --------------- |
| 前端页面   | `http://localhost`                 | Nginx 提供 Vue 页面 |
| 后端健康检查 | `http://localhost:3000/health`     | 后端服务状态          |
| 后端 API | `http://localhost:3000/api`        | 后端接口            |
| AI 服务  | Docker 内部 `http://ai-service:5000` | 默认不暴露给宿主机       |

说明：

* 默认生产编排中，AI 服务不建议直接暴露到宿主机。
* 前端会通过 Nginx 将 `/api` 请求代理到后端。
* 后端再通过 Docker 内部网络访问 AI 服务。

---

### 5.7 初始化管理员账号

数据库初始化脚本会创建演示管理员账号：

| 字段  | 值                       |
| --- | ----------------------- |
| 用户名 | `admin`                 |
| 密码  | `admin123`              |
| 邮箱  | `admin@veridata.edu.cn` |
| 角色  | 管理员                     |

首次登录后请立即修改密码。
生产环境不要使用默认管理员密码。

---

## 6. 常用命令

启动：

```bash
docker compose up -d --build
```

停止：

```bash
docker compose down
```

重启：

```bash
docker compose restart
```

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

进入 MySQL：

```bash
docker compose exec mysql mysql --default-character-set=utf8mb4 -uroot -p veri_data
```

备份数据库：

```bash
docker compose exec mysql mysqldump --default-character-set=utf8mb4 -uroot -p veri_data > backup.sql
```

恢复数据库：

```bash
docker compose exec -T mysql mysql --default-character-set=utf8mb4 -uroot -p veri_data < backup.sql
```

清理并重新初始化数据库：

```bash
docker compose down
rm -rf mysql/data
docker compose up -d --build
```

Windows PowerShell 清理数据库目录时可使用：

```powershell
docker compose down
Remove-Item -Recurse -Force mysql\data
docker compose up -d --build
```

---

## 7. 开发环境运行

如果需要前后端热更新，可以使用开发编排：

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

开发环境常用端口：

| 服务     | 地址                      |
| ------ | ----------------------- |
| 前端开发服务 | `http://localhost:8080` |
| 后端 API | `http://localhost:3000` |
| AI 服务  | `http://localhost:5000` |

如果不使用 Docker，也可以分别启动各服务。

后端：

```bash
cd backend
npm install
npm run dev
```

前端：

```bash
cd frontend
npm install
npm run serve
```

AI 服务：

```bash
cd ai-service
pip install -r requirements.txt
python app.py
```

---

## 8. 主要功能说明

### 8.1 注册与登录

* 邮箱验证码注册；
* 用户名 / 邮箱登录；
* JWT 鉴权；
* Redis 服务端会话；
* 默认单账号单处登录；
* 修改密码后清空旧会话；
* 忘记密码通过邮箱验证码重置。

### 8.2 数据上传

上传数据时需要填写：

* 数据标题；
* 数据描述；
* 数据类型；
* 可见性；
* 文件；
* 责任声明确认。

系统会记录：

* 原始文件名；
* 文件大小；
* 文件哈希；
* 上传者；
* 审核状态；
* AI 检测状态；
* 版本信息；
* 下载次数；
* 完成时间。

### 8.3 AI 检测

AI 检测包括：

* 文件读取；
* 缺失值分析；
* 重复数据分析；
* 统计指标计算；
* 异常值检测；
* 一致性检测；
* 综合评分；
* 大模型语义审计。

AI 检测状态包括：

| 状态          | 说明   |
| ----------- | ---- |
| `pending`   | 等待检测 |
| `running`   | 检测中  |
| `completed` | 检测完成 |
| `failed`    | 检测失败 |
| `skipped`   | 跳过检测 |

### 8.4 审核流程

审核记录会保存：

* 审核人；
* 审核类型；
* 审核状态；
* 完整性评分；
* 准确性评分；
* 原创性评分；
* 方法论评分；
* 综合评分；
* 审核意见；
* 发现问题；
* 修改建议；
* 是否盲审；
* AI 辅助分析。

### 8.5 数据可见性

用户可通过“我的数据”查看自己上传的数据。
审核通过且满足可见性条件的数据可在“可见数据”中查看。
管理员可在“数据管理”中进行全局管理。

### 8.6 导师与学生关系

学生可绑定导师。
导师可查看学生列表，并审核学生提交的数据。
导师审核通过后，数据进入后续专家审核流程。

### 8.7 管理员能力

管理员后台包括：

* 管理仪表盘；
* 用户管理；
* 身份审核；
* 额度调整；
* 数据管理；
* 管理员终审；
* AI 审查配置；
* 系统日志查看。

### 8.8 AI 审查配置

管理员可在：

```text
系统管理 → AI审查配置
```

配置外部大模型语义审计：

* 是否启用；
* API Base URL；
* 模型名称；
* API Key；
* Temperature；
* Max Tokens；
* 请求超时时间。

API Key 会加密存储在数据库中，前端不会回显明文 Key。

---

## 9. API 概览

后端同时支持：

```text
/api/...
/api/v1/...
```

### 9.1 认证接口

```text
POST /api/auth/send-code        发送邮箱验证码
POST /api/auth/register         注册
POST /api/auth/login            登录
POST /api/auth/logout           退出登录
GET  /api/auth/me               获取当前用户
POST /api/auth/avatar           上传头像
POST /api/auth/change-password  修改密码
POST /api/auth/reset-password   重置密码
```

### 9.2 用户接口

```text
GET /api/users                  获取用户列表
GET /api/users/notifications/list
GET /api/users/quota-logs
GET /api/users/my-students
GET /api/users/my-tutor
GET /api/users/pending-teachers
```

### 9.3 数据接口

```text
POST   /api/data/upload
GET    /api/data/my
GET    /api/data/public
GET    /api/data/:id
GET    /api/data/:id/download
POST   /api/data/:id/submit
PUT    /api/data/:id
DELETE /api/data/:id
```

### 9.4 审核接口

```text
GET  /api/review/pending
GET  /api/review/history
POST /api/review/:id/teacher
POST /api/review/:id/expert
```

### 9.5 管理员接口

```text
GET  /api/admin/dashboard
GET  /api/admin/users
POST /api/admin/users/:id/verify
POST /api/admin/users/:id/quota
GET  /api/admin/data
POST /api/admin/final-review/:id
GET  /api/admin/logs
```

### 9.6 AI 配置接口

```text
GET  /api/admin/ai/config
PUT  /api/admin/ai/config
POST /api/admin/ai/test
```

### 9.7 健康检查

```text
GET /health
GET /health/live
GET /health/ready
GET /healthz
```

---

## 10. 数据库核心表

主要数据表包括：

| 表名                          | 说明       |
| --------------------------- | -------- |
| `users`                     | 用户表      |
| `teacher_student_relations` | 导师学生关系表  |
| `expert_fields`             | 专家领域表    |
| `data_submissions`          | 数据提交表    |
| `review_records`            | 审核记录表    |
| `data_version_history`      | 数据版本历史表  |
| `access_logs`               | 访问日志表    |
| `notifications`             | 通知表      |
| `quota_usage_logs`          | 额度使用日志表  |
| `ai_review_config`          | AI 审查配置表 |

数据库初始化脚本位于：

```text
mysql/init/01-schema.sql
mysql/init/02-data.sql
```

---

## 11. 环境变量说明

### 11.1 后端环境变量

| 变量名 | 示例值 | 说明 |
|--------|--------|------|
| `MYSQL_ROOT_PASSWORD` | 请在 `.env` 中设置 | MySQL root 密码 |
| `DB_PASSWORD` | 请在 `.env` 中设置 | 后端连接 MySQL 的密码 |
| `JWT_SECRET` | 请在 `.env` 中设置 | JWT 登录令牌签名密钥 |
| `AI_INTERNAL_TOKEN` | 请在 `.env` 中设置 | 后端调用 AI 服务的内部令牌，后端和 AI 服务必须一致 |
| `SETTINGS_ENCRYPTION_KEY` | 请在 `.env` 中设置 | 用于加密数据库中的 AI API Key |
| `AI_SERVICE_URL` | `http://ai-service:5000` | Docker 内部 AI 服务地址 |

### 11.2 AI 服务环境变量

| 变量名                 | 说明         |
| ------------------- | ---------- |
| `FLASK_ENV`         | Flask 环境   |
| `MODEL_PATH`        | 模型目录       |
| `UPLOAD_ROOT`       | 上传文件挂载目录   |
| `AI_INTERNAL_TOKEN` | 内部调用 Token |

---

## 12. 安全注意事项

生产环境部署前必须完成：

* 修改 MySQL 默认密码；
* 修改管理员默认密码；
* 设置强随机 `JWT_SECRET`；
* 设置强随机 `SETTINGS_ENCRYPTION_KEY`；
* 设置强随机 `AI_INTERNAL_TOKEN`；
* 设置明确的 `CORS_ORIGIN`；
* 不暴露 AI 服务端口；
* 不提交 `.env`、上传文件、日志、数据库目录；
* 不把真实 API Key 写入代码、README、Compose 文件或提交记录；
* 如果密钥曾经提交到公开仓库，应立即轮换；
* 定期备份数据库；
* 定期检查系统日志。

---

## 13. 常见问题

### 13.1 docker compose up 后能直接访问吗？

正常情况下可以。
执行：

```bash
docker compose up -d --build
```

后，Docker 会自动构建并启动：

* MySQL；
* Redis；
* 后端；
* AI 服务；
* 前端 Nginx。

访问：

```text
http://localhost
```

即可进入系统。

### 13.2 是否需要手动创建数据库？

通常不需要。
首次启动 MySQL 容器时，会自动执行：

```text
mysql/init/01-schema.sql
mysql/init/02-data.sql
```

这些脚本会创建数据库表和初始化演示管理员账号。

### 13.3 为什么重新启动后数据还在？

因为 MySQL 数据挂载到了：

```text
mysql/data
```

只要该目录不删除，数据库数据会持久保留。

### 13.4 为什么修改 SQL 初始化脚本后没生效？

MySQL 初始化脚本只会在数据库目录首次创建时执行。
如果已经存在 `mysql/data`，需要先清理数据库目录再重新启动。

### 13.5 AI 服务为什么不能直接访问 localhost:5000？

默认生产编排中 AI 服务不暴露宿主机端口。
后端会通过 Docker 内部网络访问：

```text
http://ai-service:5000
```

这是更安全的部署方式。

### 13.6 邮箱验证码发不出去怎么办？

检查：

* `backend/.env` 是否存在；
* `SMTP_HOST` 是否正确；
* `SMTP_PORT` 是否正确；
* `SMTP_USER` 是否正确；
* `SMTP_PASS` 是否使用邮箱授权码，而不是普通登录密码；
* 后端日志是否有邮件服务错误。

---

## 14. 适用场景

本项目适合用于：

* 高校课程设计；
* 科研数据管理演示；
* 数据治理系统原型；
* 多角色审核流程演示；
* 文件上传与审核平台实践；
* AI 辅助数据质量检测系统；
* Docker Compose 全栈项目部署示例。

---

## 15. 项目亮点

* 不是单纯 CRUD，而是围绕科研数据可信度设计完整业务闭环；
* 角色划分清晰，覆盖普通用户、学生、导师、专家、管理员；
* 审核流程具有现实科研管理场景；
* AI 检测服务独立部署，架构边界清晰；
* 结合结构化规则检测和可选大模型语义审计；
* 专家盲审机制增强公平性；
* 数据可见性控制兼顾公开共享与知识产权保护；
* Docker Compose 一键部署，适合演示和交付；
* 管理员可配置外部大模型，不把 API Key 写死在代码中；
* MySQL、Redis、后端、前端、AI 服务协同完整。

---

## 16. License

MIT License

---

## 17. 项目地址

```text
https://github.com/xiaojie256/VeriData
```

---

**鉴真数据 VeriData：让科研数据更可信。**

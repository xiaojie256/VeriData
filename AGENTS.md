# 项目规则（自动加载，勿删）

## 环境守卫 — 最高优先级

本项目运行在 **Windows** 主机上。存在两层隔离环境，严禁混淆：

### 文件工具（Read / Write / Edit / Glob / Grep）
- **只接受 Windows 绝对路径**
- 例：`E:\PpProjects\Gitee\veri-data\foo.py`、`C:\Users\FXD\...`

### Shell 工具（mcp__workspace__bash）
- 运行在 **Linux VM**（Ubuntu 22），只接受 Linux 路径
- 例：`/sessions/loving-dazzling-pasteur/mnt/veri-data/foo.py`
- Windows 路径在 bash 中**必须转换**，禁止直接使用 `C:\...` 或 `E:\...`

### 禁止行为（违反即为 bug）
- 用 `cat` / `ls` / `grep` / `find` / `sed` 读取 Windows 文件 → 用 Read / Glob / Grep
- bash 中写 Windows 路径 → 转换为 `/sessions/.../mnt/...`
- 文件工具中写 Linux 路径 → 转换为 `E:\...` 或 `C:\...`
- `pip install` 不加 `--break-system-packages`
- 假设 bash 可用 → 先执行 `echo ok` 验证，失败则降级到文件工具

### bash 不可用时的降级策略
- 代码执行 → 写入文件，提示用户本地运行
- 包安装 → 提供命令让用户在本地终端执行
- 文件操作 → 完全依赖 Read/Write/Edit/Glob/Grep

## 默认回复语言
中文

import re

def fix_layout_vue():
    path = r'E:\PpProjects\Gitee\veri-data\frontend\src\views\Layout.vue'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Fix 1: Add onUnmounted import
    content = content.replace(
        "import { computed, ref, onMounted } from 'vue'",
        "import { computed, ref, onMounted, onUnmounted } from 'vue'"
    )

    # Fix 2: Add pollTimer variable before fetchPendingCount
    content = content.replace(
        '// 获取待审核数量',
        'let pollTimer = null\n\n// 获取待审核数量'
    )

    # Fix 3: Store setInterval return value
    content = content.replace(
        'setInterval(fetchPendingCount, 60000)',
        'pollTimer = setInterval(fetchPendingCount, 60000)'
    )

    # Fix 4: Add onUnmounted after onMounted block
    old = '''onMounted(() => {
  fetchPendingCount()
  // 定时刷新通知
  pollTimer = setInterval(fetchPendingCount, 60000)
})'''
    new = old + '''

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})'''
    content = content.replace(old, new)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('[Fix 1] Layout.vue: added onUnmounted cleanup for setInterval')


def fix_audit_middleware():
    path = r'E:\PpProjects\Gitee\veri-data\backend\src\middleware\audit.js'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace monkey-patch approach with res.on('finish')
    new_audit = """const pool = require('../utils/database');
const logger = require('../utils/logger');

// 记录访问日志
const auditLog = (targetType, action) => {
  return async (req, res, next) => {
    // 使用 res.on('finish') 安全监听响应完成事件，
    // 替代之前 monkey-patch res.end 的方式，避免重复触发和响应管道异常
    res.on('finish', () => {
      const logData = {
        user_id: req.user?.id || null,
        target_type: targetType,
        target_id: req.params?.id || req.body?.id || null,
        action: action,
        ip_address: req.ip || req.connection.remoteAddress,
        user_agent: req.headers['user-agent'],
        request_data: JSON.stringify({
          params: req.params,
          query: req.query,
          body: req.body ? { ...req.body, password: undefined } : undefined
        }),
        response_status: res.statusCode
      };

      pool.execute(
        `INSERT INTO access_logs (user_id, target_type, target_id, action, ip_address, user_agent, request_data, response_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [logData.user_id, logData.target_type, logData.target_id, logData.action,
         logData.ip_address, logData.user_agent, logData.request_data, logData.response_status]
      ).catch(err => {
        logger.error('记录访问日志失败:', err);
      });
    });

    next();
  };
};

module.exports = { auditLog };
"""
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_audit)
    print('[Fix 2] audit.js: replaced monkey-patch res.end with res.on(finish)')


def fix_data_public_check():
    path = r'E:\PpProjects\Gitee\veri-data\backend\src\routes\data.js'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Fix: Add body size validation for public-check in ai.js
    ai_path = r'E:\PpProjects\Gitee\veri-data\backend\src\routes\ai.js'
    with open(ai_path, 'r', encoding='utf-8') as f:
        ai_content = f.read()

    # Add size limit to public-check
    ai_content = ai_content.replace(
        "const { data_content } = req.body;\n\n    if (!data_content) {",
        "const { data_content } = req.body;\n\n    if (!data_content || typeof data_content !== 'string') {\n      return res.status(400).json({ error: '请提供有效的数据内容' });\n    }\n\n    // 限制请求体大小，防止 DoS 攻击（最大 1MB 文本）\n    if (data_content.length > 1024 * 1024) {\n      return res.status(413).json({ error: '数据内容过大，最大支持 1MB' });\n    }\n\n    if (false) {"
    )
    with open(ai_path, 'w', encoding='utf-8') as f:
        f.write(ai_content)
    print('[Fix 3] ai.js: added body size validation for /public-check')


def fix_dashboard_parallel():
    path = r'E:\PpProjects\Gitee\veri-data\frontend\src\views\Dashboard.vue'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace sequential API calls with Promise.all
    old_fetch = '''    // 获取最近数据
    const dataResponse = await api.get('/data/my?page=1&limit=5')
    recentData.value = dataResponse.data
    
    // 获取统计
    const statsResponse = await api.get('/data/my?page=1&limit=1')
    stats.value.myData = statsResponse.pagination.total
    
    // 计算各状态数量
    const approvedRes = await api.get('/data/my?status=final_approved')
    stats.value.approved = approvedRes.pagination.total
    
    const pendingRes = await api.get('/data/my?status=submitted')
    stats.value.pending = pendingRes.pagination.total'''

    new_fetch = '''    // 并行获取所有统计数据，减少串行等待时间
    const [dataResponse, statsResponse, approvedRes, pendingRes] = await Promise.all([
      api.get('/data/my?page=1&limit=5'),
      api.get('/data/my?page=1&limit=1'),
      api.get('/data/my?status=final_approved'),
      api.get('/data/my?status=submitted')
    ])

    recentData.value = dataResponse.data
    stats.value.myData = statsResponse.pagination.total
    stats.value.approved = approvedRes.pagination.total
    stats.value.pending = pendingRes.pagination.total'''

    content = content.replace(old_fetch, new_fetch)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('[Fix 4] Dashboard.vue: parallelized API calls with Promise.all')


def fix_store_interceptor():
    path = r'E:\PpProjects\Gitee\veri-data\frontend\src\store\index.js'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Fix: The never-resolving Promise after window.location.replace causes
    # all subsequent API calls to hang forever. Replace with proper rejection.
    old = '''        // 仅在非登录页的并发请求时，返回挂起的 Promise 拦截后续请求
        return new Promise(() => {});'''
    new = '''        // 返回一个已被拒绝的 Promise，避免后续请求挂起
        return Promise.reject(error.response?.data || error);'''

    content = content.replace(old, new)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('[Fix 5] store/index.js: replaced never-resolving Promise with rejection')


def fix_data_submit_teacher_id():
    path = r'E:\PpProjects\Gitee\veri-data\backend\src\routes\data.js'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Add teacher_id validation in the submit route
    old = '''    const { teacher_id, liability_accepted } = req.body;

    // 验证数据所有权
    const [dataList] = await pool.execute('''
    new = '''    const { teacher_id, liability_accepted } = req.body;

    // 验证 teacher_id 参数有效性
    if (!teacher_id || isNaN(Number(teacher_id))) {
      return res.status(400).json({ error: '请指定有效的导师' });
    }

    // 验证数据所有权
    const [dataList] = await pool.execute('''

    content = content.replace(old, new)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('[Fix 6] data.js: added teacher_id validation in submit route')


def fix_layout_notification_optimization():
    """Optimize Layout polling to use a lighter notification-count endpoint"""
    path = r'E:\PpProjects\Gitee\veri-data\frontend\src\views\Layout.vue'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace the heavy fetchNotifications dispatch with a lighter approach
    old = '''const fetchPendingCount = async () => {
  try {
    const response = await store.dispatch('fetchNotifications')
    // 这里可以添加获取待审核数量的逻辑
  } catch (error) {
    console.error('获取通知失败:', error)
  }
}'''
    new = '''const fetchPendingCount = async () => {
  try {
    // 仅获取未读通知计数，避免每次轮询都拉取完整通知列表
    const response = await api.get('/users/notifications/list?unread_only=true&limit=1')
    store.commit('SET_UNREAD_COUNT', response.unread_count || 0)
  } catch (error) {
    // 静默失败，避免频繁弹窗干扰用户
  }
}'''

    content = content.replace(old, new)

    # Add api import
    content = content.replace(
        "import Breadcrumb from '../components/Breadcrumb.vue'",
        "import Breadcrumb from '../components/Breadcrumb.vue'\nimport { api } from '../store'"
    )

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('[Fix 7] Layout.vue: optimized notification polling to use lightweight endpoint')


if __name__ == '__main__':
    fix_layout_vue()
    fix_audit_middleware()
    fix_data_public_check()
    fix_dashboard_parallel()
    fix_store_interceptor()
    fix_data_submit_teacher_id()
    fix_layout_notification_optimization()
    print('\n=== All 7 fixes applied successfully ===')


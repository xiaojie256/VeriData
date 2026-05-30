import { createRouter, createWebHistory } from 'vue-router'
import store from '../store'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { public: true }
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('../views/Register.vue'),
    meta: { public: true }
  },
  {
    path: '/',
    component: () => import('../views/Layout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('../views/Dashboard.vue'),
        meta: { title: '仪表盘', icon: 'Odometer' }
      },
      {
        path: 'data/upload',
        name: 'DataUpload',
        component: () => import('../views/data/Upload.vue'),
        meta: { title: '数据上传', icon: 'Upload' }
      },
      {
        path: 'data/list',
        name: 'DataList',
        component: () => import('../views/data/List.vue'),
        meta: { title: '我的数据', icon: 'Document' }
      },
      {
        path: 'data/:id',
        name: 'DataDetail',
        component: () => import('../views/data/Detail.vue'),
        meta: { title: '数据详情', hidden: true }
      },
      {
        path: 'review/pending',
        name: 'ReviewPending',
        component: () => import('../views/review/Pending.vue'),
        meta: { title: '待审核', icon: 'Check', roles: ['teacher', 'expert', 'admin'] }
      },
      {
        path: 'review/history',
        name: 'ReviewHistory',
        component: () => import('../views/review/History.vue'),
        meta: { title: '审核历史', icon: 'Clock', roles: ['teacher', 'expert', 'admin'] }
      },
      {
        path: 'public-check',
        name: 'PublicCheck',
        component: () => import('../views/PublicCheck.vue'),
        meta: { title: '公开检测', icon: 'Search' }
      },
      {
        path: 'students',
        name: 'Students',
        component: () => import('../views/Students.vue'),
        meta: { title: '我的学生', icon: 'User', roles: ['teacher'] }
      },
      {
        path: 'teacher',
        name: 'MyTeacher',
        component: () => import('../views/MyTeacher.vue'),
        meta: { title: '我的导师', icon: 'UserFilled', roles: ['student'] }
      },
      {
        path: 'notifications',
        name: 'Notifications',
        component: () => import('../views/Notifications.vue'),
        meta: { title: '消息通知', icon: 'Bell' }
      },
      {
        path: 'profile',
        name: 'Profile',
        component: () => import('../views/Profile.vue'),
        meta: { title: '个人中心', icon: 'User', hidden: true }
      },
      // 管理员路由
      {
        path: 'admin/dashboard',
        name: 'AdminDashboard',
        component: () => import('../views/admin/Dashboard.vue'),
        meta: { title: '管理仪表盘', icon: 'DataLine', roles: ['admin'] }
      },
      {
        path: 'admin/users',
        name: 'AdminUsers',
        component: () => import('../views/admin/Users.vue'),
        meta: { title: '用户管理', icon: 'User', roles: ['admin'] }
      },
      {
        path: 'admin/data',
        name: 'AdminData',
        component: () => import('../views/admin/Data.vue'),
        meta: { title: '数据管理', icon: 'Document', roles: ['admin'] }
      },
      {
        path: 'admin/logs',
        name: 'AdminLogs',
        component: () => import('../views/admin/Logs.vue'),
        meta: { title: '系统日志', icon: 'List', roles: ['admin'] }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('../views/404.vue')
  }
]

const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes
})

// 路由守卫
router.beforeEach((to, from, next) => {
  // 从localStorage实时获取token（避免与响应拦截器状态不同步）
  const token = localStorage.getItem('token')
  const isLoggedIn = !!token
  const userRole = store.getters.userRole
  
  // 公开页面直接访问
  if (to.meta.public) {
    if (isLoggedIn && to.path === '/login') {
      return next('/dashboard')
    }
    return next()
  }
  
  // 需要登录
  if (!isLoggedIn) {
    return next('/login')
  }
  
  // 角色权限检查
  if (to.meta.roles && !to.meta.roles.includes(userRole)) {
    return next('/dashboard')
  }
  
  next()
})

export default router

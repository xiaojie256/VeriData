import { createStore } from 'vuex'
import axios from 'axios'

const API_URL = process.env.VUE_APP_API_URL || 'http://localhost:3000/api'

// 创建axios实例
const api = axios.create({
  baseURL: API_URL,
  timeout: 30000
})

// 请求拦截器
api.interceptors.request.use(
  config => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  error => {
    return Promise.reject(error)
  }
)

// 响应拦截器
api.interceptors.response.use(
  response => response.data,
  error => {
    const status = error.response?.status;
    const errorMsg = error.response?.data?.error;

    // 1. 如果是 401 未登录，或者 403 且后端明确返回账号被封禁
    if (status === 401 || (status === 403 && errorMsg === '账号已被封禁')) {
      // 清除本地过期的无用凭证
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      
      // 新增：判断当前是否已经在登录页
      const isAtLogin = window.location.pathname.includes('/login');
      
      if (!isAtLogin) {
        if (status === 403) {
          alert('您的账号已被封禁，请联系管理员！');
        }
        // 强制重定向回登录页
        window.location.replace('/login')
        
        // 仅在非登录页的并发请求时，返回挂起的 Promise 拦截满屏红字
        return new Promise(() => {});
      }
      
      // 修改：如果本身就在登录页发起的登录，必须正常抛出错误，供登录组件捕获关闭转圈并报错
      return Promise.reject(error.response?.data || error);
    }

    return Promise.reject(error.response?.data || error)
  }
)

export { api }

// 安全地从localStorage解析用户数据
const parseUserFromStorage = () => {
  const userStr = localStorage.getItem('user')
  if (!userStr || userStr === 'null' || userStr === 'undefined') {
    return null
  }
  try {
    return JSON.parse(userStr)
  } catch (e) {
    console.error('解析用户数据失败:', e)
    localStorage.removeItem('user')
    return null
  }
}

export default createStore({
  state: {
    user: parseUserFromStorage(),
    token: localStorage.getItem('token') || null,
    notifications: [],
    unreadCount: 0
  },
  
  getters: {
    isLoggedIn: state => !!state.token,
    userRole: state => state.user?.role,
    userName: state => state.user?.real_name || state.user?.username,
    userAvatar: state => state.user?.avatar_url
  },
  
  mutations: {
    SET_USER(state, user) {
      state.user = user
      localStorage.setItem('user', JSON.stringify(user))
    },
    SET_TOKEN(state, token) {
      state.token = token
      localStorage.setItem('token', token)
    },
    CLEAR_AUTH(state) {
      state.user = null
      state.token = null
      localStorage.removeItem('user')
      localStorage.removeItem('token')
    },
    SET_NOTIFICATIONS(state, notifications) {
      state.notifications = notifications
    },
    SET_UNREAD_COUNT(state, count) {
      state.unreadCount = count
    }
  },
  
  actions: {
    // 登录
    async login({ commit }, credentials) {
      const response = await api.post('/auth/login', credentials)
      const data = response.data || response
      commit('SET_TOKEN', data.token)
      commit('SET_USER', data.user)
      return response
    },
    
    // 注册
    async register({ commit }, userData) {
      const response = await api.post('/auth/register', userData)
      const data = response.data || response
      commit('SET_TOKEN', data.token)
      commit('SET_USER', data.user)
      return response
    },
    
    // 登出
    logout({ commit }) {
      commit('CLEAR_AUTH')
    },
    
    // 获取当前用户
    async fetchUser({ commit }) {
      const response = await api.get('/auth/me')
      commit('SET_USER', response.data)
      return response.data
    },
    
    // 获取通知
    async fetchNotifications({ commit }) {
      const response = await api.get('/users/notifications/list')
      commit('SET_NOTIFICATIONS', response.notifications)
      commit('SET_UNREAD_COUNT', response.unread_count)
      return response
    },
    
    // 标记通知已读
    async markNotificationRead({ dispatch }, id) {
      await api.post(`/users/notifications/${id}/read`)
      dispatch('fetchNotifications')
    }
  }
})

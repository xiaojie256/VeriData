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
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      // 避免重复跳转，只在当前不是登录页时跳转
      if (!window.location.pathname.includes('/login')) {
        window.location.replace('/login')
      }
    }
    return Promise.reject(error.response?.data || error)
  }
)

export { api }

export default createStore({
  state: {
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    token: localStorage.getItem('token'),
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
      commit('SET_USER', response.user)
      return response.user
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

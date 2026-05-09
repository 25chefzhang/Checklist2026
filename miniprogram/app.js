// app.js — 全局入口，负责云开发初始化、openid 获取、提醒引擎启停

App({
  globalData: {
    openid: '',
    reminderManager: null,
    settings: null
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }

    wx.cloud.init({
      env: 'cloud1-d0gmkxqwt62ea4788',
      traceUser: true
    })

    // 异步获取 openid，不阻塞启动
    this.getOpenid()

    // 延迟初始化提醒管理器（等 openid 就绪后再启动也没问题）
    const reminder = require('./utils/reminder.js')
    this.globalData.reminderManager = new reminder.ReminderManager()
  },

  onShow() {
    if (this.globalData.reminderManager && this.globalData.openid) {
      this.globalData.reminderManager.start()
    }
  },

  onHide() {
    if (this.globalData.reminderManager) {
      this.globalData.reminderManager.stop()
    }
  },

  async getOpenid() {
    // 先用 wx.login 获取 code 作为临时标识（不阻塞）
    try {
      const loginRes = await this.wxLoginAsync()
      if (loginRes.code) {
        this.globalData.openid = loginRes.code
      }
    } catch (e) {
      console.warn('wx.login 失败:', e)
    }

    // 然后尝试云函数获取真正的 openid（不阻塞，静默替换）
    try {
      const res = await this.callFunctionWithTimeout('getOpenid', {}, 5000)
      if (res && res.result && res.result.openid) {
        this.globalData.openid = res.result.openid
        console.log('openid 获取成功:', this.globalData.openid)
      }
    } catch (e) {
      console.warn('云函数 getOpenid 不可用（未部署？），使用 login code 作为标识')
    }
  },

  // 带超时的 callFunction
  callFunctionWithTimeout(name, data, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('callFunction timeout')), timeoutMs)
      wx.cloud.callFunction({ name, data })
        .then(res => { clearTimeout(timer); resolve(res) })
        .catch(err => { clearTimeout(timer); reject(err) })
    })
  },

  // Promise 化的 wx.login
  wxLoginAsync() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: resolve,
        fail: reject
      })
    })
  }
})

// app.js — 全局入口，负责云开发初始化、openid 获取、提醒引擎启停
const reminder = require('./utils/reminder.js')

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
      env: 'your-env-id', // TODO: 替换为你的云环境 ID
      traceUser: true
    })

    this.getOpenid()
    this.globalData.reminderManager = new reminder.ReminderManager()
  },

  onShow() {
    if (this.globalData.reminderManager) {
      this.globalData.reminderManager.start()
    }
  },

  onHide() {
    if (this.globalData.reminderManager) {
      this.globalData.reminderManager.stop()
    }
  },

  async getOpenid() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getOpenid' })
      this.globalData.openid = res.result.openid
    } catch (e) {
      console.error('获取 openid 失败:', e)
      // 降级：尝试用 wx.login 获取
      const loginRes = await wx.login()
      this.globalData.openid = loginRes.code // 实际需要后端换取
    }
  }
})

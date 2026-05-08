// pages/index/index.js — 任务列表主页逻辑
const db = require('../../utils/db.js')
const dateUtil = require('../../utils/date.js')
const clipboard = require('../../utils/clipboard.js')

const app = getApp()

Page({
  data: {
    tasks: [],
    loading: true,
    isRefreshing: false,
    dateRangeLabel: '',
    completingId: null,   // 正在确认完成的任务 _id
    isPC: false
  },

  // ===== 生命周期 =====

  onLoad() {
    // 检测 PC 平台
    const systemInfo = wx.getSystemInfoSync()
    const platform = systemInfo.platform || ''
    this.setData({
      isPC: platform === 'windows' || platform === 'mac'
    })
  },

  async onShow() {
    await this.loadTasks()

    // 检查剪贴板是否有任务文本
    if (app.globalData.openid) {
      this.checkClipboard()
    }
  },

  // ===== 下拉刷新 =====
  async onPullDownRefresh() {
    this.setData({ isRefreshing: true })
    try {
      await this.loadTasks()
    } finally {
      this.setData({ isRefreshing: false })
      wx.stopPullDownRefresh()
    }
  },

  // ===== 任务列表加载 =====
  async loadTasks() {
    const openid = app.globalData.openid
    if (!openid) {
      // openid 尚未获取，稍后重试
      setTimeout(() => this.loadTasks(), 1000)
      return
    }

    this.setData({ loading: true })

    try {
      const tasks = await db.getRecentTasks(openid)

      // 计算日期范围标签
      const range = dateUtil.getDateRange()
      const dateRangeLabel = `${range.startLabel} — ${range.endLabel}`

      // 给每个任务附加展示用的字段
      const enrichedTasks = tasks.map(task => ({
        ...task,
        dueLabel: dateUtil.relativeDate(task.due_date),
        remindLabel: this.formatRemindLabel(task)
      }))

      this.setData({
        tasks: enrichedTasks,
        dateRangeLabel,
        loading: false
      })
    } catch (e) {
      console.error('加载任务失败:', e)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // ===== 格式化提醒标签 =====
  formatRemindLabel(task) {
    if (!task.remind_at || task.remind_at.length === 0) return ''

    if (task.remind_mode === 'flexible' && task.remind_interval_minutes > 0) {
      return `每隔${task.remind_interval_minutes}分钟提醒`
    }

    // 固定时间提醒，显示第一个时间点
    return `⏰ ${task.remind_at[0]}`
  },

  // ===== 点击任务卡片 → 跳转详情 =====
  onTaskTap(e) {
    const id = e.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({
        url: `/pages/detail/detail?id=${id}`
      })
    }
  },

  // ===== 点击完成按钮（catchtap 阻止冒泡） =====
  onCompleteTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return

    const task = this.data.tasks.find(t => t._id === id)
    if (!task) return

    wx.showModal({
      title: '确认完成',
      content: `标记「${task.content}」为已完成？`,
      confirmText: '完成 ✓',
      cancelText: '取消',
      success: async (res) => {
        if (res.confirm) {
          await this.completeTask(id)
        }
      }
    })
  },

  // ===== 执行完成任务 =====
  async completeTask(id) {
    this.setData({ completingId: id })

    try {
      await db.updateTaskStatus(id, 'done')

      wx.showToast({ title: '已完成 ✓', icon: 'success' })

      // 从列表中移除
      const tasks = this.data.tasks.filter(t => t._id !== id)
      const app = getApp()

      // 如果是最后一个任务，可能需要更新日期范围
      const range = dateUtil.getDateRange()
      const dateRangeLabel = `${range.startLabel} — ${range.endLabel}`

      this.setData({
        tasks,
        dateRangeLabel,
        completingId: null
      })
    } catch (e) {
      console.error('完成任务失败:', e)
      this.setData({ completingId: null })
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  // ===== 剪贴板检查 =====
  async checkClipboard() {
    try {
      const text = await clipboard.getClipboardText()
      if (!text) return

      const result = clipboard.analyzeText(text)
      if (!result.isLikely || result.confidence < 1) return

      // 匹配度高，弹窗询问用户
      wx.showModal({
        title: '📋 检测到任务文本',
        content: `剪贴板内容：\n「${text.length > 60 ? text.slice(0, 60) + '...' : text}」\n\n是否将其添加为任务？`,
        confirmText: '添加',
        cancelText: '忽略',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({
              url: `/pages/add/add?mode=clipboard&text=${encodeURIComponent(text)}`
            })
          }
        }
      })
    } catch (e) {
      // 静默失败，用户可能未授权剪贴板
      console.log('剪贴板检查跳过:', e)
    }
  },

  // ===== 底部操作栏点击 =====
  onAddTap(e) {
    const mode = e.currentTarget.dataset.mode
    if (!mode) return

    wx.navigateTo({
      url: `/pages/add/add?mode=${mode}`
    })
  },

  // ===== 工作总结 =====
  onSummaryTap() {
    wx.navigateTo({
      url: '/pages/summary/summary'
    })
  },

  // ===== PC 端置顶窗口 =====
  onPinWindow() {
    wx.showToast({ title: '请在PC客户端手动置顶', icon: 'none', duration: 2000 })
  }
})

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
    isPC: false,

    // ===== 闹钟提醒 =====
    showAlarm: false,
    alarmTask: null,        // 当前闹钟对应的任务对象
    alarmReminder: null     // 当前闹钟对应的 reminder 对象
  },

  // ===== 生命周期 =====

  onLoad(options) {
    // 检测 PC 平台
    const systemInfo = wx.getSystemInfoSync()
    const platform = systemInfo.platform || ''
    this.setData({
      isPC: platform === 'windows' || platform === 'mac'
    })

    // 注册闹钟回调到 ReminderManager
    if (app.globalData.reminderManager) {
      app.globalData.reminderManager.alarmCallback = this._onAlarm.bind(this)
    }

    // 检测是否从转发进入（群聊消息转发）
    if (options.forward_text) {
      this._handleForwardedMessage(decodeURIComponent(options.forward_text))
    }
  },

  async onShow() {
    await this.loadTasks()

    // 检查剪贴板是否有任务文本
    if (app.globalData.openid) {
      this.checkClipboard()
    }

    // 检查是否从群聊分享卡片进入（带 shareTicket）
    this._checkForwardScene()
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
      await db.updateTaskStatus(id, 'completed')

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

  // ===== 剪贴板检查（增强版：支持群聊消息识别 + 去重） =====
  async checkClipboard() {
    try {
      const text = await clipboard.getClipboardText()
      if (!text) return

      // ---- 去重：用简单哈希避免同一内容反复弹窗 ----
      const textHash = this._simpleHash(text.trim())
      const LAST_CLIPBOARD_HASH_KEY = 'last_clipboard_hash'
      const lastHash = wx.getStorageSync(LAST_CLIPBOARD_HASH_KEY) || ''

      if (textHash === lastHash) {
        console.log('[剪贴板] 内容未变化，跳过')
        return
      }

      const result = clipboard.analyzeText(text)

      // 置信度太低，跳过
      if (!result.isLikely || result.confidence < 20) return

      // 无论用户是否添加，都记录此哈希以避免重复弹窗
      wx.setStorageSync(LAST_CLIPBOARD_HASH_KEY, textHash)

      // 构建提示文案
      let title = '📋 检测到任务文本'
      let content = `「${text.length > 80 ? text.slice(0, 80) + '...' : text}」`

      // 群聊消息 → 显示更多信息
      if (result.isGroupChat && result.mentions.length > 0) {
        title = '💬 检测到群聊任务'
        content = `来源：群聊消息\n${result.mentions.length > 0 ? '提及：@' + result.mentions.join(', @') + '\\n' : ''}内容：「${text.length > 60 ? text.slice(0, 60) + '...' : text}」`
      }

      // 【任务】【待办】标记 → 高优先级
      if (result.tags.length > 0) {
        content = `标记：${result.tags.map(t => '【' + t + '】').join(' ')}\\n` + content
      }

      content += `\\n\\n置信度：${result.confidence}%`
      content += `\\n是否将其添加为任务？`

      wx.showModal({
        title,
        content,
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

  /** 简单哈希函数，用于剪贴板去重 */
  _simpleHash(str) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash |= 0 // 转为 32 位整数
    }
    return String(hash)
  },

  // ===== 转发消息处理 =====

  /**
   * 处理从群聊转发的消息
   * 小程序分享卡片支持 `path` 传参：pages/index/index?forward_text=xxx
   */
  _handleForwardedMessage(text) {
    if (!text || !text.trim()) return

    const result = clipboard.analyzeText(text)

    if (result.isLikely && result.confidence >= 20) {
      // 直接弹窗问用户是否添加
      const title = result.isGroupChat ? '💬 收到群聊任务' : '📨 收到转发任务'
      const content = `内容：「${text.length > 80 ? text.slice(0, 80) + '...' : text}」`
        + `\\n\\n置信度：${result.confidence}%`
        + (result.mentions.length > 0 ? `\\n提及：@${result.mentions.join(', @')}` : '')
        + `\\n\\n是否添加为任务？`

      wx.showModal({
        title,
        content,
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
    }
  },

  /**
   * 检查是否从群聊分享卡片进入（微信聊天 → 转发小程序卡片）
   * shareTicket 可用于获取群信息，但需要 wx.getShareInfo
   */
  _checkForwardScene() {
    try {
      const app = getApp()
      const scene = app.globalData.scene || ''
      // 场景值 1044 = 带 shareTicket 的小程序消息卡片（从群聊进入）
      if (scene === 1044 && app.globalData.shareTicket) {
        // 注：wx.getShareInfo 需要用户主动触发（如按钮点击），不能自动调用
        // 此处仅记录日志，实际群信息获取需用户交互
        console.log('[转发] 从群聊分享卡片进入, shareTicket:', app.globalData.shareTicket)
      }
    } catch (e) {
      // 静默
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
  },

  // ================================================================
  //  闹钟提醒
  // ================================================================

  /**
   * 闹钟回调 —— 由 ReminderManager 调用
   * 返回 Promise，在用户操作后 resolve
   */
  _onAlarm(task, reminder) {
    return new Promise((resolve) => {
      this._alarmResolve = resolve
      const dateLabel = dateUtil.relativeDate(task.due_date)
      this.setData({
        showAlarm: true,
        alarmTask: { ...task, dueLabel: dateLabel },
        alarmReminder: reminder
      })
    })
  },

  /**
   * 闹钟 — 标记完成
   */
  async onAlarmComplete() {
    const { alarmTask, alarmReminder } = this.data
    const resolve = this._alarmResolve

    try {
      await db.updateTaskStatus(alarmTask._id, 'completed')
      await db.updateReminder(alarmReminder._id, {
        status: 'confirmed',
        confirmed_at: new Date().toISOString()
      })
      wx.showToast({ title: '已完成 ✓', icon: 'success' })
    } catch (e) {
      console.error('[闹钟] 标记完成失败:', e)
      wx.showToast({ title: '操作失败', icon: 'none' })
    }

    // 关闭闹钟 + 刷新列表
    this.setData({ showAlarm: false, alarmTask: null, alarmReminder: null })
    this.loadTasks()
    if (resolve) resolve()
  },

  /**
   * 闹钟 — 稍后提醒
   */
  async onAlarmSnooze() {
    const { alarmTask, alarmReminder } = this.data
    const resolve = this._alarmResolve
    const reminderManager = app.globalData.reminderManager

    try {
      if (alarmTask.remind_mode === 'flexible' && alarmTask.remind_interval_minutes > 0) {
        const nextRemind = new Date()
        nextRemind.setMinutes(nextRemind.getMinutes() + alarmTask.remind_interval_minutes)
        await db.updateReminder(alarmReminder._id, {
          remind_time: nextRemind.toISOString()
        })
      } else {
        await db.updateReminder(alarmReminder._id, { status: 'sent' })
      }
    } catch (e) {
      console.error('[闹钟] 稍后提醒失败:', e)
    }

    this.setData({ showAlarm: false, alarmTask: null, alarmReminder: null })
    if (resolve) resolve()
  }
})

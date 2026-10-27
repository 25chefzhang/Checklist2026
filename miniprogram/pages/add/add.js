// pages/add/add.js — 添加任务页
// 已移除 WechatSI 插件依赖，改用 voice.js 工具（云函数识别降级方案）
// v2: 支持群聊消息多任务拆分

const db = require('../../utils/db.js')
const dateUtil = require('../../utils/date.js')
const clipboardUtil = require('../../utils/clipboard.js')
const reminderUtil = require('../../utils/reminder.js')
const voice = require('../../utils/voice.js')
const chatUtil = require('../../utils/chat.js')
const parse = require('../../utils/parse.js')
const config = require('../../config.js')

const app = getApp()

Page({
  data: {
    // 当前模式：voice / clipboard / manual
    mode: 'manual',

    // ===== 语音模式 =====
    isRecording: false,
    recordSeconds: 0,
    recognizedText: '',
    recognizedMeta: '',    // 识别解析摘要（时间/紧急度/频率）

    // ===== 剪贴板模式 =====
    clipboardText: '',
    clipboardFetched: false,

    // ===== 手动模式 =====
    manualInput: '',

    // ===== 多任务拆分模式（群聊消息转发场景） =====
    multiTasks: [],         // [{content, summary, confidence, priority, dueDate}]
    showMultiConfirm: false,
    targetTaskIndex: 0,     // 当前正在确认的任务索引

    // ===== 确认弹窗 =====
    showConfirm: false,
    taskContent: '',
    dueDate: '',
    dueTime: '',          // 解析出的具体时刻（HH:mm），可编辑
    dueDatetime: null,    // 完整截止时间（YYYY-MM-DD HH:mm）
    priority: 'medium',
    remindMode: 'flexible',    // 'fixed' | 'flexible'
    remindTime: '09:00',
    remindInterval: 60
  },

  // ---- 录音相关 ----
  _recordTimer: null,
  _recognizer: null,

  // ================================================================
  //  生命周期
  // ================================================================

  onLoad(options) {
    // 1. 确定模式
    if (options.mode && ['voice', 'clipboard', 'manual'].includes(options.mode)) {
      this.setData({ mode: options.mode })
    }

    // 2. 初始化语音识别器（插件优先，云函数降级）
    this._initRecognizer()

    // 3. 如果从 index 页跳转过来（带 content / text 参数），自动弹出确认弹窗
    const incoming = decodeURIComponent(options.content || options.text || '').trim()
    if (incoming) {
      // 检测是否为多消息（群聊转发）
      if (chatUtil.looksLikeMultipleMessages(incoming)) {
        this._handleMultiMessage(incoming)
      } else {
        this.showConfirmDialog(incoming)
      }
    }

    // 4. 设置默认截止日期为今天
    this.setData({
      dueDate: dateUtil.formatDate(new Date())
    })
  },

  onUnload() {
    // 停止录音 + 释放识别器
    if (this._recognizer && this._recognizer.stop) {
      try { this._recognizer.stop() } catch (e) { /* ignore */ }
    }

    // 清理定时器
    if (this._recordTimer) {
      clearInterval(this._recordTimer)
      this._recordTimer = null
    }
  },

  // ================================================================
  //  Tab 切换
  // ================================================================

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    this.setData({
      mode,
      // 重置各模式状态
      isRecording: false,
      recordSeconds: 0,
      recognizedText: '',
      clipboardText: '',
      clipboardFetched: false,
      manualInput: ''
    })

    // 切到剪贴板模式自动获取
    if (mode === 'clipboard') {
      this.fetchClipboard()
    }
  },

  // ================================================================
  //  语音模式
  // ================================================================

  /** 初始化语音识别器（插件优先，云函数降级） */
  _initRecognizer() {
    this._recognizer = voice.createRecognizer({
      onStart: () => {
        console.log('[add] 录音开始（后端: ' + (this._recognizer && this._recognizer.mode) + '）')
        this.setData({ isRecording: true, recordSeconds: 0, recognizedText: '', recognizedMeta: '' })
      },
      onResult: (text) => this._onRecognized(text),
      onError: (msg) => this._onRecognizeError(msg)
    })
  },

  /** 识别成功回调 */
  _onRecognized(text) {
    this.setData({ isRecording: false })
    this._clearRecordTimer()

    if (text) {
      const parsed = parse.parseTask(text)
      console.log('[add] 识别成功:', text, '→ 解析:', parsed)
      this.setData({
        recognizedText: text,
        recognizedMeta: this._buildMeta(parsed)
      })
    } else {
      this.setData({ recognizedText: '', recognizedMeta: '' })
      wx.showToast({ title: '语音识别失败，请手动输入', icon: 'none' })
    }
  },

  /** 识别失败回调 */
  _onRecognizeError(msg) {
    this.setData({ isRecording: false, recognizedText: '', recognizedMeta: '' })
    this._clearRecordTimer()
    console.error('[add] 识别异常:', msg)
    wx.showToast({ title: msg || '语音识别失败，请手动输入', icon: 'none' })
  },

  /** 生成解析摘要文案 */
  _buildMeta(parsed) {
    const prioLabel = { urgent: '🔴紧急', high: '🟠高', medium: '🟡中', low: '🟢低' }[parsed.priority] || parsed.priority
    const timePart = parsed.dueTime ? `${parsed.dueDate} ${parsed.dueTime}` : parsed.dueDate
    const freqPart = parsed.remindIntervalMinutes > 0
      ? `每${parse.formatIntervalMinutes(parsed.remindIntervalMinutes)}提醒`
      : '截止前每日提醒'
    return `${timePart} · ${prioLabel} · ${freqPart}`
  },

  /** 按住开始录音 */
  onVoiceTouchStart() {
    // 先请求录音权限
    wx.authorize({
      scope: 'scope.record',
      success: () => {
        this._startRecording()
      },
      fail: () => {
        wx.showModal({
          title: '需要录音权限',
          content: '请在设置中允许小程序使用麦克风',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) wx.openSetting()
          }
        })
      }
    })
  },

  _startRecording() {
    if (!this._recognizer) this._initRecognizer()

    this._recognizer.start()

    // 计时器（UI 展示用）
    this._clearRecordTimer()
    this._recordTimer = setInterval(() => {
      const seconds = this.data.recordSeconds + 1
      this.setData({ recordSeconds: seconds })
      // 60 秒自动停止
      if (seconds >= 60) {
        this.onVoiceTouchEnd()
      }
    }, 1000)
  },

  /** 松开结束录音 */
  onVoiceTouchEnd() {
    if (!this.data.isRecording) return

    if (this._recognizer && this._recognizer.stop) {
      this._recognizer.stop()
    }
  },

  /** 清除计时器 */
  _clearRecordTimer() {
    if (this._recordTimer) {
      clearInterval(this._recordTimer)
      this._recordTimer = null
    }
  },

  /** 重新录音 */
  onVoiceRetry() {
    this.setData({
      recognizedText: '',
      recognizedMeta: '',
      recordSeconds: 0
    })
  },

  /** 确认为工作任务 → 弹出确认弹窗 */
  onVoiceConfirm() {
    if (!this.data.recognizedText.trim()) {
      wx.showToast({ title: '请先录音', icon: 'none' })
      return
    }
    this.showConfirmDialog(this.data.recognizedText.trim())
  },

  // ================================================================
  //  剪贴板模式
  // ================================================================

  onGetClipboard() {
    this.fetchClipboard()
  },

  async fetchClipboard() {
    wx.showLoading({ title: '读取中...' })
    try {
      const text = await clipboardUtil.getClipboardText()
      wx.hideLoading()

      this.setData({
        clipboardText: text,
        clipboardFetched: true
      })

      if (!text) {
        wx.showToast({ title: '剪贴板为空', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      console.error('获取剪贴板失败:', e)
      wx.showToast({ title: '获取失败，请重试', icon: 'none' })
    }
  },

  /** 剪贴板确认为工作任务 */
  onClipboardConfirm() {
    if (!this.data.clipboardText.trim()) {
      wx.showToast({ title: '剪贴板无内容', icon: 'none' })
      return
    }
    this.showConfirmDialog(this.data.clipboardText.trim())
  },

  // ================================================================
  //  手动模式
  // ================================================================

  onManualInput(e) {
    this.setData({ manualInput: e.detail.value })
  },

  onManualConfirm() {
    const text = this.data.manualInput.trim()
    if (!text) {
      wx.showToast({ title: '请输入任务内容', icon: 'none' })
      return
    }
    this.showConfirmDialog(text)
  },

  // ================================================================
  //  确认弹窗
  // ================================================================

  /**
   * 显示确认弹窗
   * @param {string} content 任务内容文本（语音识别/剪贴板/手动输入）
   */
  showConfirmDialog(content) {
    // 解析出时间 / 任务内容 / 紧急度 / 提醒频率
    const parsed = parse.parseTask(content)

    // 频率映射：低优先级 → 固定模式单次提醒；其余 → 间隔模式按频率提醒
    let remindMode = 'flexible'
    let remindInterval = parsed.remindIntervalMinutes
    if (remindInterval <= 0) {
      remindMode = 'fixed'
      remindInterval = 0
    }
    const remindTime = parsed.dueTime || '09:00'

    this.setData({
      taskContent: parsed.content,
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime || '',
      dueDatetime: parsed.dueDatetime,
      priority: parsed.priority,
      remindMode,
      remindTime,
      remindInterval,
      showConfirm: true
    })
  },

  hideConfirmDialog() {
    this.setData({ showConfirm: false })
  },

  noop() {
    // 阻止弹窗点击穿透
  },

  /** 根据优先级计算提醒字段（紧急 2h / 高 半天 / 中 每天 / 低 截止前每日固定） */
  _remindFieldsForPriority(priority) {
    const freq = parse.PRIORITY_FREQUENCY[priority] !== undefined ? parse.PRIORITY_FREQUENCY[priority] : 0
    if (freq > 0) {
      return { remind_mode: 'flexible', remind_at: [], remind_interval_minutes: freq }
    }
    return { remind_mode: 'fixed', remind_at: ['09:00'], remind_interval_minutes: 0 }
  },

  /**
   * 请求订阅消息授权（一次性：授权一次只能发一条后台推送）
   * 授权失败或用户拒绝不影响任务添加。
   */
  _requestSubscribe() {
    return new Promise((resolve) => {
      wx.requestSubscribeMessage({
        tmplIds: [config.SUBSCRIBE_TEMPLATE_ID],
        success: (res) => {
          // res[templateId] 取值：'accept' 同意 / 'reject' 拒绝 / 'ban' 已禁止
          console.log('[订阅] 授权结果:', res)
          resolve()
        },
        fail: (err) => {
          console.warn('[订阅] 授权失败:', err)
          resolve()
        }
      })
    })
  },

  // ---- 弹窗字段变更 ----

  onTaskContentChange(e) {
    this.setData({ taskContent: e.detail.value })
  },

  onDueDateChange(e) {
    const dueDate = e.detail.value
    this.setData({
      dueDate,
      dueDatetime: this.data.dueTime ? `${dueDate} ${this.data.dueTime}` : null
    })
  },

  onDueTimeChange(e) {
    const dueTime = e.detail.value
    this.setData({
      dueTime,
      dueDatetime: `${this.data.dueDate} ${dueTime}`
    })
  },

  onPriorityTap(e) {
    const priority = e.currentTarget.dataset.priority
    // 联动提醒频率：紧急 2h / 高 半天 / 中 每天 / 低 单次
    const freq = parse.PRIORITY_FREQUENCY[priority] !== undefined ? parse.PRIORITY_FREQUENCY[priority] : 0
    this.setData({
      priority,
      remindMode: freq > 0 ? 'flexible' : 'fixed',
      remindInterval: freq
    })
  },

  onRemindModeTap(e) {
    this.setData({ remindMode: e.currentTarget.dataset.mode })
  },

  onRemindTimeChange(e) {
    this.setData({ remindTime: e.detail.value })
  },

  onRemindIntervalChange(e) {
    const val = parseInt(e.detail.value) || 0
    this.setData({ remindInterval: Math.max(0, Math.min(val, 1440)) })
  },

  // ================================================================
  //  多任务拆分（群聊消息转发场景）
  // ================================================================

  /**
   * 处理多消息文本：调用云函数拆分为多个任务
   */
  async _handleMultiMessage(text) {
    wx.showLoading({ title: '解析群聊消息...' })

    try {
      const result = await chatUtil.parseChatText(text)
      wx.hideLoading()

      if (result.tasks && result.tasks.length >= 1) {
        this.setData({
          multiTasks: result.tasks,
          showMultiConfirm: true
        })
      } else {
        wx.showToast({ title: result.summary || '未发现任务', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      console.error('多消息解析失败:', e)
      wx.showToast({ title: '解析失败，请手动输入', icon: 'none' })
    }
  },

  /**
   * 批量添加多任务中的一条
   */
  async onMultiTaskAdd(e) {
    const index = parseInt(e.currentTarget.dataset.index)
    const task = this.data.multiTasks[index]
    if (!task) return

    wx.showLoading({ title: '添加中...' })

    try {
      const openid = app.globalData.openid

      const remind = this._remindFieldsForPriority(task.priority || 'medium')
      const created = await db.createTask({
        content: task.content.trim(),
        source: 'clipboard',
        source_detail: '群聊转发',
        priority: task.priority || 'medium',
        due_date: task.dueDate || dateUtil.formatDate(new Date()),
        ...remind
      })

      await reminderUtil.scheduleReminders({ ...created })
      wx.hideLoading()
      wx.showToast({ title: '已添加', icon: 'success' })

      // 从列表中移除
      const updated = [...this.data.multiTasks]
      updated.splice(index, 1)
      this.setData({ multiTasks: updated })

      // 全部添加完毕
      if (updated.length === 0) {
        setTimeout(() => wx.navigateBack(), 800)
      }
    } catch (e) {
      wx.hideLoading()
      console.error('批量添加失败:', e)
      wx.showToast({ title: '添加失败', icon: 'none' })
    }
  },

  /**
   * 批量添加全部识别出的任务
   */
  async onMultiTaskAddAll() {
    if (this.data.multiTasks.length === 0) return

    wx.showLoading({ title: `添加 ${this.data.multiTasks.length} 个任务...` })
    let added = 0

    for (const task of this.data.multiTasks) {
      try {
        const openid = app.globalData.openid
        const remind = this._remindFieldsForPriority(task.priority || 'medium')
        const created = await db.createTask({
          content: task.content.trim(),
          source: 'clipboard',
          source_detail: '群聊转发',
          priority: task.priority || 'medium',
          due_date: task.dueDate || dateUtil.formatDate(new Date()),
          ...remind
        })
        await reminderUtil.scheduleReminders({ ...created })
        added++
      } catch (e) {
        console.error('批量添加任务失败:', task.summary, e)
      }
    }

    wx.hideLoading()
    wx.showToast({ title: `已添加 ${added} 个任务`, icon: 'success' })

    if (added > 0) {
      setTimeout(() => wx.navigateBack(), 800)
    }
  },

  onMultiTaskDismiss() {
    this.setData({ showMultiConfirm: false, multiTasks: [] })
    wx.navigateBack()
  },

  // ================================================================
  //  提交任务
  // ================================================================

  async submitTask() {
    const { taskContent, dueDate, priority, remindMode, remindTime, remindInterval } = this.data

    if (!taskContent.trim()) {
      wx.showToast({ title: '任务内容不能为空', icon: 'none' })
      return
    }

    // 若设置了提醒且已配置订阅模板 ID，先请求订阅授权（不阻断添加流程）
    const hasReminder = remindMode === 'fixed' || (remindMode === 'flexible' && remindInterval > 0)
    if (hasReminder && config.SUBSCRIBE_TEMPLATE_ID) {
      await this._requestSubscribe()
    }

    wx.showLoading({ title: '添加中...' })

    try {
      const openid = app.globalData.openid

      // 1. 调用 createTask
      const task = await db.createTask({
        content: taskContent.trim(),
        source: this.data.mode,
        source_detail: '',
        priority: priority,
        due_date: dueDate || dateUtil.formatDate(new Date()),
        due_time: this.data.dueTime || '',
        due_datetime: this.data.dueDatetime || null,
        remind_mode: remindMode,
        remind_at: remindMode === 'fixed' ? [remindTime] : [],
        remind_interval_minutes: remindMode === 'flexible' ? remindInterval : 0
      })

      // 2. 计划提醒
      await reminderUtil.scheduleReminders({
        ...task
      })

      wx.hideLoading()
      wx.showToast({ title: '添加成功', icon: 'success' })

      // 3. 返回上一页
      setTimeout(() => {
        wx.navigateBack()
      }, 500)

    } catch (e) {
      wx.hideLoading()
      console.error('添加任务失败:', e)
      wx.showToast({ title: '添加失败，请重试', icon: 'none' })
    }
  }
})

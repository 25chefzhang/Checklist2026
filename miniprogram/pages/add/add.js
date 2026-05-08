// pages/add/add.js — 添加任务页
const db = require('../../utils/db.js')
const dateUtil = require('../../utils/date.js')
const clipboardUtil = require('../../utils/clipboard.js')
const reminderUtil = require('../../utils/reminder.js')
const plugin = requirePlugin('WechatSI')

const app = getApp()

Page({
  data: {
    // 当前模式：voice / clipboard / manual
    mode: 'manual',

    // ===== 语音模式 =====
    isRecording: false,
    recordSeconds: 0,
    recognizedText: '',

    // ===== 剪贴板模式 =====
    clipboardText: '',
    clipboardFetched: false,

    // ===== 手动模式 =====
    manualInput: '',

    // ===== 确认弹窗 =====
    showConfirm: false,
    taskContent: '',
    dueDate: '',
    priority: 'medium',
    remindMode: 'fixed',    // 'fixed' | 'flexible'
    remindTime: '09:00',
    remindInterval: 60
  },

  // ---- 录音相关 ----
  _recordTimer: null,
  _recognitionManager: null,
  _recorderManager: null,

  // ================================================================
  //  生命周期
  // ================================================================

  onLoad(options) {
    // 1. 确定模式
    if (options.mode && ['voice', 'clipboard', 'manual'].includes(options.mode)) {
      this.setData({ mode: options.mode })
    }

    // 2. 初始化录音管理器（用于权限申请 & 帧回调）
    this._recorderManager = wx.getRecorderManager()
    this._bindRecorderEvents()

    // 3. 初始化同声传译识别管理器
    this._recognitionManager = plugin.getRecordRecognitionManager()
    this._bindRecognitionEvents()

    // 4. 如果从 index 页检测剪贴板跳转过来（带 content 参数），自动弹出确认弹窗
    if (options.content && options.content.trim()) {
      const content = decodeURIComponent(options.content).trim()
      if (content) {
        this.showConfirmDialog(content)
      }
    }

    // 5. 设置默认截止日期为今天
    this.setData({
      dueDate: dateUtil.formatDate(new Date())
    })
  },

  onUnload() {
    // 释放录音管理器监听
    if (this._recorderManager) {
      this._recorderManager.onStart(null)
      this._recorderManager.onStop(null)
      this._recorderManager.onError(null)
      this._recorderManager.onFrameRecorded(null)
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

  /** 绑定 RecorderManager 事件（用于帧回调驱动动画） */
  _bindRecorderEvents() {
    this._recorderManager.onFrameRecorded((res) => {
      // 可用于音量可视化，此处仅做存在性占位
    })

    this._recorderManager.onError((err) => {
      console.error('录音错误:', err)
      this.setData({ isRecording: false })
      this._clearRecordTimer()
      wx.showToast({ title: '录音失败，请重试', icon: 'none' })
    })
  },

  /** 绑定同声传译识别事件 */
  _bindRecognitionEvents() {
    this._recognitionManager.onRecognize = (res) => {
      // 实时部分结果（可选展示）
      console.log('实时识别:', res.result)
    }

    this._recognitionManager.onStop = (res) => {
      console.log('识别完成:', res.result)
      this.setData({ isRecording: false })
      this._clearRecordTimer()

      const text = (res.result || '').trim()
      if (text) {
        this.setData({ recognizedText: text })
      } else {
        wx.showToast({ title: '未识别到语音内容', icon: 'none' })
      }
    }

    this._recognitionManager.onError = (err) => {
      console.error('语音识别错误:', err)
      this.setData({ isRecording: false })
      this._clearRecordTimer()
      wx.showToast({ title: '语音识别失败', icon: 'none' })
    }
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
    this.setData({
      isRecording: true,
      recordSeconds: 0,
      recognizedText: ''
    })

    // 启动同声传译识别（内部自动开启录音）
    this._recognitionManager.start({
      lang: 'zh_CN',
      duration: 60000
    })

    // 计时器（UI 展示用）
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

    // 同声传译管理器停止 → 触发 onStop 回调
    this._recognitionManager.stop()
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
   * @param {string} content 任务内容文本
   */
  showConfirmDialog(content) {
    // 用 inferDueDate 推断截止日期
    const inferredDate = reminderUtil.inferDueDate(content)
    // 分析是否为工作任务
    const analysis = clipboardUtil.analyzeText(content)

    this.setData({
      taskContent: content,
      dueDate: inferredDate,
      priority: 'medium',
      remindMode: 'fixed',
      remindTime: '09:00',
      remindInterval: 60,
      showConfirm: true
    })
  },

  hideConfirmDialog() {
    this.setData({ showConfirm: false })
  },

  noop() {
    // 阻止弹窗点击穿透
  },

  // ---- 弹窗字段变更 ----

  onDueDateChange(e) {
    this.setData({ dueDate: e.detail.value })
  },

  onPriorityTap(e) {
    this.setData({ priority: e.currentTarget.dataset.priority })
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
  //  提交任务
  // ================================================================

  async submitTask() {
    const { taskContent, dueDate, priority, remindMode, remindTime, remindInterval } = this.data

    if (!taskContent.trim()) {
      wx.showToast({ title: '任务内容不能为空', icon: 'none' })
      return
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
        remind_mode: remindMode,
        remind_at: remindMode === 'fixed' ? [remindTime] : [],
        remind_interval_minutes: remindMode === 'flexible' ? remindInterval : 0,
        _openid: openid
      })

      // 2. 计划提醒
      await reminderUtil.scheduleReminders({
        ...task,
        _openid: openid
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

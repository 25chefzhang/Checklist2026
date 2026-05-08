// utils/reminder.js — 提醒引擎（前台轮询 + 语音播报）
const db = require('./db.js')
const voice = require('./voice.js')
const app = getApp()

class ReminderManager {
  constructor() {
    this.checkTimer = null
    this.isRunning = false
    this.isSpeaking = false // 避免语音播报重叠
    this.lastCheckTime = 0
  }

  /**
   * 启动提醒检查循环（前台每 60 秒）
   */
  start() {
    if (this.isRunning) return
    this.isRunning = true
    console.log('[提醒引擎] 已启动')

    // 立即检查一次
    this.checkAndRemind()

    // 定期检查
    this.checkTimer = setInterval(() => {
      this.checkAndRemind()
    }, 60000)
  }

  /**
   * 停止提醒循环
   */
  stop() {
    this.isRunning = false
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
    console.log('[提醒引擎] 已停止')
  }

  /**
   * 检查并触发提醒
   */
  async checkAndRemind() {
    // 防止重复检查（1 秒内不做两次）
    const now = Date.now()
    if (now - this.lastCheckTime < 1000) return
    this.lastCheckTime = now

    try {
      const reminders = await db.getPendingReminders()
      if (reminders.length === 0) return

      console.log(`[提醒引擎] 发现 ${reminders.length} 条到期提醒`)

      for (const reminder of reminders) {
        // 串行处理，避免多弹窗重叠
        await this.triggerReminder(reminder)
      }
    } catch (e) {
      console.error('[提醒引擎] 检查失败:', e)
    }
  }

  /**
   * 触发单条提醒
   */
  async triggerReminder(reminder) {
    try {
      const task = await db.getTask(reminder.task_id)

      // 任务已完成，标记提醒已确认
      if (!task || task.status === 'done') {
        await db.updateReminder(reminder._id, { status: 'confirmed' })
        return
      }

      // 语音播报（如果未在播报中）
      if (!this.isSpeaking) {
        this.isSpeaking = true
        try {
          const speakText = `提醒：${task.content}`
          await voice.speakText(speakText)
        } catch (e) {
          console.error('语音播报失败:', e)
        }
        this.isSpeaking = false
      }

      // 震动提醒
      wx.vibrateLong({ fail: () => {} })

      // 弹窗确认
      await this.showReminderDialog(task, reminder)

    } catch (e) {
      console.error('[提醒引擎] 触发提醒失败:', e)
    }
  }

  /**
   * 显示提醒确认弹窗
   */
  showReminderDialog(task, reminder) {
    return new Promise((resolve) => {
      const dateLabel = require('./date.js').relativeDate(task.due_date)

      wx.showModal({
        title: '⏰ 任务提醒',
        content: `「${task.content}」\\n\\n截止：${dateLabel} (${task.due_date})\\n\\n是否已完成？`,
        confirmText: '已完成 ✓',
        cancelText: '稍后提醒',
        success: async (res) => {
          if (res.confirm) {
            // 用户确认完成
            await db.updateTaskStatus(task._id, 'done')
            await db.updateReminder(reminder._id, {
              status: 'confirmed',
              confirmed_at: new Date().toISOString()
            })
            wx.showToast({ title: '已标记完成 ✓', icon: 'success' })
          } else {
            // 用户选择稍后提醒
            await this.rescheduleReminder(task, reminder)
          }
          resolve()
        },
        fail: () => resolve()
      })
    })
  }

  /**
   * 重新安排提醒
   */
  async rescheduleReminder(task, reminder) {
    if (task.remind_mode === 'flexible' && task.remind_interval_minutes > 0) {
      // 间隔模式：下N分钟后提醒
      const nextRemind = new Date()
      nextRemind.setMinutes(nextRemind.getMinutes() + task.remind_interval_minutes)

      await db.updateReminder(reminder._id, {
        remind_time: nextRemind.toISOString()
      })
    } else {
      // 固定模式：标记为已发送，明天同一时间会再次触发
      await db.updateReminder(reminder._id, { status: 'sent' })
    }
  }

  /**
   * 手动触发某个任务的提醒（用于测试或用户主动请求）
   */
  async remindNow(taskId) {
    const task = await db.getTask(taskId)
    if (!task || task.status === 'done') return

    // 创建一个即时提醒
    const reminder = {
      _openid: task._openid,
      task_id: taskId,
      remind_time: new Date().toISOString(),
      status: 'pending'
    }

    await db.createReminders([reminder])

    // 获取刚创建的提醒并触发
    const pendingReminders = await db.getPendingReminders()
    const created = pendingReminders.find(r => r.task_id === taskId)
    if (created) {
      await this.triggerReminder(created)
    }
  }
}

/**
 * 为新任务计划提醒
 */
async function scheduleReminders(task) {
  const reminders = []

  if (task.remind_mode === 'fixed' && task.remind_at && task.remind_at.length > 0) {
    // 固定时间提醒：截止日期前每天提醒，共3次
    for (let i = 0; i < 3; i++) {
      const remindDate = new Date(task.due_date)
      remindDate.setDate(remindDate.getDate() - i)
      const [h, m] = task.remind_at[0].split(':')
      remindDate.setHours(parseInt(h), parseInt(m), 0, 0)

      if (remindDate > new Date()) {
        reminders.push({
          _openid: task._openid,
          task_id: task._id,
          remind_time: remindDate.toISOString(),
          status: 'pending'
        })
      }
    }
  } else if (task.remind_mode === 'flexible' && task.remind_interval_minutes > 0) {
    // 间隔提醒：首次在创建后 N 分钟
    const firstRemind = new Date()
    firstRemind.setMinutes(firstRemind.getMinutes() + task.remind_interval_minutes)

    reminders.push({
      _openid: task._openid,
      task_id: task._id,
      remind_time: firstRemind.toISOString(),
      status: 'pending'
    })
  }

  if (reminders.length > 0) {
    await db.createReminders(reminders)
    console.log(`[提醒引擎] 为任务「${task.content}」创建了 ${reminders.length} 条提醒`)
  }
}

/**
 * 从文本智能推断截止日期
 */
function inferDueDate(text) {
  const dateUtil = require('./date.js')
  const today = new Date()

  if (/今天|今日/.test(text)) return dateUtil.formatDate(today)

  if (/明天|明日/.test(text)) {
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)
    return dateUtil.formatDate(tomorrow)
  }

  if (/后天|后日/.test(text)) {
    const dayAfter = new Date(today)
    dayAfter.setDate(today.getDate() + 2)
    return dateUtil.formatDate(dayAfter)
  }

  // 下周X
  const weekDayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0 }
  const weekMatch = text.match(/下周([一二三四五六日])/)
  if (weekMatch) {
    const targetDay = weekDayMap[weekMatch[1]]
    const nextWeek = new Date(today)
    const daysUntil = (7 - today.getDay() + targetDay) || 7
    nextWeek.setDate(today.getDate() + daysUntil)
    return dateUtil.formatDate(nextWeek)
  }

  // "X月X日"
  const dateMatch = text.match(/(\d{1,2})月(\d{1,2})[日号]/)
  if (dateMatch) {
    const month = parseInt(dateMatch[1])
    const day = parseInt(dateMatch[2])
    const date = new Date(today.getFullYear(), month - 1, day)
    if (date >= today) return dateUtil.formatDate(date)
  }

  // "X天后"
  const daysMatch = text.match(/(\d+)天后/)
  if (daysMatch) {
    const days = parseInt(daysMatch[1])
    const date = new Date(today)
    date.setDate(today.getDate() + days)
    return dateUtil.formatDate(date)
  }

  return dateUtil.formatDate(today)
}

module.exports = {
  ReminderManager,
  scheduleReminders,
  inferDueDate
}

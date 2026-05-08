// utils/db.js — 云数据库操作封装
const dateUtil = require('./date.js')

// ===== 懒加载 db 实例 =====
let _db = null
function getDB() {
  if (!_db) _db = wx.cloud.database()
  return _db
}

const _ = getDB().command

// ===== 任务 CRUD =====

/**
 * 获取最近三天待完成任务
 */
async function getRecentTasks(openid) {
  const range = dateUtil.getDateRange()
  const db = getDB()

  const res = await db.collection('tasks')
    .where({
      _openid: openid,
      status: 'pending',
      due_date: _.gte(range.start).and(_.lte(range.end))
    })
    .orderBy('due_date', 'asc')
    .orderBy('priority_order', 'desc')
    .limit(100)
    .get()

  return res.data
}

/**
 * 获取所有待完成任务（不限日期）
 */
async function getAllPendingTasks(openid) {
  const db = getDB()
  const res = await db.collection('tasks')
    .where({
      _openid: openid,
      status: 'pending'
    })
    .orderBy('due_date', 'asc')
    .limit(200)
    .get()
  return res.data
}

/**
 * 创建任务，返回包含 _id 的任务对象
 */
async function createTask(task) {
  const db = getDB()
  const now = new Date().toISOString()

  const result = await db.collection('tasks').add({
    data: {
      content: task.content || '',
      source: task.source || 'manual',
      source_detail: task.source_detail || '',
      status: 'pending',
      priority: task.priority || 'medium',
      priority_order: task.priority === 'high' ? 3 : task.priority === 'medium' ? 2 : 1,
      due_date: task.due_date || dateUtil.formatDate(new Date()),
      remind_at: task.remind_at || [],
      remind_interval_minutes: task.remind_interval_minutes || 0,
      remind_mode: task.remind_mode || 'fixed',
      completed_at: null,
      created_at: now,
      updated_at: now,
      tags: task.tags || [],
      notes: task.notes || ''
    }
  })

  return { _id: result._id, ...task }
}

/**
 * 更新任务状态
 */
async function updateTaskStatus(taskId, status) {
  const db = getDB()
  const now = new Date().toISOString()

  return await db.collection('tasks').doc(taskId).update({
    data: {
      status: status,
      completed_at: status === 'done' ? now : null,
      updated_at: now
    }
  })
}

/**
 * 更新任务内容
 */
async function updateTask(taskId, updates) {
  const db = getDB()
  updates.updated_at = new Date().toISOString()
  return await db.collection('tasks').doc(taskId).update({ data: updates })
}

/**
 * 获取单个任务
 */
async function getTask(taskId) {
  const db = getDB()
  const res = await db.collection('tasks').doc(taskId).get()
  return res.data
}

/**
 * 获取已完成任务（4 个月以内，用于工作总结）
 */
async function getCompletedTasks(openid, months = 4) {
  const db = getDB()
  const startDate = new Date()
  startDate.setMonth(startDate.getMonth() - months)

  const res = await db.collection('tasks')
    .where({
      _openid: openid,
      status: 'done',
      completed_at: _.gte(startDate.toISOString())
    })
    .orderBy('completed_at', 'desc')
    .limit(500)
    .get()

  return res.data
}

/**
 * 获取全部任务（4 个月以内，包含各状态）
 */
async function getAllTasks(openid, months = 4) {
  const db = getDB()
  const startDate = new Date()
  startDate.setMonth(startDate.getMonth() - months)

  const res = await db.collection('tasks')
    .where({
      _openid: openid,
      created_at: _.gte(startDate.toISOString())
    })
    .orderBy('created_at', 'desc')
    .limit(500)
    .get()

  return res.data
}

// ===== 提醒 CRUD =====

/**
 * 获取所有到期的待发送提醒
 */
async function getPendingReminders() {
  const db = getDB()
  const now = new Date().toISOString()

  const res = await db.collection('reminders')
    .where({
      status: 'pending',
      remind_time: _.lte(now)
    })
    .limit(50)
    .get()

  return res.data
}

/**
 * 批量创建提醒
 */
async function createReminders(reminders) {
  const db = getDB()
  const now = new Date().toISOString()

  for (const r of reminders) {
    await db.collection('reminders').add({
      data: {
        ...r,
        status: 'pending',
        created_at: now
      }
    })
  }
}

/**
 * 更新提醒状态
 */
async function updateReminder(reminderId, updates) {
  const db = getDB()
  return await db.collection('reminders').doc(reminderId).update({ data: updates })
}

/**
 * 清除任务的所有提醒
 */
async function clearTaskReminders(taskId) {
  const db = getDB()
  return await db.collection('reminders')
    .where({ task_id: taskId, status: 'pending' })
    .update({ data: { status: 'cancelled' } })
}

// ===== 设置 =====

/**
 * 获取用户设置（无则返回默认值）
 */
async function getSettings(openid) {
  const db = getDB()
  const res = await db.collection('settings')
    .where({ _openid: openid })
    .get()

  if (res.data.length > 0) return res.data[0]
  return getDefaultSettings()
}

/**
 * 保存用户设置
 */
async function saveSettings(openid, settings) {
  const db = getDB()
  const existing = await db.collection('settings')
    .where({ _openid: openid })
    .get()

  if (existing.data.length > 0) {
    return await db.collection('settings').doc(existing.data[0]._id).update({
      data: { ...settings, updated_at: new Date().toISOString() }
    })
  } else {
    return await db.collection('settings').add({
      data: { ...settings, _openid: openid, created_at: new Date().toISOString() }
    })
  }
}

function getDefaultSettings() {
  return {
    voice_enabled: true,
    default_remind_interval: 60,
    float_button_enabled: true,
    auto_clipboard_check: true
  }
}

module.exports = {
  getRecentTasks,
  getAllPendingTasks,
  createTask,
  updateTaskStatus,
  updateTask,
  getTask,
  getCompletedTasks,
  getAllTasks,
  getPendingReminders,
  createReminders,
  updateReminder,
  clearTaskReminders,
  getSettings,
  saveSettings
}

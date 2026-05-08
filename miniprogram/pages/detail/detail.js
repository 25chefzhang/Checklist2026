// pages/detail/detail.js — 任务详情页
const db = require('../../utils/db.js')
const dateUtil = require('../../utils/date.js')

const SOURCE_LABEL_MAP = {
  voice: '语音录入',
  clipboard: '剪贴板录入',
  manual: '手动录入'
}

const PRIORITY_LABEL_MAP = {
  high: '高优先级',
  medium: '中优先级',
  low: '低优先级'
}

Page({
  data: {
    task: null,
    loading: true,
    sourceLabel: '',
    priorityLabel: '',
    relativeDue: '',
    createdTime: '',
    completedTime: ''
  },

  onLoad(options) {
    const taskId = options.id
    if (!taskId) {
      this.setData({ loading: false })
      wx.showToast({ title: '缺少任务 ID', icon: 'error' })
      return
    }
    this.loadTask(taskId)
  },

  async loadTask(taskId) {
    try {
      const task = await db.getTask(taskId)
      if (!task) {
        this.setData({ loading: false })
        return
      }

      this.setData({
        task: task,
        loading: false,
        sourceLabel: SOURCE_LABEL_MAP[task.source] || '未知来源',
        priorityLabel: PRIORITY_LABEL_MAP[task.priority] || '中优先级',
        relativeDue: dateUtil.relativeDate(task.due_date),
        createdTime: dateUtil.formatDateTime(new Date(task.created_at)),
        completedTime: task.completed_at
          ? dateUtil.formatDateTime(new Date(task.completed_at))
          : ''
      })
    } catch (e) {
      console.error('加载任务失败:', e)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'error' })
    }
  },

  // 切换完成状态
  async onToggleStatus() {
    const task = this.data.task
    if (!task) return

    const newStatus = task.status === 'done' ? 'pending' : 'done'
    const actionLabel = newStatus === 'done' ? '标记完成' : '重新打开'

    wx.showModal({
      title: '确认操作',
      content: `确定要${actionLabel}这个任务吗？`,
      success: async (res) => {
        if (!res.confirm) return

        try {
          await db.updateTaskStatus(task._id, newStatus)
          wx.showToast({
            title: newStatus === 'done' ? '已完成 ✓' : '已重新打开',
            icon: 'success'
          })

          // 标记完成后返回上一页
          if (newStatus === 'done') {
            setTimeout(() => wx.navigateBack(), 1200)
          } else {
            // 重新打开：刷新本地数据
            this.setData({
              task: {
                ...task,
                status: 'pending',
                completed_at: null
              },
              completedTime: ''
            })
          }
        } catch (e) {
          console.error('更新状态失败:', e)
          wx.showToast({ title: '操作失败', icon: 'error' })
        }
      }
    })
  },

  // 删除任务
  onDelete() {
    const task = this.data.task
    if (!task) return

    wx.showModal({
      title: '删除任务',
      content: '删除后无法恢复，确定要继续吗？',
      confirmText: '确定删除',
      confirmColor: '#e74c3c',
      success: async (res) => {
        if (!res.confirm) return

        try {
          // 先清除关联提醒
          await db.clearTaskReminders(task._id)
          // 再删除任务
          await wx.cloud.database().collection('tasks').doc(task._id).remove()

          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 1000)
        } catch (e) {
          console.error('删除任务失败:', e)
          wx.showToast({ title: '删除失败', icon: 'error' })
        }
      }
    })
  }
})

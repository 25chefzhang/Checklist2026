// pages/summary/summary.js — 工作总结页
const db = require('../../utils/db.js')
const dateUtil = require('../../utils/date.js')

Page({
  data: {
    stats: {
      total: 0,
      completed: 0,
      pending: 0,
      bySource: { voice: 0, clipboard: 0, manual: 0 },
      byPriority: { high: 0, medium: 0, low: 0 },
      monthly: []
    },
    sourceMax: 0,
    sourcePercent: {
      voice: 0,
      clipboard: 0,
      manual: 0
    },
    summaryText: '',
    recentCompleted: []
  },

  onLoad() {
    this.loadSummary()
  },

  async loadSummary() {
    try {
      const app = getApp()
      const openid = app.globalData.openid

      if (!openid) {
        wx.showToast({ title: '未获取到用户信息', icon: 'error' })
        return
      }

      const allTasks = await db.getAllTasks(openid, 4)

      const stats = this.computeStats(allTasks)
      const summaryText = this.generateSummary(stats)
      const recentCompleted = allTasks
        .filter(t => t.status === 'done')
        .slice(0, 20)

      // 来源分布柱最大值
      const sourceMax = Math.max(
        stats.bySource.voice,
        stats.bySource.clipboard,
        stats.bySource.manual,
        1 // 避免全 0 时除零
      )

      // 预计算来源分布百分比（避免 WXML 中做除法）
      const sourcePercent = {
        voice: sourceMax > 0 ? Math.round(stats.bySource.voice / sourceMax * 100) : 0,
        clipboard: sourceMax > 0 ? Math.round(stats.bySource.clipboard / sourceMax * 100) : 0,
        manual: sourceMax > 0 ? Math.round(stats.bySource.manual / sourceMax * 100) : 0
      }

      // 预计算月度趋势百分比
      stats.monthly = stats.monthly.map(m => ({
        ...m,
        percent: m.total > 0 ? Math.round(m.completed / m.total * 100) : 0
      }))

      this.setData({
        stats,
        sourceMax,
        sourcePercent,
        summaryText,
        recentCompleted
      })
    } catch (e) {
      console.error('加载工作总结失败:', e)
      wx.showToast({ title: '加载失败', icon: 'error' })
    }
  },

  /**
   * 计算统计数据
   */
  computeStats(tasks) {
    const stats = {
      total: tasks.length,
      completed: 0,
      pending: 0,
      bySource: { voice: 0, clipboard: 0, manual: 0 },
      byPriority: { high: 0, medium: 0, low: 0 },
      monthly: []
    }

    const monthlyMap = {}

    for (const task of tasks) {
      // 状态计数
      if (task.status === 'done') {
        stats.completed++
      } else {
        stats.pending++
      }

      // 来源计数
      const src = task.source || 'manual'
      if (stats.bySource[src] !== undefined) {
        stats.bySource[src]++
      }

      // 优先级计数
      const pri = task.priority || 'medium'
      if (stats.byPriority[pri] !== undefined) {
        stats.byPriority[pri]++
      }

      // 月度统计
      const createdDate = task.created_at
        ? new Date(task.created_at)
        : new Date()
      const monthKey = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, '0')}`

      if (!monthlyMap[monthKey]) {
        monthlyMap[monthKey] = { month: monthKey, completed: 0, total: 0 }
      }
      monthlyMap[monthKey].total++
      if (task.status === 'done') {
        monthlyMap[monthKey].completed++
      }
    }

    // 月份按时间倒序排列
    stats.monthly = Object.values(monthlyMap).sort((a, b) => b.month.localeCompare(a.month))

    return stats
  },

  /**
   * 生成文本总结
   */
  generateSummary(stats) {
    const lines = []

    lines.push(`📊 工作总结（最近 4 个月）`)
    lines.push(``)
    lines.push(`总计任务：${stats.total} 个`)
    lines.push(`已完成：${stats.completed} 个  |  待完成：${stats.pending} 个`)

    const rate = stats.total > 0
      ? Math.round(stats.completed / stats.total * 100)
      : 0
    lines.push(`完成率：${rate}%`)
    lines.push(``)
    lines.push(`--- 来源分布 ---`)
    lines.push(`语音录入：${stats.bySource.voice} 个`)
    lines.push(`剪贴板录入：${stats.bySource.clipboard} 个`)
    lines.push(`手动录入：${stats.bySource.manual} 个`)
    lines.push(``)
    lines.push(`--- 优先级分布 ---`)
    lines.push(`高优先级：${stats.byPriority.high} 个`)
    lines.push(`中优先级：${stats.byPriority.medium} 个`)
    lines.push(`低优先级：${stats.byPriority.low} 个`)

    if (stats.monthly.length > 0) {
      lines.push(``)
      lines.push(`--- 月度趋势 ---`)
      for (const m of stats.monthly) {
        const pct = m.total > 0 ? Math.round(m.completed / m.total * 100) : 0
        const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10))
        lines.push(`${m.month}  ${bar}  ${m.completed}/${m.total}  (${pct}%)`)
      }
    }

    return lines.join('\n')
  }
})

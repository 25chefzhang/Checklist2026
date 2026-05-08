// utils/date.js — 日期工具函数

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 格式化日期时间为 YYYY-MM-DD HH:mm
 */
function formatDateTime(date) {
  const dateStr = formatDate(date)
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${dateStr} ${h}:${min}`
}

/**
 * 获取相对日期描述（今天/明天/后天/具体日期）
 */
function relativeDate(dateStr) {
  const today = formatDate(new Date())
  const tomorrow = formatDate(new Date(Date.now() + 86400000))
  const dayAfter = formatDate(new Date(Date.now() + 172800000))

  if (dateStr === today) return '今天'
  if (dateStr === tomorrow) return '明天'
  if (dateStr === dayAfter) return '后天'

  // 返回短格式：5月10日
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/**
 * 判断日期是否在近三天内
 */
function isWithinThreeDays(dateStr) {
  const date = new Date(dateStr)
  const now = new Date()
  const threeDaysLater = new Date(now)
  threeDaysLater.setDate(now.getDate() + 3)

  date.setHours(0, 0, 0, 0)
  now.setHours(0, 0, 0, 0)
  threeDaysLater.setHours(23, 59, 59, 999)

  return date >= now && date <= threeDaysLater
}

/**
 * 获取今天和三天后的日期范围字符串
 */
function getDateRange() {
  const today = new Date()
  const end = new Date(today)
  end.setDate(today.getDate() + 3)
  return {
    start: formatDate(today),
    end: formatDate(end),
    startLabel: relativeDate(formatDate(today)),
    endLabel: relativeDate(formatDate(end))
  }
}

module.exports = {
  formatDate,
  formatDateTime,
  relativeDate,
  isWithinThreeDays,
  getDateRange
}

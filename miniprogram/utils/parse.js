// utils/parse.js — 语音/文本任务解析器（纯函数，无 wx 依赖，可在 Node 中单测）
//
// 从一段自然语言（语音识别结果 / 手动输入）中提取结构化任务信息：
//   1. 任务内容（content，去除时间/紧急度短语后的干净文本）
//   2. 截止日期（dueDate）与具体时刻（dueTime）
//   3. 紧急程度（priority：urgent / high / medium / low）
//   4. 建议提醒频率（remindIntervalMinutes，由紧急度映射）
//
// 设计要点：
//   - 时间短语 → 具体 dueDate + dueTime；相对时长（两小时后）→ 折算为绝对时刻
//   - 紧急度 → 频率：紧急 2 小时 / 高 半天(12h) / 中 每天(24h) / 低 不重复
//   - 全部纯计算，便于 Node 单测，不依赖小程序环境

const CN_DIGIT = {
  '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
}

// ===== 紧急度 → 提醒频率（分钟）映射 =====
const PRIORITY_FREQUENCY = {
  urgent: 120,   // 每 2 小时
  high: 720,     // 每半天（12 小时）
  medium: 1440,  // 每天（24 小时）
  low: 0         // 不重复提醒
}

// 星期映射（getDay() 返回 0=周日）
const WEEKDAY = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 }

// 中文数字片段（用于拼接正则）
const CN = '[一二两三四五六七八九]'
// 十~九十九（含 "十"、"二十"、"二十三"、"十五"）
const CN_NUM_RE = CN + '?十' + CN + '?'
// 单个中文数字
const CN_ONE_RE = CN

function pad(n) { return String(n).padStart(2, '0') }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

/**
 * 中文数字 → 数值（支持 "半"、阿拉伯数字、"二十三"、"十五"）
 */
function cnToNumber(str) {
  if (!str) return null
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str)
  if (str === '半') return 0.5
  if (str === '十') return 10
  const m = str.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/)
  if (m) {
    const tens = m[1] ? CN_DIGIT[m[1]] : 1
    const ones = m[2] ? CN_DIGIT[m[2]] : 0
    return tens * 10 + ones
  }
  if (str.length === 1 && CN_DIGIT[str] !== undefined) return CN_DIGIT[str]
  return null
}

// ===== 1. 日期识别 =====

/**
 * 识别相对/绝对日期，返回 { dateStr, shiftDays, matched, source }
 * shiftDays：相对今天偏移的天数（今天=0）
 */
function detectDate(text, now) {
  // 绝对日期：2026-10-28 / 2026/10/28
  const abs = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (abs) {
    const y = parseInt(abs[1]); const m = parseInt(abs[2]); const d = parseInt(abs[3])
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { dateStr: `${y}-${pad(m)}-${pad(d)}`, shiftDays: null, matched: abs[0], source: 'absolute' }
    }
  }

  // X月X日 / X月X号
  const cn = text.match(/(\d{1,2})月(\d{1,2})[日号]/)
  if (cn) {
    const m = parseInt(cn[1]); const d = parseInt(cn[2])
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const target = new Date(now.getFullYear(), m - 1, d)
      const year = target < todayStart ? now.getFullYear() + 1 : now.getFullYear()
      return { dateStr: `${year}-${pad(m)}-${pad(d)}`, shiftDays: null, matched: cn[0], source: 'monthDay' }
    }
  }

  // 相对日期
  const rel = [
    { re: /大后天/, shift: 3 }, { re: /后天/, shift: 2 }, { re: /明天|明日/, shift: 1 }, { re: /今天|今日/, shift: 0 }
  ]
  for (const r of rel) {
    const m = text.match(r.re)
    if (m) {
      const d = new Date(now); d.setDate(d.getDate() + r.shift)
      return { dateStr: fmtDate(d), shiftDays: r.shift, matched: m[0], source: 'relative' }
    }
  }

  // 本周X / 下周X
  const week = text.match(/(本周|这周|下周)([一二三四五六日天])/)
  if (week) {
    const target = WEEKDAY[week[2]]
    const isNext = week[1].includes('下')
    const d = new Date(now)
    let days = (target - now.getDay() + 7) % 7
    if (isNext) {
      days += 7
    } else if (days === 0) {
      // 本周当天已过则顺延一周
      const targetDate = new Date(now); targetDate.setDate(now.getDate() + days)
      if (targetDate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) days = 7
    }
    d.setDate(d.getDate() + days)
    return { dateStr: fmtDate(d), shiftDays: days, matched: week[0], source: 'weekday' }
  }

  // 裸 "周X" → 下一个该星期（若当天则顺延一周）
  const bare = text.match(/周([一二三四五六日天])/)
  if (bare) {
    const target = WEEKDAY[bare[1]]
    const d = new Date(now)
    let days = (target - now.getDay() + 7) % 7
    if (days === 0) days = 7
    d.setDate(d.getDate() + days)
    return { dateStr: fmtDate(d), shiftDays: days, matched: bare[0], source: 'weekday' }
  }

  return null
}

// ===== 2. 时刻识别（具体钟点） =====

/**
 * 识别 "下午三点"、"15:30"、"晚上八点二十" 等钟点
 * 返回 { hour, minute, matched, dateShift }（dateShift：该时间隐含的日期偏移，如"明早"=1）
 */
function detectClockTime(text) {
  // 24 小时制 HH:MM
  const hhmm = text.match(/(\d{1,2})[:：](\d{1,2})/)
  if (hhmm) {
    const h = parseInt(hhmm[1]); const m = parseInt(hhmm[2])
    if (h <= 23 && m <= 59) return { hour: h, minute: m, matched: hhmm[0], dateShift: 0 }
  }

  // 时段前缀 → 基准小时 + 隐含日期偏移
  const periodMap = [
    { re: /(明早|明天早上|明天早晨|明晨)/, shift: 1 },
    { re: /(明晚|明天晚上)/, shift: 1 },
    { re: /(今晚|今晚上|今天晚上)/, shift: 0 },
    { re: /(凌晨)/, shift: 0 },
    { re: /(早上|早晨|清晨)/, shift: 0 },
    { re: /(上午)/, shift: 0 },
    { re: /(中午)/, shift: 0 },
    { re: /(下午)/, shift: 0 },
    { re: /(傍晚|黄昏)/, shift: 0 },
    { re: /(晚上|夜里|夜间|深夜)/, shift: 0 }
  ]

  // 钟点 + 可选分钟
  const clock = text.match(
    new RegExp(
      `(${CN_NUM_RE}|${CN_ONE_RE}|\\d{1,2})\\s*(?:点|时|点钟)` +
      `(?:\\s*(${CN_NUM_RE}|${CN_ONE_RE}|\\d{1,2}|半|一刻|三刻)?\\s*(?:分|分钟)?)?`
    )
  )

  if (!clock) return null

  let hour = cnToNumber(clock[1])
  if (hour === null) return null

  // 解析分钟
  let minute = 0
  const minRaw = clock[2]
  if (minRaw) {
    if (minRaw === '半') minute = 30
    else if (minRaw === '一刻') minute = 15
    else if (minRaw === '三刻') minute = 45
    else {
      const mv = cnToNumber(minRaw)
      if (mv !== null) minute = Math.min(mv, 59)
    }
  }

  // 找到离钟点最近的时段前缀
  let period = null
  let periodSpan = null
  let bestGap = Infinity
  for (const p of periodMap) {
    const m = text.match(p.re)
    if (m && m.index < clock.index) {
      const gap = clock.index - (m.index + m[0].length)
      if (gap < bestGap) {
        bestGap = gap
        period = p
        // 仅当时段与钟点紧邻（间隔≤2字符）时视为同一短语，用于内容剥离
        periodSpan = gap <= 2 ? { start: m.index, end: m.index + m[0].length } : null
      }
    }
  }

  if (period) {
    const prefix = period.re.toString()
    // 下午/晚上：1-11 点 +12
    if (/(下午|晚上|夜里|夜间|深夜|今晚|明晚|傍晚|黄昏)/.test(prefix)) {
      if (hour < 12) hour += 12
    }
  } else {
    // 无时段前缀：口语中 1-6 点通常指下午/凌晨，7-11 点通常指上午
    if (hour >= 1 && hour <= 6) hour += 12
  }

  // 完整短语 = 时段前缀 + 钟点（用于从内容中整体剥离）
  let matched = clock[0]
  if (periodSpan) {
    matched = text.slice(periodSpan.start, clock.index + clock[0].length)
  }

  return {
    hour: Math.min(hour, 23),
    minute,
    matched,
    dateShift: period ? period.shift : 0
  }
}

// ===== 3. 相对时长识别（"两小时后"、"半小时后"、"30分钟后"） =====

function detectRelativeDuration(text) {
  // X小时 / X个钟头
  const hour = text.match(/(半|[一二两三四五六七八九十]|\d+(?:\.\d+)?)\s*(?:个)?(?:小时|钟头|钟)(?:之后|以后|后)/)
  if (hour) {
    const v = cnToNumber(hour[1])
    if (v !== null) return { afterMinutes: Math.round(v * 60), matched: hour[0] }
  }
  // X分钟
  const min = text.match(/(半|[一二两三四五六七八九十]|\d+)\s*(?:分钟|分)(?:之后|以后|后)/)
  if (min) {
    const v = cnToNumber(min[1])
    if (v !== null) return { afterMinutes: Math.round(v), matched: min[0] }
  }
  return null
}

// ===== 4. 紧急度识别 =====

/**
 * 返回 { priority, matched }（matched 为命中的紧急度短语，用于从内容中剥离）
 */
function detectPriority(text, dueDate, now) {
  const rules = [
    { re: /不着急|不急|慢慢来|有空再|有空的时候再|随便|无所谓|不紧急|回头再说/g, p: 'low' },
    { re: /十万火急|非常急|特别急|很急|加急|紧急|火速|立刻|立即|马上|尽快|抓紧|快点|赶快/g, p: 'urgent' },
    { re: /比较急|挺急|有点急|较急|优先|重要/g, p: 'high' }
  ]
  for (const r of rules) {
    const matches = text.match(r.re)
    if (matches && matches.length > 0) return { priority: r.p, matched: matches }
  }

  // 依据截止日期推断
  if (dueDate) {
    const today = fmtDate(now)
    const in2d = (() => { const d = new Date(now); d.setDate(d.getDate() + 2); return fmtDate(d) })()
    if (dueDate <= today) return { priority: 'urgent', matched: [] }
    if (dueDate <= in2d) return { priority: 'high', matched: [] }
  }

  return { priority: 'medium', matched: [] }
}

// ===== 5. 内容清理 =====

// 求子串在文本中的位置区间（end 为绝对结束下标）
function spanOf(text, sub) {
  const i = text.indexOf(sub)
  if (i < 0) return { start: 0, end: 0 }
  return { start: i, end: i + sub.length }
}

function cleanContent(raw, fragments) {
  let s = raw
  // 按位置排序，从后往前删除，避免索引偏移
  const sorted = fragments
    .filter(f => f && f.end > f.start)
    .sort((a, b) => b.start - a.start)
  for (const f of sorted) {
    s = s.slice(0, f.start) + s.slice(f.end)
  }
  // 清理残留标点与空白
  s = s.replace(/[，。！？、,;；:：\s]+/g, ' ').trim()
  return s.length >= 2 ? s : raw.trim()
}

// ===== 主入口 =====

/**
 * 解析任务文本
 * @param {string} text 原始文本
 * @param {Date} [now] 参考时间（默认当前，测试可注入）
 * @returns {{
 *   content: string, rawContent: string,
 *   dueDate: string, dueTime: string, dueDatetime: string|null,
 *   priority: string, remindIntervalMinutes: number,
 *   timeSource: string
 * }}
 */
function parseTask(text, now) {
  const ref = now || new Date()
  const raw = (text || '').trim()

  const empty = {
    content: raw, rawContent: raw,
    dueDate: fmtDate(ref), dueTime: '', dueDatetime: null,
    priority: 'medium', remindIntervalMinutes: PRIORITY_FREQUENCY.medium,
    timeSource: ''
  }
  if (!raw) return empty

  const fragments = [] // 用于内容清理的 {start, end}

  // 1. 相对时长
  const rel = detectRelativeDuration(raw)

  // 2. 日期
  const dateInfo = detectDate(raw, ref)

  // 3. 钟点
  const clock = detectClockTime(raw)

  let dueDate = fmtDate(ref)
  let dueTime = ''
  let timeSource = ''

  if (rel) {
    // 相对时长：折算为绝对时刻
    const d = new Date(ref.getTime() + rel.afterMinutes * 60000)
    dueDate = fmtDate(d)
    dueTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    timeSource = 'relative-duration'
    fragments.push(spanOf(raw, rel.matched))
  } else if (clock || dateInfo) {
    // 日期基准：优先日期词，否则钟点隐含偏移，否则今天
    let shift = 0
    if (dateInfo && dateInfo.shiftDays !== null) shift = dateInfo.shiftDays
    else if (clock) shift = clock.dateShift

    if (dateInfo && dateInfo.dateStr && dateInfo.shiftDays === null) {
      // 绝对日期（如 10月30日），直接使用
      dueDate = dateInfo.dateStr
    } else {
      const d = new Date(ref)
      d.setDate(d.getDate() + shift)
      dueDate = fmtDate(d)
    }

    if (clock) {
      dueTime = `${pad(clock.hour)}:${pad(clock.minute)}`
      timeSource = 'clock'
      fragments.push(spanOf(raw, clock.matched))
    }
    if (dateInfo) fragments.push(spanOf(raw, dateInfo.matched))
  }

  // 组装 dueDatetime
  let dueDatetime = null
  if (dueTime) {
    dueDatetime = `${dueDate} ${dueTime}`
  }

  // 4. 紧急度（依赖 dueDate）
  const pr = detectPriority(raw, dueDate, ref)
  for (const m of pr.matched) fragments.push(spanOf(raw, m))

  const remindIntervalMinutes = PRIORITY_FREQUENCY[pr.priority] !== undefined
    ? PRIORITY_FREQUENCY[pr.priority]
    : PRIORITY_FREQUENCY.medium

  // 5. 内容清理
  const content = cleanContent(raw, fragments)

  return {
    content,
    rawContent: raw,
    dueDate,
    dueTime,
    dueDatetime,
    priority: pr.priority,
    remindIntervalMinutes,
    timeSource
  }
}

module.exports = {
  parseTask,
  cnToNumber,
  detectDate,
  detectClockTime,
  detectRelativeDuration,
  detectPriority,
  PRIORITY_FREQUENCY,
  formatIntervalMinutes,
  priorityLabel
}

/**
 * 把分钟数格式化为可读文案（120 → "2小时"，720 → "12小时(半天)"，1440 → "24小时(每天)"）
 */
function formatIntervalMinutes(min) {
  if (!min || min <= 0) return ''
  if (min < 60) return `${min}分钟`
  const h = min / 60
  if (h === 12) return '12小时(半天)'
  if (h === 24) return '24小时(每天)'
  if (Number.isInteger(h)) return `${h}小时`
  return `${min}分钟`
}

/**
 * 优先级 → 中文标签
 */
function priorityLabel(p) {
  const labels = { urgent: '紧急', high: '高', medium: '中', low: '低' }
  return labels[p] || p
}

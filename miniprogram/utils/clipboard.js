// utils/clipboard.js — 剪贴板监听与内容分析（v2 增强群聊识别）

// ===== 群聊任务消息特征模式 =====
const taskPatterns = [
  // 动作动词（执行类）
  /完成|提交|准备|安排|处理|跟进|开会|汇报|整理|编写|修改|发布|审核|审批|确认|修复|优化|测试|部署|上线|合并/,
  // 日期格式
  /\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}/,
  /星期[一二三四五六日]/,
  /今天|明天|后天|下周|本周/,
  // DDL / 截止
  /截止|DDL|deadline/i,
  /\\d{1,2}月\\d{1,2}[日号]/,
  // 提醒/待办标记
  /提醒|备忘|待办|TODO|@todo/i,
  // 工作物名
  /任务|需求|报告|方案|文档|合同|发票/,
  // 祈使句委托
  /请.*完成|请.*处理|请.*准备|请.*跟进|请.*整理|请.*确认/,

  // ===== 新增：群聊专有模式 =====
  // @提及（群聊中最常见的任务指派方式）
  /@[\\w\\u4e00-\\u9fff\\-]+/,
  // 【任务】【待办】等结构化标记
  /【[^】]{1,20}】/,
  // #话题# 标记
  /#[^#]{1,20}#/,
  // 指派句型：交给、由你、你来
  /交给你|你负责|你来|你来处理|你跟进|你去/,
  // 问句型：xxx了吗？做了吗？
  /[\\u4e00-\\u9fff]{2,10}[了吗]\\?/,
  // 群公告/通知关键词
  /群公告|@所有人|通知|各位|请注意|大家/,
  // 验收/检查类
  /验收|检查|排查|看一下|看下|确认下|核实/
]

// ===== 群聊消息元数据提取 =====

/**
 * 从群聊文本中提取 @提及的用户
 */
function extractMentions(text) {
  const mentions = []
  const regex = /@([\\w\\u4e00-\\u9fff\\-]{1,30})/g
  let match
  while ((match = regex.exec(text)) !== null) {
    if (!mentions.includes(match[1])) {
      mentions.push(match[1])
    }
  }
  return mentions
}

/**
 * 从群聊文本中提取【】标记
 */
function extractBrackets(text) {
  const brackets = []
  const regex = /【([^】]{1,20})】/g
  let match
  while ((match = regex.exec(text)) !== null) {
    brackets.push(match[1])
  }
  return brackets
}

/**
 * 从群聊文本中提取 #话题#
 */
function extractHashtags(text) {
  const hashtags = []
  const regex = /#([^#\\s]{1,20})#/g
  let match
  while ((match = regex.exec(text)) !== null) {
    if (!hashtags.includes(match[1])) {
      hashtags.push(match[1])
    }
  }
  return hashtags
}

/**
 * 判断文本是否包含群聊特征
 */
function isGroupChatMessage(text) {
  return /@[\\w\\u4e00-\\u9fff]/.test(text) ||
    /群聊|群聊的聊天记录/.test(text) ||
    extractMentions(text).length > 0
}

/**
 * 判断文本是否可能为工作任务（增强版）
 * @returns {{ isLikely: boolean, confidence: number, matches: number, isGroupChat: boolean, mentions: string[], tags: string[] }}
 */
function analyzeText(text) {
  if (!text || text.length < 3) {
    return { isLikely: false, confidence: 0, matches: 0, isGroupChat: false, mentions: [], tags: [] }
  }

  let matches = 0
  for (const pattern of taskPatterns) {
    if (pattern.test(text)) matches++
  }

  // 额外加权：群聊特征
  const mentions = extractMentions(text)
  const bracketTags = extractBrackets(text)
  const hashtags = extractHashtags(text)
  const isGroupChat = isGroupChatMessage(text)

  // 群聊消息 + 有@提及 + 至少一个任务关键词 → 高信度
  if (isGroupChat && mentions.length > 0) matches += 1
  // 有【任务】【待办】标记 → 直接加分
  const taskBrackets = bracketTags.filter(t =>
    /任务|待办|TODO|提醒|事项|需求|紧急/.test(t)
  )
  matches += taskBrackets.length

  const confidence = Math.min(matches / 3, 1)
  return {
    isLikely: matches >= 1,
    confidence: Math.round(confidence * 100),
    matches,
    isGroupChat,
    mentions,
    tags: [...bracketTags, ...hashtags]
  }
}

/**
 * 从剪贴板获取文本（需要用户授权 scope.writeClipboard）
 */
async function getClipboardText() {
  try {
    const res = await wx.getClipboardData()
    return res.data || ''
  } catch (e) {
    console.error('获取剪贴板失败:', e)
    return ''
  }
}

module.exports = {
  analyzeText,
  getClipboardText,
  extractMentions,
  extractBrackets,
  extractHashtags,
  isGroupChatMessage
}

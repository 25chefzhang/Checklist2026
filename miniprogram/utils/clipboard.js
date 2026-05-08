// utils/clipboard.js — 剪贴板监听与内容分析

const taskPatterns = [
  /完成|提交|准备|安排|处理|跟进|开会|汇报|整理|编写|修改|发布/,
  /\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}/,
  /星期[一二三四五六日]/,
  /今天|明天|后天|下周/,
  /截止|DDL|deadline/i,
  /提醒|备忘|待办|TODO/i,
  /任务|需求|报告|方案|文档|合同|发票/,
  /请.*完成|请.*处理|请.*准备/
]

/**
 * 判断文本是否可能为工作任务
 * @returns {{ isLikely: boolean, confidence: number }}
 */
function analyzeText(text) {
  if (!text || text.length < 3) return { isLikely: false, confidence: 0 }

  let matches = 0
  for (const pattern of taskPatterns) {
    if (pattern.test(text)) matches++
  }

  const confidence = Math.min(matches / 3, 1) // 3个以上匹配 → 100% 确信
  return {
    isLikely: matches >= 1,
    confidence: Math.round(confidence * 100),
    matches: matches
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
  getClipboardText
}

// utils/chat.js — 群聊消息解析工具
// 客户端调用云函数 parseChatMessage，处理多任务拆分逻辑

/**
 * 调用云函数 parseChatMessage 分析群聊文本
 * @param {string} text 群聊消息文本
 * @returns {Promise<{tasks: Array, total: number, summary: string}>}
 */
async function parseChatText(text) {
  if (!text || !text.trim()) {
    return { tasks: [], total: 0, summary: '无内容' };
  }

  try {
    const res = await wx.cloud.callFunction({
      name: 'parseChatMessage',
      data: { text }
    });
    return res.result;
  } catch (e) {
    console.error('parseChatMessage 云函数调用失败:', e);
    // 降级：返回单条任务
    return {
      tasks: [{
        content: text,
        summary: text.slice(0, 60),
        confidence: 50,
        taskType: 'assignment',
        priority: 'medium',
        assignee: null,
        dueDate: null
      }],
      total: 1,
      summary: '云函数不可用，已降级为单任务模式'
    };
  }
}

/**
 * 判断文本是否包含多条消息（用于决定是否需要拆分）
 */
function looksLikeMultipleMessages(text) {
  if (!text) return false;
  const lines = text.split('\n').filter(l => l.trim());
  // 超过 3 行，或包含多个用户名冒号格式
  const senderPattern = /^.{1,20}[:：]\s/m;
  const tsPattern = /^\d{1,2}[:：]\d{2}/m;
  return lines.length > 3 || senderPattern.test(text) || tsPattern.test(text);
}

module.exports = {
  parseChatText,
  looksLikeMultipleMessages
};

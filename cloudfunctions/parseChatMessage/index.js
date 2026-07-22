// 云函数：parseChatMessage
// 从群聊/转发消息中智能提取工作任务，支持多消息拆分
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// ===== 任务动词库 =====
const TASK_VERBS = [
  '完成', '提交', '处理', '跟进', '确认', '审核', '审批', '发布', '上线',
  '修复', '优化', '开发', '测试', '部署', '合并', '编写', '整理', '汇总',
  '报告', '汇报', '反馈', '沟通', '协调', '安排', '通知', '准备', '修改',
  '检查', '验收', '排查', '核实', '归档', '备份', '迁移', '配置', '安装',
  '填写', '回复', '转发', '联系', '对接', '推动', '发起', '关闭'
];

// ===== 日期模式 =====
const DATE_PATTERNS = [
  { regex: /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/ },
  { regex: /(\d{1,2}月\d{1,2}[日号])/ },
  { regex: /(\d{1,2}[.\-]\d{1,2})/ },
  { regex: /(今天|明天|后天|大后天)/ },
  { regex: /(下?周[一二三四五六日天])/ },
  { regex: /(本周末|下周末|月末|月底|月初|本周[一二三四五六日天])?/ }
];

// ===== 消息序列分割模式 =====
// 匹配 "用户名: 消息" 或带时间戳的格式
const MSG_DELIMITER = /\n{2,}|\n(?=\d{4}[-/]\d{2}[-/]\d{2}\s)|(?<=\n)([A-Za-z\u4e00-\u9fff][\w\u4e00-\u9fff]{0,15}):\s/gm;
// 也尝试按时间戳分割（微信聊天记录转发格式）
const MSG_TS_DELIMITER = /^(?:\[?)(\d{1,2}[:：]\d{2})(?:\]?)|^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}[:：]\d{2})/gm;

/**
 * 按消息边界拆分多消息文本
 */
function splitMessages(text) {
  const messages = [];
  const lines = text.split(/\n/);
  let current = '';

  for (const line of lines) {
    // "用户名: 内容" 模式
    const senderMatch = line.match(/^(.{1,20})[:：]\s(.+)/);
    // 时间戳模式
    const tsMatch = line.match(/^(\d{1,2}[:：]\d{2})\s(.+)/);

    if (senderMatch || tsMatch) {
      if (current.trim()) {
        messages.push(current.trim());
      }
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }

  if (current.trim()) {
    messages.push(current.trim());
  }

  return messages.length > 1 ? messages : [text.trim()];
}

/**
 * 分析单条消息是否为任务
 */
function analyzeOne(text) {
  const result = {
    content: text,
    isTask: false,
    confidence: 0,
    taskType: null,      // 'assignment' | 'reminder' | 'deadline' | 'question'
    extractedDate: null,
    assignee: null,       // @提及的个人
    priority: 'medium',   // 'low' | 'medium' | 'high' | 'urgent'
    summary: null         // 短摘要（去除前缀）
  };

  if (!text || text.length < 3) return result;

  // 1. 提取 @提及
  const mentionMatch = text.match(/@([\w\u4e00-\u9fff\-]{1,30})/);
  if (mentionMatch) {
    result.assignee = mentionMatch[1];
  }

  // 2. 匹配任务动词
  let verbMatches = 0;
  const matchedVerbs = [];
  for (const verb of TASK_VERBS) {
    if (text.includes(verb)) {
      verbMatches++;
      matchedVerbs.push(verb);
    }
  }

  // 3. 匹配日期
  let hasDate = false;
  for (const pattern of DATE_PATTERNS) {
    if (pattern.regex.test(text)) {
      hasDate = true;
      result.extractedDate = extractDate(text, pattern);
      break;
    }
  }

  // 4. 任务类型判定
  if (/@\S/.test(text) && verbMatches > 0) {
    result.taskType = 'assignment';  // 指派任务
    result.priority = 'medium';
  } else if (hasDate && verbMatches > 0) {
    result.taskType = 'deadline';    // 有截止日期的任务
    result.priority = 'medium';
  } else if (/提醒|别忘了|记得/.test(text)) {
    result.taskType = 'reminder';    // 提醒
    result.priority = 'low';
  } else if (verbMatches > 0) {
    result.taskType = 'assignment';  // 隐式任务
    result.priority = 'low';
  } else if (hasDate && /截止|DDL|deadline|前完成/i.test(text)) {
    result.taskType = 'deadline';
    result.priority = 'high';
  } else if (/做了吗|完成了吗|好了吗/.test(text)) {
    result.taskType = 'question';
    result.priority = 'low';
  }

  // 5. 紧急度判定
  if (text.includes('紧急') || text.includes('urgent') || text.includes('加急') ||
      (result.extractedDate && isWithinDays(result.extractedDate, 1))) {
    result.priority = 'urgent';
  } else if (result.extractedDate && isWithinDays(result.extractedDate, 2)) {
    result.priority = 'high';
  }

  // 6. 置信度计算
  let confidence = 0;
  if (result.taskType === 'assignment') {
    confidence = 60;
    if (hasDate) confidence += 20;
    if (verbMatches >= 2) confidence += 15;
    confidence += Math.min(verbMatches * 5, 10);
  } else if (result.taskType === 'deadline') {
    confidence = 45;
    if (verbMatches >= 1) confidence += 15;
  } else if (result.taskType === 'reminder') {
    confidence = 30;
    if (hasDate) confidence += 10;
  } else if (result.taskType === 'question') {
    confidence = 25;
  }

  result.confidence = Math.min(confidence, 100);
  result.isTask = result.confidence >= 30 && result.taskType !== null;

  // 7. 生成摘要（去除前缀如 "用户名:"）
  result.summary = text
    .replace(/^.{1,20}[:：]\s/, '')  // 去发送者前缀
    .replace(/^@\S+\s/, '')          // 去@
    .trim()
    .slice(0, 60);

  return result;
}

/**
 * 从文本提取日期字符串
 */
function extractDate(text, pattern) {
  // 相对日期
  if (/今天/.test(text)) return formatDate(new Date());
  if (/明天/.test(text)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return formatDate(d);
  }
  if (/后天/.test(text)) {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return formatDate(d);
  }
  if (/大后天/.test(text)) {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return formatDate(d);
  }

  // YYYY-MM-DD
  const dateMatch = text.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
  if (dateMatch) return dateMatch[1].replace(/\//g, '-');

  // X月X日
  const cnMatch = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (cnMatch) {
    const now = new Date();
    return `${now.getFullYear()}-${cnMatch[1].padStart(2, '0')}-${cnMatch[2].padStart(2, '0')}`;
  }

  // M-D
  const mdMatch = text.match(/(\d{1,2})[.\-](\d{1,2})/);
  if (mdMatch) {
    const now = new Date();
    return `${now.getFullYear()}-${mdMatch[1].padStart(2, '0')}-${mdMatch[2].padStart(2, '0')}`;
  }

  return null;
}

/**
 * 判断日期是否在 N 天内
 */
function isWithinDays(dateStr, days) {
  if (!dateStr) return false;
  const target = new Date(dateStr);
  const now = new Date();
  const diff = (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= days;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 主入口
 * @param {object} event
 * @param {string} event.text - 群聊消息文本（可能包含多条消息）
 * @param {boolean} [event.autoConfirm=false] - 是否自动确认置信度高的任务
 */
exports.main = async (event, context) => {
  const text = (event.text || '').trim();
  if (!text) {
    return { tasks: [], summary: '无内容' };
  }

  // 1. 拆分多消息
  const messages = splitMessages(text);

  // 2. 逐条分析
  const taskableMessages = [];
  for (const msg of messages) {
    const analysis = analyzeOne(msg);
    if (analysis.isTask) {
      taskableMessages.push(analysis);
    }
  }

  // 3. 按置信度排序
  taskableMessages.sort((a, b) => b.confidence - a.confidence);

  // 4. 生成汇总
  const tasks = taskableMessages.map(t => ({
    content: t.content,
    summary: t.summary,
    confidence: t.confidence,
    taskType: t.taskType,
    priority: t.priority,
    assignee: t.assignee,
    dueDate: t.extractedDate,
  }));

  return {
    tasks,
    total: tasks.length,
    highConfidence: tasks.filter(t => t.confidence >= 60),
    summary: tasks.length > 0
      ? `从 ${messages.length} 条消息中识别出 ${tasks.length} 个潜在任务`
      : `分析了 ${messages.length} 条消息，未发现明显任务`
  };
};

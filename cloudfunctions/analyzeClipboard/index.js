// 云函数：analyzeClipboard
// 服务端分析剪贴板文本是否为工作任务（使用规则匹配）
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// 工作相关关键词库
const WORK_KEYWORDS = [
  // 任务动作类
  '完成', '提交', '处理', '跟进', '确认', '审核', '审批', '发布', '上线',
  '修复', '优化', '开发', '测试', '部署', '合并', '编写', '整理', '汇总',
  '报告', '汇报', '反馈', '沟通', '协调', '安排', '通知', '提醒',
  // 工作场景类
  '需求', '方案', '文档', '会议', '周报', '日报', '月报', '计划', '总结',
  '项目', '版本', '迭代', '发布', '排期', '评审', '复盘', '验收',
  '客户', '合同', '发票', '报销', '预算', '采购', '付款',
  'bug', 'issue', 'pr', 'todo', 'fix', 'feat', 'release',
  // 截止/时间类
  '截止', 'deadline', 'ddl', '本周', '下周', '今天', '明天', '后天',
  '周五前', '月底前', '尽快', 'urgent', '加急', '优先',
  // 日程/事项类
  '待办', '任务', '工作', '事项', '日程', '备忘', '提醒',
  'todo', 'task', 'reminder', 'note'
];

// 日期提取正则模式
const DATE_PATTERNS = [
  { regex: /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/, desc: '完整日期' },
  { regex: /(\d{1,2}月\d{1,2}[日号])/, desc: '中文日期' },
  { regex: /(\d{1,2}[\.-]\d{1,2})/, desc: '月-日' },
  { regex: /(今天|明天|后天)/, desc: '相对日期' },
  { regex: /(下?周[一二三四五六日天])/, desc: '星期' },
  { regex: /(本周末|下周末|月末|月底|月初)/, desc: '时间段' }
];

// 分类关键词映射
const CATEGORY_KEYWORDS = {
  '开发': ['开发', '需求', '修复', 'bug', '代码', '上线', '部署', '测试', 'fix', 'feat'],
  '文档': ['文档', '整理', '汇总', '报告', '周报', '日报', '总结', '方案'],
  '会议': ['会议', '评审', '复盘', '沟通', '协调', '汇报'],
  '行政': ['报销', '发票', '合同', '采购', '付款', '审批', '审核']
};

/**
 * 解析相对日期为具体日期字符串
 */
function resolveRelativeDate(text) {
  const now = new Date();
  if (/今天/.test(text)) {
    return formatDate(now);
  }
  if (/明天/.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return formatDate(d);
  }
  if (/后天/.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return formatDate(d);
  }
  if (/本周/.test(text)) {
    // 本周日（周日为一周最后一天）
    const d = new Date(now);
    const dayOfWeek = d.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    d.setDate(d.getDate() + daysUntilSunday);
    return formatDate(d);
  }
  if (/下周/.test(text)) {
    const d = new Date(now);
    const dayOfWeek = d.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 7 : 14 - dayOfWeek;
    d.setDate(d.getDate() + daysUntilSunday);
    return formatDate(d);
  }
  if (/月底|月末/.test(text)) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return formatDate(d);
  }
  return null;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 计算置信度
 */
function calculateConfidence(matchedKeywords, totalKeywords, extractedDate) {
  // 基础分：匹配关键词数 / 总关键词位置数，最多 60 分
  let score = Math.min(matchedKeywords.length * 15, 60);
  // 如果有匹配到关键词，额外加 10-20 分
  if (matchedKeywords.length >= 3) {
    score += 20;
  } else if (matchedKeywords.length >= 2) {
    score += 10;
  } else if (matchedKeywords.length === 1) {
    score += 5;
  }
  // 如果提取到了日期，额外加 20 分
  if (extractedDate) {
    score += 20;
  }
  return Math.min(score, 100);
}

/**
 * 推断分类建议
 */
function inferCategory(matchedKeywords) {
  const scores = {};
  for (const [category, cats] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[category] = 0;
    for (const kw of matchedKeywords) {
      if (cats.some(c => kw.includes(c) || c.includes(kw))) {
        scores[category]++;
      }
    }
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : '其他';
}

exports.main = async (event, context) => {
  const text = (event.text || '').trim();

  if (!text) {
    return {
      isLikely: false,
      confidence: 0,
      keywords: [],
      suggestion: null
    };
  }

  // 匹配工作关键词
  const matchedKeywords = [];
  for (const kw of WORK_KEYWORDS) {
    if (text.includes(kw) && !matchedKeywords.includes(kw)) {
      matchedKeywords.push(kw);
    }
  }

  // 提取日期
  let extractedDate = null;
  let dateSource = null;
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match) {
      dateSource = match[1];
      if (pattern.desc === '相对日期') {
        extractedDate = resolveRelativeDate(match[1]);
      } else if (pattern.desc === '中文日期') {
        // 解析 "5月8日" 格式
        const m = match[1].match(/(\d{1,2})月(\d{1,2})[日号]/);
        if (m) {
          const now = new Date();
          extractedDate = `${now.getFullYear()}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
        }
      } else if (pattern.desc === '月-日') {
        const parts = match[1].split(/[\.-]/);
        const now = new Date();
        extractedDate = `${now.getFullYear()}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
      } else {
        extractedDate = match[1].replace(/\//g, '-');
      }
      break;
    }
  }

  // 如果是相对日期，再跑一遍 resolveRelativeDate
  if (dateSource && !extractedDate) {
    extractedDate = resolveRelativeDate(dateSource);
  }

  const confidence = calculateConfidence(matchedKeywords, WORK_KEYWORDS.length, extractedDate);
  const isLikely = confidence > 40;
  const category = isLikely ? inferCategory(matchedKeywords) : null;

  // 生成建议
  let suggestion = null;
  if (isLikely) {
    suggestion = { category };
    if (extractedDate) {
      suggestion.dueDate = extractedDate;
    }
    if (dateSource) {
      suggestion.dateSource = dateSource;
    }
  }

  return {
    isLikely,
    confidence,
    keywords: matchedKeywords,
    suggestion
  };
};

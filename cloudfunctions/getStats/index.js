// 云函数：getStats
// 服务端计算任务统计数据（默认 4 个月内），减轻客户端压力
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const months = event.months || 4;

  // 计算起始日期：months 个月前的月初
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

  try {
    // 查询该用户指定时间范围内的所有任务
    const tasksRes = await db.collection('tasks')
      .where({
        _openid: openid,
        created_at: _.gte(startDate)
      })
      .get();

    const tasks = tasksRes.data;
    const total = tasks.length;

    let completed = 0;
    let pending = 0;
    let bySource = { voice: 0, clipboard: 0, manual: 0 };
    let byPriority = { high: 0, medium: 0, low: 0 };
    let monthlyMap = {};

    for (const task of tasks) {
      // 状态统计
      if (task.status === 'completed') {
        completed++;
      } else {
        pending++;
      }

      // 来源统计
      const source = task.source || 'manual';
      if (bySource.hasOwnProperty(source)) {
        bySource[source]++;
      } else {
        bySource[source] = 1;
      }

      // 优先级统计
      const priority = task.priority || 'medium';
      if (byPriority.hasOwnProperty(priority)) {
        byPriority[priority]++;
      } else {
        byPriority[priority] = 1;
      }

      // 月度统计
      if (task.created_at) {
        const d = new Date(task.created_at);
        const monthKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        if (!monthlyMap[monthKey]) {
          monthlyMap[monthKey] = { month: monthKey, completed: 0, total: 0 };
        }
        monthlyMap[monthKey].total++;
        if (task.status === 'completed') {
          monthlyMap[monthKey].completed++;
        }
      }
    }

    // 将 monthlyMap 转为按月份排序的数组
    const monthly = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month));

    return {
      total,
      completed,
      pending,
      bySource,
      byPriority,
      monthly
    };
  } catch (err) {
    console.error('getStats 执行失败:', err.message);
    return {
      total: 0,
      completed: 0,
      pending: 0,
      bySource: { voice: 0, clipboard: 0, manual: 0 },
      byPriority: { high: 0, medium: 0, low: 0 },
      monthly: [],
      error: err.message
    };
  }
};

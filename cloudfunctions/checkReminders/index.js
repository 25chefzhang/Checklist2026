// 云函数：checkReminders
// 定期检查到期的提醒并发送订阅消息
// 需要在云函数配置中设置定时触发器（代码中不写触发逻辑）
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const now = new Date();
  let processed = 0;

  try {
    // 查找 status='pending' 且 remind_time <= now 的提醒
    const remindersRes = await db.collection('reminders')
      .where({
        status: 'pending',
        remind_time: _.lte(now)
      })
      .get();

    const reminders = remindersRes.data;

    for (const reminder of reminders) {
      try {
        // 获取关联的 task，检查是否已完成
        const taskRes = await db.collection('tasks')
          .doc(reminder.task_id)
          .get();

        const task = taskRes.data;

        // 若任务不存在或已完成，跳过发送
        if (!task || task.status === 'completed') {
          // 更新提醒状态为 sent（即使跳过也标记，避免重复检查）
          await db.collection('reminders')
            .doc(reminder._id)
            .update({
              data: { status: 'sent', updated_at: now }
            });
          processed++;
          continue;
        }

        // 发送订阅消息
        try {
          await cloud.openapi.subscribeMessage.send({
            touser: reminder._openid,
            templateId: 'YOUR_TEMPLATE_ID', // 需要在微信公众平台申请后替换
            data: {
              thing1: {
                value: (task.content || '').substring(0, 20)
              },
              date2: {
                value: task.due_date || ''
              },
              thing3: {
                value: '点击查看并确认完成'
              }
            },
            page: 'pages/index/index' // 点击消息跳转的页面
          });
        } catch (sendErr) {
          // 用户未授权订阅消息或模板ID无效等错误
          // 记录日志但继续处理下一条
          console.warn('发送订阅消息失败:', reminder._id, sendErr.message);
        }

        // 更新提醒状态为 sent
        await db.collection('reminders')
          .doc(reminder._id)
          .update({
            data: { status: 'sent', updated_at: now }
          });

        processed++;
      } catch (itemErr) {
        console.error('处理提醒失败:', reminder._id, itemErr.message);
        // 继续处理下一条
      }
    }

    return { processed };
  } catch (err) {
    console.error('checkReminders 执行失败:', err.message);
    return { processed, error: err.message };
  }
};

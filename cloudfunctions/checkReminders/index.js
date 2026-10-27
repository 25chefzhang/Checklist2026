// 云函数：checkReminders
// 定期检查到期的提醒，通过订阅消息向不在前台的用户推送
// 需要在云函数配置中设置定时触发器（代码中不写触发逻辑，见 README）
//
// 环境变量（云开发控制台 → 云函数 → checkReminders → 配置 → 环境变量）：
//   TEMPLATE_ID  订阅消息模板 ID（微信公众平台申请后填写）
//
// 订阅消息是「一次性」的：用户每次在小程序内授权，只能换取一条推送。
// 因此本函数负责的是「用户不在前台时，在截止时间点补一条后台推送」；
// 前台每 N 小时/每半天的循环提醒由小程序前台轮询引擎（utils/reminder.js）负责。
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  // 注意：reminders.remind_time 全项目均存 ISO 字符串，查询/写入必须也用字符串，
  // 不能用 Date 对象（否则字符串字段与 Date 比较恒为 true/false，导致提醒错乱）
  const now = new Date().toISOString();

  const templateId = process.env.TEMPLATE_ID || '';
  if (!templateId) {
    console.warn('[checkReminders] 未配置环境变量 TEMPLATE_ID，跳过发送（仅标记到期提醒）');
  }

  let processed = 0;

  try {
    // 查找 status='pending' 且 remind_time <= now 的提醒
    const remindersRes = await db.collection('reminders')
      .where({
        status: 'pending',
        remind_time: _.lte(now)
      })
      .limit(100)
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

        // 发送订阅消息（仅在已配置模板 ID 时）
        if (templateId) {
          try {
            // touser：优先取 reminder 记录的 openid，兜底取 task 记录的 openid
            const touser = reminder._openid || task._openid;
            if (!touser) {
              console.warn('[checkReminders] 提醒记录缺少 openid:', reminder._id);
            } else {
              await cloud.openapi.subscribeMessage.send({
                touser,
                templateId,
                // 注意：data 的 key（thing1/date2/thing3）必须与你申请的模板字段一致，
                // 申请后按实际模板的字段 key 调整这里。
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
            }
          } catch (sendErr) {
            // 用户未授权订阅消息或模板 ID 无效等错误
            // 记录日志但继续处理下一条
            console.warn('[checkReminders] 发送订阅消息失败:', reminder._id, sendErr.message);
          }
        }

        // 更新提醒状态为 sent
        await db.collection('reminders')
          .doc(reminder._id)
          .update({
            data: { status: 'sent', updated_at: now }
          });

        processed++;
      } catch (itemErr) {
        console.error('[checkReminders] 处理提醒失败:', reminder._id, itemErr.message);
        // 继续处理下一条
      }
    }

    return { processed };
  } catch (err) {
    console.error('[checkReminders] 执行失败:', err.message);
    return { processed, error: err.message };
  }
};

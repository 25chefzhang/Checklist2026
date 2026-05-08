# 工作任务清单 — 微信小程序

基于微信小程序的智能工作任务管理工具，支持语音/剪贴板录入、定时语音提醒、浮动快捷入口、4 个月数据持久化。

## 快速开始

### 1. 环境准备

- 下载安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
- 注册微信小程序 AppID（或使用测试号）

### 2. 打开项目

1. 在 Windows 端用微信开发者工具打开本项目目录
2. 导入时选择 `miniprogram/` 作为小程序根目录
3. 填写 `project.config.json` 中的 `appid`

### 3. 开通云开发

1. 在开发者工具中点击「云开发」图标
2. 开通云开发环境（基础版免费额度即可）
3. 复制云环境 ID，替换 `miniprogram/app.js` 中的 `'your-env-id'`

### 4. 创建数据库集合

在云开发控制台 → 数据库中创建以下集合：

| 集合名 | 说明 |
|--------|------|
| `tasks` | 任务主表 |
| `reminders` | 提醒记录 |
| `settings` | 用户设置 |
| `clipboard_logs` | 剪贴板历史 |

### 5. 上传云函数

右键 `cloudfunctions/` 下的每个函数文件夹 → 上传并部署

### 6. 配置定时触发器（可选）

在云开发控制台 → 云函数 → checkReminders → 触发器 → 添加定时触发器
- 触发周期：每 5 分钟
- Cron: `0 */5 * * * * *`

### 7. 申请订阅消息模板（可选）

在微信公众平台 → 功能 → 订阅消息 → 申请模板，替换 `cloudfunctions/checkReminders/index.js` 中的 `YOUR_TEMPLATE_ID`

### 8. 编译运行

点击「编译」，在模拟器或真机预览中调试。

> 语音功能需要在真机上调试，模拟器不支持录音。

## 项目结构

```
miniprogram/
├── app.js / app.json / app.wxss    # 全局入口
├── pages/
│   ├── index/         # 任务列表主页（三天视图）
│   ├── add/           # 添加任务（语音/剪贴板/手动）
│   ├── detail/        # 任务详情
│   └── summary/       # 工作总结（4个月统计）
├── components/
│   ├── float-button/  # 悬浮快捷按钮
│   ├── task-card/     # 任务卡片
│   ├── confirm-dialog/# 确认弹窗
│   └── voice-input/   # 语音输入
└── utils/
    ├── db.js          # 云数据库封装
    ├── voice.js       # 语音录制/播报
    ├── reminder.js    # 提醒引擎
    ├── clipboard.js   # 剪贴板分析
    └── date.js        # 日期工具

cloudfunctions/
├── getOpenid/         # 获取用户标识
├── checkReminders/    # 定时检查提醒
├── getStats/          # 数据统计
└── analyzeClipboard/  # 剪贴板内容分析
```

## 功能清单

- [x] 语音录入工作任务（微信同声传译插件）
- [x] 剪贴板智能识别工作任务
- [x] 手动输入添加任务
- [x] 自动推断截止日期
- [x] 最近三天任务列表视图
- [x] 定时语音提醒（前台 TTS 播报）
- [x] 间隔提醒模式
- [x] 语音确认标记完成
- [x] 悬浮快捷按钮（可拖拽）
- [x] PC 端置顶窗口
- [x] 4 个月数据持久化（云数据库）
- [x] 自动工作总结（按月/来源/优先级统计）

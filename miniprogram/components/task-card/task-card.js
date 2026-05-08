Component({
  properties: {
    task: {
      type: Object,
      value: {}
    },
    showActions: {
      type: Boolean,
      value: true
    }
  },

  data: {
    relativeTime: '',
    priorityColor: '',
    completed: false
  },

  observers: {
    'task': function(task) {
      if (!task) return;
      this.updateRelativeTime(task.deadline);
      this.setPriorityColor(task.priority);
      this.setData({ completed: task.completed || false });
    }
  },

  lifetimes: {
    attached() {
      const task = this.data.task;
      if (task) {
        this.updateRelativeTime(task.deadline);
        this.setPriorityColor(task.priority);
        this.setData({ completed: task.completed || false });
      }
    }
  },

  methods: {
    /** 计算相对时间描述 */
    updateRelativeTime(deadline) {
      if (!deadline) {
        this.setData({ relativeTime: '' });
        return;
      }

      const now = Date.now();
      const target = new Date(deadline).getTime();
      const diff = target - now;
      const absDiff = Math.abs(diff);

      const minutes = Math.floor(absDiff / 60000);
      const hours = Math.floor(absDiff / 3600000);
      const days = Math.floor(absDiff / 86400000);

      let text = '';
      if (diff < 0) {
        if (days > 0) text = `${days}天前过期`;
        else if (hours > 0) text = `${hours}小时前过期`;
        else if (minutes > 0) text = `${minutes}分钟前过期`;
        else text = '刚刚过期';
      } else if (diff === 0) {
        text = '现在';
      } else {
        if (days > 0) text = `剩余${days}天`;
        else if (hours > 0) text = `剩余${hours}小时`;
        else if (minutes > 0) text = `剩余${minutes}分钟`;
        else text = '即将到期';
      }

      this.setData({ relativeTime: text });
    },

    /** 根据优先级设置色条颜色 */
    setPriorityColor(priority) {
      const colorMap = {
        'urgent': '#f44336',
        'high': '#ff9800',
        'normal': '#4caf50',
        'low': '#9e9e9e'
      };
      this.setData({
        priorityColor: colorMap[priority] || '#e0e0e0'
      });
    },

    /** 点击卡片 */
    onTap() {
      this.triggerEvent('tap', { task: this.data.task });
    },

    /** 切换完成状态 */
    onToggleComplete() {
      const taskId = this.data.task.id;
      const completed = !this.data.completed;
      this.setData({ completed });
      this.triggerEvent('complete', { taskId, completed });
    }
  }
});

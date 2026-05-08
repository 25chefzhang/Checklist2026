Component({
  properties: {
    visible: {
      type: Boolean,
      value: true
    }
  },

  data: {
    expanded: false,
    x: 0,
    y: 0,
    // 菜单项配置
    menus: [
      { icon: '＋', label: '快速添加', url: '/pages/add/add?mode=manual', key: 'manual' },
      { icon: '🎤', label: '语音录入', url: '/pages/add/add?mode=voice', key: 'voice' },
      { icon: '📋', label: '剪贴板', url: '/pages/add/add?mode=clipboard', key: 'clipboard' },
      { icon: '📋', label: '查看列表', url: '/pages/index/index', key: 'list' }
    ]
  },

  lifetimes: {
    attached() {
      // 获取屏幕尺寸，设置初始位置
      const systemInfo = wx.getSystemInfoSync();
      const btnSize = 50; // 100rpx / 2 ≈ 50px
      this.setData({
        x: systemInfo.windowWidth - btnSize - 20,
        y: systemInfo.windowHeight - btnSize - 100
      });
    }
  },

  methods: {
    /** 切换展开/收起 */
    toggleExpand() {
      this.setData({ expanded: !this.data.expanded });
    },

    /** 收起菜单 */
    collapse() {
      if (this.data.expanded) {
        this.setData({ expanded: false });
      }
    },

    /** 点击菜单项 */
    onMenuItemTap(e) {
      const index = e.currentTarget.dataset.index;
      const menu = this.data.menus[index];
      this.collapse();

      if (menu.key === 'list') {
        // 切换到首页
        wx.switchTab({ url: menu.url });
      } else {
        wx.navigateTo({ url: menu.url });
      }
    },

    /** 触摸移动 - 拖拽 */
    onTouchMove(e) {
      const touch = e.touches[0];
      const systemInfo = wx.getSystemInfoSync();
      const btnSize = 50; // 半宽
      let x = touch.clientX - btnSize;
      let y = touch.clientY - btnSize;

      // 限制在屏幕内
      if (x < 0) x = 0;
      if (y < 0) y = 0;
      if (x > systemInfo.windowWidth - btnSize * 2) x = systemInfo.windowWidth - btnSize * 2;
      if (y > systemInfo.windowHeight - btnSize * 2) y = systemInfo.windowHeight - btnSize * 2;

      this.setData({ x, y });
    },

    /** 阻止冒泡（点击菜单区域不收起） */
    noop() {}
  }
});

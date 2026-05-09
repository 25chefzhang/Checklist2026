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
    windowHeight: 0,
    menuBottom: 0,
    // 菜单项配置（预计算 animation-delay）
    menus: [
      { icon: '＋', label: '快速添加', url: '/pages/add/add?mode=manual', key: 'manual', delay: '0.00' },
      { icon: '🎤', label: '语音录入', url: '/pages/add/add?mode=voice', key: 'voice', delay: '0.05' },
      { icon: '📋', label: '剪贴板', url: '/pages/add/add?mode=clipboard', key: 'clipboard', delay: '0.10' },
      { icon: '📋', label: '查看列表', url: '/pages/index/index', key: 'list', delay: '0.15' }
    ]
  },

  lifetimes: {
    attached() {
      const systemInfo = wx.getSystemInfoSync();
      const btnSize = 50; // 100rpx / 2 ≈ 50px
      const x = systemInfo.windowWidth - btnSize - 20;
      const y = systemInfo.windowHeight - btnSize - 100;
      this.setData({
        x,
        y,
        windowHeight: systemInfo.windowHeight,
        menuBottom: systemInfo.windowHeight - y - 50
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
        wx.switchTab({ url: menu.url });
      } else {
        wx.navigateTo({ url: menu.url });
      }
    },

    /** 触摸移动 - 拖拽 */
    onTouchMove(e) {
      const touch = e.touches[0];
      const systemInfo = wx.getSystemInfoSync();
      const btnSize = 50;
      let x = touch.clientX - btnSize;
      let y = touch.clientY - btnSize;

      if (x < 0) x = 0;
      if (y < 0) y = 0;
      if (x > systemInfo.windowWidth - btnSize * 2) x = systemInfo.windowWidth - btnSize * 2;
      if (y > systemInfo.windowHeight - btnSize * 2) y = systemInfo.windowHeight - btnSize * 2;

      this.setData({
        x,
        y,
        menuBottom: systemInfo.windowHeight - y - 50
      });
    },

    /** 阻止冒泡（点击菜单区域不收起） */
    noop() {}
  }
});

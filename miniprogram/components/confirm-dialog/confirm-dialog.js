Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    title: {
      type: String,
      value: '确认操作'
    },
    content: {
      type: String,
      value: ''
    },
    confirmText: {
      type: String,
      value: '确认'
    },
    cancelText: {
      type: String,
      value: '取消'
    },
    showCancel: {
      type: Boolean,
      value: true
    }
  },

  methods: {
    /** 点击遮罩关闭 */
    onMaskTap() {
      this.triggerEvent('close');
    },

    /** 点击确认 */
    onConfirm() {
      this.triggerEvent('confirm');
    },

    /** 点击取消 */
    onCancel() {
      this.triggerEvent('cancel');
    },

    /** 阻止冒泡 */
    noop() {}
  }
});

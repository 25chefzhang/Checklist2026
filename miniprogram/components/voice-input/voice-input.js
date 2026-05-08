const recorderManager = wx.getRecorderManager();
const plugin = requirePlugin('WechatSI');

Component({
  properties: {
    maxDuration: {
      type: Number,
      value: 60
    }
  },

  data: {
    status: 'idle',       // idle | recording | recognizing | done
    duration: 0,          // 当前录音秒数
    timer: null           // 计时器引用
  },

  lifetimes: {
    attached() {
      this._initRecorder();
    },
    detached() {
      this._cleanup();
    }
  },

  methods: {
    /** 初始化录音管理器 */
    _initRecorder() {
      // 监听录音开始
      recorderManager.onStart(() => {
        console.log('[voice-input] 录音开始');
        this.setData({ status: 'recording', duration: 0 });
        this._startTimer();
        this.triggerEvent('statuschange', { status: 'recording' });
      });

      // 监听录音结束
      recorderManager.onStop((res) => {
        console.log('[voice-input] 录音结束', res);
        this._stopTimer();
        this.setData({ status: 'recognizing' });
        this.triggerEvent('statuschange', { status: 'recognizing' });

        // 使用 WechatSI 进行语音识别
        this._recognize(res.tempFilePath);
      });

      // 监听录音错误
      recorderManager.onError((err) => {
        console.error('[voice-input] 录音错误', err);
        this._stopTimer();
        this.setData({ status: 'idle', duration: 0 });
        this.triggerEvent('error', { message: err.errMsg || '录音失败' });
        this.triggerEvent('statuschange', { status: 'idle' });
      });
    },

    /** 开始计时器 */
    _startTimer() {
      const timer = setInterval(() => {
        const duration = this.data.duration + 1;
        this.setData({ duration });

        // 达到最大时长自动停止
        if (duration >= this.data.maxDuration) {
          this.stopRecord();
        }
      }, 1000);

      this.data.timer = timer;
    },

    /** 停止计时器 */
    _stopTimer() {
      if (this.data.timer) {
        clearInterval(this.data.timer);
        this.data.timer = null;
      }
    },

    /** 语音识别 */
    _recognize(tempFilePath) {
      const manager = plugin.getRecordRecognitionManager();

      manager.onRecognize = (res) => {
        console.log('[voice-input] 识别中', res);
      };

      manager.onStop = (res) => {
        console.log('[voice-input] 识别完成', res);
        this.setData({ status: 'done', duration: 0 });

        if (res.result) {
          this.triggerEvent('result', { text: res.result });
        } else {
          this.triggerEvent('error', { message: '未识别到语音内容' });
        }

        this.triggerEvent('statuschange', { status: 'done' });

        // 短暂延迟后回到 idle
        setTimeout(() => {
          if (this.data.status === 'done') {
            this.setData({ status: 'idle' });
            this.triggerEvent('statuschange', { status: 'idle' });
          }
        }, 1500);
      };

      manager.onError = (err) => {
        console.error('[voice-input] 识别错误', err);
        this.setData({ status: 'idle', duration: 0 });
        this.triggerEvent('error', { message: err.errMsg || '语音识别失败' });
        this.triggerEvent('statuschange', { status: 'idle' });
      };

      // 开始识别
      manager.start({
        lang: 'zh_CN',
        duration: this.data.maxDuration * 1000,
        tempFilePath: tempFilePath
      });
    },

    /** 按下开始录音 */
    onTouchStart() {
      if (this.data.status === 'recording') return;

      recorderManager.start({
        duration: this.data.maxDuration * 1000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: 'mp3'
      });
    },

    /** 松开结束录音 */
    onTouchEnd() {
      if (this.data.status !== 'recording') return;
      recorderManager.stop();
    },

    /** 触摸取消（手指滑出按钮） */
    onTouchCancel() {
      if (this.data.status !== 'recording') return;
      this._stopTimer();
      this.setData({ status: 'idle', duration: 0 });
      recorderManager.stop();
      this.triggerEvent('statuschange', { status: 'idle' });
      wx.showToast({ title: '已取消', icon: 'none', duration: 1000 });
    },

    /** 手动停止录音 */
    stopRecord() {
      if (this.data.status === 'recording') {
        recorderManager.stop();
      }
    },

    /** 组件销毁时清理 */
    _cleanup() {
      this._stopTimer();
      // 如果正在录音则停止
      if (this.data.status === 'recording') {
        try {
          recorderManager.stop();
        } catch (e) {
          // ignore
        }
      }
    }
  }
});

// components/voice-input/voice-input.js — 语音输入组件
// 已移除 WechatSI 插件依赖，改用 voice.js 工具（云函数识别降级方案）

const recorderManager = wx.getRecorderManager();
const voice = require('../../utils/voice.js');

Component({
  properties: {
    maxDuration: {
      type: Number,
      value: 60
    }
  },

  data: {
    status: 'idle',       // idle | recording | recognizing | done | error
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

      // 监听录音结束 → 上传 + 云函数识别
      recorderManager.onStop((res) => {
        console.log('[voice-input] 录音结束', res);
        this._stopTimer();
        this.setData({ status: 'recognizing' });
        this.triggerEvent('statuschange', { status: 'recognizing' });

        if (res.tempFilePath) {
          this._recognize(res.tempFilePath);
        } else {
          this.setData({ status: 'error', duration: 0 });
          this.triggerEvent('error', { message: '录音文件为空' });
          this.triggerEvent('statuschange', { status: 'error' });
          this._resetAfterDelay();
        }
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

    /** 语音识别：上传到云存储 → 调用云函数 */
    async _recognize(tempFilePath) {
      try {
        const text = await voice.uploadAndRecognize(tempFilePath);
        console.log('[voice-input] 识别完成:', text);

        this.setData({ status: 'done', duration: 0 });

        if (text) {
          this.triggerEvent('result', { text });
        } else {
          this.setData({ status: 'error' });
          this.triggerEvent('error', { message: '语音识别失败，请手动输入' });
        }

        this.triggerEvent('statuschange', { status: text ? 'done' : 'error' });

        // 短暂延迟后回到 idle
        this._resetAfterDelay();
      } catch (e) {
        console.error('[voice-input] 识别异常:', e);
        this.setData({ status: 'error', duration: 0 });
        this.triggerEvent('error', { message: '语音识别失败，请手动输入' });
        this.triggerEvent('statuschange', { status: 'error' });
        this._resetAfterDelay();
      }
    },

    /** 延迟重置状态 */
    _resetAfterDelay() {
      setTimeout(() => {
        if (this.data.status === 'done' || this.data.status === 'error') {
          this.setData({ status: 'idle' });
          this.triggerEvent('statuschange', { status: 'idle' });
        }
      }, 2000);
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

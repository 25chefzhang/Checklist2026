// utils/voice.js — 语音识别统一封装
//
// 后端优先级：
//   1. 微信同声传译插件 WechatSI（免费、官方、实时识别，需在 app.json 声明并在
//      微信公众平台「设置 → 第三方设置 → 插件管理」中添加插件，真机可用）
//   2. 降级：原生 RecorderManager 录音 → 上传云存储 → recognizeVoice 云函数
//      （腾讯云 ASR，需在云函数配置 TENCENT_SECRET_ID/KEY）
//
// 对外统一接口：createRecognizer({ onStart, onResult, onError }) → { start, stop }

const PLUGIN_ID = 'WechatSI'

let _recorder = null
let _plugin = undefined // undefined = 未探测

function _getRecorder() {
  if (!_recorder) _recorder = wx.getRecorderManager()
  return _recorder
}

/**
 * 探测并缓存 WechatSI 插件是否可用
 */
function _getPlugin() {
  if (_plugin !== undefined) return _plugin
  try {
    const p = requirePlugin(PLUGIN_ID)
    _plugin = (p && typeof p.getRecordRecognitionManager === 'function') ? p : null
  } catch (e) {
    _plugin = null
  }
  return _plugin
}

/**
 * 插件是否可用（供 UI 提示当前识别方式）
 */
function pluginAvailable() {
  return !!_getPlugin()
}

/**
 * 创建语音识别器
 * @param {object} handlers { onStart?, onResult(text), onError(msg) }
 * @returns {{ start, stop, mode }}
 */
function createRecognizer(handlers) {
  const plugin = _getPlugin()
  if (plugin) return _createPluginRecognizer(plugin, handlers)
  return _createCloudRecognizer(handlers)
}

// ---- 方案一：WechatSI 插件（实时识别） ----
function _createPluginRecognizer(plugin, handlers) {
  const manager = plugin.getRecordRecognitionManager()

  manager.onStop = (res) => {
    const text = (res && res.result) ? String(res.result).trim() : ''
    handlers.onResult(text)
  }
  manager.onError = (res) => {
    handlers.onError((res && res.msg) || '语音识别失败，请重试')
  }

  return {
    mode: 'plugin',
    start() {
      if (handlers.onStart) handlers.onStart()
      manager.start({ duration: 60000, lang: 'zh_CN' })
    },
    stop() {
      try { manager.stop() } catch (e) { /* ignore */ }
    }
  }
}

// ---- 方案二：原生录音 + 云函数（腾讯云 ASR） ----
function _createCloudRecognizer(handlers) {
  const recorder = _getRecorder()

  recorder.onStop = (res) => {
    if (!res.tempFilePath) {
      handlers.onError('录音文件为空')
      return
    }
    uploadAndRecognize(res.tempFilePath)
      .then((text) => handlers.onResult(text))
      .catch((e) => handlers.onError(e && e.message ? e.message : '识别失败'))
  }
  recorder.onError = (err) => {
    handlers.onError((err && err.errMsg) || '录音失败，请重试')
  }

  return {
    mode: 'cloud',
    start() {
      if (handlers.onStart) handlers.onStart()
      recorder.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: 'mp3'
      })
    },
    stop() {
      try { recorder.stop() } catch (e) { /* ignore */ }
    }
  }
}

/**
 * 上传录音文件到云存储，再调用云函数做语音识别
 * @param {string} filePath 录音临时文件路径
 * @returns {Promise<string>} 识别文本；失败返回空字符串
 */
async function uploadAndRecognize(filePath) {
  const cloudPath = `voice/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`
  let fileID = ''

  try {
    const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath })
    fileID = uploadRes.fileID
  } catch (e) {
    console.error('[voice] 上传音频失败:', e)
    throw new Error('音频上传失败')
  }

  const res = await wx.cloud.callFunction({
    name: 'recognizeVoice',
    data: { fileID }
  })
  const text = (res.result && res.result.text) ? String(res.result.text).trim() : ''
  if (!text) {
    console.warn('[voice] 云函数识别为空:', res.result && res.result.error)
  }
  return text
}

/**
 * 语音播报（TTS 已降级 — 震动 + toast）
 */
function speakText(text) {
  return new Promise((resolve) => {
    wx.vibrateLong({ success: () => resolve(), fail: () => resolve() })
    if (text) {
      wx.showToast({ title: text, icon: 'none', duration: 2000 })
    }
    setTimeout(resolve, 100)
  })
}

module.exports = {
  createRecognizer,
  pluginAvailable,
  uploadAndRecognize,
  speakText,
  getRecorder: _getRecorder
}

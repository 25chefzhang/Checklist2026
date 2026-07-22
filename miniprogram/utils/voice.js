// utils/voice.js — 语音录入工具（纯原生 API + 云函数降级方案）
// 已移除 WechatSI 插件依赖

let recorderManager = null

/**
 * 初始化录音管理器
 */
function getRecorder() {
  if (!recorderManager) {
    recorderManager = wx.getRecorderManager()
  }
  return recorderManager
}

/**
 * 开始录音
 * @returns {Promise<string>} 临时文件路径
 */
function startRecord() {
  return new Promise((resolve, reject) => {
    const recorder = getRecorder()

    recorder.onStop((res) => {
      if (res.tempFilePath) {
        resolve(res.tempFilePath)
      } else {
        reject(new Error('录音文件为空'))
      }
    })

    recorder.onError((err) => {
      reject(err)
    })

    recorder.start({
      duration: 60000,       // 最长60秒
      sampleRate: 16000,     // 16kHz 采样率
      numberOfChannels: 1,   // 单声道
      encodeBitRate: 48000,
      format: 'mp3'
    })
  })
}

/**
 * 停止录音
 */
function stopRecord() {
  const recorder = getRecorder()
  recorder.stop()
}

/**
 * 上传录音文件到云存储，再调用云函数做语音识别
 * @param {string} filePath 录音临时文件路径
 * @returns {Promise<string>} 识别文本；失败时返回空字符串（调用方应回退到手动输入）
 */
async function uploadAndRecognize(filePath) {
  // 1. 上传到云存储
  const cloudPath = `voice/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`
  let fileID = ''

  try {
    const uploadRes = await wx.cloud.uploadFile({
      cloudPath,
      filePath
    })
    fileID = uploadRes.fileID
    console.log('[voice] 音频已上传:', fileID)
  } catch (e) {
    console.error('[voice] 上传音频失败:', e)
    return '' // 降级：返回空让调用方走手动输入
  }

  // 2. 调用云函数识别
  try {
    const res = await wx.cloud.callFunction({
      name: 'recognizeVoice',
      data: { fileID }
    })
    const text = (res.result && res.result.text) ? res.result.text.trim() : ''
    console.log('[voice] 识别结果:', text || '(空)')
    return text
  } catch (e) {
    console.error('[voice] 云函数识别失败:', e)
    return '' // 降级
  }
}

/**
 * 语音识别（便捷封装 — 上传 + 云函数识别）
 * @param {string} filePath 录音临时文件路径
 * @returns {Promise<string>} 识别文本；失败时返回空字符串
 */
function recognizeVoice(filePath) {
  return uploadAndRecognize(filePath)
}

/**
 * 语音播报（已降级 — TTS 不可用，改为震动 + toast）
 * @param {string} text - 要播报的文字（保留兼容，实际仅震动）
 * @returns {Promise<void>}
 */
function speakText(text) {
  return new Promise((resolve) => {
    wx.vibrateLong({
      success: () => resolve(),
      fail: () => resolve()
    })
    // 也用 toast 提示一次
    if (text) {
      wx.showToast({ title: text, icon: 'none', duration: 2000 })
    }
    // 确保 resolve 一定会被调用
    setTimeout(resolve, 100)
  })
}

module.exports = {
  startRecord,
  stopRecord,
  recognizeVoice,
  uploadAndRecognize,
  speakText,
  getRecorder
}

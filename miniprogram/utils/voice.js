// utils/voice.js — 语音录入与播报工具

const plugin = requirePlugin('WechatSI')
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
 * 语音识别（使用同声传译插件的流式识别）
 * @returns {Promise<string>} 识别文本
 */
function recognizeVoice(filePath) {
  return new Promise((resolve, reject) => {
    const manager = plugin.getRecordRecognitionManager()
    let finalText = ''

    manager.onRecognize = (res) => {
      // 实时返回部分结果
    }

    manager.onStop = (res) => {
      finalText = res.result || finalText
      if (finalText) {
        resolve(finalText)
      } else {
        reject(new Error('未识别到语音内容'))
      }
    }

    manager.onError = (err) => {
      reject(err)
    }

    // 开始识别
    manager.start({
      lang: 'zh_CN',
      duration: 60000
    })

    // 将录音文件传递给识别器
    // 注：同声传译插件的 recordRecognitionManager 直接读取麦克风，
    // 若需从文件识别，需使用 wx.createRecognitionTask (旧 API) 或服务端方案
  })
}

/**
 * 语音播报（TTS 文字转语音）
 * @param {string} text - 要播报的文字
 * @returns {Promise<void>}
 */
function speakText(text) {
  return new Promise((resolve, reject) => {
    plugin.textToSpeech({
      lang: 'zh_CN',
      tts: true,
      content: text,
      success: (res) => {
        const audio = wx.createInnerAudioContext()
        audio.src = res.filename
        audio.onEnded(() => {
          audio.destroy()
          resolve()
        })
        audio.onError((err) => {
          audio.destroy()
          reject(err)
        })
        audio.play()
      },
      fail: (err) => {
        reject(err)
      }
    })
  })
}

module.exports = {
  startRecord,
  stopRecord,
  recognizeVoice,
  speakText,
  getRecorder
}

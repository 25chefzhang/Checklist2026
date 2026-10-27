// cloudfunctions/recognizeVoice/index.js
// 语音识别云函数：从云存储下载音频 → 腾讯云 ASR（一句话识别）→ 返回文本
//
// 作为语音识别的「降级后端」：当前端无法使用微信同声传译插件（WechatSI）时，
// 走「原生录音 → 上传云存储 → 本云函数」链路。
//
// 需要环境变量（在云开发控制台 → 云函数 → recognizeVoice → 配置 → 环境变量）：
//   TENCENT_SECRET_ID   腾讯云 API 密钥 ID
//   TENCENT_SECRET_KEY  腾讯云 API 密钥 Key
// 并开通「语音识别 ASR」服务（有每月免费额度）。
// 未配置密钥时返回空文本，前端会降级到手动输入。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const { fileID } = event

  if (!fileID) {
    return { text: '', error: '缺少 fileID 参数' }
  }

  try {
    // 1. 从云存储下载音频
    const downloadRes = await cloud.downloadFile({ fileID })
    const audioBuffer = downloadRes.fileContent
    if (!audioBuffer || audioBuffer.length === 0) {
      return { text: '', error: '音频文件为空' }
    }
    console.log(`[recognizeVoice] 音频已下载, 大小: ${audioBuffer.length} bytes`)

    // 2. 读取密钥
    const secretId = process.env.TENCENT_SECRET_ID
    const secretKey = process.env.TENCENT_SECRET_KEY
    if (!secretId || !secretKey) {
      console.warn('[recognizeVoice] 未配置 TENCENT_SECRET_ID/KEY，跳过识别')
      return { text: '', error: '未配置腾讯云密钥' }
    }

    // 3. 调用腾讯云 ASR（一句话识别）
    const tencentcloud = require('tencentcloud-sdk-nodejs')
    const AsrClient = tencentcloud.asr.v20190614.Client
    const client = new AsrClient({
      credential: { secretId, secretKey },
      region: 'ap-guangzhou',
      profile: {
        httpProfile: { endpoint: 'asr.tencentcloudapi.com', reqTimeout: 30 }
      }
    })

    const params = {
      ProjectId: 0,
      SubServiceType: 2,        // 一句话识别
      EngSerViceType: '16k_zh', // 中文普通话
      SourceType: 1,            // 1 = 音频数据（base64）
      VoiceFormat: 'mp3',
      Data: audioBuffer.toString('base64'),
      DataLen: audioBuffer.length
    }

    const res = await client.SentenceRecognition(params)
    const text = (res && res.Result) ? String(res.Result).trim() : ''
    console.log('[recognizeVoice] 识别结果:', text || '(空)')

    return { text }

  } catch (e) {
    console.error('[recognizeVoice] 识别失败:', e)
    return { text: '', error: e.message }
  }
}

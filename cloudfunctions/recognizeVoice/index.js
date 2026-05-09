// cloudfunctions/recognizeVoice/index.js
// 语音识别云函数：从云存储下载音频 → 调用腾讯云 ASR → 返回文本
// 当前为桩实现：返回空文本，让前端降级到手动输入。
// 接入真实 ASR 时替换此文件即可。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { fileID } = event

  if (!fileID) {
    return { text: '', error: '缺少 fileID 参数' }
  }

  try {
    // 1. 从云存储下载音频文件
    const downloadRes = await cloud.downloadFile({ fileID })
    const audioBuffer = downloadRes.fileContent
    console.log(`[recognizeVoice] 音频已下载, 大小: ${audioBuffer.length} bytes`)

    // 2. TODO: 调用腾讯云 ASR 接口进行识别
    //    示例（需先配置 secretId/secretKey）：
    //
    //    const tencentcloud = require('tencentcloud-sdk-nodejs')
    //    const AsrClient = tencentcloud.asr.v20190614.Client
    //    const client = new AsrClient({ credential: {...}, region: 'ap-guangzhou' })
    //    const result = await client.SentenceRecognition({...})
    //    const text = result.Data.Result || ''
    //    return { text }
    //
    // 当前桩实现：返回空文本，前端会提示用户手动输入

    return { text: '' }

  } catch (e) {
    console.error('[recognizeVoice] 识别失败:', e)
    return { text: '', error: e.message }
  }
}

/* global AudioWorkletProcessor, registerProcessor */
/**
 * AudioWorklet Processor
 * 在獨立的 Audio 執行緒中擷取原始 PCM 音訊資料
 * 將 Float32 轉換為 Int16 PCM 後透過 port 傳回主執行緒
 */
class LiveTranslateProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._bufferSize = 4096 // 每次發送的樣本數
    this._buffer = new Float32Array(this._bufferSize)
    this._bufferIndex = 0
    this._isActive = true

    this.port.onmessage = (event) => {
      if (event.data.type === "stop") {
        this._isActive = false
      }
    }
  }

  /**
   * 將 Float32 音訊資料轉換為 Int16 PCM
   * Gemini Live API 需要 Linear16 格式
   */
  float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length)
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]))
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }
    return int16Array
  }

  process(inputs, _outputs, _parameters) {
    if (!this._isActive)
      return false

    const input = inputs[0]
    if (!input || !input[0])
      return true

    const channelData = input[0] // 只取第一個通道（mono）

    for (let i = 0; i < channelData.length; i++) {
      this._buffer[this._bufferIndex++] = channelData[i]

      if (this._bufferIndex >= this._bufferSize) {
        // 緩衝區滿了，轉換並發送
        const int16Data = this.float32ToInt16(this._buffer)
        this.port.postMessage({
          type: "audio",
          data: int16Data.buffer,
        }, [int16Data.buffer])

        this._buffer = new Float32Array(this._bufferSize)
        this._bufferIndex = 0
      }
    }

    return true
  }
}

registerProcessor("live-translate-processor", LiveTranslateProcessor)

# 即時翻譯輸出模式設計（Live Output Mode）

日期：2026-09-04
狀態：設計已批准，待實作

## 1. 背景

目前擴充功能使用 `gemini-3.5-live-translate-preview`（speech-to-speech 專用模型），
`responseModalities: ["AUDIO"]` 已要求翻譯語音，但 Offscreen 只抽取文字字幕，
`modelTurn.parts[].inlineData` 音訊直接丟棄，因此使用者聽不到翻譯語音。

本設計新增可切換的輸出模式，不更換模型。

## 2. 需求（已確認）

- 兩種模式：`text`（只輸出文字字幕）／`voice`（語音帶文字）。
- `voice` 模式：靜音原影片音，只播翻譯語音。
- 切換開關放在 Popup + 設定頁，兩邊讀寫同一 storage key 即時同步。
- 預設 `text` 模式（省流量、保持現狀）。
- 方案：A（Offscreen 直接解碼播放），已由使用者批准。

## 3. 架構與元件

### 3.1 配置（`src/utils/storage.ts`）

- `AppConfig` 新增 `liveOutputMode: "text" | "voice"`。
- `getLiveTranslateConfig()` 預設回傳 `"text"`（舊使用者無此 key 時降級）。
- `saveLiveTranslateConfig()` 透傳，无需 migration。

### 3.2 交握（`src/entrypoints/offscreen/main.ts`）

- 兩模式統一維持 `responseModalities: ["AUDIO"]`＋`input/outputAudioTranscription`，
  `text` 模式僅丟棄 `inlineData`。好處：切換模式不用重建 WebSocket，即時生效；
  代價：`text` 模式仍下行音訊流量（可接受，YAGNI 不做 TEXT/重連分支）。

### 3.3 播放管線（Offscreen，新增）

- 新增 `playbackCtx: AudioContext({ sampleRate: 24000 })`＋`GainNode`＋FIFO 播放佇列。
- `onmessage` 收到 `serverContent.modelTurn.parts[]`：
  - 文字抽取邏輯不變（字幕照常顯示）。
  - 若 `part.inlineData?.data` 存在且 `mode === "voice"`：
    base64 → Int16 PCM（24kHz mono）→ 排入佇列依序播放。
  - 若 `mode === "text"`：丟棄音訊。
- 原音靜音：`voice` 模式 `destinationNode.disconnect()`；
  切回 `text` 模式 `destinationNode.connect(destination)`。
- `stopLiveTranslateCore()` 清佇列、關閉 `playbackCtx`。
- 解碼單塊失敗：跳過該塊並 `console.error`，不中斷串流。
- `playbackCtx` 建立/resume 失敗：降級為 `text` 行為並回報
  `sendLiveTranslateStatus({ status: "error", error })`。

### 3.4 模式傳遞（`src/entrypoints/background/index.ts`）

- `startVideoLiveTranslate` 轉發時附帶 `outputMode`。
- 新增訊息 `liveTranslateOutputModeChanged`，Offscreen 收到後即時更新記憶體內
  `currentOutputMode`，不重連、不中斷字幕。

### 3.5 UI

- Popup：在啟動按鈕下方新增兩段式切換「只輸出文字／語音帶文字」，
  寫入 `saveLiveTranslateConfig({ liveOutputMode })` 並即時送
  `liveTranslateOutputModeChanged`（若連線中）。
- Options（語言設定區）：新增同一欄位，讀寫同一 key。
- 兩邊開啟時都從 `getLiveTranslateConfig()` 讀初始值。

## 4. 資料流

1. 使用者切換模式 → `storage.local` 更新 →（若連線中）background 轉發
   `liveTranslateOutputModeChanged` → Offscreen 更新 `currentOutputMode`
   ＋ 接/斷原音節點。
2. 音訊下行：WS `modelTurn.inlineData` → 解碼 → 24kHz 佇列播放（僅 voice）。
3. 文字下行：`input/outputTranscription` → `sendLiveTranslationChunk` →
   Content Script 字幕（兩模式一致）。

## 5. 錯誤處理

| 情境 | 處理 |
|---|---|
| 15 秒無 `setupComplete` | 已有逾時報錯（前次修復），保留 |
| 單塊音訊解碼失敗 | 跳塊＋log，不斷流 |
| `playbackCtx` 不可用 | 降級 text＋error 狀態回報 |
| 模式訊息在 Offscreen 就緒前送達 | 沿用既有重試機制 |

## 6. 測試

- `npx wxt build` 通過。
- 手動：text 模式有字無聲；voice 模式有聲有字且原音靜音；
  連線中切換即時生效；重載擴充功能後記住選擇。

## 7. 非目標（YAGNI）

- 不做語音選擇（voice name）、語速、音量滑桿。
- 不做 TEXT modality 分支／切換重連。
- 不把音訊轉發到 Content Script 播放。
- 不做瀏覽器 SpeechSynthesis TTS 備援。

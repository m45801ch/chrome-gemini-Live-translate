# 更新日誌

## 1.1.5 - 2026-09-04

### 新功能
- 新增即時翻譯輸出模式切換：「只輸出文字」或「語音帶文字」，可在 Popup 與設定頁同步切換（預設為文字模式）
- 語音模式會播放 Gemini 翻譯語音並自動靜音原影片音；切回文字模式即恢復原音，切換過程不斷線、不重連

### 修復
- 修復特定環境下卡在「正在連線並配置語音...」的問題：Offscreen 就緒競態重試、setupComplete 15 秒逾時主動報錯、AudioContext resume、狀態廣播強健化
- 移除被 v1alpha 端點拒絕的 setup 欄位（`inputAudioTranscription`／`outputAudioTranscription`，1007），連線交握恢復正常

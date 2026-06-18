# WXT 影片即時翻譯與字幕整合技能 (wxt-live-translate-subtitles)

本技能 (Skill) 專為基於 WXT 框架開發的 `read-frog` 瀏覽器擴充功能設計，詳細記錄了如何無損地將 **影片即時語音翻譯**（利用 Gemini 3.5 Live API）與**雙語字幕系統**進行深度整合的核心邏輯、避坑指南與狀態管理機制。

此說明檔可與 `SKILL.md` 一起部署於 GitHub 倉庫中，方便未來 AI 代理 (Agent) 或開發者直接讀取並在全新版本中重現此功能。

---

## 🚀 技能核心功能

本技能指導 AI 代理與開發者實現以下三大核心機制：

1.  **即時語訊捕捉與傳輸**：
    *   在 `Offscreen API` 中建立 WebSocket 連線，與 **Gemini 3.5 Live API** 進行低延遲雙向音訊流傳輸。
    *   精確進行 **BCP-47** 標準語系代碼轉換（防範 `1007` 伺服器斷線錯誤）。
2.  **雙語字幕 UI 自動接管**：
    *   當即時語音啟用時，自動接管 `SubtitlesView`。
    *   藉由 Jotai Atoms 動態管理字幕容器的顯示、文字流對齊（左貼齊/居中）以及多行過濾（只保留最新 N 行）。
3.  **Content Script 彈性注入**：
    *   即使未啟用普通字幕，亦一律注入 Content Script 以隨時響應來自 Popup 的「開始即時翻譯」請求。

---

## 📂 技能涉及的入口點

在移植或重構此功能時，主要修改的檔案包含：

| 檔案路徑 | 作用說明 |
| :--- | :--- |
| `src/entrypoints/subtitles.content/index.tsx` | Content Script 載入點，負責一律注入即時翻譯腳本 |
| `src/entrypoints/subtitles.content/universal-adapter.ts` | 負責影片播放器 UI 按鈕渲染、按鈕動態顯示控制 |
| `src/entrypoints/background/live-translate.ts` | Background Service Worker，負責協調 Offscreen 與 Content Script 之間的訊息傳遞 |
| `src/entrypoints/offscreen/main.ts` | Offscreen 頁面，負責 WebSocket 連接、語音串流發送與接收翻譯 text chunk |
| `src/entrypoints/popup/app.tsx` | Popup 彈出視窗，提供即時語音翻譯開關與 API Key 設定介面 |

---

## ⚠️ 開發與避坑指南（關鍵原則）

*   **語系代碼 Mapping**：Gemini Live API 不接受三字元 ISO-639-3 代碼，必須在 Offscreen 階段使用相容表轉換為 BCP-47（例如 `cmn-Hant` 轉為 `zh-Hant`）。
*   **停用 Timeupdate 更新**：即時翻譯的字幕為虛擬時間（`start: 0, end: 99999999`）。當即時語音 active 時，必須停用 `subtitlesScheduler`（調用 `subtitlesScheduler.hide()`），防止播放器進度反覆清空字幕。
*   **Chrome 多國語言限制**：i18n 的 YAML 語系檔中，所有的鍵值不可包含減號 `-`，必須以底線 `_` 替換（如 `extra-large` 改為 `extra_large`），否則 Chrome 會拒絕載入擴充功能。

---

## 📦 如何在 GitHub 部署

1.  在 GitHub 上建立一個名為 `my-read-frog-skills` 的倉庫。
2.  將本目錄底下的 **`SKILL.md`**（技能主檔）與本 **`README.md`** 上傳至該倉庫。
3.  未來如果要在新版本中重製此功能，只需向 AI 代理提供該 GitHub 連結或本機 Skill 檔案即可。

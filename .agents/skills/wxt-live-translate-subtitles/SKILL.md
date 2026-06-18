---
name: wxt-live-translate-subtitles
description: 影片即時翻譯（Gemini Live API）與雙語字幕的整合、Content Script 注入以及語系代碼轉換的除錯與開發指引。
---

# WXT 影片即時翻譯與字幕整合指南

## When to Use

在修改、維護或除錯 **影片即時翻譯**（Gemini 3.5 Live API）或 **雙語字幕** 功能時，應調用此技能。
主要涉及的入口點包含：
- [index.tsx (Content Script)](file:///e:/%E4%B8%8B%E8%BC%89/%E8%87%AA%E8%A3%BDAPP/read-frog-main/src/entrypoints/subtitles.content/index.tsx)
- [universal-adapter.ts](file:///e:/%E4%B8%8B%E8%BC%89/%E8%87%AA%E8%A3%BDAPP/read-frog-main/src/entrypoints/subtitles.content/universal-adapter.ts)
- [live-translate.ts (Background)](file:///e:/%E4%B8%8B%E8%BC%89/%E8%87%AA%E8%A3%BDAPP/read-frog-main/src/entrypoints/background/live-translate.ts)
- [main.ts (Offscreen)](file:///e:/%E4%B8%8B%E8%BC%89/%E8%87%AA%E8%A3%BDAPP/read-frog-main/src/entrypoints/offscreen/main.ts)
- [app.tsx (Popup)](file:///e:/%E4%B8%8B%E8%BC%89/%E8%87%AA%E8%A3%BDAPP/read-frog-main/src/entrypoints/popup/app.tsx)

## 成功經驗與關鍵原則

### 1. 確保 Content Script 隨時被注入
* **問題**：若使用者未開啟「雙語字幕」設定，且 Content Script 限制了只有在該設定啟用時才注入，那麼當使用者在 Popup 點選「開始即時翻譯」時，後台雖然連線成功（顯示翻譯中），但分頁內因無 Content Script 接收 `sendLiveTranslationChunk` 訊息，畫面將無法出現 any 字幕。
* **解法**：在 `index.tsx` 的 `main()` 中，**一律注入 Content Script**，不應做 `config?.videoSubtitles?.enabled` 的前置 return 限制。
* **動態 UI 控制**：為了避免在未開啟雙語字幕時干擾播放器，我們在 `universal-adapter.ts` 的 `renderTranslateButton` 與 `tryAutoStartSubtitles` 內部動態讀取設定。若雙語字幕未開啟，則不渲染播放器左下角的青蛙按鈕，且不自動啟動普通雙語字幕。

### 2. 語系代碼相容性 (BCP-47)
* **問題**：`read-frog` 的設定中使用三字元的 ISO 639-3 代碼（例如 `cmn-Hant`），但 Gemini Live API 要求使用標準 BCP-47 代碼（例如 `zh-Hant`）。傳送不相容的語系代碼會導致 Gemini 伺服器立即斷線（錯誤代碼 `1007` 或 `1011`），使即時翻譯連線失敗。
* **解法**：在 Offscreen 的 WebSocket 握手 payload 中，必須先使用 `mapISO6393ToBCP47` 進行代碼轉換後再傳入 `translationConfig`。

### 3. Jotai Atoms 狀態控制
即時翻譯啟動時，會變更以下狀態：
- `videoLiveTranslateActiveAtom` 被設為 `true`（這會觸發 `handleLiveTranslateActiveChanged`，進而暫停普通的 `translationCoordinator` 與 `subtitlesScheduler`，並初始化 `LiveSubtitleManager`）。
- `subtitlesVisibleAtom` 被設為 `true`（確保字幕容器 `SubtitlesContainer` 被正常掛載）。
- 當收到 chunk 時，更新 `currentSubtitleAtom`。此時若 `currentSubtitleAtom` 含有文字， `subtitlesShowContentAtom` 便會回傳 `true`，從而使 `SubtitlesView` 取消 `invisible` 樣式並渲染字幕。

### 4. 即時翻譯個人化控制渲染
- **對齊方式控制**：當對齊方式設為 `left` 時，除了將子元素文字對齊設為 `left` 之外，必須在外層包裹容器 `SubtitlesContent` 的 `div` 中動態替換 CSS 類別，由 `text-center items-center` 切換為 `text-left items-start`，以實現整體排版向左貼齊。
- **行數過濾**：可實作 `limitLines(text, maxLines)` 在 React 元件內動態截取並只保留最後 N 行字，如此可完美即時響應設定值的任何即時變化。

## 常見錯誤防範

- **不可前置 return**：切勿在 `index.tsx` 的 Content Script 載入點因雙語字幕關閉而中止載入。
- **不可在 timeupdate 中更新即時翻譯**：即時翻譯的字幕是由 `LiveSubtitleManager` 回報而更新的，它的 `start: 0, end: 99999999` 是虛擬時間。因此在即時翻譯 active 時，必須停用 `subtitlesScheduler`（即調用 `subtitlesScheduler.hide()`），否則 `timeupdate` 的進度更新會反覆清空即時翻譯的內容。
- **i18n 鍵值避免使用純數字**：WXT 的強型別 i18n 系統在掃描 YAML 時，不支援純數字作為 YAML 的屬性名稱（例如 `1:`、`2:`、`3:`）。這會導致 TypeScript 編譯型別解析為 `never` 或無法 assign 的錯誤。請一律使用字串鍵值（例如 `one`、`two`、`three`）。
- **i18n 鍵值不可包含減號 `-`**：Chrome 擴充功能的多國語言翻譯鍵名只能包含 ASCII `[a-z], [A-Z], [0-9]` 和底線 `_`。如果在 YAML 中定義了含有減號的子鍵（例如 `extra-large:`），WXT 在打包生成 `_locales/*/messages.json` 時會生成包含減號的鍵名，這會被 Chrome 判定為無效鍵名而拒絕加載擴充功能。因此應將減號以底線 `_` 替換或改用駝峰命名法。
- **Zod 寬鬆配置與安全防護設計**：在擴充功能全域配置 Zod Schema 中，涉及多種歷史版本語系欄位（如 `sourceLang`, `targetLang`）不應在 Schema 級別設下過於嚴格的限制（例如強限制必須為合規的 ISO-639-3）。若使用者 localStorage 中仍留有舊格式髒資料（如 `"zh-tw"`、`"zh-Hant"`），極其嚴格的 Zod 驗證會導致使用者每次更新任何其他設定（例如輸入 API Key、切換開關）時，因為全域 optimistic update 連帶的 validation 失敗而拋出例外，導致 UI 完全回滾、無法點擊或輸入。應使 schema 保持寬鬆的 `z.string()` 確保寫入通暢，並在 Options 前端 Select 元件中實作 `langCodeISO6393Schema.options.includes` 降級 fallback 顯示。
- **語系代碼 Mapping 的極致容錯**：在 Offscreen 轉譯為標準 BCP-47 代碼（如 `"zh-Hant"`）時，除對應標準三字元代碼外，必須在 `explicitMap` 字典中補齊常見舊有或地區語系格式的直接映射（例如 `"zh-tw"`, `"zh-hk"` 映射至 `"zh-Hant"`；`"zh-cn"`, `"zh-sg"` 映射至 `"zh-Hans"`），防堵不相容代碼轉為 `"zh"` 導致 Gemini Live API 連線遭斷線（錯誤代碼 `1007`）的情形。

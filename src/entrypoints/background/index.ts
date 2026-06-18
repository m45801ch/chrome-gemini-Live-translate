import { defineBackground } from "#imports"
import { getLiveTranslateConfig } from "@/utils/storage"

let activeTabId: number | null = null;
let liveTranslateStatus: "disconnected" | "connecting" | "connected" | "error" = "disconnected";

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"]
  });
  if (contexts.length > 0) {
    return;
  }
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Capture tab audio and stream to translation API"
  });
}

export default defineBackground(() => {
  console.log("Background service worker initialized");

  // 監聽訊息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = sender.tab?.id || activeTabId;

    if (message.type === "startVideoLiveTranslate") {
      const targetTabId = message.data?.tabId || sender.tab?.id;
      if (!targetTabId) {
        sendResponse({ ok: false, reason: "No target tab ID" });
        return true;
      }

      chrome.tabCapture.getMediaStreamId({ targetTabId }, async (streamId) => {
        if (!streamId) {
          console.error("Failed to get media stream ID");
          sendResponse({ ok: false, reason: "captureFailed" });
          return;
        }

        try {
          const config = await getLiveTranslateConfig();
          if (!config.apiKey.trim()) {
            sendResponse({ ok: false, reason: "apiKeyRequired" });
            return;
          }

          await ensureOffscreenDocument();
          
          // 發送給 Offscreen 啟動
          chrome.runtime.sendMessage({
            type: "liveTranslateOffscreenStart",
            data: {
              streamId,
              apiKey: config.apiKey,
              targetLang: config.targetLang,
            }
          });

          activeTabId = targetTabId;
          liveTranslateStatus = "connecting";
          sendResponse({ ok: true });
        } catch (err: any) {
          console.error("Failed to start live translate offscreen", err);
          sendResponse({ ok: false, reason: err.message || String(err) });
        }
      });
      return true; // async response
    }

    if (message.type === "stopVideoLiveTranslate") {
      liveTranslateStatus = "disconnected";
      activeTabId = null;
      chrome.runtime.sendMessage({ type: "liveTranslateOffscreenStop" });
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "getLiveTranslateState") {
      const queryTabId = message.data?.tabId || sender.tab?.id;
      if (!queryTabId) {
        sendResponse({ active: false, status: "disconnected" });
        return false;
      }
      const active = activeTabId === queryTabId && (liveTranslateStatus === "connected" || liveTranslateStatus === "connecting");
      sendResponse({
        active,
        status: activeTabId === queryTabId ? liveTranslateStatus : "disconnected"
      });
      return false;
    }

    // 當收到 Offscreen 發送過來的翻譯區塊，轉發給當前 active 的影片分頁 Content Script
    if (message.type === "sendLiveTranslationChunk") {
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, message);
      }
      return false;
    }

    // 當收到 Offscreen 回報的連線狀態，更新後轉發給當前 active 影片分頁與 Popup
    if (message.type === "sendLiveTranslateStatus") {
      const { status, error } = message.data;
      liveTranslateStatus = status;
      if (status === "disconnected" || status === "error") {
        activeTabId = null;
      }
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, message);
      }
      // 廣播給 Popup (Popup 可以被點開)
      chrome.runtime.sendMessage(message);
      return false;
    }

    if (message.type === "openOptionsPage") {
      chrome.runtime.openOptionsPage();
      sendResponse?.({ ok: true });
      return false;
    }
  });
});

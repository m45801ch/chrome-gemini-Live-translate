function mapToBCP47(code: string): string {
  if (!code) return "zh-Hant";
  const normalized = code.toLowerCase().trim().replace("_", "-");
  const explicitMap: Record<string, string> = {
    "zh-hant": "zh-Hant",
    "zh-hans": "zh-Hans",
    "zh-tw": "zh-Hant",
    "zh-hk": "zh-Hant",
    "zh-cn": "zh-Hans",
    "zh-sg": "zh-Hans",
    "zh": "zh-Hant",
    "en": "en",
    "ja": "ja",
    "ko": "ko",
  };
  return explicitMap[normalized] || code;
}

let liveAudioStream: MediaStream | null = null;
let liveAudioCtx: AudioContext | null = null;
let liveSourceNode: MediaStreamAudioSourceNode | null = null;
let liveWorkletNode: AudioWorkletNode | null = null;
let liveWs: WebSocket | null = null;

function stopLiveTranslateCore() {
  if (liveWs) {
    liveWs.onclose = null;
    liveWs.onerror = null;
    liveWs.onmessage = null;
    try {
      liveWs.close();
    } catch {}
    liveWs = null;
  }

  if (liveWorkletNode) {
    liveWorkletNode.port.postMessage({ type: "stop" });
    liveWorkletNode.disconnect();
    liveWorkletNode = null;
  }

  if (liveSourceNode) {
    liveSourceNode.disconnect();
    liveSourceNode = null;
  }

  if (liveAudioStream) {
    liveAudioStream.getTracks().forEach((track) => track.stop());
    liveAudioStream = null;
  }

  if (liveAudioCtx) {
    void liveAudioCtx.close();
    liveAudioCtx = null;
  }
}

// 監聽來自 Background 的訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "liveTranslateOffscreenStart") {
    const { streamId, apiKey, targetLang } = message.data;
    stopLiveTranslateCore();

    // 通知狀態：正在連線
    chrome.runtime.sendMessage({ type: "sendLiveTranslateStatus", data: { status: "connecting" } });

    navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      } as any,
      video: false,
    }).then(async (stream) => {
      liveAudioStream = stream;
      liveAudioCtx = new AudioContext({ sampleRate: 16000 });

      // 播放分頁音訊給使用者聽（否則分頁在被擷取時會靜音）
      const destinationNode = liveAudioCtx.createMediaStreamSource(liveAudioStream);
      destinationNode.connect(liveAudioCtx.destination);

      // 載入 Worklet 處理器
      await liveAudioCtx.audioWorklet.addModule(chrome.runtime.getURL("audio-processor.js"));
      liveSourceNode = liveAudioCtx.createMediaStreamSource(liveAudioStream);
      liveWorkletNode = new AudioWorkletNode(liveAudioCtx, "live-translate-processor");

      liveWorkletNode.port.onmessage = (event) => {
        if (event.data.type === "audio" && liveWs && liveWs.readyState === WebSocket.OPEN) {
          const uint8 = new Uint8Array(event.data.data);
          let binary = "";
          for (let i = 0; i < uint8.length; i++) {
            binary += String.fromCharCode(uint8[i]);
          }
          const base64 = btoa(binary);

          const msg = {
            realtimeInput: {
              mediaChunks: [
                {
                  mimeType: "audio/pcm;rate=16000",
                  data: base64,
                },
              ],
            },
          };
          try {
            liveWs.send(JSON.stringify(msg));
          } catch (e) {
            console.error("Failed to send audio chunk", e);
          }
        }
      };

      liveSourceNode.connect(liveWorkletNode);
      liveWorkletNode.connect(liveAudioCtx.destination);

      const modelName = "gemini-3.5-live-translate-preview";
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      liveWs = new WebSocket(wsUrl);

      const targetLangBCP47 = mapToBCP47(targetLang);

      liveWs.onopen = () => {
        console.warn("[Offscreen] Gemini Live WebSocket opened, sending setup...");
        const setup = {
          setup: {
            model: `models/${modelName}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              translationConfig: {
                targetLanguageCode: targetLangBCP47,
              },
            },
          },
        };
        liveWs?.send(JSON.stringify(setup));
      };

      liveWs.onmessage = async (event) => {
        try {
          let text = "";
          if (event.data instanceof Blob) {
            text = await event.data.text();
          } else if (event.data instanceof ArrayBuffer) {
            text = new TextDecoder().decode(event.data);
          } else if (typeof event.data === "string") {
            text = event.data;
          } else {
            return;
          }

          const data = JSON.parse(text);

          if (data.setupComplete !== undefined) {
            console.warn("[Offscreen] Gemini setupComplete received");
            chrome.runtime.sendMessage({ type: "sendLiveTranslateStatus", data: { status: "connected" } });
            return;
          }

          if (data.serverContent) {
            const sc = data.serverContent;
            let isFinal = false;
            let originalText = "";
            let translationText = "";

            const extract = (item: any): string => {
              if (!item) return "";
              if (typeof item === "string") return item;
              if (typeof item.text === "string") return item.text;
              if (Array.isArray(item.parts)) {
                return item.parts
                  .filter((p: any) => typeof p.text === "string")
                  .map((p: any) => p.text)
                  .join("");
              }
              if (Array.isArray(item)) {
                return item.map(extract).join("");
              }
              return "";
            };

            if (sc.inputTranscription) {
              originalText = extract(sc.inputTranscription);
              if (sc.inputTranscription.finished) {
                isFinal = true;
              }
            }

            if (sc.outputTranscription) {
              translationText = extract(sc.outputTranscription);
              if (sc.outputTranscription.finished) {
                isFinal = true;
              }
            }

            if (sc.modelTurn) {
              const textVal = extract(sc.modelTurn);
              if (textVal && !translationText) {
                translationText = textVal;
              }
            }

            if (sc.turnComplete) {
              isFinal = true;
            }

            if (originalText || translationText || isFinal) {
              chrome.runtime.sendMessage({
                type: "sendLiveTranslationChunk",
                data: { original: originalText, translation: translationText, isFinal },
              });
            }
          }

          if (data.error) {
            console.error("[Offscreen] Gemini error:", data.error);
            const msg = data.error.message || JSON.stringify(data.error);
            chrome.runtime.sendMessage({ type: "sendLiveTranslateStatus", data: { status: "error", error: msg } });
          }
        } catch (err) {
          console.error("[Offscreen] Error handling message", err);
        }
      };

      liveWs.onerror = (e) => {
        console.error("[Offscreen] Gemini WebSocket error", e);
        chrome.runtime.sendMessage({
          type: "sendLiveTranslateStatus",
          data: { status: "error", error: "WebSocket 連線錯誤，請確認網路或 API Key 是否正確。" },
        });
      };

      liveWs.onclose = (e) => {
        console.warn("[Offscreen] Gemini WebSocket closed", e.code, e.reason);
        if (e.code !== 1000 && e.code !== 1005) {
          let errMsg = `連線關閉 (${e.code})`;
          if (e.code === 1008 || e.reason?.includes("API key not valid")) {
            errMsg = "API Key 無效或已過期，請重新檢查輸入的金鑰。";
          } else if (e.code === 1011) {
            errMsg = "伺服器內部錯誤，請確認 Model 與 API 版本相容性。";
          } else if (e.code === 1007) {
            errMsg = "Setup 參數錯誤或格式不合。";
          } else if (e.reason) {
            errMsg += `: ${e.reason}`;
          }
          chrome.runtime.sendMessage({ type: "sendLiveTranslateStatus", data: { status: "error", error: errMsg } });
        } else {
          chrome.runtime.sendMessage({ type: "sendLiveTranslateStatus", data: { status: "disconnected" } });
        }
      };

      sendResponse({ ok: true });
    }).catch((err) => {
      console.error("[Offscreen] getUserMedia failed", err);
      stopLiveTranslateCore();
      chrome.runtime.sendMessage({ type: "sendLiveTranslateStatus", data: { status: "error", error: err.message || String(err) } });
      sendResponse({ ok: false });
    });

    return true; // async sendResponse
  }

  if (message.type === "liveTranslateOffscreenStop") {
    stopLiveTranslateCore();
    chrome.runtime.sendMessage({ type: "sendLiveTranslateStatus", data: { status: "disconnected" } });
    sendResponse({ ok: true });
    return false;
  }
});

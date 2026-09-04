function mapToBCP47(code: string): string {
  if (!code) return "zh-Hant";
  const raw = code.trim();
  if (!raw || raw.toLowerCase() === "auto") return "zh-Hant";
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
let setupTimeout: ReturnType<typeof setTimeout> | null = null;

let currentOutputMode: "text" | "voice" = "text";
let playbackCtx: AudioContext | null = null;
let playbackGain: GainNode | null = null;
let playbackQueue: AudioBufferSourceNode[] = [];
let playbackCursor = 0; // 下一個排播時間點（playbackCtx.currentTime 基準）
let monitorNode: MediaStreamAudioSourceNode | null = null; // 原音監聽節點（voice 模式斷開）

let hotSwapInterval: NodeJS.Timeout | null = null;
let pendingReconnect = false;

function startHotSwapTimer(seconds: number, apiKey: string, targetLang: string) {
  stopHotSwapTimer();
  if (seconds <= 0) return;

  console.warn(`[Offscreen] 已啟動熱切換計時器，間隔為 ${seconds} 秒`);
  hotSwapInterval = setInterval(() => {
    if (liveWs && (liveWs.readyState === WebSocket.OPEN || liveWs.readyState === WebSocket.CONNECTING)) {
      console.warn("[Offscreen] 達到熱切換間隔，正在重新建立連線以清空對話快取...");
      pendingReconnect = true;
      liveWs.close();
    }
  }, seconds * 1000);
}

function stopHotSwapTimer() {
  if (hotSwapInterval) {
    clearInterval(hotSwapInterval);
    hotSwapInterval = null;
  }
}

function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

function ensurePlaybackCtx(): boolean {
  try {
    if (!playbackCtx) {
      playbackCtx = new AudioContext({ sampleRate: 24000 });
      playbackGain = playbackCtx.createGain();
      playbackGain.gain.value = 1.0;
      playbackGain.connect(playbackCtx.destination);
      playbackCursor = playbackCtx.currentTime;
    }
    if (playbackCtx.state === "suspended") void playbackCtx.resume();
    return true;
  } catch (e) {
    console.error("[Offscreen] playback AudioContext 建立失敗，降級為文字模式", e);
    return false;
  }
}

function enqueueTranslatedAudio(base64: string) {
  if (currentOutputMode !== "voice") return; // text 模式直接丟棄，不重連
  if (!ensurePlaybackCtx() || !playbackCtx || !playbackGain) {
    chrome.runtime.sendMessage({
      type: "sendLiveTranslateStatus",
      data: { status: "error", error: "語音播放初始化失敗，已降級為文字模式。" },
    });
    currentOutputMode = "text";
    applyOutputMode();
    return;
  }
  try {
    const int16 = base64ToInt16(base64);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    const buffer = playbackCtx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32 as Float32Array<ArrayBuffer>, 0);
    const src = playbackCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(playbackGain);
    const startAt = Math.max(playbackCursor, playbackCtx.currentTime);
    src.start(startAt);
    playbackCursor = startAt + buffer.duration;
    src.onended = () => {
      const idx = playbackQueue.indexOf(src);
      if (idx >= 0) playbackQueue.splice(idx, 1);
    };
    playbackQueue.push(src);
  } catch (e) {
    console.error("[Offscreen] 單塊翻譯音訊解碼/排播失敗，已跳過", e);
  }
}

function applyOutputMode() {
  // voice：斷開原音監聽，只播翻譯；text：恢復原音監聽
  try {
    if (currentOutputMode === "voice") {
      monitorNode?.disconnect();
    } else {
      try {
        monitorNode?.disconnect();
      } catch {}
      if (monitorNode && liveAudioCtx) monitorNode.connect(liveAudioCtx.destination);
      // 切回文字時清空播放佇列，避免殘音
      playbackQueue.forEach((n) => {
        try { n.stop(); } catch {}
      });
      playbackQueue = [];
      if (playbackCtx) playbackCursor = playbackCtx.currentTime;
    }
  } catch (e) {
    console.error("[Offscreen] applyOutputMode 失敗", e);
  }
}

function setOutputMode(mode: "text" | "voice") {
  currentOutputMode = mode === "voice" ? "voice" : "text";
  applyOutputMode();
}

function stopLiveTranslateCore() {
  stopHotSwapTimer();
  pendingReconnect = false;

  if (setupTimeout) {
    clearTimeout(setupTimeout);
    setupTimeout = null;
  }

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

  playbackQueue.forEach((n) => {
    try { n.stop(); } catch {}
    try { n.disconnect(); } catch {}
  });
  playbackQueue = [];
  if (playbackGain) {
    try { playbackGain.disconnect(); } catch {}
    playbackGain = null;
  }
  if (playbackCtx) {
    void playbackCtx.close().catch(() => {});
    playbackCtx = null;
  }
  monitorNode = null;

  if (liveAudioCtx) {
    void liveAudioCtx.close();
    liveAudioCtx = null;
  }
}

// 監聽來自 Background 的訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "liveTranslateOffscreenStart") {
    const { streamId, apiKey, targetLang, hotSwap, modelName: incomingModelName, outputMode } = message.data;
    stopLiveTranslateCore();
    setOutputMode(outputMode === "voice" ? "voice" : "text");

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
      // Chrome 新版會將 Offscreen 的 AudioContext 初始為 suspended，必須 resume 否則 Worklet 無資料
      try {
        await liveAudioCtx.resume();
      } catch {}

      // 播放分頁音訊給使用者聽（否則分頁在被擷取時會靜音；voice 模式由 applyOutputMode 斷開）
      monitorNode = liveAudioCtx.createMediaStreamSource(liveAudioStream);
      monitorNode.connect(liveAudioCtx.destination);
      applyOutputMode();

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

      const connectLiveWs = () => {
        if (liveWs) {
          liveWs.onclose = null;
          liveWs.onerror = null;
          liveWs.onmessage = null;
          try {
            liveWs.close();
          } catch {}
          liveWs = null;
        }

        const finalModelName = incomingModelName || "gemini-3.5-live-translate-preview";
        const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
        liveWs = new WebSocket(wsUrl);

        const targetLangBCP47 = mapToBCP47(targetLang);

        liveWs.onopen = () => {
          console.warn("[Offscreen] Gemini Live WebSocket opened, sending setup...");
          const setup = {
            setup: {
              model: `models/${finalModelName}`,
              generationConfig: {
                responseModalities: ["AUDIO"],
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                translationConfig: {
                  targetLanguageCode: targetLangBCP47,
                },
              },
            },
          };
          liveWs?.send(JSON.stringify(setup));
          startHotSwapTimer(Number(hotSwap), apiKey, targetLang);
          // 若 15 秒內沒收到 setupComplete，代表交握卡住，主動回報錯誤而非永遠 connecting
          if (setupTimeout) clearTimeout(setupTimeout);
          setupTimeout = setTimeout(() => {
            if (liveWs && liveWs.readyState === WebSocket.OPEN) {
              console.error("[Offscreen] setupComplete timeout (15s)");
              chrome.runtime.sendMessage({
                type: "sendLiveTranslateStatus",
                data: { status: "error", error: "連線逾時：伺服器未回傳 setupComplete，請檢查 API Key 配額、模型名稱與網路。" },
              });
            }
          }, 15000);
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
              if (setupTimeout) {
                clearTimeout(setupTimeout);
                setupTimeout = null;
              }
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
                // 翻譯語音（24kHz PCM base64），text 模式由 enqueue 內部丟棄
                const parts = (sc.modelTurn as any).parts;
                if (Array.isArray(parts)) {
                  for (const p of parts) {
                    if (typeof p?.inlineData?.data === "string" && p.inlineData.data.length > 0) {
                      enqueueTranslatedAudio(p.inlineData.data);
                    }
                  }
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
          stopHotSwapTimer();
          if (setupTimeout) {
            clearTimeout(setupTimeout);
            setupTimeout = null;
          }
          if (pendingReconnect) {
            pendingReconnect = false;
            console.warn("[Offscreen] 熱切換定時重新連線中...");
            setTimeout(() => {
              connectLiveWs();
            }, 500);
          } else {
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
          }
        };
      };

      connectLiveWs();

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

  if (message.type === "liveTranslateOutputModeChanged") {
    setOutputMode(message.data?.outputMode === "voice" ? "voice" : "text");
    sendResponse({ ok: true, outputMode: currentOutputMode });
    return false;
  }
});

import { defineContentScript } from "#imports"
import React, { useRef, useState, useEffect, useCallback } from "react"
import ReactDOM from "react-dom/client"
import { createPortal } from "react-dom"
import { getLiveTranslateConfig, saveLiveTranslateConfig, AppConfig } from "@/utils/storage"
import { LiveSubtitleManager } from "@/utils/live-subtitle-manager"
import { SettingsPanel } from "@/components/SettingsPanel"
import { googleTranslate, microsoftTranslate } from "@/utils/free-translator"
import { optimizeSubtitles } from "@/utils/subtitles/processor/optimizer"
import { IconSubtitles, IconPalette, IconDownload, IconFileText, IconLanguage } from "@tabler/icons-react"

declare global {
  interface Window {
    __VIDEO_LIVE_TRANSLATE_INJECTED__?: boolean
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  runAt: "document_idle",
  async main() {
    if (window.__VIDEO_LIVE_TRANSLATE_INJECTED__) return
    window.__VIDEO_LIVE_TRANSLATE_INJECTED__ = true
    console.log("[VLT] Content script injected");
    setupVideoElementsWatcher();
  }
});

interface SubtitleChunk {
  original: string;
  translation: string;
  entries?: { original: string; translation: string }[];
}

function setupVideoElementsWatcher() {
  const checkInterval = setInterval(() => {
    const videos = document.querySelectorAll("video");
    videos.forEach((video) => {
      let playerContainer = video.parentElement as HTMLElement;
      const isYouTube = window.location.hostname.includes("youtube.com");

      if (isYouTube) {
        const ytPlayer = video.closest(".html5-video-player") as HTMLElement;
        if (ytPlayer) playerContainer = ytPlayer;
      }

      const hostExists = playerContainer.querySelector("#live-translate-subtitles-host");

      if (!video.dataset.liveTranslateHooked || !hostExists) {
        video.dataset.liveTranslateHooked = "true";
        initLiveTranslateForVideo(video, playerContainer);
      }
    });
  }, 2000);

  window.addEventListener("unload", () => clearInterval(checkInterval));
}

function initLiveTranslateForVideo(video: HTMLVideoElement, playerContainer: HTMLElement) {
  console.log("[VLT] Init for video", video);

  if (window.getComputedStyle(playerContainer).position === "static") {
    playerContainer.style.position = "relative";
  }

  // 清除舊的 host
  const oldHost = playerContainer.querySelector("#live-translate-subtitles-host");
  if (oldHost) oldHost.remove();

  // 建立 Shadow DOM host
  const subtitleHost = document.createElement("div");
  subtitleHost.id = "live-translate-subtitles-host";
  subtitleHost.style.cssText = `
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    pointer-events: none; z-index: 29; overflow: visible;
  `;
  const shadowRoot = subtitleHost.attachShadow({ mode: "open" });
  playerContainer.appendChild(subtitleHost);

  const reactContainer = document.createElement("div");
  reactContainer.style.cssText = "width:100%; height:100%; position:relative;";
  shadowRoot.appendChild(reactContainer);

  const root = ReactDOM.createRoot(reactContainer);

  const isYouTube = window.location.hostname.includes("youtube.com");
  if (isYouTube) {
    injectYouTubeControls(playerContainer);
  }

  root.render(<SubtitleRenderer playerContainer={playerContainer} />);
}

// ─── 蜂鳥圖示 ──────────────────────────────────────────────────────────────────
const HummingbirdIcon: React.FC<{ active: boolean; size?: number }> = ({ active, size = 22 }) => (
  <img
    src={chrome.runtime.getURL(active ? "icons/hummingbird-on.png" : "icons/hummingbird-off.png")}
    alt="Hummingbird Icon"
    style={{
      width: `${size}px`,
      height: `${size}px`,
      minWidth: `${size}px`,
      minHeight: `${size}px`,
      objectFit: "contain",
      flexShrink: 0,
      display: "block",
    }}
  />
);

const StatusIcon: React.FC<{ active: boolean; useBuiltIn: boolean; size?: number }> = ({ active, useBuiltIn, size = 22 }) => {
  if (useBuiltIn) {
    return (
      <img
        src={chrome.runtime.getURL("icons/hummingbird-cc.png")}
        alt="CC Icon"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          minWidth: `${size}px`,
          minHeight: `${size}px`,
          objectFit: "contain",
          flexShrink: 0,
          display: "block",
        }}
      />
    );
  }
  return <HummingbirdIcon active={active} size={size} />;
};

function formatTimeSRT(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = Math.floor(ms % 1000);

  const pad = (n: number, width: number = 2) => String(n).padStart(width, "0");

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(milliseconds, 3)}`;
}

function exportToSRT(events: any[], type: "original" | "translation" | "both"): string {
  return events
    .map((ev, index) => {
      const timeStr = `${formatTimeSRT(ev.start)} --> ${formatTimeSRT(ev.end)}`;
      let content = "";
      if (type === "original") {
        content = ev.text;
      } else if (type === "translation") {
        content = ev.translation || "";
      } else {
        content = `${ev.text}\n${ev.translation || ""}`;
      }
      return `${index + 1}\n${timeStr}\n${content}\n`;
    })
    .join("\n");
}

// ─── Font map ────────────────────────────────────────────────────────────────
const FONT_FAMILIES: Record<string, string> = {
  "system": "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  "roboto": "Roboto, sans-serif",
  "noto-sans": "'Noto Sans', 'Noto Sans SC', 'Noto Sans JP', sans-serif",
  "noto-serif": "'Noto Serif', 'Noto Serif SC', 'Noto Serif JP', serif",
};

import { YoutubeSubtitlesFetcher } from "@/utils/subtitles/fetchers/youtube";

interface YouTubeSubtitleEvent {
  start: number;
  end: number;
  text: string;
  translation: string;
}

const getYoutubeVideoId = (): string => {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get("v") || "";
  } catch (e) {
    return "";
  }
};

// ─── SubtitleRenderer ────────────────────────────────────────────────────────
// 重點：listener 只掛一次，用 ref 保存最新狀態，避免 stale closure / listener 重建丟 chunk
const setYouTubeSubtitlesState = (playerContainer: HTMLElement, enable: boolean) => {
  const ccBtn = playerContainer.querySelector(".ytp-subtitles-button") as HTMLElement;
  if (!ccBtn) return;
  const isPressed = ccBtn.getAttribute("aria-pressed") === "true";
  if (enable !== isPressed) {
    ccBtn.click();
  }
};

const SubtitleRenderer: React.FC<{ playerContainer: HTMLElement }> = ({ playerContainer }) => {
  const [subtitle, setSubtitle] = useState<SubtitleChunk | null>(null);
  const [builtInSubtitle, setBuiltInSubtitle] = useState<SubtitleChunk | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [active, setActive] = useState(false);
  const [verticalPercent, setVerticalPercent] = useState(10);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState("disconnected");
  const dragStartRef = useRef<{ startY: number; startPercent: number } | null>(null);

  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  // 用 ref 儲存最新的 setter，讓靜音計時器 callback 能安全呼叫
  const subtitleSetterForSilenceRef = useRef(setSubtitle);
  subtitleSetterForSilenceRef.current = setSubtitle;
  const needsClearRef = useRef(false);

  const resetSilenceTimerRef = useRef<() => void>(() => {});
  resetSilenceTimerRef.current = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = setTimeout(() => {
      // 靜音 7 秒：清除字幕顯示與歷史，等下次語音再出現
      managerRef.current?.clearSilent();
      subtitleSetterForSilenceRef.current(null);
      needsClearRef.current = true;
    }, 7000);
  };

  // ref 保存最新值，避免 listener 內 stale closure
  const activeRef = useRef(false);
  const configRef = useRef<AppConfig | null>(null);
  const subtitleSetterRef = useRef(setSubtitle);
  subtitleSetterRef.current = setSubtitle;

  // manager 永遠只建一個
  const managerRef = useRef<LiveSubtitleManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = new LiveSubtitleManager({ maxLines: 3, showOriginal: true });
    managerRef.current.onSubtitleUpdate = ({ original, translation, entries }) => {
      console.log("[VLT] subtitle update:", { original, translation, entries });
      subtitleSetterRef.current({ original, translation, entries });
    };
  }

  // 載入設定
  useEffect(() => {
    getLiveTranslateConfig().then((loaded) => {
      console.log("[VLT] Config loaded:", loaded);
      configRef.current = loaded;
      setConfig(loaded);
      managerRef.current?.setDisplayMode(loaded.subtitleStyle.displayMode);
      managerRef.current?.setMaxLines(loaded.subtitleStyle.maxLines);
      if (loaded.useBuiltInSubtitles) {
        setYouTubeSubtitlesState(playerContainer, true);
      }
    });
  }, []);

  // 監聽內建字幕的變更與翻譯（下載完整字幕軌 + 時間排程器 + 預翻譯）
  useEffect(() => {
    if (!config?.useBuiltInSubtitles) {
      setBuiltInSubtitle(null);
      return;
    }

    let active = true;
    let subtitleEvents: YouTubeSubtitleEvent[] = [];
    const video = playerContainer.querySelector("video");
    const translateQueue = new Set<string>();
    const fetcher = new YoutubeSubtitlesFetcher();

    const loadSubtitles = async () => {
      const videoId = getYoutubeVideoId();
      if (!videoId) return;

      setBuiltInSubtitle({
        original: "正在載入字幕軌...",
        translation: "正在載入字幕軌...",
        entries: [{ original: "正在載入字幕軌...", translation: "正在載入字幕軌..." }]
      });

      try {
        const fragments = await fetcher.fetch();
        if (!active) return;

        const sourceLanguage = fetcher.getSourceLanguage();
        const optimized = optimizeSubtitles(fragments, sourceLanguage);

        subtitleEvents = optimized.map(f => ({
          start: f.start,
          end: f.end,
          text: f.text,
          translation: f.translation || "",
        }));
        (window as any).__YOUTUBE_SUBTITLE_EVENTS__ = subtitleEvents;

        if (subtitleEvents.length === 0) {
          setBuiltInSubtitle(null);
        } else {
          // Trigger initial check
          handleTimeUpdate();
        }
      } catch (err) {
        console.error("[VLT] Failed to fetch subtitles via YoutubeSubtitlesFetcher:", err);
        setBuiltInSubtitle({
          original: "此影片無內建字幕",
          translation: "請使用即時翻譯功能",
          entries: [{ original: "此影片無內建字幕", translation: "請使用即時翻譯功能" }]
        });
      }
    };

    loadSubtitles();

    const handleTimeUpdate = async () => {
      if (!video || subtitleEvents.length === 0) return;
      const timeMs = video.currentTime * 1000;

      // 找出當前播放時間對應的字幕行 (支援多行重疊)
      const activeLines = subtitleEvents.filter(ev => ev.start <= timeMs && ev.end > timeMs);

      // 預尋找與翻譯未來 4 句
      const currentIndex = subtitleEvents.findIndex(ev => ev.start <= timeMs && ev.end > timeMs);
      if (currentIndex !== -1) {
        const provider = configRef.current?.builtInTranslator || "google";
        const target = configRef.current?.targetLang || "zh-Hant";

        for (let i = 0; i < 4; i++) {
          const index = currentIndex + i;
          if (index >= subtitleEvents.length) break;
          const ev = subtitleEvents[index];

          if (!ev.translation && !translateQueue.has(ev.text)) {
            translateQueue.add(ev.text);
            (async () => {
              try {
                let translated = "";
                if (provider === "microsoft") {
                  translated = await microsoftTranslate(ev.text, "auto", target);
                } else {
                  translated = await googleTranslate(ev.text, "auto", target);
                }
                ev.translation = translated;
              } catch (err) {
                console.error("[VLT] Pre-translation failed for:", ev.text, err);
              } finally {
                translateQueue.delete(ev.text);
                // 如果目前剛好播到這句，立刻更新 UI
                if (active && video.currentTime * 1000 >= ev.start && video.currentTime * 1000 < ev.end) {
                  updateUI();
                }
              }
            })();
          }
        }
      }

      updateUI();
    };

    const updateUI = () => {
      if (!video || !active) return;
      const timeMs = video.currentTime * 1000;
      
      const currentIndex = subtitleEvents.findIndex(ev => ev.start <= timeMs && ev.end > timeMs);
      if (currentIndex === -1) {
        setBuiltInSubtitle(null);
        return;
      }

      const maxLines = configRef.current?.subtitleStyle.maxLines ?? 3;
      const startIndex = Math.max(0, currentIndex - maxLines + 1);
      const activeLines = subtitleEvents.slice(startIndex, currentIndex + 1);

      setBuiltInSubtitle({
        original: activeLines.map(e => e.text).join("\n"),
        translation: activeLines.map(e => e.translation || "[翻譯中...]").join("\n"),
        entries: activeLines.map(e => ({
          original: e.text,
          translation: e.translation || "[翻譯中...]"
        }))
      });
    };

    if (video) {
      video.addEventListener("timeupdate", handleTimeUpdate);
      video.addEventListener("seeking", handleTimeUpdate);
    }

    const handleYtNavigate = () => {
      fetcher.cleanup();
      subtitleEvents = [];
      (window as any).__YOUTUBE_SUBTITLE_EVENTS__ = null;
      loadSubtitles();
    };
    window.addEventListener("yt-navigate-finish", handleYtNavigate);

    return () => {
      active = false;
      fetcher.cleanup();
      (window as any).__YOUTUBE_SUBTITLE_EVENTS__ = null;
      if (video) {
        video.removeEventListener("timeupdate", handleTimeUpdate);
        video.removeEventListener("seeking", handleTimeUpdate);
      }
      window.removeEventListener("yt-navigate-finish", handleYtNavigate);
    };
  }, [config?.useBuiltInSubtitles, config?.builtInTranslator, config?.targetLang, playerContainer]);

  // 動態顯示與隱藏原生 YouTube 字幕
  useEffect(() => {
    const styleId = "hide-native-yt-captions";
    let styleEl = document.getElementById(styleId);

    if (config?.useBuiltInSubtitles) {
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = styleId;
        styleEl.textContent = ".ytp-caption-window-container { opacity: 0 !important; }";
        document.head.appendChild(styleEl);
      }
    } else {
      if (styleEl) {
        styleEl.remove();
      }
    }

    return () => {
      const el = document.getElementById(styleId);
      if (el) el.remove();
    };
  }, [config?.useBuiltInSubtitles]);

  // 監聽訊息 ─ 只掛一次，永不 remove 再 add
  useEffect(() => {
    // 查詢初始狀態
    chrome.runtime.sendMessage({ type: "getLiveTranslateState" }, (res) => {
      if (res) {
        console.log("[VLT] Initial state:", res);
        activeRef.current = res.active;
        setActive(res.active);
        setStatus(res.status);
        if (res.active) {
          resetSilenceTimerRef.current();
        }
      }
    });

    const handleMessage = (message: any) => {
      if (message.type === "sendLiveTranslationChunk") {
        const { original, translation, isFinal } = message.data;
        console.log("[VLT] chunk received, active:", activeRef.current, { original, translation });
        
        // 僅在靜音後第一個 chunk 才額外清空歷史（避免帶入舊對話）
        if (needsClearRef.current) {
          managerRef.current?.clearSilent();
          needsClearRef.current = false;
        }
        resetSilenceTimerRef.current();
        managerRef.current?.addChunk({ original, translation, isFinal });

      } else if (message.type === "sendLiveTranslateStatus") {
        const s = message.data.status;
        console.log("[VLT] status:", s);
        setStatus(s);
        const isActive = s === "connected" || s === "connecting";
        activeRef.current = isActive;
        setActive(isActive);
        if (!isActive) {
          subtitleSetterRef.current(null);
          managerRef.current?.clear();
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else {
          resetSilenceTimerRef.current();
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    // storage 更新
    const handleStorageChange = (changes: any) => {
      if (changes.subtitleStyle || changes.useBuiltInSubtitles || changes.builtInTranslator) {
        getLiveTranslateConfig().then((loaded) => {
          configRef.current = loaded;
          setConfig(loaded);
          managerRef.current?.setDisplayMode(loaded.subtitleStyle.displayMode);
          managerRef.current?.setMaxLines(loaded.subtitleStyle.maxLines);
          if (changes.useBuiltInSubtitles) {
            setYouTubeSubtitlesState(playerContainer, loaded.useBuiltInSubtitles === true);
          }
        });
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      chrome.storage.onChanged.removeListener(handleStorageChange);
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    };
  }, [playerContainer]); // ← 只掛一次！

  // 拖曳
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartRef.current = {
      startY: e.clientY,
      startPercent: verticalPercent,
    };
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    // 拖曳時在整個頁面鎖定 cursor 與文字選取，避免滑出字幕框後 cursor 恢復預設
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const onMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const rect = playerContainer.getBoundingClientRect();
      const deltaY = e.clientY - dragStartRef.current.startY;
      // 往上拖曳（deltaY < 0）時，高度百分比應增加
      const deltaPercent = -(deltaY / rect.height) * 100;
      const nextPercent = dragStartRef.current.startPercent + deltaPercent;
      const percent = Math.max(5, Math.min(85, nextPercent));
      setVerticalPercent(percent);
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [isDragging]);

  // 不渲染的條件
  const displaySubtitle = config?.useBuiltInSubtitles ? builtInSubtitle : subtitle;
  const isShowing = config?.useBuiltInSubtitles
    ? (config.useBuiltInSubtitles && !!builtInSubtitle && (!!builtInSubtitle.original || !!builtInSubtitle.translation))
    : (active && !!subtitle && (!!subtitle.original || !!subtitle.translation));

  if (!config || !isShowing || !displaySubtitle) {
    return null;
  }

  const { subtitleStyle } = config;
  const isLeftAlign = subtitleStyle.textAlign === "left";

  const mainFontSize = (subtitleStyle.main.fontScale / 100) * 22;
  const transFontSize = (subtitleStyle.translation.fontScale / 100) * 22;

  const containerStyle: React.CSSProperties = {
    position: "absolute",
    left: "0",
    right: "0",
    margin: "0 auto",
    bottom: `${verticalPercent}%`,
    width: "fit-content",
    maxWidth: "80%",
    backgroundColor: `rgba(0, 0, 0, ${subtitleStyle.backgroundOpacity / 100})`,
    borderRadius: "10px",
    padding: "10px 18px",
    pointerEvents: "auto",
    userSelect: "text",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    border: subtitleStyle.backgroundOpacity > 0 ? "1px solid rgba(255, 255, 255, 0.08)" : "none",
    boxShadow: subtitleStyle.backgroundOpacity > 0 ? "0 10px 15px -3px rgba(0,0,0,0.4)" : "none",
    cursor: isDragging ? "grabbing" : "grab",
    transition: isDragging ? "none" : "bottom 0.1s ease-out",
    alignItems: isLeftAlign ? "flex-start" : "center",
    textAlign: isLeftAlign ? "left" : "center",
  };

  const mainBlockStyle: React.CSSProperties = {
    maxHeight: `${subtitleStyle.maxLines * 1.4 * mainFontSize}px`,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    alignItems: isLeftAlign ? "flex-start" : "center",
    width: "100%",
  };

  const transBlockStyle: React.CSSProperties = {
    maxHeight: `${subtitleStyle.maxLines * 1.4 * transFontSize}px`,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    alignItems: isLeftAlign ? "flex-start" : "center",
    width: "100%",
  };

  const mainStyle: React.CSSProperties = {
    fontFamily: FONT_FAMILIES[subtitleStyle.main.fontFamily] ?? FONT_FAMILIES.system,
    fontSize: `${mainFontSize}px`,
    color: subtitleStyle.main.color,
    fontWeight: subtitleStyle.main.fontWeight,
    lineHeight: "1.4",
    textShadow: "1px 1px 3px rgba(0,0,0,0.9)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    flexShrink: 0,
  };

  const transStyle: React.CSSProperties = {
    fontFamily: FONT_FAMILIES[subtitleStyle.translation.fontFamily] ?? FONT_FAMILIES.system,
    fontSize: `${transFontSize}px`,
    color: subtitleStyle.translation.color,
    fontWeight: subtitleStyle.translation.fontWeight,
    lineHeight: "1.4",
    textShadow: "1px 1px 3px rgba(0,0,0,0.9)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    flexShrink: 0,
  };

  const rawEntries = displaySubtitle.entries || [
    { original: displaySubtitle.original, translation: displaySubtitle.translation },
  ];
  const entries = rawEntries.slice(-subtitleStyle.maxLines);

  return (
    <>
      {isDragging && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "100%",
            cursor: "grabbing",
            zIndex: 2147483647,
            pointerEvents: "auto",
            backgroundColor: "transparent",
          }}
        />
      )}
      <div style={containerStyle} onMouseDown={handleMouseDown} title="拖曳可調整字幕高度">
        {config.subtitleStyle.translationPosition === "up" ? (
          <>
            {config.subtitleStyle.displayMode !== "original" && displaySubtitle.translation && (
              <div style={transBlockStyle}>
                {entries.map((entry, idx) => entry.translation && (
                  <div key={idx} style={{
                    ...transStyle,
                    color: idx < entries.length - 1 ? "#94a3b8" : subtitleStyle.translation.color,
                    fontSize: idx < entries.length - 1 ? `${transFontSize * 0.9}px` : `${transFontSize}px`,
                    fontWeight: idx < entries.length - 1 ? Math.max(300, (subtitleStyle.translation.fontWeight || 400) - 100) : subtitleStyle.translation.fontWeight
                  }}>
                    {entry.translation}
                  </div>
                ))}
              </div>
            )}
            {config.subtitleStyle.displayMode !== "translation" && displaySubtitle.original && (
              <div style={mainBlockStyle}>
                {entries.map((entry, idx) => entry.original && (
                  <div key={idx} style={{
                    ...mainStyle,
                    color: idx < entries.length - 1 ? "#cbd5e1" : subtitleStyle.main.color,
                    fontSize: idx < entries.length - 1 ? `${mainFontSize * 0.9}px` : `${mainFontSize}px`,
                    fontWeight: idx < entries.length - 1 ? Math.max(300, (subtitleStyle.main.fontWeight || 400) - 100) : subtitleStyle.main.fontWeight
                  }}>
                    {entry.original}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {config.subtitleStyle.displayMode !== "translation" && displaySubtitle.original && (
              <div style={mainBlockStyle}>
                {entries.map((entry, idx) => entry.original && (
                  <div key={idx} style={{
                    ...mainStyle,
                    color: idx < entries.length - 1 ? "#cbd5e1" : subtitleStyle.main.color,
                    fontSize: idx < entries.length - 1 ? `${mainFontSize * 0.9}px` : `${mainFontSize}px`,
                    fontWeight: idx < entries.length - 1 ? Math.max(300, (subtitleStyle.main.fontWeight || 400) - 100) : subtitleStyle.main.fontWeight
                  }}>
                    {entry.original}
                  </div>
                ))}
              </div>
            )}
            {config.subtitleStyle.displayMode !== "original" && displaySubtitle.translation && (
              <div style={transBlockStyle}>
                {entries.map((entry, idx) => entry.translation && (
                  <div key={idx} style={{
                    ...transStyle,
                    color: idx < entries.length - 1 ? "#94a3b8" : subtitleStyle.translation.color,
                    fontSize: idx < entries.length - 1 ? `${transFontSize * 0.9}px` : `${transFontSize}px`,
                    fontWeight: idx < entries.length - 1 ? Math.max(300, (subtitleStyle.translation.fontWeight || 400) - 100) : subtitleStyle.translation.fontWeight
                  }}>
                    {entry.translation}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

// ─── YouTube 控制按鈕注入 ─────────────────────────────────────────────────────
function injectYouTubeControls(playerContainer: HTMLElement) {
  const checkControls = setInterval(() => {
    const rightControls = playerContainer.querySelector(".ytp-right-controls");
    if (!rightControls) return;
    clearInterval(checkControls);

    const btnId = "live-translate-yt-btn";
    if (rightControls.querySelector(`#${btnId}`)) return;

    const controlBtn = document.createElement("button");
    controlBtn.id = btnId;
    controlBtn.className = "ytp-button";
    controlBtn.title = "即時翻譯設定";
    controlBtn.style.cssText = `
      display: inline-flex; align-items: center; justify-content: center;
      vertical-align: middle; cursor: pointer; padding: 0 4px; position: relative;
      overflow: visible !important;
    `;

    const btnRoot = document.createElement("div");
    btnRoot.style.cssText = "display:flex;align-items:center;justify-content:center;width:100%;height:100%;overflow:visible;";
    controlBtn.appendChild(btnRoot);
    rightControls.insertBefore(controlBtn, rightControls.firstChild);

    const root = ReactDOM.createRoot(btnRoot);
    root.render(<PlayerControlButton playerContainer={playerContainer} />);
  }, 1000);
}

// ─── PlayerControlButton ──────────────────────────────────────────────────────
const PlayerControlButton: React.FC<{ playerContainer: HTMLElement }> = ({ playerContainer }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [view, setView] = useState<"main" | "style" | "download">("main");
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("disconnected");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [downloadingType, setDownloadingType] = useState<"original" | "translation" | "both" | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "getLiveTranslateState" }, (res) => {
      if (res) { setActive(res.active); setStatus(res.status); }
    });

    const handleMessage = (message: any) => {
      if (message.type === "sendLiveTranslateStatus") {
        const s = message.data.status;
        setStatus(s);
        setActive(s === "connected" || s === "connecting");
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  useEffect(() => {
    getLiveTranslateConfig().then(setConfig);

    const handleStorageChange = (changes: any) => {
      if (changes.useBuiltInSubtitles || changes.builtInTranslator || changes.subtitleStyle) {
        getLiveTranslateConfig().then(setConfig);
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        if (btnRef.current && btnRef.current.contains(e.target as Node)) {
          return;
        }
        closeMenu();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [showMenu]);

  const checkBuiltInSubtitlesAvailable = () => {
    const ccBtn = playerContainer.querySelector(".ytp-subtitles-button") as HTMLElement;
    return !!ccBtn && window.getComputedStyle(ccBtn).display !== "none";
  };

  const handleUseBuiltInChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const enable = e.target.checked;
    if (enable) {
      if (!checkBuiltInSubtitlesAvailable()) {
        alert("該影片無內建字幕，請使用即時翻譯功能");
        return;
      }
      await saveLiveTranslateConfig({ useBuiltInSubtitles: true });
      setYouTubeSubtitlesState(playerContainer, true);
      // 兩者只能擇一：停用即時翻譯
      if (active) {
        chrome.runtime.sendMessage({ type: "stopVideoLiveTranslate" }, () => {
          setActive(false);
          setStatus("disconnected");
        });
      }
    } else {
      await saveLiveTranslateConfig({ useBuiltInSubtitles: false });
      setYouTubeSubtitlesState(playerContainer, false);
    }
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (active) {
      chrome.runtime.sendMessage({ type: "stopVideoLiveTranslate" }, () => {
        setActive(false); setStatus("disconnected");
      });
    } else {
      // 兩者只能擇一：停用內建字幕
      saveLiveTranslateConfig({ useBuiltInSubtitles: false });
      setYouTubeSubtitlesState(playerContainer, false);

      setStatus("connecting");
      chrome.runtime.sendMessage({ type: "startVideoLiveTranslate" }, (res) => {
        if (res && !res.ok) {
          setActive(false); setStatus("error");
          alert(
            res.reason === "apiKeyRequired"
              ? "請先點擊瀏覽器右上角的「蜂鳥影片即時翻譯」擴充套件圖示，在彈出的視窗中輸入 API 金鑰並啟動即時翻譯後，再使用播放器內的按鈕控制。"
              : `無法啟動即時翻譯: ${res.reason}\n\n提示：若為首次使用，請先點擊瀏覽器右上角的擴充套件圖示進行設定與啟動。`
          );
        }
      });
    }
  };

  const hasSubtitles = typeof window !== "undefined" && !!(window as any).__YOUTUBE_SUBTITLE_EVENTS__;

  const handleDownload = async (type: "original" | "translation" | "both") => {
    const events = (window as any).__YOUTUBE_SUBTITLE_EVENTS__;
    if (!events || events.length === 0) {
      alert("目前沒有載入的字幕軌可供下載。");
      return;
    }

    if (downloadingType) return;
    setDownloadingType(type);
    setDownloadProgress(0);

    try {
      if (type === "translation" || type === "both") {
        const untranslatedLines = events.filter((ev: any) => !ev.translation);
        if (untranslatedLines.length > 0) {
          const provider = config?.builtInTranslator || "google";
          const target = config?.targetLang || "zh-Hant";
          const batchSize = 10;
          let completed = 0;

          for (let i = 0; i < untranslatedLines.length; i += batchSize) {
            const batch = untranslatedLines.slice(i, i + batchSize);
            await Promise.all(
              batch.map(async (ev: any) => {
                try {
                  let translated = "";
                  if (provider === "microsoft") {
                    translated = await microsoftTranslate(ev.text, "auto", target);
                  } else {
                    translated = await googleTranslate(ev.text, "auto", target);
                  }
                  ev.translation = translated;
                } catch (err) {
                  console.error("[VLT] Batch translation failed for:", ev.text, err);
                  ev.translation = "[翻譯失敗]";
                }
              })
            );
            completed += batch.length;
            setDownloadProgress(Math.round((completed / untranslatedLines.length) * 100));
          }
        }
      }

      const srtContent = exportToSRT(events, type);
      const blob = new Blob([srtContent], { type: "text/srt;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      
      let title = "youtube_subtitle";
      const titleEl = document.querySelector("h1.ytd-watch-metadata, #container h1.title");
      if (titleEl && titleEl.textContent) {
        title = titleEl.textContent.trim().replace(/[\\/:*?"<>|]/g, "_");
      }

      let suffix = "";
      if (type === "original") suffix = "原文";
      else if (type === "translation") suffix = "譯文";
      else suffix = "雙語";

      link.setAttribute("download", `${title}_${suffix}.srt`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[VLT] Download error:", err);
      alert("下載過程中發生錯誤。");
    } finally {
      setDownloadingType(null);
      setDownloadProgress(0);
    }
  };

  const openMenu = () => { setShowMenu(true); setView("main"); };
  const closeMenu = () => { setShowMenu(false); setView("main"); };

  const menuStyle: React.CSSProperties = {
    position: "absolute",
    right: "12px",
    bottom: "60px",
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "14px",
    width: view === "style" ? "290px" : view === "download" ? "270px" : "260px",
    maxHeight: (view === "style" || view === "download") ? "500px" : "auto",
    overflowY: "auto",
    padding: "14px",
    color: "#1e293b",
    zIndex: 99999,
    boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
    pointerEvents: "auto",
    display: showMenu ? "flex" : "none",
    flexDirection: "column",
    gap: "10px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    transition: "width 0.15s ease",
  };

  const statusText = status === "connected" ? "已連線" : status === "connecting" ? "連線中..." : status === "error" ? "連線出錯" : "未連線";
  const statusColor = status === "connected" ? "#10b981" : status === "connecting" ? "#fbbf24" : status === "error" ? "#f87171" : "#94a3b8";

  return (
    <div
      ref={btnRef}
      onClick={() => showMenu ? closeMenu() : openMenu()}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "46px",
        height: "100%",
        position: "relative",
        cursor: "pointer",
        overflow: "visible",
      }}
    >
      <StatusIcon active={active} useBuiltIn={!!config?.useBuiltInSubtitles} size={28} />
      <span
        style={{
          position: "absolute",
          bottom: "3px",
          right: "2px",
          fontSize: "8px",
          fontWeight: "bold",
          lineHeight: "1.2",
          color: (active || config?.useBuiltInSubtitles) ? "#ffffff" : "#ef4444",
          backgroundColor: (active || config?.useBuiltInSubtitles) ? "#10b981" : "#ffffff",
          padding: "1.5px 5px",
          borderRadius: "8px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          pointerEvents: "none",
          whiteSpace: "nowrap",
          minWidth: "20px",
          textAlign: "center",
        }}
      >
        {(active || config?.useBuiltInSubtitles) ? "ON" : "OFF"}
      </span>

      {showMenu && createPortal(
        <div ref={menuRef} style={menuStyle} onClick={(e) => e.stopPropagation()}>

          {/* ── 主視圖 ── */}
          {view === "main" && (
            <>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <StatusIcon active={active} useBuiltIn={!!config?.useBuiltInSubtitles} />
                  <span style={{ fontWeight: "700", fontSize: "14px", color: "#0f172a" }}>即時翻譯</span>
                </div>
                <button onClick={closeMenu} style={closeBtnStyle}>✕</button>
              </div>

              {/* 啟動 / 停止按鈕 */}
              <button
                onClick={handleToggle}
                style={{
                  width: "100%", border: "none", borderRadius: "10px", padding: "11px",
                  fontSize: "13px", fontWeight: "600", cursor: "pointer",
                  backgroundColor: active ? "#ef4444" : "#0284c7",
                  color: "#fff",
                  transition: "background-color 0.2s, transform 0.1s",
                  boxShadow: active ? "0 4px 10px rgba(239,68,68,0.2)" : "0 4px 10px rgba(2,132,199,0.2)",
                }}
                onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.97)")}
                onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
              >
                {active ? "⏹ 停止即時翻譯" : "▶ 開啟即時翻譯"}
              </button>

              {/* 狀態列 */}
              <div style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "center" }}>
                <div style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: statusColor, boxShadow: status === "connected" ? `0 0 6px ${statusColor}` : "none" }} />
                <span style={{ fontSize: "11px", color: "#64748b" }}>{statusText}</span>
              </div>

              {/* 使用影片內建字幕 */}
              <div
                style={{
                  width: "100%",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  backgroundColor: "#f8fafc",
                  color: "#475569",
                  fontSize: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <IconSubtitles size={16} stroke={1.5} color="#475569" />
                  <span style={{ fontWeight: "500" }}>使用影片內建字幕</span>
                </div>
                <input
                  type="checkbox"
                  checked={config?.useBuiltInSubtitles === true}
                  onChange={handleUseBuiltInChange}
                  style={{
                    cursor: "pointer",
                    width: "16px",
                    height: "16px",
                    accentColor: "#0284c7",
                    margin: 0,
                  }}
                />
              </div>

              {/* 字幕樣式入口 */}
              <button
                onClick={() => setView("style")}
                style={{
                  width: "100%", border: "1px solid #e2e8f0", borderRadius: "10px",
                  padding: "10px 12px", backgroundColor: "#f8fafc",
                  color: "#475569", fontSize: "12px", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  transition: "background-color 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f1f5f9")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <IconPalette size={16} stroke={1.5} color="#475569" />
                  <span>字幕樣式</span>
                </div>
                <span style={{ color: "#94a3b8" }}>›</span>
              </button>

              {/* 字幕下載入口 */}
              <button
                onClick={() => setView("download")}
                style={{
                  width: "100%", border: "1px solid #e2e8f0", borderRadius: "10px",
                  padding: "10px 12px", backgroundColor: "#f8fafc",
                  color: "#475569", fontSize: "12px", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  transition: "background-color 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f1f5f9")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <IconDownload size={16} stroke={1.5} color="#475569" />
                  <span>字幕下載</span>
                </div>
                <span style={{ color: "#94a3b8" }}>›</span>
              </button>
            </>
          )}

          {/* ── 字幕樣式子頁面 ── */}
          {view === "style" && (
            <>
              {/* Header with back */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  onClick={() => setView("main")}
                  style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: "2px 4px", borderRadius: "4px" }}
                  title="返回"
                >
                  ‹
                </button>
                <span style={{ fontWeight: "600", fontSize: "14px", color: "#0f172a", flex: 1 }}>字幕樣式</span>
                <button onClick={closeMenu} style={closeBtnStyle}>✕</button>
              </div>
              <div style={{ borderTop: "1px solid #e2e8f0", margin: "-4px 0 0" }} />
              <SettingsPanel />
            </>
          )}

          {/* ── 字幕下載子頁面 ── */}
          {view === "download" && (
            <>
              {/* Header with back */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  onClick={() => setView("main")}
                  style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: "2px 4px", borderRadius: "4px" }}
                  title="返回"
                >
                  ‹
                </button>
                <span style={{ fontWeight: "600", fontSize: "14px", color: "#0f172a", flex: 1 }}>字幕下載</span>
                <button onClick={closeMenu} style={closeBtnStyle}>✕</button>
              </div>
              <div style={{ borderTop: "1px solid #e2e8f0", margin: "-4px 0 0" }} />
              
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "8px 0" }}>
                {!hasSubtitles ? (
                  <div style={{ fontSize: "12px", color: "#64748b", textAlign: "center", padding: "10px" }}>
                    此影片無內建字幕軌或未成功載入。
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => handleDownload("original")}
                      disabled={!!downloadingType}
                      style={{
                        width: "100%", border: "1px solid #cbd5e1", borderRadius: "8px",
                        padding: "10px 12px", backgroundColor: downloadingType === "original" ? "#f1f5f9" : "#ffffff",
                        color: "#334155", fontSize: "12px", fontWeight: "600", cursor: downloadingType ? "not-allowed" : "pointer",
                        transition: "background-color 0.15s, border-color 0.15s",
                        textAlign: "left",
                        boxSizing: "border-box",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                      onMouseEnter={(e) => { if (!downloadingType) e.currentTarget.style.backgroundColor = "#f8fafc"; }}
                      onMouseLeave={(e) => { if (!downloadingType) e.currentTarget.style.backgroundColor = "#ffffff"; }}
                    >
                      <IconFileText size={16} stroke={1.5} color="#475569" />
                      <span>{downloadingType === "original" ? "下載中..." : "下載原文字幕 (.srt)"}</span>
                    </button>
 
                    <button
                      onClick={() => handleDownload("translation")}
                      disabled={!!downloadingType}
                      style={{
                        width: "100%", border: "1px solid #cbd5e1", borderRadius: "8px",
                        padding: "10px 12px", backgroundColor: downloadingType === "translation" ? "#f1f5f9" : "#ffffff",
                        color: "#334155", fontSize: "12px", fontWeight: "600", cursor: downloadingType ? "not-allowed" : "pointer",
                        transition: "background-color 0.15s, border-color 0.15s",
                        textAlign: "left",
                        boxSizing: "border-box",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                      onMouseEnter={(e) => { if (!downloadingType) e.currentTarget.style.backgroundColor = "#f8fafc"; }}
                      onMouseLeave={(e) => { if (!downloadingType) e.currentTarget.style.backgroundColor = "#ffffff"; }}
                    >
                      <IconLanguage size={16} stroke={1.5} color="#475569" />
                      <span>{downloadingType === "translation" ? `翻譯並下載中 (${downloadProgress}%)` : "下載譯文字幕 (.srt)"}</span>
                    </button>
 
                    <button
                      onClick={() => handleDownload("both")}
                      disabled={!!downloadingType}
                      style={{
                        width: "100%", border: "1px solid #cbd5e1", borderRadius: "8px",
                        padding: "10px 12px", backgroundColor: downloadingType === "both" ? "#f1f5f9" : "#ffffff",
                        color: "#334155", fontSize: "12px", fontWeight: "600", cursor: downloadingType ? "not-allowed" : "pointer",
                        transition: "background-color 0.15s, border-color 0.15s",
                        textAlign: "left",
                        boxSizing: "border-box",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                      onMouseEnter={(e) => { if (!downloadingType) e.currentTarget.style.backgroundColor = "#f8fafc"; }}
                      onMouseLeave={(e) => { if (!downloadingType) e.currentTarget.style.backgroundColor = "#ffffff"; }}
                    >
                      <IconSubtitles size={16} stroke={1.5} color="#475569" />
                      <span>{downloadingType === "both" ? `翻譯並下載中 (${downloadProgress}%)` : "下載雙語對照字幕 (.srt)"}</span>
                    </button>
                  </>
                )}
              </div>
            </>
          )}

        </div>,
        playerContainer
      )}
    </div>
  );
};

const closeBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "#475569", cursor: "pointer",
  fontSize: "14px", padding: "2px 5px", borderRadius: "4px", lineHeight: 1,
};


import { defineContentScript } from "#imports"
import React, { useRef, useState, useEffect, useCallback } from "react"
import ReactDOM from "react-dom/client"
import { createPortal } from "react-dom"
import { getLiveTranslateConfig, AppConfig } from "@/utils/storage"
import { LiveSubtitleManager } from "@/utils/live-subtitle-manager"
import { SettingsPanel } from "@/components/SettingsPanel"

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
    pointer-events: none; z-index: 2147483647; overflow: visible;
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
    src={chrome.runtime.getURL("icons/icon-48.png")}
    alt="Hummingbird Icon"
    style={{
      width: `${size}px`,
      height: `${size}px`,
      minWidth: `${size}px`,
      minHeight: `${size}px`,
      objectFit: "contain",
      flexShrink: 0,
      display: "block",
      // ON → 原色加輕微綠暈；OFF → 紅色
      filter: active
        ? "drop-shadow(0 0 3px #4ade80)"          // 原圖 + 綠色外光
        : "drop-shadow(0 0 2px #ef4444) sepia(1) saturate(5) hue-rotate(340deg) brightness(0.9)", // 轉成紅色
      transition: "filter 0.25s",
    }}
  />
);

// ─── Font map ────────────────────────────────────────────────────────────────
const FONT_FAMILIES: Record<string, string> = {
  "system": "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  "roboto": "Roboto, sans-serif",
  "noto-sans": "'Noto Sans', 'Noto Sans SC', 'Noto Sans JP', sans-serif",
  "noto-serif": "'Noto Serif', 'Noto Serif SC', 'Noto Serif JP', serif",
};

// ─── SubtitleRenderer ────────────────────────────────────────────────────────
// 重點：listener 只掛一次，用 ref 保存最新狀態，避免 stale closure / listener 重建丟 chunk
const SubtitleRenderer: React.FC<{ playerContainer: HTMLElement }> = ({ playerContainer }) => {
  const [subtitle, setSubtitle] = useState<SubtitleChunk | null>(null);
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
    });
  }, []);

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
      if (changes.subtitleStyle) {
        getLiveTranslateConfig().then((loaded) => {
          configRef.current = loaded;
          setConfig(loaded);
          managerRef.current?.setDisplayMode(loaded.subtitleStyle.displayMode);
          managerRef.current?.setMaxLines(loaded.subtitleStyle.maxLines);
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
  }, []); // ← 只掛一次！

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
  if (!config || !active || (!subtitle?.original && !subtitle?.translation)) {
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
    backgroundColor: `rgba(15, 23, 42, ${subtitleStyle.backgroundOpacity / 100})`,
    borderRadius: "10px",
    padding: "10px 18px",
    pointerEvents: "auto",
    userSelect: "text",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    boxShadow: "0 10px 15px -3px rgba(0,0,0,0.4)",
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

  const entries = subtitle.entries || [
    { original: subtitle.original, translation: subtitle.translation },
  ];

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
        {config.subtitleStyle.displayMode !== "translation" && subtitle.original && (
          <div style={mainBlockStyle}>
            {entries.map((entry, idx) => entry.original && (
              <div key={idx} style={mainStyle}>{entry.original}</div>
            ))}
          </div>
        )}
        {config.subtitleStyle.displayMode !== "original" && subtitle.translation && (
          <div style={transBlockStyle}>
            {entries.map((entry, idx) => entry.translation && (
              <div key={idx} style={transStyle}>{entry.translation}</div>
            ))}
          </div>
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
  const [view, setView] = useState<"main" | "style">("main");
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("disconnected");

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

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (active) {
      chrome.runtime.sendMessage({ type: "stopVideoLiveTranslate" }, () => {
        setActive(false); setStatus("disconnected");
      });
    } else {
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

  const openMenu = () => { setShowMenu(true); setView("main"); };
  const closeMenu = () => { setShowMenu(false); setView("main"); };

  const menuStyle: React.CSSProperties = {
    position: "absolute",
    right: "12px",
    bottom: "60px",
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "14px",
    width: view === "style" ? "340px" : "260px",
    maxHeight: view === "style" ? "500px" : "auto",
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
      <HummingbirdIcon active={active} size={28} />
      <span
        style={{
          position: "absolute",
          bottom: "3px",
          right: "2px",
          fontSize: "8px",
          fontWeight: "bold",
          lineHeight: "1.2",
          color: active ? "#ffffff" : "#ef4444",
          backgroundColor: active ? "#10b981" : "#ffffff",
          padding: "1.5px 5px",
          borderRadius: "8px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          pointerEvents: "none",
          whiteSpace: "nowrap",
          minWidth: "20px",
          textAlign: "center",
        }}
      >
        {active ? "ON" : "OFF"}
      </span>

      {showMenu && createPortal(
        <div ref={menuRef} style={menuStyle} onClick={(e) => e.stopPropagation()}>

          {/* ── 主視圖 ── */}
          {view === "main" && (
            <>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <HummingbirdIcon active={active} />
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
                <span>字幕樣式</span>
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


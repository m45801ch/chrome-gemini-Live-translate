import React, { useEffect, useState, useRef } from "react";
import ReactDOM from "react-dom/client";
import { getLiveTranslateConfig, saveLiveTranslateConfig } from "@/utils/storage";
import { IconSettings, IconVideo, IconPlayerPlay, IconPlayerStop, IconCircleDot } from "@tabler/icons-react";

const GoogleLogo: React.FC = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" style={{ flexShrink: 0 }}>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
  </svg>
);

const MicrosoftLogo: React.FC = () => (
  <svg viewBox="0 0 23 23" width="15" height="15" style={{ flexShrink: 0 }}>
    <rect x="0" y="0" width="10.5" height="10.5" fill="#F25022" />
    <rect x="11.5" y="0" width="10.5" height="10.5" fill="#7FBA00" />
    <rect x="0" y="11.5" width="10.5" height="10.5" fill="#00A4EF" />
    <rect x="11.5" y="11.5" width="10.5" height="10.5" fill="#FFB900" />
  </svg>
);

const TranslatorSelect: React.FC<{
  value: "google" | "microsoft";
  onChange: (val: "google" | "microsoft") => void;
}> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const options = [
    {
      value: "google" as const,
      label: "Google 翻譯 (免費版)",
      logo: <GoogleLogo />,
    },
    {
      value: "microsoft" as const,
      label: "微軟翻譯 (免費版)",
      logo: <MicrosoftLogo />,
    },
  ];

  const currentOption = options.find((o) => o.value === value) || options[0];

  return (
    <div ref={dropdownRef} style={{ position: "relative", width: "100%" }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          backgroundColor: "#ffffff",
          border: isOpen ? "1.5px solid #0284c7" : "1px solid #cbd5e1",
          borderRadius: "8px",
          padding: "8px 12px",
          color: "#0f172a",
          fontSize: "12.5px",
          cursor: "pointer",
          userSelect: "none",
          boxSizing: "border-box",
          justifyContent: "space-between",
          transition: "border-color 0.15s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {currentOption.logo}
          <span style={{ fontWeight: "500" }}>{currentOption.label}</span>
        </div>
        <svg
          viewBox="0 0 20 20"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          style={{
            transform: isOpen ? "rotate(180deg)" : "none",
            transition: "transform 0.2s ease",
            color: "#64748b",
          }}
        >
          <path d="M5 7.5l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            width: "100%",
            backgroundColor: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
            zIndex: 1000,
            overflow: "hidden",
            boxSizing: "border-box",
            padding: "4px 0",
          }}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 12px",
                  cursor: "pointer",
                  backgroundColor: isSelected ? "#eff6ff" : "transparent",
                  color: isSelected ? "#0284c7" : "#0f172a",
                  fontSize: "12.5px",
                  fontWeight: isSelected ? "600" : "400",
                  transition: "background-color 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = "#f8fafc";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                {opt.logo}
                <span style={{ flex: 1 }}>{opt.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [isActive, setIsActive] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("disconnected");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [builtInTranslator, setBuiltInTranslator] = useState<"google" | "microsoft">("google");

  useEffect(() => {
    getLiveTranslateConfig().then((config) => {
      setBuiltInTranslator(config.builtInTranslator || "google");
    });
  }, []);

  const handleTranslatorChange = (val: "google" | "microsoft") => {
    setBuiltInTranslator(val);
    saveLiveTranslateConfig({ builtInTranslator: val });
  };

  useEffect(() => {
    // 獲取當前分頁 ID
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id) {
        setActiveTabId(tab.id);
        queryState(tab.id);
      }
    });

    // 監聽來自 Background/Offscreen 的連線狀態回報
    const handleMessage = (message: any) => {
      if (message.type === "sendLiveTranslateStatus") {
        setStatus(message.data.status);
        if (message.data.status === "connected" || message.data.status === "connecting") {
          setIsActive(true);
        } else {
          setIsActive(false);
        }
        if (message.data.status === "error") {
          setErrorMsg(message.data.error || "連線失敗");
        } else {
          setErrorMsg("");
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const queryState = (tabId: number) => {
    chrome.runtime.sendMessage({ type: "getLiveTranslateState", data: { tabId } }, (res) => {
      if (res) {
        setIsActive(res.active);
        setStatus(res.status);
      }
    });
  };

  const handleToggle = () => {
    if (!activeTabId) return;

    if (isActive) {
      // 停止即時翻譯
      chrome.runtime.sendMessage({ type: "stopVideoLiveTranslate" }, () => {
        setIsActive(false);
        setStatus("disconnected");
      });
    } else {
      // 先驗證 API Key 是否填寫
      getLiveTranslateConfig().then((config) => {
        if (!config.apiKey || !config.apiKey.trim()) {
          alert("請先設定您的 Gemini API 金鑰！現在將為您開啟設定頁面。");
          chrome.runtime.openOptionsPage();
          return;
        }

        // 開始即時翻譯
        setErrorMsg("");
        setStatus("connecting");
        chrome.runtime.sendMessage({ type: "startVideoLiveTranslate", data: { tabId: activeTabId } }, (res) => {
          if (res && !res.ok) {
            setIsActive(false);
            setStatus("error");
            if (res.reason === "apiKeyRequired") {
              setErrorMsg("請先設定 Gemini API Key！");
              chrome.runtime.openOptionsPage();
            } else if (res.reason === "captureFailed") {
              setErrorMsg("擷取分頁音訊失敗，請確認該分頁有在播放影片。");
            } else {
              setErrorMsg(res.reason || "無法啟動翻譯");
            }
          }
        });
      });
    }
  };

  const handleOpenSettings = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <img
            src={chrome.runtime.getURL("icons/icon-48.png")}
            alt="Hummingbird Logo"
            style={{ width: "20px", height: "20px", objectFit: "contain" }}
          />
          <span style={{ fontWeight: "700", fontSize: "15px", letterSpacing: "0.3px", color: "#0f172a" }}>
            蜂鳥影片即時翻譯
          </span>
        </div>
        <button onClick={handleOpenSettings} style={iconBtnStyle} title="開啟設定">
          <IconSettings size={18} color="#64748b" />
        </button>
      </div>

      {/* Main Body */}
      <div style={bodyStyle}>
        <div style={statusCardStyle}>
          <div style={statusWrapperStyle}>
            <IconCircleDot
              size={12}
              className={status === "connected" ? "pulse-animation" : ""}
              color={
                status === "connected"
                  ? "#10b981"
                  : status === "connecting"
                  ? "#f59e0b"
                  : status === "error"
                  ? "#ef4444"
                  : "#94a3b8"
              }
            />
            <span style={statusTextStyle}>
              狀態：
              {status === "connected"
                ? "正在翻譯影片中"
                : status === "connecting"
                ? "正在連線並配置語音..."
                : status === "error"
                ? "發生錯誤"
                : "未啟動"}
            </span>
          </div>

          {errorMsg && <div style={errorCardStyle}>{errorMsg}</div>}

          <button
            onClick={handleToggle}
            style={{
              ...actionBtnStyle,
              backgroundColor: isActive ? "#ef4444" : "#0284c7",
              boxShadow: isActive ? "0 4px 10px rgba(239, 68, 68, 0.2)" : "0 4px 10px rgba(2, 132, 199, 0.2)",
              marginBottom: "8px",
            }}
          >
            {isActive ? <IconPlayerStop size={16} /> : <IconPlayerPlay size={16} />}
            <span>{isActive ? "停止即時語音翻譯" : "啟動影片即時語音翻譯"}</span>
          </button>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px", marginBottom: "4px" }}>
            <label style={{ fontSize: "12px", fontWeight: "600", color: "#475569" }}>內建字幕翻譯服務</label>
            <TranslatorSelect value={builtInTranslator} onChange={handleTranslatorChange} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <span>Gemini Live Translate</span>
      </div>
    </div>
  );
};

// Styling definitions
const containerStyle: React.CSSProperties = {
  backgroundColor: "#f8fafc",
  color: "#0f172a",
  padding: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderBottom: "1px solid #e2e8f0",
  paddingBottom: "10px",
};

const iconBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "4px",
  borderRadius: "6px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "background-color 0.2s",
};

const bodyStyle: React.CSSProperties = {
  minHeight: "110px",
  display: "flex",
  alignItems: "center",
};

const statusCardStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "10px",
  padding: "14px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  border: "1px solid #e2e8f0",
  width: "100%",
  boxShadow: "0 2px 4px rgba(0,0,0,0.02)",
};

const statusWrapperStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

const statusTextStyle: React.CSSProperties = {
  fontSize: "13px",
  color: "#334155",
  fontWeight: "600",
};

const errorCardStyle: React.CSSProperties = {
  backgroundColor: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#ef4444",
  padding: "8px 10px",
  borderRadius: "6px",
  fontSize: "12px",
  lineHeight: "1.4",
};

const actionBtnStyle: React.CSSProperties = {
  color: "#ffffff",
  border: "none",
  borderRadius: "8px",
  padding: "10px 14px",
  fontSize: "13px",
  fontWeight: "600",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  transition: "opacity 0.2s, transform 0.1s",
};

const footerStyle: React.CSSProperties = {
  textAlign: "center",
  fontSize: "11px",
  color: "#64748b",
  borderTop: "1px solid #e2e8f0",
  paddingTop: "10px",
  fontWeight: "500",
};

// Create Root
const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<App />);
}

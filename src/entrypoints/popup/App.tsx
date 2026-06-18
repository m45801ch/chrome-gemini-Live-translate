import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { getLiveTranslateConfig, saveLiveTranslateConfig } from "@/utils/storage";
import { IconSettings, IconVideo, IconPlayerPlay, IconPlayerStop, IconCircleDot } from "@tabler/icons-react";

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

          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px", marginBottom: "4px" }}>
            <label style={{ fontSize: "12px", fontWeight: "600", color: "#475569" }}>內建字幕翻譯服務</label>
            <select
              value={builtInTranslator}
              onChange={(e) => handleTranslatorChange(e.target.value as "google" | "microsoft")}
              style={{
                backgroundColor: "#ffffff",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                padding: "6px 10px",
                color: "#0f172a",
                fontSize: "12.5px",
                outline: "none",
                width: "100%",
                boxSizing: "border-box",
                cursor: "pointer",
              }}
            >
              <option value="google">Google 翻譯 (免費版)</option>
              <option value="microsoft">微軟翻譯 (免費版)</option>
            </select>
          </div>

          <button
            onClick={handleToggle}
            style={{
              ...actionBtnStyle,
              backgroundColor: isActive ? "#ef4444" : "#0284c7",
              boxShadow: isActive ? "0 4px 10px rgba(239, 68, 68, 0.2)" : "0 4px 10px rgba(2, 132, 199, 0.2)",
            }}
          >
            {isActive ? <IconPlayerStop size={16} /> : <IconPlayerPlay size={16} />}
            <span>{isActive ? "停止即時語音翻譯" : "啟動影片即時語音翻譯"}</span>
          </button>
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

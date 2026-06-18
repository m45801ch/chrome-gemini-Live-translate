import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { SettingsPanel } from "@/components/SettingsPanel";
import { getLiveTranslateConfig, saveLiveTranslateConfig, AppConfig } from "@/utils/storage";

const LANGUAGES = [
  { code: "auto", name: "自動偵測 (Auto Detect)" },
  { code: "zh-Hant", name: "繁體中文 (Traditional Chinese)" },
  { code: "zh-Hans", name: "簡體中文 (Simplified Chinese)" },
  { code: "en", name: "英文 (English)" },
  { code: "ja", name: "日文 (Japanese)" },
  { code: "ko", name: "韓文 (Korean)" },
  { code: "es", name: "西班牙文 (Spanish)" },
  { code: "fr", name: "法文 (French)" },
  { code: "de", name: "德文 (German)" },
  { code: "it", name: "義大利文 (Italian)" },
  { code: "ru", name: "俄文 (Russian)" },
  { code: "pt", name: "葡萄牙文 (Portuguese)" },
  { code: "vi", name: "越南文 (Vietnamese)" },
  { code: "th", name: "泰文 (Thai)" },
  { code: "id", name: "印尼文 (Indonesian)" },
  { code: "ms", name: "馬來文 (Malay)" },
  { code: "hi", name: "印地文 (Hindi)" },
  { code: "ar", name: "阿拉伯文 (Arabic)" },
  { code: "tr", name: "土耳其文 (Turkish)" },
  { code: "nl", name: "荷蘭文 (Dutch)" },
  { code: "pl", name: "波蘭文 (Polish)" },
  { code: "sv", name: "瑞典文 (Swedish)" },
  { code: "da", name: "丹麥文 (Danish)" },
  { code: "fi", name: "芬蘭文 (Finnish)" },
  { code: "no", name: "挪威文 (Norwegian)" },
  { code: "cs", name: "捷克文 (Czech)" },
  { code: "el", name: "希臘文 (Greek)" },
  { code: "he", name: "希伯來文 (Hebrew)" },
  { code: "ro", name: "羅馬尼亞文 (Romanian)" },
  { code: "hu", name: "匈牙利文 (Hungarian)" },
  { code: "uk", name: "烏克蘭文 (Ukrainian)" },
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"api" | "lang" | "subtitle">("api");
  const [apiKey, setApiKey] = useState<string>("");
  const [modelName, setModelName] = useState<string>("gemini-3.5-live-translate-preview");
  const [sourceLang, setSourceLang] = useState<string>("auto");
  const [targetLang, setTargetLang] = useState<string>("zh-Hant");
  const [hotSwap, setHotSwap] = useState<number>(90);
  const [builtInTranslator, setBuiltInTranslator] = useState<"google" | "microsoft">("google");

  useEffect(() => {
    getLiveTranslateConfig().then((config) => {
      setApiKey(config.apiKey);
      setModelName(config.modelName || "gemini-3.5-live-translate-preview");
      setTargetLang(config.targetLang);
      setHotSwap(config.hotSwap);
      setBuiltInTranslator(config.builtInTranslator || "google");
      // 擴充套件可能沒有存 sourceLang，如果有的話讀取
      const anyConfig = config as any;
      if (anyConfig.sourceLang) {
        setSourceLang(anyConfig.sourceLang);
      }
    });
  }, []);

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    saveLiveTranslateConfig({ apiKey: val });
  };

  const handleModelNameChange = (val: string) => {
    setModelName(val);
    saveLiveTranslateConfig({ modelName: val });
  };

  const handleSourceLangChange = (val: string) => {
    setSourceLang(val);
    chrome.storage.local.set({ sourceLang: val });
  };

  const handleTargetLangChange = (val: string) => {
    setTargetLang(val);
    saveLiveTranslateConfig({ targetLang: val });
  };

  const handleHotSwapChange = (val: number) => {
    setHotSwap(val);
    saveLiveTranslateConfig({ hotSwap: val });
  };

  const handleBuiltInTranslatorChange = (val: "google" | "microsoft") => {
    setBuiltInTranslator(val);
    saveLiveTranslateConfig({ builtInTranslator: val });
  };

  return (
    <div style={layoutStyle}>
      {/* Sidebar */}
      <div style={sidebarStyle}>
        <div style={sidebarHeaderStyle}>
          <img
            src={chrome.runtime.getURL("icons/icon-48.png")}
            alt="Logo"
            style={{ width: "32px", height: "32px", objectFit: "contain" }}
          />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontWeight: "700", fontSize: "15px", color: "#0f172a" }}>蜂鳥影片即時翻譯</span>
            <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "500" }}>v1.1.1</span>
          </div>
        </div>

        <div style={navGroupStyle}>
          <div style={navTitleStyle}>設定</div>
          <button
            onClick={() => setActiveTab("api")}
            style={activeTab === "api" ? activeNavItemStyle : navNavItemStyle}
          >
            <span style={{ fontSize: "16px" }}>🔑</span>
            <span>Gemini API 金鑰</span>
          </button>
          <button
            onClick={() => setActiveTab("lang")}
            style={activeTab === "lang" ? activeNavItemStyle : navNavItemStyle}
          >
            <span style={{ fontSize: "16px" }}>🌐</span>
            <span>翻譯語言設定</span>
          </button>
          <button
            onClick={() => setActiveTab("subtitle")}
            style={activeTab === "subtitle" ? activeNavItemStyle : navNavItemStyle}
          >
            <span style={{ fontSize: "16px" }}>🎨</span>
            <span>字幕設定</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={contentAreaStyle}>
        <div style={headerTitleStyle}>
          {activeTab === "api" && "Gemini API 金鑰設定"}
          {activeTab === "lang" && "翻譯語言設定"}
          {activeTab === "subtitle" && "字幕設定"}
        </div>

        <div style={cardStyle}>
          {activeTab === "api" && (
            <div style={settingsGroupStyle}>
              <div style={cardHeaderStyle}>
                <h3 style={cardTitleStyle}>API 提供者設定</h3>
                <p style={cardSubTitleStyle}>輸入您的 Gemini API Key 以啟動即時翻譯服務。</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "16px" }}>
                <label style={labelStyle}>Gemini API Key</label>
                <input
                  type="password"
                  placeholder="請輸入 Gemini API Key"
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  style={inputStyle}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                  <span style={tipStyle}>請輸入 Gemini API Key (應用程式介面金鑰)。</span>
                  <button
                    onClick={() => window.open("https://aistudio.google.com/api-keys", "_blank")}
                    style={guideBtnStyle}
                  >
                    前往獲取 API Key
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "20px" }}>
                <label style={labelStyle}>自訂模型名稱 (Gemini Live Model)</label>
                <input
                  type="text"
                  placeholder="預設為 gemini-3.5-live-translate-preview"
                  value={modelName}
                  onChange={(e) => handleModelNameChange(e.target.value)}
                  style={inputStyle}
                />
                <span style={tipStyle}>* 當 Google 推出新版即時翻譯模型（例如 Gemini 4.0 Live）時，您可以在此輸入新的模型名稱。</span>
              </div>
            </div>
          )}

          {activeTab === "lang" && (
            <div style={settingsGroupStyle}>
              <div style={cardHeaderStyle}>
                <h3 style={cardTitleStyle}>語音翻譯語言</h3>
                <p style={cardSubTitleStyle}>選擇即時翻譯的影片語音來源，以及翻譯呈現的字幕目標語言與快取設定。</p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginTop: "20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label style={labelStyle}>影片語音來源語言</label>
                  <select
                    value={sourceLang}
                    onChange={(e) => handleSourceLangChange(e.target.value)}
                    style={selectStyle}
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                  <span style={tipStyle}>* 當設定為「自動偵測」時，語音翻譯模型會自動偵測影片講述的語言。</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label style={labelStyle}>翻譯字幕目標語言</label>
                  <select
                    value={targetLang}
                    onChange={(e) => handleTargetLangChange(e.target.value)}
                    style={selectStyle}
                  >
                    {LANGUAGES.filter(l => l.code !== "auto").map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                  <span style={tipStyle}>* 即時翻譯產出的字幕目標語系，預設為繁體中文。</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label style={labelStyle}>內建字幕翻譯來源 (Built-in Subtitle Translator)</label>
                  <select
                    value={builtInTranslator}
                    onChange={(e) => handleBuiltInTranslatorChange(e.target.value as "google" | "microsoft")}
                    style={selectStyle}
                  >
                    <option value="google">Google 翻譯 (免費版)</option>
                    <option value="microsoft">微軟翻譯 (免費版)</option>
                  </select>
                  <span style={tipStyle}>* 當使用內建字幕時，所採用的免費翻譯引擎來源。</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label style={labelStyle}>清理快取對話間隔 (防止延遲)</label>
                  <select
                    value={hotSwap}
                    onChange={(e) => handleHotSwapChange(Number(e.target.value))}
                    style={selectStyle}
                  >
                    <option value={30}>30 秒</option>
                    <option value={60}>60 秒</option>
                    <option value={90}>90 秒（預設）</option>
                    <option value={120}>120 秒</option>
                    <option value={0}>不清理</option>
                  </select>
                  <span style={tipStyle}>* 定期重新建立連線以清空語音模型上下文快取，防止因對話過長導致的反應延遲。</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === "subtitle" && (
            <SettingsPanel />
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const layoutStyle: React.CSSProperties = {
  display: "flex",
  minHeight: "100vh",
  backgroundColor: "#f8fafc",
};

const sidebarStyle: React.CSSProperties = {
  width: "240px",
  backgroundColor: "#ffffff",
  borderRight: "1px solid #e2e8f0",
  display: "flex",
  flexDirection: "column",
  padding: "24px 16px",
  boxSizing: "border-box",
  flexShrink: 0,
};

const sidebarHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  marginBottom: "36px",
  paddingLeft: "8px",
};

const navGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const navTitleStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: "700",
  color: "#94a3b8",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  paddingLeft: "12px",
  marginBottom: "8px",
};

const navNavItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "none",
  backgroundColor: "transparent",
  color: "#475569",
  fontSize: "13.5px",
  fontWeight: "500",
  cursor: "pointer",
  textAlign: "left",
  transition: "all 0.15s",
};

const activeNavItemStyle: React.CSSProperties = {
  ...navNavItemStyle,
  backgroundColor: "#f1f5f9",
  color: "#0f172a",
  fontWeight: "600",
};

const contentAreaStyle: React.CSSProperties = {
  flex: 1,
  padding: "40px 48px",
  boxSizing: "border-box",
  maxWidth: "760px",
};

const headerTitleStyle: React.CSSProperties = {
  fontSize: "22px",
  fontWeight: "700",
  color: "#0f172a",
  marginBottom: "24px",
};

const cardStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  padding: "24px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
};

const settingsGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
};

const cardHeaderStyle: React.CSSProperties = {
  borderBottom: "1px solid #f1f5f9",
  paddingBottom: "14px",
  marginBottom: "8px",
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: "600",
  color: "#0f172a",
  margin: 0,
};

const cardSubTitleStyle: React.CSSProperties = {
  fontSize: "12.5px",
  color: "#64748b",
  margin: "4px 0 0",
};

const labelStyle: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: "600",
  color: "#334155",
};

const inputStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  padding: "10px 14px",
  color: "#0f172a",
  fontSize: "13.5px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  transition: "border-color 0.15s",
};

const selectStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  padding: "10px 14px",
  color: "#0f172a",
  fontSize: "13.5px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  cursor: "pointer",
};

const tipStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "#64748b",
  lineHeight: "1.4",
};

const guideBtnStyle: React.CSSProperties = {
  backgroundColor: "#eff6ff",
  border: "1px solid #bfdbfe",
  borderRadius: "6px",
  color: "#0284c7",
  fontSize: "11.5px",
  padding: "5px 12px",
  cursor: "pointer",
  fontWeight: "600",
  transition: "all 0.15s",
};

// Create Root
const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<App />);
}

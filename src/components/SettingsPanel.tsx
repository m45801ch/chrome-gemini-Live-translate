import React, { useEffect, useState, useRef } from "react";
import { getLiveTranslateConfig, saveLiveTranslateConfig, AppConfig, SubtitleTextStyle } from "@/utils/storage";

// ─── 預設色盤 ─────────────────────────────────────────────────────────────────
const PRESET_COLORS = [
  "#ffffff", "#ffeb3b", "#4ade80", "#38bdf8", "#f87171", "#fb923c",
  "#c084fc", "#f472b6", "#a3e635", "#2dd4bf", "#fbbf24", "#e879f9",
  "#000000", "#1e293b", "#475569", "#94a3b8",
];

// ─── ColorPicker ──────────────────────────────────────────────────────────────
const ColorPicker: React.FC<{ value: string; onChange: (c: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        popupRef.current && !popupRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [open]);

  // 計算 popup 的螢幕位置
  const [popupPos, setPopupPos] = useState({ top: 0, right: 0 });
  const openPicker = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPopupPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(true);
  };

  return (
    <>
      <div
        ref={triggerRef}
        onClick={() => open ? setOpen(false) : openPicker()}
        style={{
          width: "26px", height: "26px", borderRadius: "6px",
          backgroundColor: value,
          border: open ? "2px solid #0284c7" : "1px solid #cbd5e1",
          cursor: "pointer",
          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
          transition: "border-color 0.15s",
          flexShrink: 0,
        }}
      />

      {open && (
        <div
          ref={popupRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: popupPos.top,
            right: popupPos.right,
            backgroundColor: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "10px",
            zIndex: 2147483647,
            boxShadow: "0 12px 24px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)",
            minWidth: "180px",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "5px", marginBottom: "8px" }}>
            {PRESET_COLORS.map((c) => (
              <div
                key={c}
                onClick={() => { onChange(c); setOpen(false); }}
                title={c}
                style={{
                  width: "18px", height: "18px", borderRadius: "4px",
                  backgroundColor: c,
                  border: value.toLowerCase() === c.toLowerCase()
                    ? "2px solid #0284c7"
                    : "1px solid #e2e8f0",
                  cursor: "pointer",
                  transition: "transform 0.1s",
                  boxSizing: "border-box",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.2)")}
                onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
              />
            ))}
          </div>
          <div style={{ borderTop: "1px solid #f1f5f9", margin: "6px 0 8px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "11px", color: "#64748b", flexShrink: 0 }}>自訂</span>
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              style={{
                flex: 1, height: "26px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                cursor: "pointer",
                backgroundColor: "transparent",
                padding: "1px 2px",
              }}
            />
          </div>
        </div>
      )}
    </>
  );
};

// ─── SettingsPanel 主體 ───────────────────────────────────────────────────────
interface SettingsPanelProps {
  onConfigChange?: (config: AppConfig) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onConfigChange }) => {
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    getLiveTranslateConfig().then(setConfig);
  }, []);

  if (!config) return (
    <div style={{ color: "#64748b", padding: "12px", textAlign: "center", fontSize: "12px" }}>載入中...</div>
  );

  const updateConfig = (updater: (prev: AppConfig) => AppConfig) => {
    const next = updater(config);
    setConfig(next);
    saveLiveTranslateConfig(next);
    onConfigChange?.(next);
  };

  const updateGlobal = <K extends keyof AppConfig["subtitleStyle"]>(key: K, val: AppConfig["subtitleStyle"][K]) =>
    updateConfig((prev) => ({ ...prev, subtitleStyle: { ...prev.subtitleStyle, [key]: val } }));

  const updateText = (type: "main" | "translation", key: keyof SubtitleTextStyle, val: any) =>
    updateConfig((prev) => ({
      ...prev,
      subtitleStyle: {
        ...prev.subtitleStyle,
        [type]: { ...prev.subtitleStyle[type], [key]: val },
      },
    }));

  const resetAll = () => updateConfig((prev) => ({
    ...prev,
    subtitleStyle: {
      textAlign: "center", maxLines: 3, backgroundOpacity: 75, displayMode: "both",
      main: { fontFamily: "system", fontScale: 100, color: "#ffffff", fontWeight: 400 },
      translation: { fontFamily: "system", fontScale: 110, color: "#ffeb3b", fontWeight: 400 },
    },
  }));

  const { subtitleStyle: s } = config;

  return (
    <div style={panelStyle}>
      {/* ── 字幕樣式 ── */}
      <Section title="全域字幕設定" onReset={resetAll}>
        <Field label="顯示模式">
          <div style={{ display: "flex", gap: "4px" }}>
            {(["both", "original", "translation"] as const).map((mode) => {
              const labels = { both: "雙語", original: "原文", translation: "譯文" };
              const isActive = s.displayMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => updateGlobal("displayMode", mode)}
                  style={{
                    padding: "4px 10px",
                    fontSize: "12px",
                    borderRadius: "6px",
                    border: "1px solid",
                    borderColor: isActive ? "#0284c7" : "#cbd5e1",
                    backgroundColor: isActive ? "#eff6ff" : "#ffffff",
                    color: isActive ? "#0284c7" : "#334155",
                    cursor: "pointer",
                    transition: "all 0.15s",
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {labels[mode]}
                </button>
              );
            })}
          </div>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid #f1f5f9" }}>
          <Field label="對齊方式" noBorder>
            <select value={s.textAlign} onChange={(e) => updateGlobal("textAlign", e.target.value as "center" | "left")} style={selectSm}>
              <option value="center">置中</option>
              <option value="left">靠左</option>
            </select>
          </Field>
          <Field label="最大行數" noBorder>
            <select value={s.maxLines} onChange={(e) => updateGlobal("maxLines", parseInt(e.target.value))} style={selectSm}>
              <option value={1}>1 行</option>
              <option value={2}>2 行</option>
              <option value={3}>3 行</option>
            </select>
          </Field>
        </div>

        <SliderField label="背景透明度" value={s.backgroundOpacity} unit="%" min={0} max={100} step={5}
          onChange={(v) => updateGlobal("backgroundOpacity", v)} />
      </Section>

      {/* ── 主字幕 ── */}
      <Section title="主字幕樣式（原文）">
        <SliderField label="字級縮放" value={s.main.fontScale} unit="%" min={50} max={200} step={10}
          onChange={(v) => updateText("main", "fontScale", v)} />
        <Field label="文字顏色">
          <ColorPicker value={s.main.color} onChange={(c) => updateText("main", "color", c)} />
        </Field>
        <Field label="字型系列">
          <select value={s.main.fontFamily} onChange={(e) => updateText("main", "fontFamily", e.target.value)} style={selectSm}>
            <option value="system">系統預設</option>
            <option value="roboto">Roboto</option>
            <option value="noto-sans">思源黑體 (Noto Sans)</option>
            <option value="noto-serif">思源宋體 (Noto Serif)</option>
          </select>
        </Field>
        <SliderField label="字型粗細" value={s.main.fontWeight} unit="" min={300} max={700} step={100}
          onChange={(v) => updateText("main", "fontWeight", v)} />
      </Section>

      {/* ── 翻譯字幕 ── */}
      <Section title="翻譯字幕樣式（譯文）">
        <SliderField label="字級縮放" value={s.translation.fontScale} unit="%" min={50} max={200} step={10}
          onChange={(v) => updateText("translation", "fontScale", v)} />
        <Field label="文字顏色">
          <ColorPicker value={s.translation.color} onChange={(c) => updateText("translation", "color", c)} />
        </Field>
        <Field label="字型系列">
          <select value={s.translation.fontFamily} onChange={(e) => updateText("translation", "fontFamily", e.target.value)} style={selectSm}>
            <option value="system">系統預設</option>
            <option value="roboto">Roboto</option>
            <option value="noto-sans">思源黑體 (Noto Sans)</option>
            <option value="noto-serif">思源宋體 (Noto Serif)</option>
          </select>
        </Field>
        <SliderField label="字型粗細" value={s.translation.fontWeight} unit="" min={300} max={700} step={100}
          onChange={(v) => updateText("translation", "fontWeight", v)} />
      </Section>
    </div>
  );
};

// ─── UI 小元件 ─────────────────────────────────────────────────────────────────
const Section: React.FC<{ title: string; onReset?: () => void; children: React.ReactNode }> = ({ title, onReset, children }) => (
  <div style={{ marginBottom: "8px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
      <span style={{ fontSize: "12px", fontWeight: "600", color: "#0284c7", letterSpacing: "0.02em" }}>{title}</span>
      {onReset && (
        <button onClick={onReset} title="重設" style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "14px", padding: "0 2px", lineHeight: 1 }}>↺</button>
      )}
    </div>
    <div style={{
      backgroundColor: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: "8px",
      boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
    }}>
      {children}
    </div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode; noBorder?: boolean }> = ({ label, children, noBorder }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "8px 12px",
    borderBottom: noBorder ? "none" : "1px solid #f1f5f9",
  }}>
    <span style={{ fontSize: "13px", color: "#334155" }}>{label}</span>
    {children}
  </div>
);

const SliderField: React.FC<{
  label: string; value: number; unit: string; min: number; max: number; step: number; onChange: (v: number) => void;
}> = ({ label, value, unit, min, max, step, onChange }) => (
  <div style={{ padding: "8px 12px", borderBottom: "1px solid #f1f5f9" }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
      <span style={{ fontSize: "13px", color: "#334155" }}>{label}</span>
      <span style={{ fontSize: "12px", color: "#64748b" }}>{value}{unit}</span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseInt(e.target.value))}
      style={{ width: "100%", accentColor: "#0284c7", cursor: "pointer", margin: 0, display: "block" }}
    />
  </div>
);

// ─── Styles ───────────────────────────────────────────────────────────────────
const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "14px",
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#1e293b",
  fontSize: "13px",
};

const selectSm: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: "6px",
  padding: "4px 8px",
  color: "#0f172a",
  outline: "none",
  fontSize: "12px",
  minWidth: "90px",
  cursor: "pointer",
};

export interface SubtitleTextStyle {
  fontFamily: "system" | "roboto" | "noto-sans" | "noto-serif";
  fontScale: number; // 30 到 150 %
  color: string;
  fontWeight: number; // 300 到 700
}

export interface SubtitleStyle {
  textAlign: "center" | "left";
  maxLines: number;
  builtInMaxLines: number;
  backgroundOpacity: number; // 0 到 100
  displayMode: "both" | "original" | "translation";
  translationPosition: "up" | "down";
  main: SubtitleTextStyle;
  translation: SubtitleTextStyle;
  historical: {
    main: { color: string };
    translation: { color: string };
  };
}

export interface AppConfig {
  apiKey: string;
  modelName: string;
  targetLang: string;
  hotSwap: number; // 30, 60, 90, 120, 0
  liveOutputMode: "text" | "voice"; // 只輸出文字字幕，或語音帶文字
  subtitleStyle: SubtitleStyle;
  useBuiltInSubtitles?: boolean;
  builtInTranslator?: "google" | "microsoft";
}

const DEFAULT_STYLE: SubtitleStyle = {
  textAlign: "center",
  maxLines: 2,
  builtInMaxLines: 1,
  backgroundOpacity: 75,
  displayMode: "both",
  translationPosition: "down",
  main: {
    fontFamily: "system",
    fontScale: 100,
    color: "#ffffff",
    fontWeight: 400,
  },
  translation: {
    fontFamily: "system",
    fontScale: 110,
    color: "#ffeb3b",
    fontWeight: 400,
  },
  historical: {
    main: { color: "#cbd5e1" },
    translation: { color: "#94a3b8" },
  },
};

export async function getLiveTranslateConfig(): Promise<AppConfig> {
  const data = await chrome.storage.local.get(["apiKey", "modelName", "targetLang", "hotSwap", "liveOutputMode", "subtitleStyle", "useBuiltInSubtitles", "builtInTranslator"]);
  return {
    apiKey: data.apiKey || "",
    modelName: data.modelName || "gemini-3.5-live-translate-preview",
    targetLang: data.targetLang || "zh-Hant",
    hotSwap: data.hotSwap !== undefined ? Number(data.hotSwap) : 90,
    liveOutputMode: data.liveOutputMode === "voice" ? "voice" : "text",
    useBuiltInSubtitles: data.useBuiltInSubtitles === true,
    builtInTranslator: data.builtInTranslator || "google",
    subtitleStyle: {
      ...DEFAULT_STYLE,
      ...data.subtitleStyle,
      main: {
        ...DEFAULT_STYLE.main,
        ...(data.subtitleStyle?.main || {}),
      },
      translation: {
        ...DEFAULT_STYLE.translation,
        ...(data.subtitleStyle?.translation || {}),
      },
      historical: {
        main: { ...DEFAULT_STYLE.historical.main, ...(data.subtitleStyle?.historical?.main || {}) },
        translation: { ...DEFAULT_STYLE.historical.translation, ...(data.subtitleStyle?.historical?.translation || {}) },
      },
    },
  };
}

export async function saveLiveTranslateConfig(config: Partial<AppConfig>): Promise<void> {
  await chrome.storage.local.set(config);
}

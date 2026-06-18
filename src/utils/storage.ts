export interface SubtitleTextStyle {
  fontFamily: "system" | "roboto" | "noto-sans" | "noto-serif";
  fontScale: number; // 30 到 150 %
  color: string;
  fontWeight: number; // 300 到 700
}

export interface SubtitleStyle {
  textAlign: "center" | "left";
  maxLines: number;
  backgroundOpacity: number; // 0 到 100
  displayMode: "both" | "original" | "translation";
  main: SubtitleTextStyle;
  translation: SubtitleTextStyle;
}

export interface AppConfig {
  apiKey: string;
  modelName: string;
  targetLang: string;
  hotSwap: number; // 30, 60, 90, 120, 0
  subtitleStyle: SubtitleStyle;
  useBuiltInSubtitles?: boolean;
  builtInTranslator?: "google" | "microsoft";
}

const DEFAULT_STYLE: SubtitleStyle = {
  textAlign: "center",
  maxLines: 3,
  backgroundOpacity: 75,
  displayMode: "both",
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
};

export async function getLiveTranslateConfig(): Promise<AppConfig> {
  const data = await chrome.storage.local.get(["apiKey", "modelName", "targetLang", "hotSwap", "subtitleStyle", "useBuiltInSubtitles", "builtInTranslator"]);
  return {
    apiKey: data.apiKey || "",
    modelName: data.modelName || "gemini-3.5-live-translate-preview",
    targetLang: data.targetLang || "zh-Hant",
    hotSwap: data.hotSwap !== undefined ? Number(data.hotSwap) : 90,
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
    },
  };
}

export async function saveLiveTranslateConfig(config: Partial<AppConfig>): Promise<void> {
  await chrome.storage.local.set(config);
}


export const i18n = {
  t(key: string, args?: any[]): string {
    const messages: Record<string, string> = {
      "subtitles.errors.videoNotFound": "無法取得影片資訊 / Video not found",
      "subtitles.errors.noSubtitlesFound": "此影片沒有可用字幕 / No subtitles found for this video",
      "subtitles.errors.fetchSubTimeout": "載入字幕逾時 / Fetch subtitles timeout",
      "subtitles.errors.http403": "存取被拒 (HTTP 403) / HTTP 403 Forbidden",
      "subtitles.errors.http404": "字幕不存在 (HTTP 404) / HTTP 404 Not Found",
      "subtitles.errors.http429": "請求過於頻繁 (HTTP 429) / HTTP 429 Too Many Requests",
      "subtitles.errors.http500": "伺服器錯誤 (HTTP 500) / HTTP 500 Internal Server Error",
      "subtitles.errors.httpUnknown": "HTTP 錯誤: " + (args?.[0] || "未知錯誤"),
      "subtitles.errors.aiRateLimited": "AI 翻譯超出頻率限制 / AI Rate Limited",
      "subtitles.errors.aiAuthFailed": "AI 認證失敗 / AI Authentication Failed",
      "subtitles.errors.aiServiceUnavailable": "AI 服務暫時無法使用 / AI Service Unavailable",
      "subtitles.errors.aiNoResponse": "AI 未能回應 / AI did not respond",
    };
    return messages[key] || key;
  }
};

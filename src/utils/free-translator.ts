export async function googleTranslate(
  sourceText: string,
  fromLang: string,
  toLang: string
): Promise<string> {
  const effectiveFrom = fromLang === "auto" ? "auto" : fromLang;
  const effectiveTo = toLang === "zh-Hant" ? "zh-TW" : toLang === "zh-Hans" ? "zh-CN" : toLang;

  const params = {
    client: "gtx",
    sl: effectiveFrom,
    tl: effectiveTo,
    dt: "t",
    q: encodeURIComponent(sourceText),
  };

  const queryString = Object.entries(params)
    .map(([key, val]) => `${key}=${val}`)
    .join("&");

  const resp = await fetch(
    `https://translate.googleapis.com/translate_a/single?${queryString}`,
    {
      method: "GET",
    }
  );

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "");
    throw new Error(`Google Translate request failed: ${resp.status} ${resp.statusText} - ${errorText}`);
  }

  const result = await resp.json();
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    throw new TypeError("Unexpected response format from Google Translate API");
  }

  const translatedText = result[0]
    .filter(Array.isArray)
    .map(chunk => chunk[0])
    .filter(Boolean)
    .join("");

  return translatedText;
}

export async function refreshMicrosoftToken(): Promise<string> {
  const resp = await fetch("https://edge.microsoft.com/translate/auth");
  if (!resp.ok) {
    throw new Error(`Failed to refresh Microsoft token: ${resp.status} ${resp.statusText}`);
  }
  return await resp.text();
}

export async function microsoftTranslate(
  sourceText: string,
  fromLang: string,
  toLang: string
): Promise<string> {
  const effectiveFrom = fromLang === "auto" ? "" : fromLang;
  const token = await refreshMicrosoftToken();

  const resp = await fetch(
    `https://api-edge.cognitive.microsofttranslator.com/translate?from=${effectiveFrom}&to=${toLang}&api-version=3.0&includeSentenceLength=true&textType=html`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": token,
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify([{ Text: sourceText }]),
    }
  );

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "Unable to read error response");
    throw new Error(`Microsoft Translate request failed: ${resp.status} ${resp.statusText} - ${errorText}`);
  }

  const result = await resp.json();
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error("Unexpected response format from Microsoft Translate API");
  }

  const text = result[0]?.translations?.[0]?.text;
  if (text == null) {
    throw new Error("Missing translation text in Microsoft response");
  }

  return text;
}

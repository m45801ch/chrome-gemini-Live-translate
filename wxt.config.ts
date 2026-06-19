import { defineConfig } from "wxt"

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "蜂鳥影片即時翻譯",
    version: "1.1.3",
    description: "擷取影片音訊，透過 Gemini 3.5 Live API 即時生成並渲染雙語字幕",
    icons: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },
    permissions: [
      "tabCapture",
      "activeTab",
      "offscreen",
      "storage"
    ],
    host_permissions: [
      "<all_urls>"
    ],
    web_accessible_resources: [
      {
        resources: ["audio-processor.js", "icons/*.png"],
        matches: ["<all_urls>"]
      }
    ]
  }
})


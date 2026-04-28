{
  "manifest_version": 3,
  "name": "飲食店リスト取得ツール",
  "version": "1.0.0",
  "description": "ホットペッパー・食べログ・Googleマップから店舗情報をCSVで取得",
  "permissions": [
    "activeTab",
    "scripting"
  ],
  "host_permissions": [
    "https://hotpepper.jp/*",
    "https://www.hotpepper.jp/*",
    "https://tabelog.com/*",
    "https://www.google.com/*",
    "https://maps.google.com/*"
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_scripts": [
    {
      "matches": [
        "https://hotpepper.jp/*",
        "https://www.hotpepper.jp/*",
        "https://tabelog.com/*",
        "https://www.google.com/maps/*"
      ],
      "js": ["src/content.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
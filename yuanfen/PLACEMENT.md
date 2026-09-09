# 檔案放哪裡

`yuanfen.zip` 解開之後是一個 `yuanfen/` 資料夾，**整個放進 repo 根目錄**就好，不要拆開。

```
magic-oracle/                ← 你現有的 repo
├── index.html                 （原本的抽籤首頁）
├── src/
│   └── oracle.js              （原本的 Worker）
├── assets/                    （原本的素材）
├── data/
└── yuanfen/                 ← 新增這一整包
    ├── index.html
    ├── assets/               21 個 webp
    ├── src/                  15 個模組
    ├── build.js
    ├── lint.js
    ├── calibrate.js
    ├── package.json
    ├── .gitignore
    ├── README.md
    └── docs/
```

**為什麼要獨立資料夾**：這個產品自帶 `assets/` 跟 `src/`，跟你主站同名。放根目錄會撞在一起，`assets/medallion.webp` 會蓋掉你原本的素材。

---

## 上 Git

```bash
cd magic-oracle
# 把解開的 yuanfen 資料夾放進來，然後：
git add yuanfen
git commit -m "feat: 雙人合盤緣分指數（預覽模式，未接金流）"
git push
```

`.gitignore` 已經寫在 `yuanfen/` 裡，會排除 `node_modules/` 和自動產生的 `engine.bundle.js`。

---

## 網址會是什麼

Cloudflare Pages 部署整個 repo 的話：

```
https://unfinished.tw/yuanfen/          ← 自動指向 yuanfen/index.html
```

**要先確認一件事**：你主站是 Cloudflare Workers 跑的（`src/oracle.js`）。如果 Worker 的路由設定是 `unfinished.tw/*`，它會攔截所有請求，包含 `/yuanfen/`。

檢查 `wrangler.jsonc` 的 routes 設定：

- 如果是 `unfinished.tw/*` → 要在 Worker 裡加一條，讓 `/yuanfen/` 開頭的路徑直接回傳靜態檔（`env.ASSETS.fetch(request)`）
- 如果只綁特定路徑（如 `/oracle*`、`/api/*`）→ 不用動，Pages 會自己接手

不確定的話，推上去之後直接開 `unfinished.tw/yuanfen/` 看看。出現抽籤首頁就是被 Worker 攔了。

---

## 部署後檢查三件事

1. **開 `/yuanfen/` 能看到花框跟金色按鈕** —— 看到光禿禿的金框邊線代表 `assets/` 沒上傳成功
2. **按「開始測算」有羅盤轉 1.8 秒** —— 沒有的話是 `compass.webp` 沒到
3. **F12 的 Console 沒有 404** —— 有的話是素材路徑錯了

---

## 之後要改東西

**不要直接改 `index.html`。** 開頭 `<script>` 到「介面」註解之間是自動產生的。

```bash
cd yuanfen
# 改 src/ 底下的檔案（文案、引擎、格局判讀都在這）
npm run lint      # 文案檢查，必須全過
npm run build     # 併進 index.html
git add . && git commit -m "..." && git push
```

介面註解**以下**的 UI 程式碼（版面、動畫、事件處理）是手寫的，可以直接改 `index.html`。

---

## 上線前還要做的

1. 拿掉付費按鈕下方那行「預覽模式：此版本尚未接金流，點擊可直接展開。」
2. 把 `#u-cta` 的 click 事件從「直接展開」改成「導向付款」
3. ECPay 比照你 99 元那條，改金額與品項名稱

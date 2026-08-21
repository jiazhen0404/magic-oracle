# 未完籤所 × 綠界 ECPay 金流

這個版本已把目前的網站改成：
- 第一籤免費。
- 第二籤開始，每抽一次固定 NT$50。
- 已完全移除抖內／支持金額功能。
- 不論從結果頁、首頁或底部抽籤入口再次進入，若免費額度已使用且沒有付款額度，都會先進綠界付款。
- 使用綠界全方位金流 AioCheckOut V5。
- HashKey / HashIV 只放後端環境變數，不寫入前端。

## 1. 本機啟動
先安裝 Node.js 18+。

```bash
npm install
cp .env.example .env
npm start
```

開啟：
`http://localhost:3000`

## 2. 為什麼不能只用一個 HTML？
綠界建立訂單需要 CheckMacValue，而 HashKey / HashIV 是私密金鑰。
正式網站絕對不能把它們放在 HTML / JavaScript 前端。

## 3. 測試環境
`.env.example` 已放綠界官方公開的 Stage 測試 MerchantID / HashKey / HashIV。
只可用於 Stage，不能當正式商店金鑰。

## 4. 完整測試付款通知
ECPay 的 ReturnURL 是 server-to-server callback，因此需要「公開 HTTPS」網址。
本機 localhost 無法讓綠界伺服器回呼。

你可以將這個專案部署到 Render / Railway / Fly.io / VPS，
或開發期間用 Cloudflare Tunnel / ngrok 暫時取得 HTTPS URL，
再把 `.env` 的 `PUBLIC_BASE_URL` 改成該 HTTPS 網址。

## 5. 正式上線
申請綠界特店後，把 `.env` 改成：

```env
ECPAY_MODE=production
ECPAY_MERCHANT_ID=你的正式MerchantID
ECPAY_HASH_KEY=你的正式HashKey
ECPAY_HASH_IV=你的正式HashIV
PUBLIC_BASE_URL=https://你的正式網域
```

不要把 `.env` 上傳到公開 GitHub。

## 6. 正式營運前要補的東西
目前訂單存在 Node 記憶體 Map，伺服器重啟就會消失。
正式版請換成資料庫（PostgreSQL / Supabase / MySQL 等），
並以 ReturnURL 的付款成功狀態作為真正的權限判斷來源。

目前「付款成功後再抽」採單次瀏覽器流程示範，
正式版如果要防止重新整理／分享網址造成權限錯亂，
建議加入匿名 session token + 資料庫訂單綁定。


## 第一籤免費的判斷
目前沒有會員系統，因此 MVP 使用瀏覽器 `localStorage` 記錄「此裝置已使用第一籤免費」。
付款成功後使用 `sessionStorage` 發一個單次抽籤額度，真正選擇分類抽籤時才消耗。

這適合 MVP 驗證，但不是防作弊機制；使用者清除瀏覽器資料或換裝置後仍可再次取得免費籤。
正式版若要嚴格限制「每人只有第一籤免費」，需要匿名帳號、手機／Email 驗證或會員系統與資料庫。

## 籤詩資料架構（輕量版）

- 首頁不再內嵌 520 支籤詩；籤詩拆分為 `public/data/love.json`、`work.json`、`choice.json`、`life.json`、`pet.json`。
- 使用者選定分類並準備抽籤時，才載入該分類 JSON；「隨機一籤」才會載入全部分類。
- 大分類 → 細分類 → 默念題目 → 抽籤；抽籤會依細分類過濾，不會跨情境抽到其他分類內容。
- 毛孩「離別中」只使用已離世情境資料。
- 主要 PNG 已轉 WebP，降低首頁載入量。

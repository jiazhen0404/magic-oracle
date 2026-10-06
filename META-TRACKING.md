# 未完籤所 Meta Pixel 事件

Pixel ID：`1141537454976539`。全部程式集中在 `assets/meta-pixel.js`：
Base Code（init 一次＋PageView）、事件 helper、ClickLINE、SEO 主題頁 ViewContent、UTM 補存。
各頁只呼叫 `trackMetaEvent()`／`trackMetaCustomEvent()`，不直接碰 `fbq`。

除錯：網址帶 `?meta_debug=1` 進站，之後每個事件都會印在瀏覽器 Console（`?meta_debug=0` 關掉）。

## 事件一覽

| 事件 | 類型 | 位置 | 何時送 | 去重 |
|---|---|---|---|---|
| PageView | 標準 | 全站 `meta-pixel.js` | 每次載入頁面 | 已關閉 Meta 依網址變化自動補送（`disablePushState`） |
| ViewContent | 標準 | SEO 主題頁（`/love/…` 等）；首頁抽籤流程進到「選情境／想一件事」 | 進入某一類抽籤 | 同一頁面同一分類一次 |
| SelectDrawQuestion | 自訂 | 首頁「選擇情境」卡；SEO 頁帶 `?theme=&sub=` 進站 | 選定情境 | 1.5 秒內連點只算一次 |
| StartDraw | 自訂 | 首頁「我準備好了」；觀音籤「誠心求籤」 | 真正開始抽 | 1.5 秒內連點只算一次 |
| CompleteDraw | 自訂 | 籤文結果頁出現；觀音籤結果出現 | 免費籤文已顯示 | 以這次抽籤的 `fortune.id` 去重（sessionStorage） |
| ViewExtendedReading | 自訂 | 結果頁延伸解籤區塊（進入畫面一半以上、停 1 秒，且這支籤買得到）；`/extended/` 商品頁 | 看到 NT$99 商品 | 每個結果區塊一次；`/extended/` 每次載入一次 |
| AddToCart | 標準 | 結果頁「解鎖這支籤的完整解讀 NT$99」；`/extended/` 購買按鈕 | 點擊（下一步是 `/checkout/` 確認頁） | 2 秒內連點只算一次 |
| InitiateCheckout | 標準 | `/checkout/` 與 `oracle.html` | 後端建立訂單成功、即將跳綠界 | 訂單編號（sessionStorage）＋ eventID `ic_訂單編號` |
| Purchase | 標準 | `/checkout/done/`（延伸籤）、`/oracle/done`（真人占卜，`src/oracle.js` 的 PAGE_DONE） | 後端回 paid **且** countPurchase:true | 後端訂單旗標＋本機 localStorage＋ eventID `purchase_訂單編號` |
| ClickLINE | 自訂 | 全站任何 LINE 加好友連結 | 點擊 | 1.5 秒內同位置只算一次 |
| ViewConsultation | 自訂 | `oracle.html` | 打開真人占卜服務頁 | 每次載入一次 |

## 參數

- 延伸籤商品 ID 一律是籤的唯一編號，例如 `love_flirting_055`（跟 `/checkout/?id=` 同一組）。
- 真人占卜服務 ID：`oracle_reading`。
- InitiateCheckout／Purchase 的金額取自後端訂單（綠界 TotalAmount、訂單 amount），不是前端常數。
- 每個事件自動附上原始來源 `utm_*`（localStorage 的 `unfinished_utm`，30 天）。
- 只送白名單參數（見 `meta-pixel.js` 的 `ALLOWED`），姓名、Email、電話、問題內容一律不會送出。

## 改價時

`meta-pixel.js` 的 `PRODUCTS` 價格要跟 `src/index.js`、`src/oracle.js` 的 `PRICE` 一起改。
（只影響 ViewExtendedReading／AddToCart／ViewConsultation 的 value；付款相關事件本來就用後端金額。）

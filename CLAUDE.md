# 未完籤所 · MAGIC ORACLE

線上抽籤問事網站，已上線於 unfinished.tw。使用者帶著一個真實問題、選一個主題，
系統抽一支籤並附上解籤與建議。定位是「在說不清楚的時刻，陪你把問題想清楚」。

## 跟我溝通的方式

專案負責人是**平面設計師，不是工程背景**。說明時請用非工程人員也能懂的話，
避免術語堆疊。要動手前先說「你要改什麼、為什麼、會影響哪裡」，再開始。

改完之後，附上「怎麼確認有沒有壞掉」的具體步驟（開哪一頁、看哪裡）。

---

## 專案結構

| 路徑 | 內容 |
|---|---|
| `index.html` | **主檔**。單檔 React 18（UMD 由 cdnjs 載入），含 12 個 inline `<style>` 區塊 |
| `assets/site-header.css` / `.js` | 頂部導覽（`.ww-*`）與漢堡選單 |
| `assets/home-survey-card.css` | 「更多指引」輪播與卡片。**大量 `!important`**，改動前要確認最終生效的規則 |
| `assets/survey.css` / `.js` | 使用者問卷（四段式） |
| `assets/feedback.css` | 意見回饋頁 |
| `assets/ambiguity-articles.css` | 未完文章（編輯型頁面） |
| `src/index.js` | 後端，約 700 行，分七段，每段開頭有註解 |
| `src/pdf-template.js` | 延伸籤 PDF 樣板，**字型以 base64 內嵌（約 1MB）** |
| `src/extended-love.json` | 延伸籤付費內容 |

`index.html` 的 `<style>` 區塊中，`id="home-theme-muses-v1"` 是首頁主題卡樣式，
`id="rwd-background-fix"` 是背景的響應式修正。

---

## 絕對不要做的事

1. **不要把 inline `<style>` 抽成外部檔案**，不要合併、不要重排順序。
2. **不要把 `src/extended-love.json` 或任何延伸籤內容移到公開目錄。**
   它靠 `.assetsignore` 排除，移出去等於看原始碼就能免費讀完付費內容。
   延伸籤內容一律由後端在付款驗證後才回傳。
3. **不要改 `.home .line-band:not(.compact){display:none!important}`**
   （在 `assets/home-survey-card.css`）。這是刻意隱藏，不是 bug。
4. **不要改籤文內容**、解籤文字、`GUANYIN_TIPS`。籤文有獨立的撰寫規範。
5. **不要改視覺識別**：深靛藍底、金色 `#D9BD82`、Noto Serif TC + Cinzel、
   星空與光暈動畫，全部保留。
6. **不要縮短抽籤動畫**。等待是儀式的一部分，不是效能問題。
7. **不要為了「整理」而改動沒被要求改的選擇器。**

---

## 平台特性：三個踩過的坑

這三個各花掉不只一輪才找到，請務必記得。

### 1. Cloudflare 的一般變數會被建置洗掉

每次 GitHub 建置，Cloudflare 會用 `wrangler.jsonc` 重建「一般變數」清單，
檔案裡沒寫的就被清空。**Secret 不受影響，只有 Text 會被洗掉。**

| 要改什麼 | 去哪裡改 |
|---|---|
| `ECPAY_MODE`、`CF_ACCOUNT_ID` | **只改 `wrangler.jsonc`**，推 GitHub |
| 六把 Secret | Cloudflare 後台 |
| 程式碼 | GitHub |

**不要在 Cloudflare 後台碰一般變數**，那一區應該永遠是空的。

### 2. 新版本不會自動接管流量

已進入手動模式：**每次建置完都要去 Deployments 把最上面「有 main 標記」那筆推上線。**
判斷線上跑的是不是新版：打開 `/api/health`，看有沒有新欄位。

### 3. API 回應會被 Cloudflare 快取

`json()` 一律加 `cache-control: no-store`，前端 fetch 也要帶 `cache: 'no-store'`。
不加會導致付款完成頁一直卡在「正在確認付款」。

---

## 籤文資料規則

**籤號本身不唯一。** 唯一識別是 `分類_情境_籤號`，例如 `love_breakup_001`。
籤冊收藏、分享籤卡、付費解鎖紀錄都必須以此為準。

| 分類 | 支數 | 情境 |
|---|---|---|
| 愛情 | 170 | 失戀中35・曖昧中35・關係中35・單身中35・桃花運勢30 |
| 毛孩 | 140 | 陪伴中30・擔心中30・思念中30・離別中50 |
| 工作 | 125 | 迷惘中25・求職中25・轉職中25・職場中25・創業中25 |
| 人生 | 100 | 迷茫中25・家庭中25・夢想中25・日常中25 |
| 選擇 | 75 | 兩難中25・決定中25・方向中25 |

合計 610 支。**注意：首頁目前只有四張主題卡，「選擇」75 支沒有入口**，這是已知待處理項目。

一般版八大結局：順勢而成／好消息將近／緩慢轉好／平穩維持／等待期／先難後易／阻礙提醒／結束與轉向。

---

## 金流現況

| 服務 | 狀態 | 位置 |
|---|---|---|
| 延伸籤 NT$99 | **已上線**，綠界 production，信用卡 | 解籤結果頁 |
| 真人占卜 | **金流尚未串接**，價格與產能未定 | 首頁（暫時） |

延伸籤流程：抽籤 → 解籤結果頁 → `/checkout/?id=籤支編號` → 綠界 →
`/api/ecpay-callback` 驗章 → 產 PDF → Resend 寄信 → **立刻刪除信箱與問題**。

主要 API：`/api/health`、`/api/create-order`、`/api/ecpay-callback`、
`/api/order-status`、`/api/unlock`、`/api/extended`、`/api/resend-pdf`。

資料保存：訂單含個資存 KV 24 小時，寄出後立刻刪除信箱與問題；
解鎖憑證（無個資）存一年；解鎖狀態存使用者瀏覽器 localStorage。

---

## 其他既有資源

- 條款頁 `/privacy/` 已存在，三段式（服務條款／隱私權／退款）
- 客服信箱 `hello@unfinished.tw`
- GA4 已設定，追蹤 ID `G-71RMD00WPJ`
- 已設定 robots.txt、sitemap.xml、Open Graph／Twitter Card
- 手動補寄 PDF：`/api/resend-pdf`，需 `X-Admin-Key`

---

## 改動流程

1. **開新分支再動手**，不要直接在 `main` 上改
2. 一個主題一個 commit，訊息寫清楚改了什麼
3. 改 CSS 之後，在 **1440×900（桌機）與 390×844（手機）** 兩個尺寸都確認
4. 若某個選擇器在檔案中出現多次（響應式覆寫），**全部都要改**，並說明改了幾處
5. 動到金流或後端，先確認 `/api/health` 正常

---

## 已知待處理

首頁版面有一份完整的施工單（TASK-01～13 加兩項待決策），涵蓋字級、footer、
行長、導覽層級、首屏比例、桌機輪播、容器寬度等。若專案內有
`docs/codex-implementation-brief.md`，以那份為準。

兩項**需要負責人先決定、不要自行決定**的事項：

1. **分類命名不一致**：導覽「人生」／卡片「宇宙指引」／網址 `/life/`；
   導覽「寵物」／卡片「毛孩」。改網址會影響 SEO 與既有連結。
2. **首屏沒有標題級文字**：`.brand-cn`（72px）與 `.brand-en` 目前都是
   `display:none`，屬死碼。要復活還是改寫新文案，牽涉品牌決策。

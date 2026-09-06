# 文章後台 · 設定說明

後台在 `/admin/articles/`。編輯存在 Cloudflare D1，**發布時產生靜態 HTML 並 commit 進這個
repo**，Cloudflare 隨後自動部署。讀者拿到的仍然是靜態檔案，服務路徑完全不經過 Worker，
所以 SEO 與 AI 爬蟲的可讀性和現在的文章一模一樣。

設定分四步，都在你自己的帳號操作，我不經手任何金鑰。

---

## 1. 建立 D1 資料庫

```
npx wrangler d1 create unfinished-articles
```

指令會印出一段 `database_id`。把它貼進 `wrangler.jsonc` 裡這一行：

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "unfinished-articles", "database_id": "貼在這裡" }
]
```

## 2. 建表

```
npx wrangler d1 execute unfinished-articles --remote --file=src/articles.sql
```

## 3. 設定兩個 secret

**ADMIN_KEY** —— 後台登入用。如果 `/survey/admin/` 已經在用同一組，這步可以跳過。

```
npx wrangler secret put ADMIN_KEY
```

**GITHUB_TOKEN** —— 發布時用來 commit。

到 GitHub → Settings → Developer settings → Personal access tokens →
**Fine-grained tokens**，然後：

- Repository access：**只選 `jiazhen0404/magic-oracle` 這一個 repo**
- Permissions → Repository permissions → **Contents: Read and write**
- 其餘權限全部不要給
- 有效期限建議設 90 天，到期再換一次

```
npx wrangler secret put GITHUB_TOKEN
```

> **這組 token 有寫入 repo 的權限，絕對不要寫進 `wrangler.jsonc`。**
> 那個檔案在 GitHub 上是公開的，你自己在檔案裡也註記過這件事。
> 一定要用 `wrangler secret put`，它只存在 Cloudflare 那側。

## 4. 設定 repo 變數

`wrangler.jsonc` 的 `vars` 區塊加一行（這個不是密鑰，可以公開）：

```jsonc
"GITHUB_REPO": "jiazhen0404/magic-oracle"
```

然後 `npx wrangler deploy`。

---

## 怎麼用

1. 開 `/admin/articles/`，輸入 ADMIN_KEY
2. 按「＋ 新文章」，填 slug、SEO Title、H1、Meta Description，正文貼 markdown
3. 按「儲存草稿」→ 存進 D1，不會影響線上任何東西
4. 按「預覽」→ 開新分頁看實際渲染結果，同樣不寫任何地方
5. 按「發布並 commit」→ 產生 HTML、commit 進 repo、順便把網址加進 `sitemap.xml`

Cloudflare 部署通常 1–3 分鐘。

### 正文支援的語法

| 寫法 | 產出 |
|---|---|
| `## 標題` / `### 小標` | h2 / h3 |
| `- 項目` | 方框清單 |
| `1. 項目` | 方框編號清單 |
| `> 引言` | 引言區塊（回覆範本用這個） |
| `**粗體**` | strong |
| `[INTERNAL_LINK: 鍵]` | 查對應表；有目標就變連結，沒有就留待補標記 |
| `[CTA：免費抽籤]` | 免費抽籤區塊，自動帶入預選情境 |
| `[CTA：了解真人占卜]` | 真人占卜區塊，**不寫死價格** |

CTA 的文案取自標記上方那一段文字。

### 內鏈對應表

左欄是正文裡寫的鍵，右欄填目標 slug。目標還沒寫就留空 —— 頁面會保留
`[INTERNAL_LINK: 鍵]` 待補標記。之後補上 slug 再重新發布相關文章，連結就接起來了。

---

## 設計上的取捨

**為什麼不讓 Worker 直接從資料庫渲染頁面？**

那樣每個請求都要執行 Worker、多一段 D1 查詢延遲、要自己做快取，而且渲染一旦出錯就是整頁
SEO 消失。目前 81 個內容頁都是靜態檔案，在 Cloudflare 邊緣直接快取、零查詢延遲、在 git
裡有完整版本歷史。資料庫的價值在於「不碰 git 也能發文」，不在於服務讀者。

**發布失敗會怎樣？**

D1 的草稿還在，線上檔案不會被動到，後台會顯示 GitHub 回傳的錯誤。最常見的原因是 token
過期或權限不足。

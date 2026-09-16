-- 未完籤所｜LINE 今日訊息籤 D1 schema（migration）
-- 建在既有的 D1 資料庫 unfinished-articles（binding: DB），不另開資料庫。
--
-- 執行（重複執行安全）：
--   npx wrangler d1 execute unfinished-articles --remote --file=src/line-daily.sql
--   npx wrangler d1 execute unfinished-articles --remote --file=src/line-daily-seed.sql

-- ── 籤池 ─────────────────────────────────────────────
-- fortune_id 是對外編號（001、002⋯），之後加到 150、200 支照樣往下編。
-- 不想再讓人抽到：is_active = 0。不要刪除，歷史紀錄還要讀得到。
CREATE TABLE IF NOT EXISTS line_daily_fortunes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  fortune_id  TEXT    NOT NULL UNIQUE,
  title       TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  reminder    TEXT    NOT NULL,
  category    TEXT    NOT NULL,              -- 只給後台看，不顯示給使用者
  weight      REAL    NOT NULL DEFAULT 1.0,  -- 1.0 一般／0.7 較特殊／0.4 稀有
  is_active   INTEGER NOT NULL DEFAULT 1,    -- 1 啟用／0 停用
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ldf_active   ON line_daily_fortunes(is_active);
CREATE INDEX IF NOT EXISTS idx_ldf_category ON line_daily_fortunes(category);

-- ── 正式抽籤紀錄 ─────────────────────────────────────
-- draw_date 是「台灣日期」（Asia/Taipei），例：2026-09-16。
-- UNIQUE(line_user_id, draw_date) 是「一人一天一支」的最後防線：
-- 就算使用者連點兩下、兩個請求同時進來，資料庫也只會收下一筆。
CREATE TABLE IF NOT EXISTS line_daily_draws (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id  TEXT    NOT NULL,
  fortune_id    TEXT    NOT NULL,
  draw_date     TEXT    NOT NULL,
  drawn_at      TEXT    NOT NULL DEFAULT (datetime('now')),   -- UTC 時間戳
  UNIQUE (line_user_id, draw_date)
);
CREATE INDEX IF NOT EXISTS idx_ldd_date    ON line_daily_draws(draw_date);
CREATE INDEX IF NOT EXISTS idx_ldd_fortune ON line_daily_draws(fortune_id, draw_date);

-- ── 行為紀錄（統計用）──────────────────────────────────
-- event：draw_start（按下接收）／repeat_view（當天再看一次）／to_site（按「我有一件事想問」）
-- repeat_view 不寫進 line_daily_draws，所以不會被算成新的抽籤。
CREATE TABLE IF NOT EXISTS line_daily_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id  TEXT    NOT NULL,
  event         TEXT    NOT NULL,
  draw_id       INTEGER,
  fortune_id    TEXT,
  event_date    TEXT    NOT NULL,            -- 台灣日期
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lde_event_date ON line_daily_events(event, event_date);
CREATE INDEX IF NOT EXISTS idx_lde_fortune    ON line_daily_events(event, fortune_id);

-- ── 訂單來源（全站共用）────────────────────────────────
-- 訂單本身在 KV 只留 24 小時，而且寄出後會刪個資；
-- 這張表只記「這筆錢從哪裡來」，沒有信箱、沒有問題內容，可以長期保存。
-- 建單時寫入 pending，綠界通知付款成功後改成 paid。
CREATE TABLE IF NOT EXISTS order_attribution (
  trade_no      TEXT PRIMARY KEY,           -- 綠界 MerchantTradeNo
  product       TEXT NOT NULL,              -- extended（99 元延伸籤）／oracle（真人占卜）
  amount        INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending／paid／failed
  source        TEXT NOT NULL DEFAULT '',
  medium        TEXT NOT NULL DEFAULT '',
  campaign      TEXT NOT NULL DEFAULT '',
  content       TEXT NOT NULL DEFAULT '',
  term          TEXT NOT NULL DEFAULT '',
  landed_at     TEXT NOT NULL DEFAULT '',   -- 使用者帶著 UTM 進站的時間
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_oa_src ON order_attribution(source, medium, campaign, status);

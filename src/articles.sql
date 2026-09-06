-- 未完籤所｜文章後台 D1 schema
-- 建立方式見 README-articles-admin.md

CREATE TABLE IF NOT EXISTS articles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT    NOT NULL UNIQUE,   -- 例：love/breakup/how-to-get-over-a-breakup
  status       TEXT    NOT NULL DEFAULT 'draft',  -- draft | published
  title        TEXT    NOT NULL,          -- SEO Title（<title>）
  h1           TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  keyword      TEXT    NOT NULL DEFAULT '',
  crumb        TEXT    NOT NULL DEFAULT '', -- 麵包屑最後一層，空白則自動由 h1 推導
  eyebrow      TEXT    NOT NULL DEFAULT '失戀／分手',
  draw_sub     TEXT    NOT NULL DEFAULT '失戀中', -- 免費抽籤 CTA 要預選的情境
  body_md      TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);

-- 內鏈標記對應表：body_md 裡的 [INTERNAL_LINK: key] 會查這裡
-- target_slug 為 NULL 代表目標文章還沒寫，產生 HTML 時保留待補標記
CREATE TABLE IF NOT EXISTS link_targets (
  key          TEXT PRIMARY KEY,
  target_slug  TEXT,
  title        TEXT NOT NULL DEFAULT ''
);

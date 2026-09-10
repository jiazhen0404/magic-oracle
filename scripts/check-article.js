/* =========================================================================
   未完籤所 · 文章上稿檢查（工具一）
   -------------------------------------------------------------------------
   施工單第 430 節。檢查 articles/ 底下的頁面有沒有踩到上稿規格。

   最重要的是 H1 數量：docx 每份都有 11–14 個 H1，直接轉檔就是 11 個 H1
   的頁面——這是本批最容易出錯、也最傷 SEO 的一項。

   用法：
     node scripts/check-article.js                     檢查全部文章
     node scripts/check-article.js <路徑> [<路徑>…]    只檢查指定的
   全綠回傳 0，有 FAIL 回傳 1。
   ========================================================================= */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://unfinished.tw';

/* ---------- 小工具 ---------- */

const strip = h => h.replace(/<script[\s\S]*?<\/script>/g, '')
                    .replace(/<style[\s\S]*?<\/style>/g, '')
                    .replace(/<[^>]*>/g, ' ');

/* 全形字數：半形算 0.5，中文與全形標點算 1。title / description 的字數規則用這個。 */
function widthOf(s) {
  let n = 0;
  for (const ch of s) n += /[\x00-\x7F]/.test(ch) ? 0.5 : 1;
  return Math.round(n * 10) / 10;
}

const attr = (h, re) => { const m = h.match(re); return m ? m[1] : null; };
const metaName = (h, n) =>
  attr(h, new RegExp('<meta[^>]*name="' + n + '"[^>]*content="([^"]*)"')) ||
  attr(h, new RegExp('<meta[^>]*content="([^"]*)"[^>]*name="' + n + '"'));
const metaProp = (h, p) =>
  attr(h, new RegExp('<meta[^>]*property="' + p + '"[^>]*content="([^"]*)"')) ||
  attr(h, new RegExp('<meta[^>]*content="([^"]*)"[^>]*property="' + p + '"'));

/* 站內連結 → 檔案路徑 */
function resolveLink(href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean.startsWith('/')) return null;
  const p = path.join(ROOT, clean);
  return clean.endsWith('/') ? path.join(p, 'index.html') : p;
}

/* 全站 slug 表，供唯一性檢查 */
function allArticles() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'index.html') out.push(p);
    }
  })(path.join(ROOT, 'articles'));
  return out;
}

/* ---------- 檢查本體 ---------- */

const FORBID_EDITORIAL = ['SEO 建議設定', 'SEO 上稿設定', 'SEO建議設定', 'SEO上稿設定',
                          '編輯備註', '主要關鍵字', '次要關鍵字', '搜尋意圖'];
const FORBID_BRAND = ['解鎖', '完整版', '付費內容'];

function check(file, slugSeen) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const html = fs.readFileSync(file, 'utf8');
  const text = strip(html);
  const res = [];
  const F = (name, msg) => res.push({ lv: 'FAIL', name, msg });
  const W = (name, msg) => res.push({ lv: 'WARN', name, msg });

  /* 是文章還是分類頁：照 2-1 的目錄規格用層數判斷，不要猜 HTML 結構。
     articles/<分類>/<子分類>/<slug>/index.html → 5 段 = 文章
     articles/<分類>/<子分類>/index.html        → 4 段 = 分類頁 */
  const isArticle = rel.split('/').length >= 5;

  /* 1 H1 數量 ── 本批最高風險項 */
  const h1 = html.match(/<h1[\s>]/g) || [];
  if (h1.length !== 1) F('h1 數量', '有 ' + h1.length + ' 個 <h1>，必須剛好 1 個');

  /* 2 標題階層不跳級 */
  const levels = (html.match(/<h([1-6])[\s>]/g) || []).map(t => +t.match(/h([1-6])/)[1]);
  let prev = 0, jump = null;
  for (const l of levels) { if (prev && l > prev + 1) { jump = prev + '→' + l; break; } prev = l; }
  if (jump) F('標題階層', '跳級 ' + jump + '（h2 之下才可以有 h3）');

  /* 3 title */
  const title = attr(html, /<title>([^<]*)<\/title>/);
  if (!title) F('title', '沒有 <title>');
  else {
    const w = widthOf(title);
    if (w > 30) F('title 長度', w + ' 全形字，超過 30');
    if (!/｜未完籤所\s*$/.test(title)) W('title 結尾', '不是以「｜未完籤所」結尾');
  }

  /* 4 description */
  const desc = metaName(html, 'description');
  if (!desc) F('description', '沒有 meta description');
  else {
    const w = widthOf(desc);
    if (w < 70 || w > 80) W('description 長度', w + ' 全形字，規格是 70–80');
  }

  /* 5 canonical */
  const canon = attr(html, /<link[^>]*rel="canonical"[^>]*href="([^"]*)"/);
  if (!canon) F('canonical', '沒有 canonical');
  else {
    if (!canon.startsWith('http')) F('canonical', '不是絕對網址：' + canon);
    if (!canon.endsWith('/')) F('canonical', '沒有結尾斜線：' + canon);
    const want = SITE + '/' + rel.replace(/index\.html$/, '');
    if (canon !== want) F('canonical', '與檔案路徑不符\n        實際 ' + canon + '\n        應為 ' + want);
  }

  /* 6 og 與 twitter */
  for (const p of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type']) {
    if (!metaProp(html, p)) (isArticle ? F : W)('og', '缺少 ' + p);
  }
  if (metaProp(html, 'og:url') && canon && metaProp(html, 'og:url') !== canon)
    W('og:url', '與 canonical 不一致');
  if (!metaName(html, 'twitter:card')) W('twitter', '缺少 twitter:card');

  /* 7 JSON-LD */
  const lds = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  if (!lds.length) (isArticle ? F : W)('JSON-LD', isArticle ? '文章頁沒有任何 JSON-LD' : '分類頁沒有 JSON-LD');
  let crumbLd = null;
  lds.forEach((m, i) => {
    let o;
    try { o = JSON.parse(m[1]); }
    catch (e) { F('JSON-LD', '第 ' + (i + 1) + ' 塊無法 JSON.parse：' + e.message); return; }
    const nodes = Array.isArray(o) ? o : (o['@graph'] || [o]);
    for (const n of nodes) if (n['@type'] === 'BreadcrumbList') crumbLd = n;
  });

  /* 麵包屑：JSON-LD 的項數要對得上畫面上「有連結的」那幾層 */
  const crumbHtml = attr(html, /<(?:div|nav)[^>]*class="crumb"[^>]*>([\s\S]*?)<\/(?:div|nav)>/);
  if (crumbHtml && crumbLd) {
    const links = (crumbHtml.match(/<a\b/g) || []).length;
    const n = (crumbLd.itemListElement || []).length;
    if (n !== links)
      W('麵包屑', 'JSON-LD ' + n + ' 項、畫面連結 ' + links + ' 條，數量不一致');
    for (const it of crumbLd.itemListElement || []) {
      const u = typeof it.item === 'string' ? it.item : (it.item && it.item['@id']);
      if (!u) continue;
      const f = resolveLink(u.replace(SITE, ''));
      if (f && !fs.existsSync(f)) F('麵包屑', 'JSON-LD 指向不存在的頁面：' + u);
    }
  }
  /* 麵包屑不該混入「真人占卜」（施工單 4-3 bug 2） */
  if (crumbHtml && /真人占卜/.test(crumbHtml)) F('麵包屑', '混入了「真人占卜」連結');

  /* 8 防呆：工作指示不可上稿 */
  for (const k of FORBID_EDITORIAL) if (text.includes(k)) F('內容防呆', '出現工作指示字串「' + k + '」');
  /* 禁用詞是為了擋付費牆用語，但同樣的字也可能是比喻
     （實例：「關係不是倒數完成就會解鎖的程序」）。印出前後文讓人判斷，不直接判失敗。 */
  for (const k of FORBID_BRAND) {
    const i = text.indexOf(k);
    if (i < 0) continue;
    W('品牌用語', '出現「' + k + '」，確認不是付費牆語氣：…'
      + text.slice(Math.max(0, i - 22), i + 22).replace(/\s+/g, '') + '…');
  }

  /* 9 半形標點 */
  const half = [...text.matchAll(/[一-鿿][,?!]/g)].map(m => m[0]);
  if (half.length) W('標點', '中文後面接半形標點 ' + half.length + ' 處：' + [...new Set(half)].slice(0, 5).join(' '));

  /* 10 站內連結 404 */
  const bad = [];
  for (const m of html.matchAll(/href="(\/[^"#][^"]*)"/g)) {
    const f = resolveLink(m[1]);
    if (f && !fs.existsSync(f) && !bad.includes(m[1])) bad.push(m[1]);
  }
  if (bad.length) F('連結 404', bad.join('　'));

  /* 11 slug 唯一 */
  const slug = rel.replace(/\/index\.html$/, '').split('/').pop();
  if (slugSeen.has(slug)) F('slug', '與 ' + slugSeen.get(slug) + ' 重複');
  else slugSeen.set(slug, rel);

  /* 12 文章頁的額外要求 */
  if (isArticle && h1.length === 1) {
    const inline = [...html.matchAll(/<a[^>]*href="(\/articles\/[^"]*)"/g)]
      .filter(m => !/class="ww-|class="site-footer|class="crumb/.test(html.slice(Math.max(0, html.indexOf(m[0]) - 200), html.indexOf(m[0]))));
    if (new Set(inline.map(m => m[1])).size < 2)
      W('內部連結', '指向其他文章的連結少於 2 條');
    if (/breakup/.test(rel) && !/(心理師|身心科|專業協助|諮商)/.test(text))
      F('專業協助', '分手類文章缺少專業協助提示');
    const cta = [...html.matchAll(/href="([^"]*theme=[^"]*)"/g)].map(m => m[1]);
    if (cta.length && !cta.every(u => /utm_source=article/.test(u)))
      W('CTA UTM', '抽籤 CTA 沒有帶 utm_source=article');
  }

  return { rel, res, isArticle };
}

/* ---------- 執行 ---------- */

const args = process.argv.slice(2);
const files = args.length ? args.map(a => path.resolve(ROOT, a)) : allArticles();
const slugSeen = new Map();
let fails = 0, warns = 0;

for (const f of files) {
  if (!fs.existsSync(f)) { console.log('✗ 找不到 ' + f); fails++; continue; }
  const { rel, res, isArticle } = check(f, slugSeen);
  const bad = res.filter(r => r.lv === 'FAIL'), warn = res.filter(r => r.lv === 'WARN');
  fails += bad.length; warns += warn.length;
  const mark = bad.length ? '✗' : (warn.length ? '△' : '✓');
  console.log(mark + ' ' + rel + (isArticle ? '' : '　(分類頁)'));
  for (const r of bad)  console.log('    FAIL  ' + r.name + '　' + r.msg);
  for (const r of warn) console.log('    warn  ' + r.name + '　' + r.msg);
}

console.log('\n檢查 ' + files.length + ' 頁：' + (fails ? fails + ' 項 FAIL' : '無 FAIL') + '、' + warns + ' 項 warn');
process.exit(fails ? 1 : 0);

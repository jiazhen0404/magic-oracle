// 未完籤所｜文章後台
// D1 存稿 → 產生靜態 HTML → 以 GitHub Contents API commit 進 repo → Cloudflare 自動部署。
// 讀者拿到的仍是靜態檔案，服務路徑完全不經過這支程式。

const OK = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

function authed(request, env) {
  return Boolean(env.ADMIN_KEY) && request.headers.get('X-Admin-Key') === env.ADMIN_KEY;
}

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => esc(s).replace(/"/g, '&quot;');

// ── markdown → HTML ────────────────────────────────────────────────
// 只支援文章實際用到的語法：h2/h3、段落、有序與無序清單、引言、粗體、
// [INTERNAL_LINK: key] 內鏈標記、[CTA：免費抽籤] 與 [CTA：了解真人占卜]。
export function mdToHtml(md, links, drawSub) {
  const drawHref = '/?theme=love&sub=' + encodeURIComponent(drawSub || '失戀中') + '#start';
  const ctaDraw = copy =>
    `<div class="ctabox">\n<p>${copy}</p>\n<a class="cta" href="${drawHref}">帶著現在的狀況抽一支籤</a>\n` +
    `<div class="note">免費 · 不用登入 · 已替你選好「${esc(drawSub || '失戀中')}」情境</div>\n</div>`;
  const ctaOracle = copy =>
    `<div class="ctabox">\n<p>${copy}</p>\n<a class="cta" href="/oracle.html">看看真人占卜</a>\n` +
    `<div class="note">由合作占卜師閱讀你的問題與背景後親自占卜與解讀，不是 AI 自動生成 · ` +
    `以一個具體問題為單位 · 約 24–48 小時完成 · 費用以服務頁面顯示為準</div>\n</div>`;

  const inline = t => {
    let s = esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 〈標題〉。[INTERNAL_LINK: key] → 真連結，或保留待補標記（用哨符避免二次比對）
    s = s.replace(/〈(.+?)〉([。，、]?)\s*\[INTERNAL_LINK:\s*([^\]]+)\]/g, (m, title, p, key) => {
      const t2 = links[key.trim()];
      return t2 ? `<a href="/${t2}/">〈${title}〉</a>${p}` : `〈${title}〉${p}${key.trim()}`;
    });
    s = s.replace(/\[INTERNAL_LINK:\s*([^\]]+)\]/g, (m, key) => {
      const t2 = links[key.trim()];
      return t2 ? `<a href="/${t2}/">${key.trim()}</a>` : `${key.trim()}`;
    });
    return s.replace(/([^]+)/g,
      (m, k) => `<span class="todo">[INTERNAL_LINK: ${k}]</span>`);
  };

  const out = []; let buf = [], ul = [], ol = [], q = [];
  const flushP = () => { if (buf.length) { out.push(`<p>${inline(buf.join(' ').trim())}</p>`); buf = []; } };
  const flushUl = () => { if (ul.length) { out.push(`<div class="box"><ul>${ul.map(x => `<li>${inline(x)}</li>`).join('')}</ul></div>`); ul = []; } };
  const flushOl = () => { if (ol.length) { out.push(`<div class="box"><ol>${ol.map(x => `<li>${inline(x)}</li>`).join('')}</ol></div>`); ol = []; } };
  const flushQ = () => { if (q.length) { out.push(`<blockquote class="pull">${inline(q.join('\n')).replace(/\n/g, '<br>')}</blockquote>`); q = []; } };
  const flushAll = () => { flushP(); flushUl(); flushOl(); flushQ(); };

  for (const raw of String(md || '').split('\n')) {
    const s = raw.replace(/\s+$/, '');
    if (!s.trim()) { flushAll(); continue; }
    if (s.startsWith('### ')) { flushAll(); out.push(`<h3>${inline(s.slice(4).trim())}</h3>`); continue; }
    if (s.startsWith('## ')) { flushAll(); out.push(`<h2>${inline(s.slice(3).trim())}</h2>`); continue; }
    if (s.startsWith('> ')) { flushP(); flushUl(); flushOl(); q.push(s.slice(2).trim()); continue; }
    const m = s.trim().match(/^\d+\.\s+(.*)$/);
    if (m) { flushP(); flushUl(); flushQ(); ol.push(m[1]); continue; }
    if (s.trim().startsWith('- ')) { flushP(); flushOl(); flushQ(); ul.push(s.trim().slice(2)); continue; }
    if (s.trim().startsWith('[CTA：')) {
      flushAll();
      let copy = '';
      for (let j = out.length - 1; j >= 0; j--) {
        if (out[j].startsWith('<p>')) { copy = out[j].replace(/^<p>|<\/p>$/g, ''); out.splice(j, 1); break; }
      }
      out.push(s.includes('免費抽籤') ? ctaDraw(copy) : ctaOracle(copy));
      continue;
    }
    buf.push(s.trim());
  }
  flushAll();
  return out.join('\n\n');
}

// ── 完整頁面 ───────────────────────────────────────────────────────
const STYLE = `:root{--gold:#d9bd82;--soft:#d7cfe2;--faint:#a89ab8;--line:rgba(217,189,130,.28);--pink:#e6b6dc}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% 8%,#351a50 0,#160d2c 43%,#0c0818 100%);color:#f3edf7;font-family:"Noto Serif TC","Microsoft JhengHei",serif;line-height:1.9}a{color:inherit}.wrap{max-width:880px;margin:auto;padding:54px 22px 80px}.brand{text-align:center;color:var(--gold);letter-spacing:.24em;font-size:15px}.hero{text-align:center;padding:42px 22px 46px;border:1px solid var(--line);border-radius:26px;background:linear-gradient(180deg,rgba(58,34,88,.76),rgba(24,16,47,.8));box-shadow:0 25px 80px rgba(0,0,0,.32)}.eyebrow{color:var(--pink);font-size:14px;letter-spacing:.12em}h1{font-size:clamp(27px,5.4vw,42px);line-height:1.5;margin:12px 0;color:#f2e6c8;font-weight:600}h2{color:var(--gold);font-size:22px;margin:46px 0 12px}h3{color:#f1e5c8;font-size:17px;font-weight:600;margin:28px 0 8px}p{color:var(--soft);font-size:16px}.cta{display:inline-block;margin-top:26px;padding:13px 30px;border-radius:999px;text-decoration:none;background:linear-gradient(180deg,#8168ad,#50387d);border:1px solid rgba(217,189,130,.62);box-shadow:0 0 26px rgba(145,94,185,.38)}.note{font-size:13px;color:var(--faint);margin-top:12px}.box{border:1px solid var(--line);border-radius:16px;padding:17px 20px;margin:20px 0;background:rgba(40,25,66,.55);color:var(--soft)}.box li{margin:7px 0}.box ol{margin:0;padding-left:1.35em}.box ol li{margin:9px 0}.box ul{margin:0;padding-left:1.2em}blockquote.pull{margin:22px 0;padding:16px 20px;border-left:2px solid var(--line);background:rgba(40,25,66,.4);border-radius:0 12px 12px 0;color:#e9dff0;font-size:15.5px}.quote{font-size:20px;color:#f1e5c8;text-align:center;padding:24px;margin:30px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.crumb{font-size:13px;color:var(--faint);margin-bottom:18px}.crumb a{color:var(--faint)}footer{text-align:center;color:var(--faint);font-size:12px;margin-top:56px}.warn{font-size:13px;color:#bdb0c8;border:1px solid var(--line);padding:14px 16px;border-radius:12px;margin-top:30px}.tblwrap{overflow-x:auto;margin:20px 0}table{border-collapse:collapse;width:100%;min-width:420px;font-size:15px}th,td{text-align:left;padding:11px 13px;border-bottom:1px solid var(--line);color:var(--soft);vertical-align:top}th{color:#f1e5c8;font-weight:600;white-space:nowrap}.ctabox{border:1px solid var(--line);border-radius:18px;padding:24px 22px;margin:34px 0;background:rgba(40,25,66,.55);text-align:center}.ctabox .cta{margin-top:18px}.ctabox p{margin:0;color:var(--soft)}.todo{color:var(--faint);font-style:normal;border-bottom:1px dotted var(--faint)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:20px}.card{display:block;text-decoration:none;border:1px solid var(--line);border-radius:16px;padding:19px;background:rgba(35,24,62,.62)}.card b{color:#f1e5c8;font-size:16px}.card span{display:block;color:var(--faint);font-size:13px;margin-top:5px}@media(max-width:650px){.wrap{padding-top:28px}.hero{padding:31px 16px}p{font-size:15px}h2{font-size:20px}.grid{grid-template-columns:1fr}}`;

const SITE_FOOTER = `<style id="site-footer-v1">
.site-footer{position:relative;z-index:3;background:linear-gradient(180deg,rgba(9,6,20,0),rgba(9,6,20,.72) 16%,rgba(9,6,20,.86));border-top:1px solid rgba(217,189,130,.32);color:#9d91aa;font-size:13px;padding:44px 20px 40px;text-align:center;width:100%;box-sizing:border-box}
.site-footer-inner{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:30px 24px;width:min(100%,1000px);margin:0 auto;text-align:left}
.site-footer-col{display:flex;flex-direction:column;gap:11px;min-width:0}
.site-footer-h{color:#d9bd82;font-size:13px;letter-spacing:.14em;margin-bottom:3px}
.site-footer a{color:#9d91aa;text-decoration:none;font-size:13px;line-height:1.4}
.site-footer a:hover{color:#d9bd82}
.site-footer p{margin:34px 0 0;font-size:13px}
@media(max-width:760px){
.site-footer{padding:36px 22px}
.site-footer-inner{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 18px}
.site-footer-col{gap:2px}
.site-footer-col a{padding:7px 0}
.site-footer-h{margin-bottom:0}
}
</style>
<footer class="site-footer"><nav class="site-footer-inner" aria-label="網站地圖"><div class="site-footer-col"><span class="site-footer-h">抽籤主題</span><a href="/love/">愛情</a><a href="/work/">工作</a><a href="/life/">人生</a><a href="/pet/">毛孩</a><a href="/choice/">選擇</a></div><div class="site-footer-col"><span class="site-footer-h">更多內容</span><a href="/monthly/">本月主題籤</a><a href="/articles/">未完文章</a><a href="/extended/">延伸解籤</a></div><div class="site-footer-col"><span class="site-footer-h">服務</span><a href="/oracle.html">真人占卜</a><a href="/feedback/">意見回饋</a><a href="/survey/">使用者問卷</a></div><div class="site-footer-col"><span class="site-footer-h">條款</span><a href="/privacy/#terms">服務條款</a><a href="/privacy/#privacy">隱私權</a><a href="/privacy/#refund">退款說明</a></div><div class="site-footer-col"><span class="site-footer-h">聯絡與追蹤</span><a href="https://line.me/R/ti/p/@017vwhwj?utm_source=web&amp;utm_medium=footer&amp;utm_campaign=line_add">LINE 官方帳號</a><a href="https://www.threads.com/@eating_for_justice" target="_blank" rel="noopener">Threads</a><a href="mailto:hello@unfinished.tw">客服信箱</a></div></nav><p>© 2026 未完籤所 MAGIC ORACLE</p></footer>`;

const GA = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-71RMD00WPJ"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-71RMD00WPJ');</script>`;

const UTM = `<script>
(function(){
  var KEYS=['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
  var params=new URLSearchParams(window.location.search);
  var found={};var hasUtm=false;
  KEYS.forEach(function(k){var v=params.get(k);if(v){found[k]=v;hasUtm=true;}});
  try{
    if(hasUtm){found.saved_at=Date.now();localStorage.setItem('unfinished_utm',JSON.stringify(found));}
    var saved=JSON.parse(localStorage.getItem('unfinished_utm')||'{}');
    if(saved.saved_at && Date.now()-saved.saved_at>30*24*60*60*1000){localStorage.removeItem('unfinished_utm');saved={};}
    window.UNFINISHED_UTM=saved;
  }catch(e){window.UNFINISHED_UTM={};}
})();
</script>`;

// 同叢集其他文章的卡片列
function clusterGrid(current, siblings) {
  const cards = siblings.filter(s => s.slug !== current).map(s =>
    `<a class="card" href="/${s.slug}/"><b>${esc(s.crumb || s.h1)}</b><span>${esc(s.sub || '')}</span></a>`).join('');
  return cards ? `<h2>你可能也想看</h2><div class="grid">${cards}</div>` : '';
}

export function renderPage(a, links, siblings) {
  const LABEL = { articles: '文章分類', love: '愛情', work: '工作', life: '人生', pet: '毛孩',
                  breakup: '分手', unrequited: '單戀', relationship: '戀愛關係', marriage: '婚姻' };
  const url = `https://unfinished.tw/${a.slug}/`;
  const crumbLast = a.crumb || (a.h1.includes('？') ? a.h1.split('？')[0] + '？' : a.h1);
  // slug 逐段組出麵包屑，標籤查表，查不到就用該段的原文
  const parts = a.slug.split('/').slice(0, -1);   // 去掉文章自身那一段
  const crumbs = [`<a href="/">首頁</a>`];
  let acc = '';
  for (const seg of parts) {
    acc += '/' + seg;
    crumbs.push(`<a href="${acc}/">${esc(LABEL[seg] || seg)}</a>`);
  }
  crumbs.push(esc(crumbLast));

  const ld = [
    { '@context': 'https://schema.org', '@type': 'Article', headline: a.h1, description: a.description,
      datePublished: (a.created_at || '').slice(0, 10), inLanguage: 'zh-Hant',
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      publisher: { '@type': 'Organization', name: '未完籤所', url: 'https://unfinished.tw/' } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [{ '@type': 'ListItem', position: 1, name: '首頁', item: 'https://unfinished.tw/' }]
        .concat(a.slug.split('/').slice(0, -1).map((seg, i, arr) => ({
          '@type': 'ListItem', position: i + 2, name: LABEL[seg] || seg,
          item: 'https://unfinished.tw/' + arr.slice(0, i + 1).join('/') + '/' })))
        .concat([{ '@type': 'ListItem', position: a.slug.split('/').length + 1, name: crumbLast, item: url }]) }];

  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escAttr(a.title)}</title>` +
    `<meta name="description" content="${escAttr(a.description)}">` +
    `<link rel="canonical" href="${url}">` +
    `<meta property="og:type" content="article"><meta property="og:site_name" content="未完籤所 · MAGIC ORACLE">` +
    `<meta property="og:title" content="${escAttr(a.h1)}">` +
    `<meta property="og:description" content="${escAttr(a.description)}">` +
    `<meta property="og:url" content="${url}">` +
    `<meta property="og:image" content="https://unfinished.tw/assets/og-cover.jpg">` +
    `<meta name="twitter:card" content="summary_large_image">` +
    GA + UTM +
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>` +
    `<style>\n${STYLE}\n</style></head><body><div class="wrap">` +
    `<div class="crumb">${crumbs.join(' / ')}</div>\n\n` +
    `<section class="hero"><div class="brand">未 完 籤 所 · MAGIC ORACLE</div>` +
    `<div class="eyebrow">✦ ${esc(a.eyebrow || '失戀／分手')} ✦</div><h1>${esc(a.h1)}</h1></section>\n\n` +
    mdToHtml(a.body_md, links, a.draw_sub) + '\n\n' +
    clusterGrid(a.slug, siblings) +
    `<footer>✦ 未完籤所 · MAGIC ORACLE ✦<br><a href="/love/breakup/">失戀／分手</a> · <a href="/">unfinished.tw</a></footer></div>\n` +
    SITE_FOOTER + `\n</body></html>\n`;
}

// ── GitHub Contents API ────────────────────────────────────────────
async function ghPut(env, path, content, message) {
  const repo = env.GITHUB_REPO;
  if (!env.GITHUB_TOKEN || !repo) throw new Error('github_not_configured');
  const api = `https://api.github.com/repos/${repo}/contents/${path}`;
  const headers = {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'unfinished-article-admin',
    'content-type': 'application/json',
  };
  // 取現有檔案的 sha（更新時必要；不存在則是新增）
  let sha;
  const head = await fetch(api, { headers });
  if (head.status === 200) sha = (await head.json()).sha;
  else if (head.status !== 404) throw new Error(`github_read_failed_${head.status}`);

  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(content)));
  const res = await fetch(api, {
    method: 'PUT', headers,
    body: JSON.stringify({ message, content: b64, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) throw new Error(`github_write_failed_${res.status}_${(await res.text()).slice(0, 160)}`);
  return (await res.json()).commit?.sha;
}

async function ghGet(env, path) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`, {
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github.raw',
               'user-agent': 'unfinished-article-admin' } });
  if (!res.ok) throw new Error(`github_read_failed_${res.status}`);
  return await res.text();
}

function sitemapWith(xml, slug) {
  const loc = `https://unfinished.tw/${slug}/`;
  if (xml.includes(loc)) return null;                       // 已收錄，不必重寫
  const entry = `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>\n  </url>\n`;
  return xml.replace(/<\/urlset>/, entry + '</urlset>');
}

// ── 資料存取 ───────────────────────────────────────────────────────
async function loadLinks(env) {
  const { results } = await env.DB.prepare('SELECT key, target_slug FROM link_targets').all();
  const map = {};
  for (const r of results || []) if (r.target_slug) map[r.key] = r.target_slug;
  return map;
}

async function loadSiblings(env, slug) {
  const dir = slug.split('/').slice(0, -1).join('/');
  const { results } = await env.DB
    .prepare(`SELECT slug, h1, crumb, keyword FROM articles WHERE status='published' AND slug LIKE ?1`)
    .bind(dir + '/%').all();
  return (results || []).map(r => ({ slug: r.slug, h1: r.h1, crumb: r.crumb, sub: r.keyword }));
}

const FIELDS = ['slug', 'status', 'title', 'h1', 'description', 'keyword', 'crumb', 'eyebrow', 'draw_sub', 'body_md'];

// ── 路由 ───────────────────────────────────────────────────────────
export async function articleRoutes(request, env, url) {
  const p = url.pathname;
  if (!p.startsWith('/api/articles')) return null;
  if (!authed(request, env)) return OK({ error: 'unauthorized' }, 401);
  if (!env.DB) return OK({ error: 'd1_not_configured' }, 503);

  // GET /api/articles — 列表
  if (p === '/api/articles' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id,slug,status,title,h1,updated_at FROM articles ORDER BY updated_at DESC').all();
    const { results: links } = await env.DB.prepare(
      'SELECT key,target_slug FROM link_targets ORDER BY key').all();
    return OK({ ok: true, articles: results || [], links: links || [] });
  }

  // GET /api/articles/item?slug=…
  if (p === '/api/articles/item' && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM articles WHERE slug=?1')
      .bind(url.searchParams.get('slug') || '').first();
    return row ? OK({ ok: true, article: row }) : OK({ error: 'not_found' }, 404);
  }

  // POST /api/articles/save — 新增或更新草稿
  if (p === '/api/articles/save' && request.method === 'POST') {
    const b = await request.json().catch(() => null);
    if (!b || !b.slug || !b.title || !b.h1) return OK({ error: 'slug/title/h1 為必填' }, 400);
    if (!/^[a-z0-9]+(\/[a-z0-9-]+)*$/.test(b.slug)) return OK({ error: 'slug 只能用小寫英數與連字號' }, 400);
    const vals = FIELDS.map(f => b[f] == null ? '' : String(b[f]));
    await env.DB.prepare(
      `INSERT INTO articles (${FIELDS.join(',')}) VALUES (${FIELDS.map((_, i) => '?' + (i + 1)).join(',')})
       ON CONFLICT(slug) DO UPDATE SET ${FIELDS.slice(1).map((f, i) => `${f}=?${i + 2}`).join(',')},
       updated_at=datetime('now')`).bind(...vals).run();
    return OK({ ok: true });
  }

  // POST /api/articles/preview — 產生 HTML，不寫任何地方
  if (p === '/api/articles/preview' && request.method === 'POST') {
    const b = await request.json().catch(() => null);
    if (!b) return OK({ error: 'bad_json' }, 400);
    const html = renderPage(b, await loadLinks(env), await loadSiblings(env, b.slug || ''));
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  // POST /api/articles/publish — 產生 HTML 並 commit 進 repo
  if (p === '/api/articles/publish' && request.method === 'POST') {
    const b = await request.json().catch(() => null);
    const slug = b && b.slug;
    if (!slug) return OK({ error: 'slug required' }, 400);
    const row = await env.DB.prepare('SELECT * FROM articles WHERE slug=?1').bind(slug).first();
    if (!row) return OK({ error: 'not_found' }, 404);

    const html = renderPage(row, await loadLinks(env), await loadSiblings(env, slug));
    try {
      const commit = await ghPut(env, `${slug}/index.html`, html, `文章後台發布：${row.h1}`);
      let sitemapCommit = null;
      try {
        const xml = await ghGet(env, 'sitemap.xml');
        const next = sitemapWith(xml, slug);
        if (next) sitemapCommit = await ghPut(env, 'sitemap.xml', next, `sitemap：新增 ${slug}`);
      } catch (e) { sitemapCommit = 'skipped:' + e.message; }
      await env.DB.prepare(`UPDATE articles SET status='published', updated_at=datetime('now') WHERE slug=?1`)
        .bind(slug).run();
      return OK({ ok: true, commit, sitemapCommit, url: `https://unfinished.tw/${slug}/` });
    } catch (e) {
      return OK({ error: String(e.message || e) }, 502);
    }
  }

  // POST /api/articles/link — 設定或清除內鏈標記的目標
  if (p === '/api/articles/link' && request.method === 'POST') {
    const b = await request.json().catch(() => null);
    if (!b || !b.key) return OK({ error: 'key required' }, 400);
    await env.DB.prepare(
      `INSERT INTO link_targets (key,target_slug,title) VALUES (?1,?2,?3)
       ON CONFLICT(key) DO UPDATE SET target_slug=?2, title=?3`)
      .bind(b.key, b.target_slug || null, b.title || '').run();
    return OK({ ok: true });
  }

  return OK({ error: 'not_found' }, 404);
}

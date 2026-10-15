/* =========================================================================
   未完籤所 · 文章列表（/articles/）產生器
   -------------------------------------------------------------------------
   2026-10：/articles/ 改成部落格模式——一頁列出所有文章，新的在前，
   上方用分類標籤篩選，不用再一層一層點進分類。

   掃描 articles/ 底下所有「有 Article 結構化資料」的頁面，
   讀出標題（H1）、摘要（meta description）、發布日期、分類（麵包屑），
   然後只替換 articles/index.html 的 <main> 內容與標題，其餘原封不動。

   新增文章後重跑一次即可：node scripts/build-article-index.js
   ========================================================================= */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'articles/index.html');
const SITE = 'https://unfinished.tw';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = s => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'index.html') out.push(p);
  }
  return out;
}

function readArticle(file) {
  const h = fs.readFileSync(file, 'utf8');
  const m = h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let ld;
  try { ld = JSON.parse(m[1]); } catch (e) { return null; }
  const nodes = Array.isArray(ld) ? ld : (ld['@graph'] || [ld]);
  const art = nodes.find(n => n['@type'] === 'Article' || n['@type'] === 'BlogPosting');
  if (!art) return null;
  /* 分類 = 文章所在資料夾的上一層分類頁的 H1（例：articles/love/breakup/ → 分手） */
  const catPage = path.join(path.dirname(path.dirname(file)), 'index.html');
  const cat = fs.existsSync(catPage)
    ? ((fs.readFileSync(catPage, 'utf8').match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '').replace(/<[^>]+>/g, '').trim()
    : '';
  const h1 = (h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || art.headline;
  const desc = (h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || art.description || '';
  const rel = path.relative(ROOT, path.dirname(file)).split(path.sep).join('/');
  return {
    href: '/' + rel + '/',
    title: unesc(h1.replace(/<[^>]+>/g, '').trim()),
    desc: unesc(desc),
    date: art.datePublished || '',
    cat
  };
}

const posts = walk(path.join(ROOT, 'articles'), [])
  .map(readArticle).filter(Boolean)
  .sort((a, b) => b.date.localeCompare(a.date) || a.href.localeCompare(b.href));

const cats = [...new Set(posts.map(p => p.cat).filter(Boolean))];

const fmt = d => d ? d.replace(/-/g, '.') : '';

const main = '<main class="ww-taxonomy ww-blog">'
  + '<div class="crumb"><a href="/">首頁</a> / 未完文章</div>'
  + '<h1>未完文章</h1>'
  + '<p class="lead">有些問題適合抽一支籤，有些問題值得先多理解一點。這裡是所有文章，新的在前面。</p>'
  + '<div class="ww-blog-filter" role="group" aria-label="依分類篩選">'
  + '<button type="button" class="is-on" data-cat="">全部</button>'
  + cats.map(c => '<button type="button" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('')
  + '</div>'
  + '<ol class="ww-blog-list">'
  + posts.map(p => '<li data-cat="' + esc(p.cat) + '"><a class="ww-blog-item" href="' + p.href + '">'
      + '<span class="ww-blog-meta">' + esc(p.cat) + (p.date ? ' · <time datetime="' + p.date + '">' + fmt(p.date) + '</time>' : '') + '</span>'
      + '<h2>' + esc(p.title) + '</h2>'
      + '<p>' + esc(p.desc) + '</p></a></li>').join('')
  + '</ol>'
  + '</main>';

const STYLE_ID = 'ww-blog-style';
const style = '<style id="' + STYLE_ID + '">'
  + '.ww-blog .lead{margin-bottom:28px}'
  + '.ww-blog-filter{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 30px}'
  + '.ww-blog-filter button{font:inherit;font-size:14px;color:#cfc2d1;background:transparent;border:1px solid rgba(224,196,139,.28);border-radius:999px;padding:8px 16px;min-height:40px;cursor:pointer}'
  + '.ww-blog-filter button.is-on{color:#1a1027;background:#D9BD82;border-color:#D9BD82}'
  + '.ww-blog-list{list-style:none;margin:0;padding:0;max-width:760px}'
  + '.ww-blog-list li{border-top:1px solid rgba(224,196,139,.18)}'
  + '.ww-blog-list li:last-child{border-bottom:1px solid rgba(224,196,139,.18)}'
  + '.ww-blog-list li[hidden]{display:none}'
  + '.ww-blog-item{display:block;padding:24px 4px;text-decoration:none}'
  + '.ww-blog-meta{display:block;font-size:13px;letter-spacing:.06em;color:#ad9fb3;margin-bottom:8px}'
  + '.ww-blog-item h2{margin:0 0 8px;color:#f2dfb2;font-size:21px;line-height:1.5;font-weight:500;font-family:"Noto Serif TC","Songti TC",serif}'
  + '.ww-blog-item p{margin:0;color:#bfb2c3;line-height:1.8;font-size:15px}'
  + '.ww-blog-item:hover h2{text-decoration:underline;text-underline-offset:4px;text-decoration-color:rgba(242,223,178,.5)}'
  + '@media(max-width:720px){.ww-blog-item h2{font-size:19px}.ww-blog-item{padding:20px 0}}'
  + '</style>';

const script = '<script id="ww-blog-filter-js">(function(){var f=document.querySelector(".ww-blog-filter");if(!f)return;'
  + 'var items=document.querySelectorAll(".ww-blog-list li");'
  + 'f.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;var c=b.getAttribute("data-cat");'
  + 'f.querySelectorAll("button").forEach(function(x){x.classList.toggle("is-on",x===b)});'
  + 'items.forEach(function(li){li.hidden=!!c&&li.getAttribute("data-cat")!==c});});})();</script>';

let h = fs.readFileSync(INDEX, 'utf8');
const swap = (re, to, label) => { if (!re.test(h)) throw new Error('找不到替換點：' + label); h = h.replace(re, to); };

swap(/<title>[^<]*<\/title>/, '<title>未完文章｜感情、工作與人生的問題整理｜未完籤所</title>', 'title');
swap(/(<meta name="description" content=")[^"]*(")/,
  '$1未完籤所的所有文章，新的在前面：曖昧、分手、單戀、戀愛關係裡的疑問，用具體的判斷方法與情境，陪你把問題想清楚。$2', 'description');
swap(/<main class="ww-taxonomy[^"]*">[\s\S]*?<\/main>/, main, 'main');
h = h.replace(new RegExp('<style id="' + STYLE_ID + '">[\\s\\S]*?<\\/style>'), '');
h = h.replace('</head>', style + '</head>');
h = h.replace(/<script id="ww-blog-filter-js">[\s\S]*?<\/script>/, '');
h = h.replace('</body>', script + '</body>');

fs.writeFileSync(INDEX, h);
console.log('已更新 articles/index.html：' + posts.length + ' 篇，分類 ' + cats.join('、'));

/* =========================================================================
   未完籤所 · 文章產生器
   -------------------------------------------------------------------------
   施工單 0-2：不要自己刻 HTML。以站上完整度最高的那篇當骨架，
   複製 → 換內容 → 換 meta → 換麵包屑 → 換 related。
   head、CTA 元件、footer、樣式一律照抄，不重寫、不「順手優化」。

   所以這支不是模板引擎，是「照著範本挖洞填」：
   只替換指定的幾段，其餘位元組原封不動，從根本上避免樣式漂移。

   用法：node scripts/build-article.js scripts/articles/<名稱>.js
   ========================================================================= */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'articles/love/breakup/how-to-get-over-a-breakup/index.html');
const SITE = 'https://unfinished.tw';

/* 只換第一個出現的位置，換不到就停——寧可失敗也不要默默產出半成品 */
function swap(html, from, to, label) {
  const i = html.indexOf(from);
  if (i < 0) throw new Error('找不到替換點：' + label + '\n  ' + from.slice(0, 80));
  return html.slice(0, i) + to + html.slice(i + from.length);
}

function swapAttr(html, re, to, label) {
  if (!re.test(html)) throw new Error('找不到替換點：' + label);
  return html.replace(re, to);
}

function build(spec) {
  let h = fs.readFileSync(TEMPLATE, 'utf8');
  const url = SITE + '/' + spec.dir + '/';

  /* ── head ── */
  h = swapAttr(h, /<title>[^<]*<\/title>/, '<title>' + spec.title + '</title>', 'title');
  h = swapAttr(h, /(<meta name="description" content=")[^"]*(")/, '$1' + spec.description + '$2', 'description');
  h = swapAttr(h, /(<link rel="canonical" href=")[^"]*(")/, '$1' + url + '$2', 'canonical');
  h = swapAttr(h, /(<meta property="og:title" content=")[^"]*(")/, '$1' + spec.h1 + '$2', 'og:title');
  h = swapAttr(h, /(<meta property="og:description" content=")[^"]*(")/, '$1' + spec.description + '$2', 'og:description');
  h = swapAttr(h, /(<meta property="og:url" content=")[^"]*(")/, '$1' + url + '$2', 'og:url');

  /* ── JSON-LD：沿用範本的 [Article, BreadcrumbList] 結構，FAQPage 追加在後 ── */
  const ldRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/;
  const old = JSON.parse(h.match(ldRe)[1]);
  const article = Object.assign({}, old.find(n => n['@type'] === 'Article'), {
    headline: spec.h1,
    description: spec.description,
    mainEntityOfPage: url,
    datePublished: spec.datePublished,
    dateModified: spec.dateModified
  });
  if (article.url) article.url = url;
  const crumbs = spec.crumb.concat([[null, spec.crumbLast]]);
  const breadcrumb = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: spec.crumb.map((c, i) => ({
      '@type': 'ListItem', position: i + 1, name: c[1], item: SITE + c[0]
    }))
  };
  const ld = [article, breadcrumb];
  if (spec.faq && spec.faq.length) {
    ld.push({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: spec.faq.map(f => ({
        '@type': 'Question', name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a }
      }))
    });
  }
  h = h.replace(ldRe, '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>');

  /* ── 麵包屑 ── */
  const crumbRe = /(<div class="crumb">)[\s\S]*?(<\/div>)/;
  const crumbHtml = spec.crumb.map(c => '<a href="' + c[0] + '">' + c[1] + '</a>').join(' / ')
                  + ' / ' + spec.crumbLast;
  h = swapAttr(h, crumbRe, '$1' + crumbHtml + '$2', 'crumb');

  /* ── kicker 與 h1 ── */
  h = swapAttr(h, /(<div class="eyebrow">)[^<]*(<\/div>)/, '$1✦ ' + spec.kicker + ' ✦$2', 'kicker');
  h = swapAttr(h, /<h1>[\s\S]*?<\/h1>/, '<h1>' + spec.h1 + '</h1>', 'h1');

  /* ── 內文：h1 所在 section 結束之後，到「你可能也想看」之前 ── */
  const bodyStart = h.indexOf('</section>') + '</section>'.length;
  const bodyEnd = h.indexOf('<h2>你可能也想看</h2>');
  if (bodyStart < 10 || bodyEnd < 0) throw new Error('找不到內文邊界');
  h = h.slice(0, bodyStart) + '\n\n' + spec.body.trim() + '\n\n' + h.slice(bodyEnd);

  /* ── 你可能也想看 ── */
  const gridRe = /(<h2>你可能也想看<\/h2><div class="grid">)[\s\S]*?(<\/div><footer>)/;
  const grid = spec.related.map(r =>
    '<a class="card" href="' + r.href + '"><b>' + r.b + '</b><span>' + r.span + '</span></a>').join('');
  h = swapAttr(h, gridRe, '$1' + grid + '$2', 'related');

  /* ── 抽籤 CTA 的 sub 與 utm_campaign ── */
  h = h.replace(/href="\/\?theme=love&sub=[^"#]*(#start)?"/g,
    'href="/?theme=love&sub=' + encodeURIComponent(spec.sub)
    + '&utm_source=article&utm_medium=cta&utm_campaign=' + path.basename(spec.dir) + '#start"');

  return h;
}

/* ---------- 執行 ---------- */
if (require.main === module) {
  const specFile = process.argv[2];
  if (!specFile) { console.error('用法：node scripts/build-article.js <spec.js>'); process.exit(1); }
  const spec = require(path.resolve(specFile));
  const out = path.join(ROOT, spec.dir, 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, build(spec));
  console.log('已產生 ' + spec.dir + '/index.html　' + fs.statSync(out).size + ' bytes');
}

module.exports = { build };

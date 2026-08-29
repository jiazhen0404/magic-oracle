/**
 * 解籤 PDF 的版面樣板。
 * 這份 HTML 會交給 Cloudflare 的 Browser Rendering 轉成 PDF，
 * 所以你在 PDF 上看到的樣子，就是這裡寫的樣子。
 *
 * 字型檔放在 assets/fonts/，是網站上的公開檔案（字型不是機密）。
 */

const TEMPLATE = String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>__TITLE__</title>
<link rel="preload" as="font" type="font/woff2" crossorigin href="__FONTBASE__oracle-serif.woff2">
<link rel="preload" as="font" type="font/woff2" crossorigin href="__FONTBASE__oracle-serif-semibold.woff2">
<style>
/* 這兩個字型檔會放在 unfinished.tw/assets/fonts/ 底下，
   Cloudflare 產 PDF 時會去抓。網址在下面的 __FONTBASE__ 換掉。 */
@font-face{
  font-family:"Oracle Serif";
  src:url("__FONTBASE__oracle-serif.woff2") format("woff2");
  font-weight:300 400; font-style:normal; font-display:block;
}
@font-face{
  font-family:"Oracle Serif";
  src:url("__FONTBASE__oracle-serif-semibold.woff2") format("woff2");
  font-weight:500 700; font-style:normal; font-display:block;
}

@page{
  size:A4;
  margin:22mm 20mm 20mm;
}
:root{
  --ink:#20223F;         /* 內文：深靛 */
  --ink-soft:#4A4A63;
  --faint:#8A8698;
  --gold:#9A7B3C;        /* 印刷用的金，比螢幕深，才不會糊掉 */
  --gold-soft:#C4A263;
  --rule:#D9CDB4;
  --paper:#FBF7EF;       /* 象牙紙 */
  --paper-deep:#F3ECDF;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--paper);
  color:var(--ink);
  font-family:"Oracle Serif","Noto Serif CJK TC",serif;
  font-weight:300;
  font-size:10.4pt;
  line-height:1.94;
  letter-spacing:.012em;
  -webkit-font-smoothing:antialiased;
}

/* ───────── 報頭 ───────── */
.masthead{text-align:center;padding-bottom:12mm}
.rule-pair{border-top:.9pt solid var(--gold-soft);border-bottom:.35pt solid var(--rule);height:2.4mm}
.brand{margin-top:7mm;font-size:9.6pt;letter-spacing:.52em;text-indent:.52em;color:var(--gold)}
.brand-en{margin-top:2.6mm;font-size:6.2pt;letter-spacing:.42em;text-indent:.42em;color:var(--faint)}

/* ───────── 籤頭 ───────── */
.slip{text-align:center;padding-bottom:9mm;margin-bottom:9mm;border-bottom:.35pt solid var(--rule)}
.slip-kicker{font-size:7pt;letter-spacing:.34em;text-indent:.34em;color:var(--faint);margin-bottom:6mm}
.slip-name{font-size:25pt;font-weight:600;color:var(--gold);letter-spacing:.17em;text-indent:.17em;line-height:1.5;margin:0}
.slip-meta{margin-top:4mm;font-size:8.4pt;letter-spacing:.2em;color:var(--ink-soft)}
.slip-outcome{display:inline-block;margin-top:6mm;padding:1.4mm 5mm;
  border:.5pt solid var(--gold-soft);font-size:7.6pt;letter-spacing:.24em;text-indent:.24em;color:var(--gold)}

/* 籤詩 */
.poem{margin:9mm auto 0;max-width:112mm;padding:7mm 8mm;
  background:var(--paper-deep);border-top:.5pt solid var(--rule);border-bottom:.5pt solid var(--rule);
  font-size:11pt;line-height:2.15;color:var(--ink)}

/* ───────── 問題與時間 ───────── */
.asked{margin:0 0 10mm;padding:5mm 0 5mm 7mm;border-left:1.1pt solid var(--gold-soft)}
.asked-lab{font-size:7.4pt;letter-spacing:.3em;text-indent:.3em;color:var(--faint);margin-bottom:2.6mm}
.asked-txt{font-size:10pt;line-height:1.95;color:var(--ink-soft)}
.drawn{margin:0 0 10mm;font-size:7.8pt;letter-spacing:.16em;color:var(--faint);text-align:center}

/* ───────── 內文 ───────── */
section{margin-bottom:7.4mm}
h2{
  font-size:11.4pt;font-weight:600;color:var(--gold);letter-spacing:.13em;
  margin:0 0 4mm;line-height:1.65;
  break-after:avoid;page-break-after:avoid;
}
h2::before{content:"";display:inline-block;width:5mm;height:.5pt;
  background:var(--gold-soft);vertical-align:.32em;margin-right:3.4mm}
section p{margin:0 0 3.2mm;orphans:2;widows:2}
section p:last-child{margin-bottom:0}

/* ───────── 結尾 ───────── */
.closing{margin-top:10mm;padding-top:6mm;break-inside:avoid;border-top:.35pt solid var(--rule);
  font-size:8.2pt;line-height:2;color:var(--faint);text-align:center}
.closing .keep{color:var(--ink-soft);font-size:9pt;margin-bottom:4mm}
.closing .order{margin-top:4mm;font-size:7.2pt;letter-spacing:.14em}
.mark{margin-top:6mm;color:var(--gold-soft);font-size:9pt;letter-spacing:.5em;text-indent:.5em}
</style>
</head>
<body>

<!-- 這一小塊看不見，作用是讓兩個字重都被「用到」，
     瀏覽器才會真的去下載它們。 -->
<div aria-hidden="true" style="position:absolute;left:-9999px;top:0;white-space:nowrap">
  <span style="font-weight:300">籤文月影</span><span style="font-weight:600">籤文月影</span>
</div>

<div class="masthead">
  <div class="rule-pair"></div>
  <div class="brand">未完籤所</div>
  <div class="brand-en">MAGIC ORACLE</div>
</div>

<div class="slip">
  <div class="slip-kicker">完整解籤</div>
  <h1 class="slip-name">__NAME__</h1>
  <div class="slip-meta">愛情・__SITUATION__</div>
  __OUTCOME__
  __POEM__
</div>

__ASKED__
<div class="drawn">抽籤時間　__DRAWN__</div>

__SECTIONS__

<div class="closing">
  <div class="keep">這份解讀是為你這一次的提問寫的。</div>
  籤文陪你把問題想清楚，不預測未來，也不保證結果。<br>
  真正要做決定的時候，你心裡其實已經有答案了。
  <div class="mark">✦</div>
  <div class="order">訂單編號　__ORDER__　·　unfinished.tw</div>
</div>

<script>
/* 字型載完才放行。
   Cloudflare 產 PDF 時會等 #fonts-ready 出現，
   沒有這一段的話，字型還沒到就先截圖，中文會變成別的字型。 */
(function(){
  function mark(){
    var d = document.createElement('div');
    d.id = 'fonts-ready';
    d.setAttribute('aria-hidden','true');
    d.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px';
    document.body.appendChild(d);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(mark);
    setTimeout(mark, 6000);         // 字型真的抓不到也不要卡死，6 秒就放行
  } else {
    mark();
  }
})();
</script>
</body>
</html>
`;

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** 寫成「2026 年 8 月 29 日　晚上 10:02」（台北時間） */
function twDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  const h = t.getUTCHours();
  const period = h < 6 ? '凌晨' : h < 12 ? '上午' : h < 18 ? '下午' : '晚上';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${t.getUTCFullYear()} 年 ${t.getUTCMonth() + 1} 月 ${t.getUTCDate()} 日　`
       + `${period} ${h12}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}

export function buildPdfHtml(slip, { question = '', drawnAt = '', orderNo = '', fontBase = '' } = {}) {
  const sections = (slip.sections || []).map((s) =>
    '<section><h2>' + esc(s.title) + '</h2>'
    + (s.paragraphs || []).map((p) => '<p>' + esc(p) + '</p>').join('')
    + '</section>'
  ).join('\n');

  // 使用者沒寫問題就整塊不印，不留空格子
  const asked = String(question || '').trim()
    ? '<div class="asked"><div class="asked-lab">你問的是</div>'
      + '<div class="asked-txt">' + esc(question.trim()) + '</div></div>'
    : '';

  return TEMPLATE
    .replace('__TITLE__', esc(slip.name) + '｜完整解籤・未完籤所')
    .replace('__NAME__', esc(slip.name))
    .replace('__SITUATION__', esc(slip.situation))
    .replace('__OUTCOME__', slip.outcome ? '<div class="slip-outcome">' + esc(slip.outcome) + '</div>' : '')
    .replace('__POEM__', slip.poem ? '<div class="poem">' + esc(slip.poem) + '</div>' : '')
    .replace('__ASKED__', asked)
    .replace('__DRAWN__', twDate(drawnAt))
    .replace('__SECTIONS__', sections)
    .replace('__ORDER__', esc(orderNo || '—'))
    .replaceAll('__FONTBASE__', fontBase);
}

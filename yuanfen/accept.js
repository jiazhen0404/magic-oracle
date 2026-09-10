/* =========================================================================
   未完籤所 · 曖昧合盤 —— 驗收基準組
   -------------------------------------------------------------------------
   施工單說「這是判斷版本對不對的唯一標準」，所以把它寫成可以重複跑的檢查，
   不要每次靠人工比對。

   刻意從 src/ 直接載入，不是讀 index.html 的 bundle——
   因為「bundle 對」不代表「require 檔頭接對了」，strip() 本來就會把 require 剝掉。
   另外再對 index.html 做兩項檢查：目錄描述有沒有漏、以及 build 有沒有跑過。

   用法：node accept.js
   ========================================================================= */

const fs = require('fs');
const { yuanfen } = require('./src/yuanfen');
const { render }  = require('./src/copy');
const { report }  = require('./src/report');
const { palace }  = require('./src/palace');
const { shape }   = require('./src/shape');

const A = { y: 1991, m: 4,  d: 4  };
const B = { y: 1987, m: 12, d: 30 };

let fail = 0;
const ok = (got, want, name) => {
  const pass = String(got) === String(want);
  if (!pass) fail++;
  console.log((pass ? '  ✓ ' : '  ✗ ') + name.padEnd(12) + got + (pass ? '' : '　←　應為 ' + want));
};

const r   = yuanfen(A, B);
const c   = render(r, { a: A, b: B }, { A: '你', B: '他' }, '曖昧');
const rep = report(r, { A: '你', B: '他' });
const pl  = palace(r.debug.A, r.debug.B, r.dimensions.zhongliang.key);
const sh  = shape(r.dimensions, r);

const PAL = { bijie: '比劫', shishang: '食傷', yinxing: '印星', caixing: '財星', guansha: '官殺' };

console.log('驗收基準組　1991/4/4 × 1987/12/30（不填時辰）\n');
ok(c.total, 72, '緣分指數');
ok(c.sections.map(s => s.score).join(' / '), '48 / 78 / 90', '三維度');
ok(c.chance, '偏低，但不是不可能', '機會');
ok(c.tempo, '一見傾心', '節奏');
ok(c.initiator, '他先動心', '主動方');
ok(PAL[pl.aKey] + ' × ' + PAL[pl.bKey], '財星 × 官殺', '夫妻宮');
ok(sh.pattern, 'mixed', '格局');
ok(sh.sweet + '合' + sh.harsh + '沖', '1合1沖', '合沖');
ok(rep.sections.length, 24, '報告段數');
ok([...new Set(rep.sections.map(s => s.part))].length, 6, '部別');

const repH = report(yuanfen({ ...A, hour: 9 }, { ...B, hour: 21 }), { A: '你', B: '他' });
ok(repH.sections.length, 25, '有時辰段數');

/* ---- 對 index.html 的兩項檢查 ---- */
console.log('\n頁面');
const html = fs.readFileSync('index.html', 'utf8');

/* 目錄描述有沒有漏。加新段落卻忘了補 TOC_DESC 會在付費區留下空白標題，
   而且 node 端完全測不出來——這個已經發生過一次。 */
const j = html.indexOf('const TOC_DESC');
const toc = html.slice(j, html.indexOf('};', j));
const miss = rep.sections.filter(s => !toc.includes("'" + s.title + "'"));
ok(miss.length, 0, '目錄漏描述');
if (miss.length) miss.forEach(s => console.log('       缺：' + s.title));

/* index.html 內嵌的引擎是不是目前 src/ 建出來的（忘了 build 是最常見的坑） */
const cut = h => { const e = h.indexOf('/* ───────────────────────── 介面 ───');
                   return h.slice(h.lastIndexOf('<script>', e) + 8, e).trim(); };
const built = fs.existsSync('engine.bundle.js') ? fs.readFileSync('engine.bundle.js', 'utf8').trim() : null;
ok(built && cut(html.replace(/\r\n/g, '\n')) === built ? '一致' : '未 build 或不一致',
   '一致', 'bundle');

console.log('\n' + (fail ? '✗ ' + fail + ' 項未通過' : '全部通過 ✓'));
process.exit(fail ? 1 : 0);

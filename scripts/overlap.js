/* =========================================================================
   未完籤所 · 重疊比對報告（工具二）
   -------------------------------------------------------------------------
   施工單第 445 節。比對兩份內容逐節的相似度，找出：
     1 哪些節重疊（不要重複上稿，會自己跟自己打對台）
     2 哪些節只存在於稿件 → 這就是可以搬用／需要擴寫的部分

   方法用 2-gram shingle + Jaccard，中文不需要斷詞、不需要模型。
   施工單指定門檻 0.5：相似度 > 0.5 判為重疊。

   用法：
     node scripts/overlap.js <A> <B>            比對兩份（.docx / .md / .html）
     node scripts/overlap.js <A> <B> --only-a <輸出.md>
                                               另外把「只存在於 A」的整段原文寫出來
   ========================================================================= */

const fs = require('fs');
const path = require('path');
const { documentXml, parse } = require('./docx-text.js');

/* 兩個門檻，因為它們抓的是不同的東西。

   施工單訂 0.5 當「退回重寫」的驗收條件，但實測後那個數字抓不到它想抓的情況：

     逐字相同                     1.000
     同主題、獨立撰寫（要擋的）    0.162 – 0.270
     完全無關（基準線）            中位數 0.019、最高 0.070

   中文各寫各的，就算講同一件事，字面重疊也只有 0.16–0.27。
   0.5 的門檻永遠不會觸發，等於沒有守門。
   無關的最高 0.070、同主題的最低 0.162，中間有空隙，所以主題重疊訂 0.12。
   0.5 保留下來，但它的意義是「整段被複製過去」，不是「講了同一件事」。 */
const TOPIC = 0.12;    // 超過 → 可能在講同一件事，要人看過
const VERBATIM = 0.5;  // 超過 → 幾乎是整段搬過去，一定要退回
const THRESHOLD = TOPIC;

/* ---------- 讀入：三種格式都轉成 [{ title, body }] ---------- */

function sectionsFromBlocks(blocks) {
  const out = [];
  let cur = { title: '（導言）', body: [] };
  for (const b of blocks) {
    if (b.level) { if (cur.body.length) out.push(cur); cur = { title: b.text, body: [] }; }
    else cur.body.push(b.text);
  }
  if (cur.body.length) out.push(cur);
  return out.map(s => ({ title: s.title, body: s.body.join('\n') }));
}

function readDocx(f) { return sectionsFromBlocks(parse(documentXml(f))); }

function readMd(f) {
  const blocks = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) blocks.push({ level: h[1].length, text: h[2].trim() });
    else if (line.trim()) blocks.push({ level: 0, text: line.replace(/[*_`>]/g, '').trim() });
  }
  return sectionsFromBlocks(blocks);
}

function readHtml(f) {
  let h = fs.readFileSync(f, 'utf8');
  /* 只取主要內容，避開頁首、頁尾、側欄與 CTA */
  const main = h.match(/<article[\s\S]*?<\/article>/) || h.match(/<main[\s\S]*?<\/main>/);
  if (main) h = main[0];
  h = h.replace(/<script[\s\S]*?<\/script>/g, '')
       .replace(/<style[\s\S]*?<\/style>/g, '')
       .replace(/<(?:nav|footer|aside)[\s\S]*?<\/(?:nav|footer|aside)>/g, '')
       .replace(/<div class="ctabox"[\s\S]*?<\/div>\s*<\/div>/g, '');
  const blocks = [];
  for (const m of h.matchAll(/<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const text = m[2].replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const hl = m[1].match(/^h([1-6])$/);
    blocks.push({ level: hl ? +hl[1] : 0, text });
  }
  return sectionsFromBlocks(blocks);
}

function read(f) {
  const e = path.extname(f).toLowerCase();
  if (e === '.docx') return readDocx(f);
  if (e === '.md')   return readMd(f);
  if (e === '.html' || e === '.htm') return readHtml(f);
  throw new Error('不支援的格式：' + f);
}

/* ---------- 相似度 ---------- */

/* 只留中文與英數，再切 2-gram。中文不斷詞，2-gram 對這種比對已經夠準。 */
function shingles(s) {
  const t = s.replace(/[^一-鿿A-Za-z0-9]/g, '');
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/* ---------- 執行 ---------- */

module.exports = { read, shingles, jaccard, THRESHOLD };

/* 被其他工具 require 時不要跑主程式 */
if (require.main !== module) return;

const [fileA, fileB] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!fileA || !fileB) {
  console.error('用法：node scripts/overlap.js <A> <B> [--only-a <輸出.md>]');
  process.exit(1);
}
const onlyAIdx = process.argv.indexOf('--only-a');
const onlyAOut = onlyAIdx > -1 ? process.argv[onlyAIdx + 1] : null;

const A = read(fileA), B = read(fileB);
const shA = A.map(s => shingles(s.title + s.body));
const shB = B.map(s => shingles(s.title + s.body));

console.log('A　' + path.basename(fileA) + '　' + A.length + ' 節');
console.log('B　' + path.basename(fileB) + '　' + B.length + ' 節');
console.log('門檻　> ' + VERBATIM + ' 逐字重用（退回）　> ' + TOPIC + ' 主題重疊（要人看）\n');

const rows = A.map((s, i) => {
  let best = 0, bestJ = -1;
  shB.forEach((t, j) => { const v = jaccard(shA[i], t); if (v > best) { best = v; bestJ = j; } });
  return { i, title: s.title, best, match: bestJ >= 0 ? B[bestJ].title : '—', chars: s.body.length };
});

console.log('── A 的每一節，對上 B 最像的是哪一節 ──');
for (const r of rows) {
  const mark = r.best > VERBATIM ? '★逐字' : (r.best > TOPIC ? '重疊' : '獨有');
  console.log('  ' + mark.padEnd(4) + '  ' + r.best.toFixed(3) + '  ' + r.title.slice(0, 32).padEnd(34) +
              (r.best > TOPIC ? '← ' + r.match.slice(0, 30) : ''));
}

const verb = rows.filter(r => r.best > VERBATIM);
const dup  = rows.filter(r => r.best > TOPIC && r.best <= VERBATIM);
const uniq = rows.filter(r => r.best <= TOPIC);
console.log('\n逐字重用 ' + verb.length + ' 節、主題重疊 ' + dup.length + ' 節、只存在於 A ' + uniq.length +
            ' 節（合計約 ' + uniq.reduce((n, r) => n + r.chars, 0) + ' 字）');
if (verb.length) console.log('★ 有逐字重用，依施工單 3-3 應退回重寫');

if (onlyAOut) {
  const md = ['# 只存在於 ' + path.basename(fileA) + ' 的段落', '',
    '> 這份是給擴寫用的。以下段落在 ' + path.basename(fileB) + ' 裡沒有對應內容',
    '> （2-gram Jaccard 相似度 ≤ ' + THRESHOLD + '），可以直接搬用或作為擴寫起點。',
    '> 沒有列出來的節代表已經重疊，**不要重寫**，要提到就一句話帶過並連回原文。', ''];
  for (const r of uniq) {
    md.push('## ' + r.title, '', A[r.i].body, '',
            '<!-- 相似度 ' + r.best.toFixed(2) + '，約 ' + r.chars + ' 字 -->', '');
  }
  fs.writeFileSync(onlyAOut, md.join('\n'));
  console.log('\n已輸出可搬用原文：' + onlyAOut);
}

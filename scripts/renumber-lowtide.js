/* 低潮中是由「迷茫中」與「日常中」兩池合併來的，兩池用的是同一組籤號
   （39-50、88-100），合併後同一個池子裡會有兩支「第 39 籤」。

   結果頁對客人顯示的是「第 NN 籤」，之後做延伸籤要靠這個對照，重複就認不出來。
   所以把日常中那 25 支在正式站改編成 101-125（人生類這個號段是空的）。

   ★ 為什麼可以只改正式站不動校稿站

     proofing-sync.js 同步的是文字（籤名、籤詩、內文、建議），不碰 n 也不碰 sub。
     所以這裡改的籤號不會被下一次同步蓋掉。身分是 pid，籤號只是顯示用的號碼。

   ★ 籤名仍然會重複

     兩池共用同一組 25 個籤名，這是刻意接受的（負責人確認過）。
     真正保證唯一的是 pid。

   跑一次就夠，重複跑不會有事（已經是 101 以上就跳過）。

   用法：
     node scripts/renumber-lowtide.js          試跑
     node scripts/renumber-lowtide.js --write  實際寫入
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const LIFE = path.join(ROOT, 'data', 'life.json');
const TARGET_SUB = '日常中';
const BASE = 101;

const WRITE = process.argv.includes('--write');

/* 舊籤號 → 新籤號。依原本的順序往下編，不打亂。 */
function buildMap(rows) {
  const olds = [...new Set(rows.filter(f => f.sub === TARGET_SUB).map(f => Number(f.n)))].sort((a, b) => a - b);
  const map = new Map();
  olds.forEach((n, i) => { if (n < BASE) map.set(n, BASE + i); });
  return map;
}

function apply(rows, map, label) {
  let done = 0, already = 0;
  for (const f of rows) {
    if (f.sub !== TARGET_SUB) continue;
    if (Number(f.n) >= BASE) { already++; continue; }
    const next = map.get(Number(f.n));
    if (!next) continue;
    f.n = next;
    done++;
  }
  console.log(`  ${label.padEnd(26)}改號 ${done}　已經是新號 ${already}`);
  return done;
}

/* data/life.json */
const original = fs.readFileSync(LIFE, 'utf8');
const life = JSON.parse(original);
const indent = (original.match(/^\[\r?\n( +)/) || [, '  '])[1].length;
const eol = original.endsWith('\n') ? '\n' : '';
const map = buildMap(life);
console.log('對照表：');
[...map.entries()].forEach(([a, b]) => process.stdout.write(`  ${a}→${b}`));
console.log('\n');
const n1 = apply(life, map, 'data/life.json');

/* index.html 的 EMBEDDED_FORTUNES */
const text = fs.readFileSync(HTML, 'utf8');
const at = text.indexOf('EMBEDDED_FORTUNES=');
const start = text.indexOf('{', at);
let depth = 0, end = -1, inStr = false, esc = false;
for (let p = start; p < text.length; p++) {
  const c = text[p];
  if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
  if (c === '"') inStr = true;
  else if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { end = p + 1; break; } }
}
const raw = text.slice(start, end);
const embedded = JSON.parse(raw);
if (JSON.stringify(embedded) !== raw) { console.error('✗ EMBEDDED_FORTUNES 重新序列化與原檔不同，不能用這個方式改'); process.exit(1); }
const n2 = apply(embedded.life || [], map, 'index.html（life）');

/* 檢查：低潮中那池（迷茫＋日常）籤號是否已經全不重複 */
const low = life.filter(f => f.sub === '迷茫中' || f.sub === TARGET_SUB);
const counts = low.reduce((a, f) => (a[f.n] = (a[f.n] || 0) + 1, a), {});
const dup = Object.entries(counts).filter(([, v]) => v > 1);
console.log(`\n低潮中 ${low.length} 支：重複籤號 ${dup.length} 組`);
if (dup.length) { console.error('✗ 還有重複，不寫入'); process.exit(1); }

if (!WRITE) { console.log('\n（試跑，沒有寫檔。確認後加 --write）'); process.exit(0); }
fs.writeFileSync(LIFE, JSON.stringify(life, null, indent) + eol);
fs.writeFileSync(HTML, text.slice(0, start) + JSON.stringify(embedded) + text.slice(end));
console.log(`\n寫入完成，共改 ${n1 + n2} 筆。`);

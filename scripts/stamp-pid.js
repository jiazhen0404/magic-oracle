/* 一次性腳本：把校稿站的固定 id 烙進正式站的每一筆籤，欄位名 pid。

   ★ 為什麼要做這件事

     同步工具過去兩版都是拿「會變的東西」當身分證，所以都壞過：

       第一版　情境＋籤名　→ 籤名在校稿站重寫時被改過，610 支只對上 412 支
       第二版　情境＋籤號　→ 籤號即將在分類重構批次二被重編

     籤名、籤號、情境都是內容，不是身分。校稿站的 id（love-0-1、pet-3-210…）
     全域唯一，而且施工單明文禁止更動，那才是真正的身分。

   ★ 為什麼要「現在」做

     這支腳本自己也得靠「情境＋籤號」才能把兩邊對起來。那個對應現在是
     679/679 全中，但批次二一動籤號就斷了。所以這是最後一次能安全烙印的時機。

   跑一次就夠。之後 proofing-sync.js 只認 pid，籤名籤號情境怎麼改都不影響。

   用法：
     node scripts/stamp-pid.js <校稿站匯出的.json>            試跑
     node scripts/stamp-pid.js <校稿站匯出的.json> --write     實際寫入
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const DATA_DIR = path.join(ROOT, 'data');
const FILES = ['love', 'work', 'life', 'pet', 'choice', 'monthly'];
const CN = { love: '愛情', work: '工作', life: '人生', pet: '毛孩', choice: '選擇', monthly: '本月主題籤' };

const file = process.argv[2];
const WRITE = process.argv.includes('--write');
if (!file) { console.error('用法：node scripts/stamp-pid.js <匯出的.json> [--write]'); process.exit(1); }

/* 毛孩在校稿站併成兩組，正式站仍是四組，用籤號還原 */
function prodSub(category, situation, n) {
  if (category !== '毛孩') return situation;
  if (situation === '離世中') return '離別中';
  if (n <= 130) return '陪伴中';
  if (n <= 160) return '擔心中';
  return '思念中';
}

const rows = (() => { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return d.fortunes || d; })();
const src = new Map();
for (const r of rows) {
  const n = Number(r.display_number);
  if (!Number.isFinite(n)) continue;
  src.set(r.category + '|' + prodSub(r.category, r.situation, n) + '|' + n, r.id);
}

let stamped = 0, already = 0;
const missing = [];
function stamp(f, cat) {
  const id = src.get(CN[cat] + '|' + f.sub + '|' + Number(f.n));
  if (!id) { missing.push(`${CN[cat]}|${f.sub}|${f.n}`); return; }
  if (f.pid === id) { already++; return; }
  f.pid = id;
  stamped++;
}

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
let htmlCount = 0;
for (const cat of Object.keys(embedded)) for (const f of embedded[cat]) { stamp(f, cat); htmlCount++; }

/* data/*.json */
const dataOut = {};
let dataCount = 0;
for (const cat of FILES) {
  const p = path.join(DATA_DIR, cat + '.json');
  if (!fs.existsSync(p)) continue;
  const original = fs.readFileSync(p, 'utf8');
  const arr = JSON.parse(original);
  const indent = (original.match(/^\[\r?\n( +)/) || [, '  '])[1].length;
  const eol = original.endsWith('\n') ? '\n' : '';
  for (const f of arr) { stamp(f, cat); dataCount++; }
  dataOut[p] = JSON.stringify(arr, null, indent) + eol;
}

console.log(`index.html ${htmlCount} 筆　data/*.json ${dataCount} 筆`);
console.log(`  新烙印 ${stamped}　已經有了 ${already}　對不到 ${missing.length}`);
missing.slice(0, 10).forEach(m => console.log('      ' + m));
if (missing.length) { console.error('\n✗ 有對不到的，先查清楚再寫入'); process.exit(1); }

if (!WRITE) { console.log('\n（試跑，沒有寫檔。確認後加 --write）'); process.exit(0); }
fs.writeFileSync(HTML, text.slice(0, start) + JSON.stringify(embedded) + text.slice(end));
for (const [p, out] of Object.entries(dataOut)) fs.writeFileSync(p, out);
console.log('\n烙印完成。之後 proofing-sync.js 會改用 pid 配對。');

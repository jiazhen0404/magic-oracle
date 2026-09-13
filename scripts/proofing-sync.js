/* 把校稿站匯出的 JSON 同步到「網站」與「LINE bot」兩個地方。

   和 proofing-import.js 的差別只有一個，但很關鍵：

       proofing-import.js　用「情境＋籤名」配對　→ 610 支只對上 412 支
       這一支的第一版　　　用「情境＋籤號」配對　→ 679 支全中，但籤號會被批次二重編
       現在　　　　　　　　用 pid（校稿站的固定 id）→ 內容怎麼改都不影響

     籤名、籤號、情境都是內容，不是身分，拿來當配對鍵遲早會壞。
     校稿站的 id（love-0-1、pet-3-210…）全域唯一且不得更動，那才是身分。
     正式站每一筆的 pid 由 scripts/stamp-pid.js 烙上，跑過一次就不用再跑。

   ★ 兩個目標各自服務誰，改錯地方會白工：

       index.html 的 EMBEDDED_FORTUNES　→ 網站
         index.html 載入時先 Object.assign(F, EMBEDDED_FORTUNES)，
         之後 loadTheme() 的 if(F[theme]) return 永遠成立，
         所以網站「不會」去 fetch data/*.json，改那裡對網站沒有用。

       data/*.json　→ LINE bot
         unfinished-oracle 的 Worker 不打包籤文，每次抓
         ${DATA_BASE_URL}/data/*.json（見 src/oracle/draw.js），快取 300 秒。
         所以 bot 只看這裡，改 index.html 對 bot 沒有用。

     兩邊都要寫，網站和 bot 才會一致。

   ★ 欄位對應（沿用 proofing-import.js 的做法）：

       st  ← general_html　　sa ← advice_html　　adv = sa
       t   ← title_html（籤名）　　yu ← poem_html（籤詩）
       jie 是備援欄位，跟著重算保持自洽
       msg／rx／fw 校稿站沒有對應來源。預設保留線上原本的；加 --collapse 會清空，
                  免費頁就從五格縮成籤語＋狀態推測＋具體建議

     outcome／outcomeLabel／sit 也沒有同步。線上的 outcome 是機器鍵
     （turning、clear_good…）配一個 outcomeLabel 顯示字串，校稿站的 outcome
     是直接寫顯示字串（安穩休息、安心離開…），兩邊不是一對一，硬套會把鍵值弄壞。

   用法：
     node scripts/proofing-sync.js <匯出的.json>              試跑
     node scripts/proofing-sync.js <匯出的.json> --write       實際寫入
     node scripts/proofing-sync.js <匯出的.json> --final-only  只同步狀態為已定稿的籤
     node scripts/proofing-sync.js <匯出的.json> --collapse    免費頁瘦身，清掉 msg／rx／fw
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const DATA_DIR = path.join(ROOT, 'data');
const FILES = ['love', 'work', 'life', 'pet', 'choice', 'monthly'];

const file = process.argv[2];
const WRITE = process.argv.includes('--write');
const FINAL_ONLY = process.argv.includes('--final-only');
/* 免費頁瘦身。校稿站只有 general_html ＋ advice_html 兩段，線上卻是五格
   （狀態推測／內在訊息／可能出現的變化／未來走向／具體建議），多出來的三格
   是舊文案。清掉之後免費頁剩下籤語＋狀態推測＋具體建議，延伸籤才有區隔。

   msg／rx／fw 本來就是條件渲染，欄位空了自動不顯示；具體建議那格原本不是，
   已經在 index.html 一起改成條件渲染。

   ★ 是真的從資料裡拿掉，不是只在畫面上隱藏。data/*.json 是公開檔案，
     只藏不刪等於沒有縮減。要復原就重跑一次不加 --collapse 的同步。

   LINE bot 讀同一份 data/*.json，所以也會跟著瘦身。 */
const COLLAPSE = process.argv.includes('--collapse');
if (!file) { console.error('用法：node scripts/proofing-sync.js <匯出的.json> [--write] [--final-only]'); process.exit(1); }

const CN = { love: '愛情', work: '工作', life: '人生', pet: '毛孩', choice: '選擇', monthly: '本月主題籤' };
const strip = s => String(s || '').replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').trim();

/* 毛孩：校稿站併成兩組，正式站仍是四組。用籤號還原成正式站的組別。
   在世中 101-130 陪伴中／131-160 擔心中／161-190 思念中　　離世中 191-240 離別中 */
function prodSub(category, situation, n) {
  if (category !== '毛孩') return situation;
  if (situation === '離世中') return '離別中';
  if (n <= 130) return '陪伴中';
  if (n <= 160) return '擔心中';
  return '思念中';
}

const rows = (() => {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  return d.fortunes || d;
})();

/* 主要索引：校稿站的固定 id。每一筆正式站資料都有 pid（scripts/stamp-pid.js 烙的）。
   籤名、籤號、情境以後怎麼改都不會影響配對。 */
const byId = new Map();
for (const r of rows) byId.set(r.id, r);

/* 備援索引：分類｜正式站情境｜籤號。只有在某筆資料沒有 pid 時才會用到，
   例如將來有人手動新增了一筆卻忘了補 pid。用到就會出警告。 */
const byKey = new Map();
for (const r of rows) {
  const n = Number(r.display_number);
  if (!Number.isFinite(n)) continue;
  byKey.set(r.category + '|' + prodSub(r.category, r.situation, n) + '|' + n, r);
}
let fallbackUsed = 0;

function applyTo(f, cat) {
  let r = f.pid ? byId.get(f.pid) : undefined;
  if (!r && !f.pid) {
    r = byKey.get(CN[cat] + '|' + f.sub + '|' + Number(f.n));
    if (r) { fallbackUsed++; }
  }
  if (!r) return 'notfound';
  if (FINAL_ONLY && r.status !== 'final') return 'skipped';
  const st = strip(r.general_html);
  const sa = strip(r.advice_html);
  const t = strip(r.title_html);
  const yu = strip(r.poem_html);
  if (!st || !sa || !t) return 'empty';
  const before = JSON.stringify([f.st, f.sa, f.adv, f.jie, f.t, f.yu, f.msg, f.rx, f.fw]);
  f.st = st;
  f.sa = sa;
  f.adv = sa;
  f.t = t;
  if (yu) f.yu = yu;
  if (COLLAPSE) { f.msg = ''; f.rx = ''; f.fw = ''; }
  f.jie = [f.st, f.rx, f.fw, f.sa].filter(Boolean).join('');
  return JSON.stringify([f.st, f.sa, f.adv, f.jie, f.t, f.yu, f.msg, f.rx, f.fw]) === before ? 'unchanged' : 'changed';
}

/* 校稿站把某支籤封存之後，它要從正式站「消失」，不是留著不更新。
   軟刪除的意思是資料留在校稿站，不是留在前台。 */
function isArchived(f) {
  const r = f.pid ? byId.get(f.pid) : undefined;
  return !!r && Number(r.archived) === 1;
}

function report(label, tally, misses) {
  const line = Object.entries(tally).map(([k, v]) => `${k} ${v}`).join('　');
  console.log(`  ${label.padEnd(22)}${line}`);
  misses.slice(0, 3).forEach(m => console.log(`      找不到：${m}`));
}

/* ── 目標一：index.html 的 EMBEDDED_FORTUNES（網站） ── */
const text = fs.readFileSync(HTML, 'utf8');
const marker = 'EMBEDDED_FORTUNES=';
const at = text.indexOf(marker);
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

console.log('匯出檔共 ' + rows.length + ' 筆\n');
console.log('網站　index.html 的 EMBEDDED_FORTUNES');
let htmlChanged = 0, removed = 0;
for (const cat of Object.keys(embedded)) {
  const before = embedded[cat].length;
  embedded[cat] = embedded[cat].filter(f => !isArchived(f));
  removed += before - embedded[cat].length;
  const tally = {}; const misses = [];
  for (const f of embedded[cat]) {
    const r = applyTo(f, cat);
    tally[r] = (tally[r] || 0) + 1;
    if (r === 'notfound') misses.push(CN[cat] + '|' + f.sub + '|' + f.n);
    if (r === 'changed') htmlChanged++;
  }
  report(`  ${CN[cat]}（${embedded[cat].length}）`, tally, misses);
}

/* ── 目標二：data/*.json（LINE bot） ── */
console.log('\nLINE bot　data/*.json');
const dataOut = {};
let dataChanged = 0;
for (const cat of FILES) {
  const p = path.join(DATA_DIR, cat + '.json');
  if (!fs.existsSync(p)) { console.log(`  ${cat}.json 不存在，跳過`); continue; }
  const original = fs.readFileSync(p, 'utf8');
  let arr = JSON.parse(original);
  const beforeLen = arr.length;
  arr = arr.filter(f => !isArchived(f));
  removed += beforeLen - arr.length;
  /* 各檔縮排不一樣（pet.json 是 1 格，其他 2 格），沿用原本的，不要整份重排 */
  const indent = (original.match(/^\[\r?\n( +)/) || [, '  '])[1].length;
  const eol = original.endsWith('\n') ? '\n' : '';
  const tally = {}; const misses = [];
  for (const f of arr) {
    const r = applyTo(f, cat);
    tally[r] = (tally[r] || 0) + 1;
    if (r === 'notfound') misses.push(CN[cat] + '|' + f.sub + '|' + f.n);
    if (r === 'changed') dataChanged++;
  }
  report(`  ${cat}.json（${arr.length}）`, tally, misses);
  dataOut[p] = JSON.stringify(arr, null, indent) + eol;
}

console.log(`\n  網站有變動 ${htmlChanged} 支　bot 有變動 ${dataChanged} 支`);
if (removed) console.log(`  🗑 校稿站已封存，從正式站移除 ${removed} 筆（資料仍在校稿站，隨時可還原）`);
if (fallbackUsed) console.log(`  ⚠ 有 ${fallbackUsed} 筆沒有 pid，改用「情境＋籤號」配對。跑一次 scripts/stamp-pid.js 補上。`);
console.log(COLLAPSE
  ? '  ✂ 已清空 msg／rx／fw，免費頁剩籤語＋狀態推測＋具體建議，和校稿站的結構一致。'
  : '  ★ 保留了線上原本的 msg／rx／fw，免費頁仍是五段，其中三段是舊文案。要瘦身加 --collapse。');

if (!WRITE) { console.log('\n（試跑，沒有寫檔。確認後加 --write）'); process.exit(0); }
fs.writeFileSync(HTML, text.slice(0, start) + JSON.stringify(embedded) + text.slice(end));
for (const [p, out] of Object.entries(dataOut)) {
  fs.writeFileSync(p, out);
}
console.log('\nindex.html 與 data/*.json 都已更新。');

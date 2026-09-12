/* 把改好的文字塞回 JS 模組。跟 copy-export.js 是一對。

   作法刻意保守：不解析 JS，只做「整段字串換整段字串」。
   用匯出當下的原文當搜尋依據，找不到或找到不只一處就整個檔案不動，
   並把問題列出來。寧可不改，也不要改到半套。

   用法：
     node scripts/copy-import.js <文字檔資料夾>            先試跑，不寫檔
     node scripts/copy-import.js <文字檔資料夾> --write    確認沒問題再寫
*/
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'yuanfen', 'src');
const DIR = process.argv[2];
const WRITE = process.argv.includes('--write');
if (!DIR) { console.error('用法：node scripts/copy-import.js <文字檔資料夾> [--write]'); process.exit(1); }

const isCopy = s => typeof s === 'string' && /[一-龥]/.test(s) && s.replace(/\s/g, '').length >= 6;

function walk(node, trail, out, seen) {
  if (isCopy(node)) { out.push([trail.join('.'), node]); return; }
  if (typeof node !== 'object' || node === null) return;
  if (seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) { node.forEach((v, i) => walk(v, [...trail, '[' + i + ']'], out, seen)); return; }
  for (const k of Object.keys(node)) walk(node[k], [...trail, k], out, seen);
}

/* 讀回文字檔：【位置】→ 新文字 */
function parseTxt(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const out = new Map();
  const blocks = text.split('\n【位置】');
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const nl = b.indexOf('\n');
    const key = b.slice(0, nl).trim();
    let body = b.slice(nl + 1);
    if (!body.startsWith('▼')) continue;
    body = body.slice(1).replace(/^\n/, '');
    /* 空行代表這一段結束 */
    const end = body.indexOf('\n\n');
    out.set(key, (end > -1 ? body.slice(0, end) : body).trim());
  }
  return out;
}

/* JS 單引號字串裡要跳脫的東西。文案不該出現換行，出現就報錯不是默默吃掉。 */
function toLiteral(s) {
  if (/\n/.test(s)) return null;
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

let totalChanged = 0, totalSkipped = 0;
const problems = [];

for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.txt'))) {
  const jsName = f.replace(/\.txt$/, '.js');
  const jsPath = path.join(SRC, jsName);
  if (!fs.existsSync(jsPath)) { problems.push(jsName + '　找不到對應的程式檔'); continue; }

  const edits = parseTxt(path.join(DIR, f));
  const mod = require(jsPath);
  const rows = [];
  const seen = new Set();
  for (const k of Object.keys(mod)) {
    if (typeof mod[k] === 'function') continue;
    walk(mod[k], [k], rows, seen);
  }
  const original = new Map(rows);

  let src = fs.readFileSync(jsPath, 'utf8');
  const fileProblems = [];
  const pending = [];

  for (const [key, next] of edits) {
    const before = original.get(key);
    if (before === undefined) { fileProblems.push('位置不存在：' + key); continue; }
    if (before === next) continue;                       // 沒改動

    const lit = toLiteral(next);
    if (lit === null) { fileProblems.push('文字裡有換行，一段請寫成一行：' + key); continue; }

    const needle = "'" + toLiteral(before) + "'";
    const hits = src.split(needle).length - 1;
    if (hits === 0) { fileProblems.push('在程式碼裡找不到原文（可能被拆成多段字串）：' + key); continue; }
    if (hits > 1) { fileProblems.push('原文在檔案裡出現 ' + hits + ' 次，無法確定改哪一個：' + key); continue; }
    pending.push([needle, "'" + lit + "'", key]);
  }

  if (fileProblems.length) {
    problems.push(jsName + '　' + fileProblems.length + ' 個問題，整個檔案不動：');
    fileProblems.slice(0, 6).forEach(p => problems.push('    ' + p));
    totalSkipped += pending.length;
    continue;
  }
  for (const [needle, repl] of pending) src = src.split(needle).join(repl);

  if (pending.length) {
    if (WRITE) fs.writeFileSync(jsPath, src);
    console.log('  ' + jsName.padEnd(22) + pending.length + ' 段' + (WRITE ? ' 已寫入' : '（試跑）'));
    totalChanged += pending.length;
  }
}

console.log();
if (problems.length) { console.log('✗ 有問題，相關檔案沒有被修改：'); problems.forEach(p => console.log('  ' + p)); }
console.log((WRITE ? '已寫入 ' : '可寫入 ') + totalChanged + ' 段' + (totalSkipped ? '，跳過 ' + totalSkipped + ' 段' : ''));
if (!WRITE && totalChanged) console.log('\n確認沒問題後加 --write 才會真的改檔，然後記得跑 npm run build 與 npm run lint。');
process.exitCode = problems.length ? 1 : 0;

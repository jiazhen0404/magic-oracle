/* 把文案從 JS 模組抽成純文字，交給文案寫手；改完再用 copy-import.js 塞回去。

   為什麼要這樣做：直接交 JS 檔，寫手得在程式碼裡翻找字串，
   而且動到引號或逗號就整個網站掛掉。抽出來之後他只看得到文字。

   用法：
     node scripts/copy-export.js                 匯出全部
     node scripts/copy-export.js copy.js         只匯出一個檔
     node scripts/copy-export.js --out 資料夾     指定輸出位置
*/
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'yuanfen', 'src');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx > -1 ? args[outIdx + 1] : path.join(__dirname, '..', 'copy-export');
const only = args.filter(a => !a.startsWith('--') && a !== OUT);

/* 哪些檔案有文案。順序＝改稿的優先序，字數多的在前。 */
const FILES = ['copy.js', 'takeaway.js', 'shape.js', 'self-values.js', 'events.js',
  'encounter.js', 'other-position.js', 'basis.js', 'other-appearance.js',
  'movefirst.js', 'dont.js', 'flavour.js', 'spouse-copy.js', 'other-attitude.js',
  'chance.js', 'initiator.js', 'palace.js'];

const isCopy = s => typeof s === 'string' && /[一-龥]/.test(s) && s.replace(/\s/g, '').length >= 6;

/* 走訪模組匯出的資料，記下每一段文字的位置。
   位置字串之後要原封不動送回 import，是唯一的對應依據。 */
function walk(node, trail, out, seen) {
  if (isCopy(node)) { out.push([trail.join('.'), node]); return; }
  if (typeof node !== 'object' || node === null) return;
  if (seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) { node.forEach((v, i) => walk(v, [...trail, '[' + i + ']'], out, seen)); return; }
  for (const k of Object.keys(node)) walk(node[k], [...trail, k], out, seen);
}

fs.mkdirSync(OUT, { recursive: true });
let grand = 0;
const index = [];

for (const f of FILES) {
  if (only.length && !only.includes(f)) continue;
  let mod;
  try { mod = require(path.join(SRC, f)); } catch (e) { console.log('  跳過 ' + f + '：' + e.message); continue; }

  const rows = [];
  const seen = new Set();
  for (const k of Object.keys(mod)) {
    if (typeof mod[k] === 'function') continue;      // 函式不是文案
    walk(mod[k], [k], rows, seen);
  }
  if (!rows.length) continue;

  const chars = rows.reduce((a, [, t]) => a + t.replace(/[，。；：、—「」（）？！\s{}AB]/g, '').length, 0);
  grand += chars;
  index.push([f, rows.length, chars]);

  const lines = [
    '# ' + f,
    '',
    '共 ' + rows.length + ' 段，' + chars + ' 字。',
    '',
    '**怎麼改**：只改「▼」底下那一行的文字。',
    '`【位置】` 那一行是程式用來對回去的，**一個字都不要動，也不要刪**。',
    '一段可以寫成多行，空一行就代表這一段結束。',
    '',
    '---',
    '',
  ];
  for (const [k, t] of rows) {
    lines.push('【位置】' + k);
    lines.push('▼');
    lines.push(t);
    lines.push('');
  }
  fs.writeFileSync(path.join(OUT, f.replace(/\.js$/, '') + '.txt'), lines.join('\n'), 'utf8');
  console.log('  ' + f.padEnd(22) + String(rows.length).padStart(4) + ' 段　' + String(chars).padStart(6) + ' 字');
}

index.sort((a, b) => b[2] - a[2]);
fs.writeFileSync(path.join(OUT, '00_目錄.md'),
  ['# 文案檔案清單', '', '照字數排序，前面的影響最大。', '',
    '| 檔案 | 段數 | 字數 |', '|---|---:|---:|',
    ...index.map(([f, n, c]) => '| ' + f.replace(/\.js$/, '') + '.txt | ' + n + ' | ' + c + ' |'),
    '| **合計** | | **' + grand + '** |'].join('\n'), 'utf8');

console.log('\n  合計 ' + grand + ' 字 → ' + OUT);

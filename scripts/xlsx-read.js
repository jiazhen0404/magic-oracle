/* =========================================================================
   未完籤所 · xlsx 讀取（無相依）
   -------------------------------------------------------------------------
   xlsx 就是一個 zip：xl/workbook.xml 記分頁、xl/sharedStrings.xml 放共用字串、
   xl/worksheets/sheetN.xml 放儲存格。只要讀這三種就夠，不必裝套件。

   籤文掃描（施工單批次 C）與內容替換（批次 A）都要吃 xlsx，所以抽成共用模組。

   用法：
     node scripts/xlsx-read.js <檔案.xlsx>                 列出分頁
     node scripts/xlsx-read.js <檔案.xlsx> <分頁名>        印出前幾列
     node scripts/xlsx-read.js <檔案.xlsx> <分頁名> --json 輸出整份 JSON
   ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

function unzipTo(file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-'));
  execSync('unzip -o -q "' + file + '" -d "' + tmp + '"');
  return tmp;
}

const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                       .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
                       .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
                       .replace(/&amp;/g, '&');

/* <si> 裡可能有多個 <t>（同一格內有不同格式的文字），要全部串起來 */
function sharedStrings(dir) {
  const p = path.join(dir, 'xl', 'sharedStrings.xml');
  if (!fs.existsSync(p)) return [];
  const xml = fs.readFileSync(p, 'utf8');
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => unescape(t[1])).join(''));
}

function sheetList(dir) {
  const wb = fs.readFileSync(path.join(dir, 'xl', 'workbook.xml'), 'utf8');
  return [...wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="rId(\d+)"/g)]
    .map(m => ({ name: m[1], file: 'sheet' + m[2] + '.xml' }));
}

/* 欄位字母 → 索引（A=0, Z=25, AA=26…） */
function colIndex(ref) {
  const s = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readSheet(dir, fileName, shared) {
  const xml = fs.readFileSync(path.join(dir, 'xl', 'worksheets', fileName), 'utf8');
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[2].matchAll(/<c[^>]*r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const idx = colIndex(cm[1]);
      const isShared = /t="s"/.test(cm[2]);
      const isInline = /t="inlineStr"/.test(cm[2]);
      let v = '';
      if (isInline) {
        v = [...cm[3].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => unescape(t[1])).join('');
      } else {
        const vm = cm[3].match(/<v>([\s\S]*?)<\/v>/);
        if (vm) v = isShared ? (shared[+vm[1]] ?? '') : unescape(vm[1]);
      }
      cells[idx] = v;
    }
    rows[+rm[1] - 1] = cells;
  }
  /* 補齊空洞，避免下游要一直判斷 undefined */
  const width = rows.reduce((n, r) => Math.max(n, r ? r.length : 0), 0);
  return rows.map(r => Array.from({ length: width }, (_, i) => (r && r[i] != null) ? r[i] : ''));
}

/* 回傳 [{ 欄名: 值 }]，第一列當表頭 */
function readTable(file, sheetName) {
  const dir = unzipTo(file);
  try {
    const shared = sharedStrings(dir);
    const sheets = sheetList(dir);
    const sh = sheets.find(s => s.name === sheetName);
    if (!sh) throw new Error('找不到分頁「' + sheetName + '」，有的是：' + sheets.map(s => s.name).join('、'));
    const rows = readSheet(dir, sh.file, shared).filter(r => r.some(c => String(c).trim()));
    if (!rows.length) return [];
    const head = rows[0].map(h => String(h).trim());
    return rows.slice(1).map(r => {
      const o = {};
      head.forEach((h, i) => { if (h) o[h] = r[i] == null ? '' : String(r[i]); });
      return o;
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function listSheets(file) {
  const dir = unzipTo(file);
  try { return sheetList(dir).map(s => s.name); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { readTable, listSheets };

if (require.main === module) {
  const [file, sheet] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!file) { console.error('用法：node scripts/xlsx-read.js <檔案.xlsx> [分頁名] [--json]'); process.exit(1); }
  if (!sheet) { console.log(listSheets(file).map(s => '  ' + s).join('\n')); process.exit(0); }
  const rows = readTable(file, sheet);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
  console.log('列數：' + rows.length);
  console.log('欄位：' + Object.keys(rows[0] || {}).join(' ｜ '));
  console.log('\n第一列：');
  for (const [k, v] of Object.entries(rows[0] || {})) console.log('  ' + k + '　' + String(v).slice(0, 60));
}

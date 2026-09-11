/* =========================================================================
   未完籤所 · 籤文品質掃描（施工單批次 C）
   -------------------------------------------------------------------------
   把人工檢查做成可重複執行的腳本。輸入 xlsx 或站上的資料，輸出違規清單。

   用法：
     node scripts/scan-fortunes.js <檔案.xlsx> [分頁名]
     node scripts/scan-fortunes.js data/love.json
     node scripts/scan-fortunes.js --embedded          讀 index.html 線上實際資料
     加 --csv 輸出 CSV，預設輸出 markdown 表

   輸入來源不同，欄位名也不同，先正規化成同一組再檢查——
   不然每加一種來源就要把十三條規則各改一次。
   ========================================================================= */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* ---------- 檢查用的字表 ---------- */

const OUTCOMES = ['順勢而成', '好消息將近', '緩慢轉好', '平穩維持', '等待期', '先難後易', '阻礙提醒', '結束與轉向'];
const SCENES = ['失戀中', '曖昧中', '關係中', '單身中', '桃花運勢',
                '陪伴中', '擔心中', '思念中', '離別中',
                '迷惘中', '求職中', '轉職中', '職場中', '創業中',
                '迷茫中', '家庭中', '夢想中', '日常中', '兩難中', '決定中', '方向中'];
const TEMPLATE_PHRASES = ['這支籤落在', '你們現在最關鍵的是', '這段關係目前卡在',
                          '這支籤把焦點放在', '這一波桃花的重點是'];
const BOOKISH = ['維持', '投入', '取決於', '模式', '翻轉', '落地', '釋出',
                 '篩選', '能見度', '定案', '層面', '訊號', '建立'];
const JARGON = ['籌碼', '痛點', '回購', '對齊', '天花板', '海投', '紅旗', '現金流'];
/* 無對象情境不該出現的字。判斷依據是情境，不是分類。 */
const NO_PARTNER_SCENES = ['單身中', '桃花運勢'];
const PARTNER_WORDS = ['雙方', '這段關係', '復合', '分手', '對方的靠近', '追問'];

const TEXT_FIELDS = ['st', 'rx', 'fw', 'adv', 'msg'];

/* ---------- 讀取與正規化 ---------- */

function fromXlsx(file, sheet) {
  const { readTable, listSheets } = require('./xlsx-read.js');
  const name = sheet || listSheets(file).find(s => /可匯入|全文/.test(s)) || listSheets(file)[0];
  return readTable(file, name).map(r => ({
    id: r['唯一ID'], sub: r['情境'], name: r['籤名'], poem: r['籤詩'],
    st: r['現況'], rx: r['對方／外在反應'], fw: r['未來走勢'],
    adv: r['建議'], msg: r['籤的訊息'], _src: '「' + name + '」'
  }));
}

const SLUG = { 失戀中: 'breakup', 曖昧中: 'flirting', 關係中: 'relationship', 單身中: 'single', 桃花運勢: 'fortune' };

function fromRecords(arr, theme, label) {
  return arr.map(f => ({
    id: SLUG[f.sub] ? theme + '_' + SLUG[f.sub] + '_' + String(f.n).padStart(3, '0')
                    : theme + '_' + String(f.n).padStart(3, '0'),
    sub: f.sub, name: f.t, poem: f.yu,
    st: f.st, rx: f.rx, fw: f.fw,
    adv: f.sa || f.adv,          // 畫面上顯示的是 sa || adv，檢查要跟畫面一致
    msg: f.msg, _src: label
  }));
}

function fromJson(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const arr = Array.isArray(j) ? j : Object.values(j).find(Array.isArray);
  const theme = path.basename(file, '.json');
  return fromRecords(arr, theme, path.basename(file));
}

function fromEmbedded() {
  const h = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const i = h.indexOf('EMBEDDED_FORTUNES={');
  const start = h.indexOf('{', i + 18);
  let d = 0, end = -1;
  for (let k = start; k < h.length; k++) {
    if (h[k] === '{') d++;
    else if (h[k] === '}') { d--; if (!d) { end = k + 1; break; } }
  }
  const obj = JSON.parse(h.slice(start, end));
  const out = [];
  for (const [theme, arr] of Object.entries(obj)) {
    if (Array.isArray(arr)) out.push(...fromRecords(arr, theme, 'index.html 線上資料'));
  }
  return out;
}

/* ---------- 十三條檢查 ---------- */

const CJK = /[一-鿿]/;
const len = s => [...String(s || '')].filter(c => !/\s/.test(c)).length;

function scan(rows) {
  const bad = [];
  const add = (r, field, type, text) =>
    bad.push({ id: r.id || '(無 ID)', field, type, text: String(text || '').slice(0, 60) });

  /* 1 唯一 ID 重複 */
  const seen = new Map();
  for (const r of rows) {
    if (!r.id) { add(r, '唯一ID', 'ID 缺漏', r.name); continue; }
    if (seen.has(r.id)) add(r, '唯一ID', 'ID 重複', '與 ' + seen.get(r.id) + ' 相同');
    else seen.set(r.id, r.name);
  }

  /* 2 五欄的唯一值數量要等於支數（抓套版／共用） */
  const dupSummary = [];
  for (const f of TEXT_FIELDS) {
    const vals = rows.map(r => String(r[f] || '').trim()).filter(Boolean);
    const uniq = new Set(vals).size;
    if (uniq < vals.length) {
      dupSummary.push({ field: f, uniq, total: vals.length });
      /* 把重複的那幾支列出來，才知道要改哪一支 */
      const count = {};
      vals.forEach(v => { count[v] = (count[v] || 0) + 1; });
      for (const r of rows) {
        const v = String(r[f] || '').trim();
        if (v && count[v] > 1) add(r, f, '內容重複（' + count[v] + ' 支共用）', v);
      }
    }
  }

  for (const r of rows) {
    const fields = TEXT_FIELDS.filter(f => r[f]);

    for (const f of fields) {
      const t = String(r[f]);

      /* 3 內文出現結局標籤 */
      for (const w of OUTCOMES) if (t.includes(w)) add(r, f, '出現結局標籤「' + w + '」', t);
      /* 4 內文出現情境標籤 */
      for (const w of SCENES) if (t.includes(w)) add(r, f, '出現情境標籤「' + w + '」', t);
      /* 5 套版句型 */
      for (const w of TEMPLATE_PHRASES) if (t.includes(w)) add(r, f, '套版句型「' + w + '」', t);
      /* 9 半形標點混用（中文字後面接半形逗號問號驚嘆號） */
      const half = t.match(/[一-鿿][,?!;:]/g);
      if (half) add(r, f, '半形標點「' + half[0] + '」', t);
      /* 10 書面詞 */
      for (const w of BOOKISH) if (t.includes(w)) add(r, f, '書面詞「' + w + '」', t);
      /* 11 行話 */
      for (const w of JARGON) if (t.includes(w)) add(r, f, '行話「' + w + '」', t);
      /* 12 無對象情境出現有對象語彙 */
      if (NO_PARTNER_SCENES.includes(r.sub))
        for (const w of PARTNER_WORDS) if (t.includes(w)) add(r, f, '無對象情境卻出現「' + w + '」', t);
      /* 8 單句字數 */
      for (const s of t.split(/[。？！]/)) if (len(s) > 42) add(r, f, '單句 ' + len(s) + ' 字，超過 42', s);
    }

    /* 6 msg 以籤名引號開頭 */
    if (r.msg && r.name && /^[「『"]/.test(String(r.msg).trim())
        && String(r.msg).includes(r.name)) add(r, 'msg', 'msg 以籤名引號開頭', r.msg);
    /* 7 msg 字數 14–32 */
    if (r.msg) {
      const n = len(r.msg);
      if (n < 14 || n > 32) add(r, 'msg', 'msg ' + n + ' 字，規格 14–32', r.msg);
    }

    /* 13 毛孩・擔心中的建議要提到看診／獸醫（本輪不在範圍，先寫著） */
    if (r.sub === '擔心中' && r.adv && !/獸醫|看診|就醫|門診/.test(String(r.adv)))
      add(r, 'adv', '毛孩・擔心中未提到看診／獸醫', r.adv);
  }

  return { bad, dupSummary };
}

/* ---------- 執行 ---------- */

const args = process.argv.slice(2);
const asCsv = args.includes('--csv');
const files = args.filter(a => !a.startsWith('--'));

let rows;
if (args.includes('--embedded')) rows = fromEmbedded();
else if (!files.length) { console.error('用法：node scripts/scan-fortunes.js <檔案.xlsx|.json> [分頁名] [--csv]\n      node scripts/scan-fortunes.js --embedded'); process.exit(1); }
else if (/\.xlsx$/i.test(files[0])) rows = fromXlsx(files[0], files[1]);
else rows = fromJson(files[0]);

/* --theme love 只看某一類。唯一值檢查必須在同一類之內比，
   跨類一起算會把不同分類的重複混在一起，數字沒有意義。 */
const themeArg = args.find(a => a.startsWith('--theme='));
if (themeArg) {
  const t = themeArg.split('=')[1];
  rows = rows.filter(r => String(r.id || '').startsWith(t + '_'));
}

const { bad, dupSummary } = scan(rows);

console.log('掃描 ' + rows.length + ' 支　來源：' + (rows[0] ? rows[0]._src : '—'));
console.log();
console.log('五個欄位的唯一值數量（應等於支數，小於就是套版或共用）：');
for (const f of TEXT_FIELDS) {
  const vals = rows.map(r => String(r[f] || '').trim()).filter(Boolean);
  const u = new Set(vals).size;
  console.log('  ' + f.padEnd(4) + String(u).padStart(4) + ' / ' + vals.length + (u < vals.length ? '　✗' : '　✓'));
}
console.log();

if (!bad.length) { console.log('十三項全部通過 ✓'); process.exit(0); }

/* 依類型歸類，同一種問題不要洗版 */
const byType = {};
bad.forEach(b => (byType[b.type] = byType[b.type] || []).push(b));
const sorted = Object.entries(byType).sort((a, b) => b[1].length - a[1].length);

if (asCsv) {
  const q = v => '"' + String(v).replaceAll('"', '""') + '"';
  console.log('﻿' + ['唯一ID', '欄位', '違規類型', '原句'].join(','));
  bad.forEach(b => console.log([b.id, b.field, b.type, b.text].map(q).join(',')));
} else {
  console.log('共 ' + bad.length + ' 處違規，' + sorted.length + ' 種類型\n');
  for (const [type, list] of sorted) {
    console.log('### ' + type + '　' + list.length + ' 處');
    list.slice(0, 5).forEach(b => console.log('  · ' + b.id + '　' + b.field + '　' + b.text));
    if (list.length > 5) console.log('  … 另有 ' + (list.length - 5) + ' 處');
    console.log();
  }
}
process.exit(1);

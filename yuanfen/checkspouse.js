/* 配偶星文案驗收（docs/COPY-REQUEST-SPOUSE-STAR.md 的五條標準）

   跟 checkwrap.js 一樣，比對前先把佔位符還原成人眼看到的字——
   {B} 佔三個字元、「他」只佔一個，不還原的話六字門檻會誤判。 */
const { SPOUSE_COPY } = require('./src/spouse-copy');
const { fillNames } = require('./src/fill');

const NAMES = { A: '你', B: '他' };
const CELLS = ['weak_strong', 'weak_faint', 'strong_strong', 'strong_faint', 'mid', 'none'];

/* 2　命理術語。使用者要看到關係的樣子，不是命理的名詞。 */
const JARGON = ['財星', '官殺', '身弱', '身強', '喜神', '忌神', '日主', '四柱',
                '喜用', '正財', '偏財', '正官', '七殺', '八字', '命盤'];

/* 3　其他軸的地盤。跟 lint.js 的 R7 同一份字表。 */
const OTHER_AXIS = [
  '一見', '燒起來', '見面就', '一拍即合', '轟轟烈烈', '忽冷忽熱',
  '似曾相識', '日久', '慢慢熟', '怎麼開始', '一開始就強烈',
  '先動心', '先出手', '誰先主動',
  '走到一起的機會', '成的機會', '機會偏低', '機會很高', '翻盤',
];

/* 5　中和那一格必須明說「看不出來」，不能偷偷下方向。 */
const MID_HEDGE = ['看不出來', '沒有給出', '難判', '不說', '沒有方向', '中間'];

const strip = t => t.replace(/[，。；：、—「」（）？！…·\s]/g, '');
const grams = (t, n) => {
  const a = [...strip(t)];
  const g = new Set();
  for (let i = 0; i + n <= a.length; i++) g.add(a.slice(i, i + n).join(''));
  return g;
};

const fails = [];
const fail = m => fails.push(m);
const rows = [];

/* ---------- 逐格檢查 ---------- */
for (const key of CELLS) {
  const cell = SPOUSE_COPY[key];
  if (!cell) { fail('缺少格子　' + key); continue; }

  const core = fillNames(cell.core, NAMES);
  const poems = (cell.poems || []).map(p => fillNames(p, NAMES));

  /* 4　字數 */
  const coreLen = strip(core).length;
  if (coreLen < 60 || coreLen > 90) fail(key + '　core 字數 ' + coreLen + '，要求 60–90');
  if (poems.length !== 3) fail(key + '　poems 應為 3 句，實際 ' + poems.length);
  /* 籤詩長度 8–28。需求表原本寫 12–20，那是憑感覺訂的，訂錯了：
     現有已上線的 30 句籤詩實際落在 8–28 字，最短的兩句是
     「火光會滅，餘溫不會。」（8 字）與「故事會講完，日子不會。」（9 字），
     而且正是上一批刻意改寫出來的好句子。照 12 字的門檻退件，
     等於逼寫手把短句灌水。改成照現有作品的實際範圍。 */
  const bad = poems.map(p => strip(p).length).filter(n => n < 8 || n > 28);
  if (bad.length) fail(key + '　poems 字數 ' + bad.join('、') + '，要求 8–28');

  const all = core + poems.join('');

  /* 2　術語 */
  const j = JARGON.filter(w => all.includes(w));
  if (j.length) fail(key + '　出現命理術語：' + j.join('、'));

  /* 3　跨軸 */
  const o = OTHER_AXIS.filter(w => all.includes(w));
  if (o.length) fail(key + '　踩到其他軸：' + o.join('、'));

  /* 6　寫死的代名詞。需求表寫了「對方一律寫 {B}」，但第一次交件仍有兩處寫死，
     而自動檢查當時沒有這一條——選「她」的使用者會讀到「他」。
     這是整個專案反覆踩的坑，補進來守著。
     用原文比對，不是 fillNames 之後的，不然替換完就看不出來了。 */
  const raw = cell.core + (cell.poems || []).join('');
  const stray = raw.replace(/\{B\}|其他|他們/g, '').match(/[他她]/g);
  if (stray) fail(key + '　有 ' + stray.length + ' 處寫死的「' + stray[0] + '」，要改成 {B}');

  rows.push([key, coreLen, poems.map(p => strip(p).length).join('/')]);
}

/* 5　中和格 */
{
  const m = SPOUSE_COPY.mid;
  if (m && !MID_HEDGE.some(w => m.core.includes(w)))
    fail('mid　沒有明說「看不出來」，可能偷偷下了方向');
}

/* 1　六格兩兩之間不得有連續 6 字以上相同 */
const text = {};
for (const key of CELLS) {
  const c = SPOUSE_COPY[key];
  if (c) text[key] = fillNames(c.core + (c.poems || []).join(''), NAMES);
}
for (let i = 0; i < CELLS.length; i++)
  for (let k = i + 1; k < CELLS.length; k++) {
    const A = CELLS[i], B = CELLS[k];
    if (!text[A] || !text[B]) continue;
    const ga = grams(text[A], 6), gb = grams(text[B], 6);
    const hit = [...ga].find(g => gb.has(g));
    if (hit) fail('重複　「' + hit + '」同時出現在 ' + A + ' 與 ' + B);
  }

/* ---------- 報告 ---------- */
console.log('格子          core字數  poems字數');
rows.forEach(([k, c, p]) => console.log('  ' + k.padEnd(14) + String(c).padStart(4) + '      ' + p));
console.log();

if (fails.length) {
  console.log('✗ ' + fails.length + ' 項未通過：');
  fails.forEach(f => console.log('  ' + f));
  process.exit(1);
}
console.log('配偶星文案全部通過 ✓（6 格）');

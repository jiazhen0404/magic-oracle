const { yuanfen } = require('./src/yuanfen');

// 目標客群：25–35 歲女性 → 生年約 1991–2001，對象放寬 1985–2005
function randDate(y0, y1, rnd) {
  const y = y0 + Math.floor(rnd() * (y1 - y0 + 1));
  const m = 1 + Math.floor(rnd() * 12);
  const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  const d = 1 + Math.floor(rnd() * dim);
  return { y, m, d };
}

// 可重現的偽隨機
let seed = 20260909;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

const N = 200000;
const totals = [];
const dims = { wendu: [], zhongliang: [], changdu: [] };

for (let i = 0; i < N; i++) {
  const r = yuanfen(randDate(1991, 2001, rnd), randDate(1985, 2005, rnd));
  totals.push(r.total);
  for (const k of Object.keys(dims)) dims[k].push(r.dimensions[k].score);
}

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const q = p => s[Math.floor(p * (s.length - 1))];
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
  return { min: s[0], p5: q(.05), p25: q(.25), median: q(.5), p75: q(.75), p95: q(.95),
           max: s[s.length - 1], mean: +mean.toFixed(1), sd: +sd.toFixed(1) };
}

console.log('總分（緣分指數）', stats(totals));
for (const k of Object.keys(dims)) console.log(k.padEnd(11), stats(dims[k]));

// 分數帶分佈
const bands = { '<50': 0, '50-59': 0, '60-69': 0, '70-79': 0, '80-89': 0, '90+': 0 };
for (const t of totals) {
  if (t < 50) bands['<50']++;
  else if (t < 60) bands['50-59']++;
  else if (t < 70) bands['60-69']++;
  else if (t < 80) bands['70-79']++;
  else if (t < 90) bands['80-89']++;
  else bands['90+']++;
}
console.log('\n分數帶佔比');
for (const [k, v] of Object.entries(bands)) {
  console.log(k.padEnd(7), (v / N * 100).toFixed(1) + '%', '█'.repeat(Math.round(v / N * 60)));
}
console.log('\n相異總分數量:', new Set(totals).size);

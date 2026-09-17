/* 資訊密度檢查
   1 否定句比例 < 25%
   2 否定句與機率語氣不得同句
   3 免費頁單段字數 ≤ 100 */
const { yuanfen } = require('./src/yuanfen');
const { render } = require('./src/copy');

const NEG  = /沒有|不是|不會|不太|未必|不用|並非|不至於|不見得/;
const PROB = /多半|通常|往往|容易|大概|傾向於/;

let s = 20260912;
const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const rd = () => ({ y: 1988 + Math.floor(rnd() * 16), m: 1 + Math.floor(rnd() * 12), d: 1 + Math.floor(rnd() * 28) });

let sent = 0, neg = 0, both = 0;
const lens = { '緣的溫度': [], '緣的重量': [], '緣的長度': [] };
const long = {};

for (let i = 0; i < 8000; i++) {
  const a = rd(), b = rd();
  const c = render(yuanfen(a, b), { a, b }, { A: '你', B: '他' }, '曖昧');
  c.sections.forEach(x => {
    lens[x.name].push([...x.text].length);
    if ([...x.text].length > 100) long[x.name] = (long[x.name] || 0) + 1;
    x.text.split(/[。；]/).filter(Boolean).forEach(t => {
      sent++;
      const n = NEG.test(t), p = PROB.test(t);
      if (n) neg++;
      if (n && p) both++;
    });
  });
}

const pct = (a, b) => (a / b * 100).toFixed(1) + '%';
console.log('否定句比例　　　' + pct(neg, sent) + '（目標 < 25%）');
console.log('否定＋機率同句　' + pct(both, sent) + '（目標 0%）');
console.log('');
console.log('免費頁段落字數：');
let over = 0;
for (const [k, v] of Object.entries(lens)) {
  v.sort((a, b) => a - b);
  const o = (long[k] || 0) / v.length * 100;
  over += long[k] || 0;
  console.log('  ' + k + '　中位 ' + String(v[v.length >> 1]).padStart(3)
    + '　最長 ' + String(v[v.length - 1]).padStart(3)
    + '　超過 100 字：' + o.toFixed(1) + '%');
}
process.exitCode = (neg / sent > 0.25 || both > 0) ? 1 : 0;

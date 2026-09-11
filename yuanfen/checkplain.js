/* 白話檢查：掃描所有使用者看得到的文字，找出書面語與抽象詞
   （干支表本身不計——那是算式揭露，術語是刻意保留的）

   ★ 這支刻意**不放進 npm run lint**，用 npm run plain 單獨跑。
     原因是它現在還是紅的：第八次交件把免費頁清乾淨了（11 個詞 → 0），
     但付費報告還剩八個，而那些字住在這次沒交的模組裡
     （report.js、takeaway.js、tempo.js、basis.js、self-values.js）。
     放進 lint 會讓建置一直失敗，而平常就在紅的檢查，久了會被習慣性忽略，
     等到真的有新問題時反而看不見——跟 lint.js R7 當初降級是同一個理由。
     等第二批把付費報告清完，再把它併進 lint。 */
const { yuanfen } = require('./src/yuanfen');
const { render } = require('./src/copy');
const { report } = require('./src/report');

/* 一般人不會這樣講話的詞 */
const HARD = [
  '底質', '質地', '本命', '納音', '日支', '日干', '年支', '合婚', '盤面', '命局',
  '先天', '主體性', '定局', '必然性', '邊際', '結構性', '維度', '配置', '對沖',
  '滋養', '耗損', '損耗', '消耗性', '不對等', '對等', '極性', '慣性', '複利',
  '參照', '對照組', '契機', '傾向', '機制', '本質', '層次', '面向', '樣態',
  '既定', '恆常', '週期', '循環', '累積性', '不可逆'
];

let s = 20260911;
const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const rd = h => {
  const o = { y: 1985 + Math.floor(rnd() * 20), m: 1 + Math.floor(rnd() * 12), d: 1 + Math.floor(rnd() * 28) };
  if (h) o.hour = Math.floor(rnd() * 24);
  return o;
};

const free = {}, paid = {};
const N = 6000;
for (let i = 0; i < N; i++) {
  const a = rd(), b = rd();
  const r = yuanfen(a, b);
  const c = render(r, { a, b }, { A: '你', B: '他' }, '曖昧');
  const ft = c.sections.map(x => x.text).join('') + c.summary + c.chanceLine + c.tempoLine + c.poem;
  HARD.forEach(w => { if (ft.includes(w)) free[w] = (free[w] || 0) + 1; });

  const pt = report(r).sections.map(x => x.body || '').join('');
  HARD.forEach(w => { if (pt.includes(w)) paid[w] = (paid[w] || 0) + 1; });
}

const show = (name, o) => {
  const e = Object.entries(o).sort((a, b) => b[1] - a[1]);
  console.log(name + '：' + (e.length ? '' : '無 ✓'));
  e.forEach(([k, v]) => console.log('  ' + (v / N * 100).toFixed(1).padStart(5) + '%　' + k));
};
show('免費頁', free);
console.log('');
show('付費報告', paid);

const total = Object.keys(free).length + Object.keys(paid).length;
process.exitCode = total ? 1 : 0;

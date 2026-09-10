/* 框架句互撞檢查（規則 15）
   wrap.js 的框架句共用於 16 個段落，彼此之間重複的話，
   同一份報告裡會出現兩個一樣的開場。 */
const { WRAP } = require('./src/wrap');
const { fillNames } = require('./src/fill');

/* 比對前要先把 {A}／{B} 還原成真的字。六字門檻是照人眼訂的，
   而 {B} 佔三個字元、「他」只佔一個——不還原的話，
   「{B}的位置」會被算成六個字而誤判，但讀者看到的只有「他的位置」四個字。
   跟 lint.js 的 R6 是同一個坑，別再拿原始字串來比。 */
const NAMES = { A: '你', B: '他' };

const all = [];
for (const [sec, v] of Object.entries(WRAP)) {
  v.open.forEach(x => x && all.push([sec, 'open', fillNames(x, NAMES)]));
  v.close.forEach(x => x && all.push([sec, 'close', fillNames(x, NAMES)]));
}

const grams = t => {
  const a = [...t.replace(/[，。；：—「」（）]/g, '')];
  const g = new Set();
  for (let i = 0; i + 6 <= a.length; i++) g.add(a.slice(i, i + 6).join(''));
  return g;
};

const dup = [];
for (let i = 0; i < all.length; i++)
  for (let j = i + 1; j < all.length; j++) {
    const A = grams(all[i][2]), B = grams(all[j][2]);
    for (const g of A)
      if (B.has(g)) { dup.push(`「${g}」　${all[i][0]}/${all[i][1]} × ${all[j][0]}/${all[j][1]}`); break; }
  }

if (dup.length) {
  console.log('✗ 框架句互撞：');
  dup.forEach(d => console.log('  ' + d));
  process.exit(1);
}
console.log(`框架句無互撞 ✓（${all.length} 句）`);

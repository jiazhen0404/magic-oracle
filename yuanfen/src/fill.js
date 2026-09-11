/* =========================================================================
   未完籤所 · 代名詞佔位符替換
   -------------------------------------------------------------------------
   文案裡的對方一律寫成 {B}，自己寫成 {A}，由這裡在輸出前換成實際稱謂。

   為什麼獨立成一個模組：copy.js 與 report.js 都要用，但 report.js 已經
   require 了 copy.js，反過來會變成循環相依。而 build.js 把所有模組併進
   同一個作用域，兩邊各自定義同名函式會被 checkglobals.js 判為衝突。

   為什麼在「輸出前」統一換，而不是每個模組各自收 names：
   模組有十幾個，新增一個忘了接就會漏，而漏掉的那一句要等使用者選了「她」
   才看得到——那種錯誤很難在開發時發現。集中在出口，從結構上就不可能漏。
   ========================================================================= */

function fillNames(v, names) {
  if (typeof v === 'string') {
    return v.replace(/\{A\}/g, names.A).replace(/\{B\}/g, names.B);
  }
  if (Array.isArray(v)) return v.map(x => fillNames(x, names));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = fillNames(v[k], names);
    return o;
  }
  return v;                          // 數字、null、undefined 原樣回傳
}

module.exports = { fillNames };

/* =========================================================================
   未完籤所 · 配偶星（這段關係對你是滋養還是消耗）
   -------------------------------------------------------------------------
   八字裡「你會被什麼樣的人吸引」看的是配偶星：男命看財星（我剋者）、
   女命看官殺（剋我者）。配上日主強弱，傳統會判這顆星對你是喜是忌。

   ★ 這一軸最重要的一件事不在程式裡，在文案裡。
     實測六萬組盤，身弱佔 69%——照傳統寫法，近七成的使用者會讀到
     「你的正緣會消耗你」。那既傷人又不誠實：身弱財旺描述的是一種
     關係狀態，不是這個人命不好。
     所以 spouse-copy.js 把「忌」翻譯成「這段關係會要你付出很多」，
     判準是讀完該覺得「難怪我這麼累」，不是「原來我命不好」。
     改這一軸的文案前，先讀 docs/COPY-REQUEST-SPOUSE-STAR.md。

   六格怎麼決定：
     旺衰落在中和區      → mid（不下助耗的斷言）
     四柱找不到配偶星    → none
     其餘                → 身強身弱 × 透干藏支，四格

   兩個「都成立」的情況怎麼取捨：
     中和 × 無星（約 1.4%）取 none。
     「找不到配偶星」是一個確定的事實，「強弱難判」是沒有結論——
     有話可說的時候就不要說沒話可說。
   ========================================================================= */

const { strength, ST_WUXING, ST_KE, ST_HIDDEN } = require('./strength');
const { SPOUSE_COPY } = require('./spouse-copy');

/* 男以財為妻（我剋者）、女以官殺為夫（剋我者）
   Q10：同性組合一律各自按自己的性別取，不要求使用者自我歸類成
   「比較男方的那個」——那種問法本身就會冒犯人。
   而且配偶星在本產品裡講的是「你期待什麼樣的人」，
   本來就是從自己的命盤看出去的，跟對方是誰無關。
   詳見 docs/ASK-PRACTITIONERS.md Q10。 */
function spouseElement(dayGan, isMale) {
  const me = ST_WUXING[dayGan];
  if (isMale) return ST_KE[me];                                  // 我剋　財星
  for (let e = 0; e < 5; e++) if (ST_KE[e] === me) return e;      // 剋我　官殺
  return me;
}

/* 掃四柱找配偶星。透干（在天干）比藏支（在地支）明顯。 */
function spouseHits(P, isMale) {
  const want = spouseElement(P.day.gan, isMale);
  const cols = [['year', P.year], ['month', P.month], ['day', P.day]];
  if (P.hour) cols.push(['hour', P.hour]);

  const hits = [];
  for (const [col, c] of cols) {
    if (ST_WUXING[c.gan] === want) hits.push({ col, exposed: true });
    ST_HIDDEN[c.zhi].forEach((h, rank) => {
      if (ST_WUXING[h] === want) hits.push({ col, exposed: false, rank });
    });
  }
  return hits;
}

/**
 * @param P       pillars() 的回傳值
 * @param isMale  true 男、false 女。不指定時請不要呼叫這支，整段不顯示
 * @returns {{ cell, core, poem, band, score, hits }}
 */
function spouseStar(P, isMale) {
  const st = strength(P);
  const hits = spouseHits(P, isMale);

  const cell = hits.length === 0 ? 'none'
             : !st.confident     ? 'mid'
             : st.band + '_' + (hits.some(h => h.exposed) ? 'strong' : 'faint');

  const copy = SPOUSE_COPY[cell];
  return {
    cell,
    core: copy.core,
    poems: copy.poems,
    band: st.band,
    score: st.score,
    hits,
  };
}

module.exports = { spouseStar, spouseElement, spouseHits };

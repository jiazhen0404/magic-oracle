/* =========================================================================
   未完籤所 · 格局判讀
   -------------------------------------------------------------------------
   問題：目前「你們現在停在哪裡／卡住的是什麼／值得珍惜的是什麼」三段
   是由分數推出來的——分數帶決定第一段，最低／最高維度決定後兩段。

   但分數是加權平均，是衍生數字，不是盤面事實。實測有 10.9% 的情況
   最低與次低只差 0–2 分，這時候斷言「真正卡住你們的是溫度」是硬掰。

   解法：先看盤面「配置」是什麼樣的格局，再決定要怎麼說。
   分數只用來排名與呈現，不用來決定敘事。
   ========================================================================= */

const HARSH = ['liuchong', 'liuhai', 'xing', 'zixing'];   // 沖害刑
const SWEET = ['liuhe', 'sanhe'];                          // 合

/**
 * @param d  result.dimensions
 * @returns  { pattern, label, weak, strong, flat }
 *   pattern  格局代號
 *   weak     真正的短板（差距不足時為 null）
 *   strong   真正的強項（差距不足時為 null）
 *   flat     三項是否相當
 */
function shape(d) {
  const keys = {
    wendu: d.wendu.key,
    zhongliang: d.zhongliang.key,
    changdu: d.changdu.key
  };
  const rel = [keys.wendu, keys.changdu];              // 只有溫度與長度是地支關係
  const sweet = rel.filter(k => SWEET.includes(k)).length;
  const harsh = rel.filter(k => HARSH.includes(k)).length;
  const flatRel = rel.filter(k => k === 'ping').length;

  const zl = keys.zhongliang;
  const balanced = zl === 'bihe';
  const oneWay = zl === 'a_ke_b' || zl === 'b_ke_a';    // 剋＝壓，最不對等
  const giving = zl === 'a_sheng_b' || zl === 'b_sheng_a';

  const scores = [
    ['wendu', d.wendu.score],
    ['zhongliang', d.zhongliang.score],
    ['changdu', d.changdu.score]
  ].sort((a, b) => a[1] - b[1]);

  const GAP = 8;                       // 低於次低 8 分以上才算真的短板
  const weak   = (scores[1][1] - scores[0][1]) >= GAP ? scores[0][0] : null;
  let   strong = (scores[2][1] - scores[1][1]) >= GAP ? scores[2][0] : null;
  // 兩個高分接近、且都明顯高於最低 → 兩項都是強項
  const twoStrong = !strong && (scores[1][1] - scores[0][1]) >= GAP
    ? [scores[1][0], scores[2][0]] : null;
  const flat   = (scores[2][1] - scores[0][1]) <= 10;

  /* ---- 格局判定（順序即優先度） ---- */
  let pattern;
  if (sweet === 2 && balanced)              pattern = 'harmony';    // 雙合＋對等
  else if (harsh === 2)                     pattern = 'doubleClash';// 雙沖害
  else if (sweet >= 1 && harsh >= 1)        pattern = 'mixed';      // 一合一沖
  else if (sweet === 2)                     pattern = 'sweetUneven';// 雙合但位置不對等
  else if (harsh === 1 && oneWay)           pattern = 'pressed';    // 有沖＋有壓
  else if (flatRel === 2 && balanced)       pattern = 'blank';      // 全平＋對等
  else if (flatRel === 2)                   pattern = 'quiet';      // 全平
  else if (sweet === 1)                     pattern = 'onePoint';   // 單一亮點
  else if (harsh === 1)                     pattern = 'oneSnag';    // 單一卡點
  else                                      pattern = 'plain';

  return { pattern, keys, weak, strong, twoStrong, flat, sweet, harsh, balanced, oneWay, giving };
}

/* ---------- 第一段：你們現在，正處於什麼樣的關係狀態？ ---------- */
/* 由格局決定，不由分數帶決定 */
const NOW = {
  harmony:
    '你們的盤面是少見的整齊。日常相處合得來，長線也對得上，而且兩個人的位置是平的——沒有誰一直在讓。' +
    '這種配置的關係通常不用什麼技巧就能運作，問題反而出在太順：你們可能從來沒有真正吵過，也因此不知道彼此的底線在哪裡。',
  doubleClash:
    '你們的盤面有兩處對沖。這代表不順不是偶發的，是結構性的——日常有摩擦，長線也不容易對齊。' +
    '這聽起來很硬，但它其實比「說不上哪裡不對」好處理，因為問題是具體的、看得見的。',
  mixed:
    '你們的盤面一邊是合、一邊是沖，這是最容易讓人困惑的配置。有些時候你們好到不需要說話，有些時候卻為了小事卡住，' +
    '而且兩種狀態常常在同一週出現。你會反覆懷疑自己判斷錯了——沒有，是這段關係本來就有兩個面。',
  sweetUneven:
    '你們合得來，這件事在盤上很清楚。但兩個人在關係裡的位置不對等，有一方一直在調整。' +
    '合得來讓這個不對等被掩蓋住了，因為日子過得下去，所以沒有人覺得需要處理。',
  pressed:
    '你們的盤面有一處明顯的摩擦，加上位置不對等——這兩件事會互相放大。' +
    '摩擦發生的時候，退讓的那一方會退得更快，於是問題看起來被解決了，其實只是被吞下去。',
  blank:
    '你們的盤面很乾淨，沒有合也沒有沖，位置也是平的。這代表這段關係沒有先天的推力，也沒有先天的阻力。' +
    '它會長成什麼樣子，幾乎完全取決於你們做了什麼——這種盤最誠實，也最沒有藉口。',
  quiet:
    '你們的盤面平穩，沒有明顯的合也沒有明顯的沖。相處起來不會有戲劇性的起伏，' +
    '但也因此少了那種「非他不可」的推力。這種關係走得下去，只是需要有人記得推一把。',
  onePoint:
    '你們的盤面有一個很明確的亮點，其餘平穩。這代表你們之間有一件事是特別對的，' +
    '而那件事往往就是你們走到現在的原因——只是你可能沒有意識到那是優勢。',
  oneSnag:
    '你們的盤面大致平順，但有一處卡點。這種配置的關係通常沒有大問題，' +
    '只是那一個地方會反覆出現，久了會讓你以為整段關係都有問題——其實只有那一處。',
  plain:
    '你們的盤面沒有特別強的訊號，這在合盤裡其實是多數。沒有天生的默契，也沒有天生的對沖，' +
    '你們的關係目前的樣子，大致上就是你們相處出來的樣子。'
};

/* ---------- 第二段：真正卡住你們的，是哪一件事？ ---------- */
/* 有明確短板才指名；沒有就誠實說沒有 */
const WEAK_LINE = {
  wendu:      '具體卡住的地方在日常。不是大事，是相處時那些說不上來的不順——那個部分正在慢慢消耗你們之間本來還不錯的東西。',
  zhongliang: '具體卡住的地方在位置。你們之間有一個人一直在往下讓，另一個人不知道。這件事不解決，其他做得好的部分都會被磨掉。',
  changdu:    '具體卡住的地方在走向。你們現在相處得還可以，但這段關係沒有先天的長度——它不會自己往前，需要有人刻意去推。'
};
const NO_WEAK = {
  flat:
    '這一項要誠實講：你們三個維度的分數很接近，盤上沒有一個明顯的短板。' +
    '這代表現在的狀態不是被某件事拖住的，而是整體就停在這個位置。想往上，得三個地方一起動，不能只修一處。',
  even:
    '盤上沒有單一的短板。三個維度各有各的狀況，但沒有哪一個明顯拖累其他兩個。' +
    '這種情況下不用急著找問題——真正該問的是你們想把這段關係帶去哪裡。'
};

/* ---------- 第三段：你們之間，最值得珍惜的是什麼？ ---------- */
const STRONG_LINE = {
  wendu:      '你們有一個很實在的優勢：日常相處是順的。很多關係就是敗在每天的摩擦上，你們沒有這個問題，這給了你們處理其他事情的餘裕。',
  zhongliang: '你們有一個很好的底子：位置是對等的。沒有人在偷偷承受，也沒有人在無意識地佔上風。這表示你們的問題都可以放到檯面上談。',
  changdu:    '你們有一個先天的好處：這段緣本身走得遠。就算中間有一段不順，它也不容易斷——時間站在你們這邊。'
};
const DIM_CN = { wendu: '日常相處', zhongliang: '位置對等', changdu: '長線走向' };
const TWO_STRONG = (a, b) =>
  '你們有兩個地方是紮實的：' + DIM_CN[a] + '與' + DIM_CN[b] + '。' +
  '這代表前面說的那個卡點不是全面性的，它只卡在一處——而你們有足夠的本錢去處理它。' +
  '很多關係是三項都平庸，你們不是。';

const NO_STRONG = {
  harmony: '要說最值得珍惜的，是這份整齊本身。盤面能同時合得來又位置對等的組合不多，你們現在擁有的東西比你以為的稀有。',
  plain:   '你們沒有一項特別突出，但也沒有一項特別差——這種均衡本身就是資產。它代表這段關係不會因為某個弱點突然崩掉。',
  clash:   '就算盤面有沖，你們還是走到了現在，這件事本身就說明了一些什麼。願意為對方調整的意願，是盤上算不出來的。'
};

function narrate(d) {
  const sh = shape(d);
  const now = NOW[sh.pattern];

  const weak = sh.weak
    ? WEAK_LINE[sh.weak]
    : (sh.flat ? NO_WEAK.flat : NO_WEAK.even);

  let strong;
  if (sh.strong) strong = STRONG_LINE[sh.strong];
  else if (sh.twoStrong) strong = TWO_STRONG(sh.twoStrong[0], sh.twoStrong[1]);
  else if (sh.pattern === 'harmony') strong = NO_STRONG.harmony;
  else if (sh.harsh >= 1) strong = NO_STRONG.clash;
  else strong = NO_STRONG.plain;

  return { shape: sh, now, weak, strong };
}

module.exports = { shape, narrate, NOW, WEAK_LINE, STRONG_LINE, NO_WEAK, NO_STRONG, TWO_STRONG };

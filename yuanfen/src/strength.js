/* =========================================================================
   未完籤所 · 日主強弱（旺衰）
   -------------------------------------------------------------------------
   這一支是整個引擎裡**最沒有標準答案**的一塊。

   RULES.md 規則 11 原本擋著不做，理由是：旺衰各流派吵不完，判反了不是
   「不夠深」，是整份喜忌全部顛倒——該說助力的會講成耗損。
   負責人 2026-09-11 決定要做，那就換一種方式守住它：

     1. 每個有爭議的地方都寫成**具名參數**，不藏在算式裡。
        師資回覆之後改一個數字就好，不用重寫。
        每個參數都標了對應 docs/ASK-PRACTITIONERS.md 的第幾題。

     2. 算出來的不只是「強」或「弱」，還有**一個分數與一段中和區**。
        落在中和區＝這盤本來就難判，這時候上層不准下斷言。
        跟 shape.js 的 GAP = 8 是同一個精神：
        敢說「看不出來」的判讀，才會讓人相信說「看得出來」的時候是真的。

     3. 從格預設**不做**（ST_FOLLOW_MODE = 'off'）。
        從格的喜忌與正格完全相反，是十一題裡唯一「答錯會全反」的一題。
        在師資明確表態之前，少一層深度好過整份反過來。

   分數怎麼來的：
     把八個字（沒時辰就六個）逐一對日干分類——
       幫身：同我（比劫）、生我（印星）
       剋洩耗：我生（食傷）、我剋（財星）、剋我（官殺）
     天干一個算一份，地支按藏干的本氣／中氣／餘氣給不同份量，
     月支再乘上月令權重。最後取 幫 ÷（幫＋耗）×100。
   ========================================================================= */

/* ---------- 可調參數（全部對應 ASK-PRACTITIONERS.md）---------- */

/* Q1　月令權重。月支的份量是其他地支的幾倍。
   暫定 3：市面多數排盤把月令當「最重要但非一票否決」，3 倍大致等於
   讓月令佔總分三成上下。師資若答「一票否決」，這裡改成很大的數字
   （例如 99）即可，不必改算式。 */
const ST_W_MONTH = 3;

/* Q2　通根三種根的份量。暫定 6：3：1。
   一開始寫 3：2：1，被最基本的案例打臉——甲寅甲寅甲寅（滿盤木又得令，
   教科書等級的身強）只算出 53 分的「中和」。原因是寅藏甲丙戊，
   3：2：1 讓中氣丙加餘氣戊剛好等於本氣甲，幫身與耗身互相抵銷。
   次要藏干不該有這種份量。6：3：1 接近常見的人元司令比例（六成／三成／一成）。 */
const ST_ROOT_WEIGHT = { benqi: 6, zhongqi: 3, yuqi: 1 };

/* Q3　虛透（天干透出但地支完全無根）打幾折。暫定五折。 */
const ST_EMPTY_GAN_RATIO = 0.5;

/* Q4　中和區。落在這個區間就是「這盤難判」，上層不准下配偶星的斷言。
   暫定 45–55：訂窄一點會講得比較多，但講錯的機率也高。
   這個區間的實際命中率，calibrate 會印出來。 */
const ST_MID_BAND = [45, 55];

/* Q5　從格。'off' ＝ 一律按正格判。**改動前務必先看 ASK-PRACTITIONERS.md Q5。** */
const ST_FOLLOW_MODE = 'off';

/* Q6　調候。'off' ＝ 一律扶抑。 */
const ST_TIAOHOU_MODE = 'off';

/* ---------- 基礎表 ---------- */

/* 地支藏干，依序為本氣、中氣、餘氣（天干序：甲0 乙1 丙2 丁3 戊4 己5 庚6 辛7 壬8 癸9）
   子丑寅卯辰巳午未申酉戌亥 */
const ST_HIDDEN = [
  [9],          // 子　癸
  [5, 9, 7],    // 丑　己癸辛
  [0, 2, 4],    // 寅　甲丙戊
  [1],          // 卯　乙
  [4, 1, 9],    // 辰　戊乙癸
  [2, 6, 4],    // 巳　丙庚戊
  [3, 5],       // 午　丁己
  [5, 3, 1],    // 未　己丁乙
  [6, 8, 4],    // 申　庚壬戊
  [7],          // 酉　辛
  [4, 7, 3],    // 戌　戊辛丁
  [8, 0],       // 亥　壬甲
];

const ST_WUXING = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];   // 木木火火土土金金水水
const ST_SHENG  = [1, 2, 3, 4, 0];                  // 木生火 火生土 土生金 金生水 水生木
const ST_KE     = [2, 3, 4, 0, 1];                  // 木剋土 火剋金 土剋水 金剋木 水剋火

const ST_ROOT_ORDER = ['benqi', 'zhongqi', 'yuqi'];

/**
 * 某個天干對日干是幫身還是剋洩耗
 * @returns 1 ＝ 幫身（比劫、印星）　-1 ＝ 剋洩耗（食傷、財星、官殺）
 */
function stSide(dayGan, gan) {
  const me = ST_WUXING[dayGan];
  const it = ST_WUXING[gan];
  if (it === me) return 1;              // 同我　比劫
  if (ST_SHENG[it] === me) return 1;    // 生我　印星
  return -1;                            // 我生／我剋／剋我，都是消耗
}

/** 這個天干在四柱地支裡有沒有根（同五行即可） */
function stHasRoot(gan, zhis) {
  const w = ST_WUXING[gan];
  return zhis.some(z => ST_HIDDEN[z].some(h => ST_WUXING[h] === w));
}

/**
 * 日主強弱
 * @param P pillars() 的回傳值，hour 可缺
 * @returns {{ score, band, confident, support, drain, hasHour }}
 *          score     0–100，越高越強
 *          band      'strong' | 'mid' | 'weak'
 *          confident band !== 'mid'。false 時上層不准下斷言
 */
function strength(P) {
  const dayGan = P.day.gan;
  const hasHour = !!P.hour;

  const zhis = [P.year.zhi, P.month.zhi, P.day.zhi];
  if (hasHour) zhis.push(P.hour.zhi);

  /* 日干本身不計入——它是被衡量的對象，不是衡量的材料。 */
  const gans = [P.year.gan, P.month.gan];
  if (hasHour) gans.push(P.hour.gan);

  let support = 0, drain = 0;
  const add = (side, amount) => { if (side > 0) support += amount; else drain += amount; };

  /* 天干：一個算一份，虛透打折 */
  for (const g of gans) {
    const amount = stHasRoot(g, zhis) ? 1 : ST_EMPTY_GAN_RATIO;
    add(stSide(dayGan, g), amount);
  }

  /* 地支：按藏干的本氣／中氣／餘氣給份量，月支再乘月令權重 */
  const zhiList = [
    [P.year.zhi, 1],
    [P.month.zhi, ST_W_MONTH],
    [P.day.zhi, 1],
  ];
  if (hasHour) zhiList.push([P.hour.zhi, 1]);

  for (const [z, mult] of zhiList)
    ST_HIDDEN[z].forEach((h, i) => {
      add(stSide(dayGan, h), ST_ROOT_WEIGHT[ST_ROOT_ORDER[i]] * mult);
    });

  const total = support + drain;
  const score = total === 0 ? 50 : Math.round(support / total * 1000) / 10;

  const band = score < ST_MID_BAND[0] ? 'weak'
             : score > ST_MID_BAND[1] ? 'strong'
             : 'mid';

  return {
    score, band,
    confident: band !== 'mid',
    support: Math.round(support * 10) / 10,
    drain: Math.round(drain * 10) / 10,
    hasHour,
  };
}

module.exports = {
  strength, stSide, stHasRoot,
  ST_HIDDEN, ST_WUXING, ST_SHENG, ST_KE,
  ST_MID_BAND, ST_FOLLOW_MODE, ST_TIAOHOU_MODE,
};

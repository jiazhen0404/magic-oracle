/* =========================================================================
   未完籤所 · 緣分指數 Scoring Engine  (MVP: 只吃 年/月/日，不需時辰)
   -------------------------------------------------------------------------
   純函數：同一組輸入永遠得到同一組分數。無隨機、無時間依賴。
   ========================================================================= */

const GAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const ZHI = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];

// 天干五行
const GAN_WUXING = ['木','木','火','火','土','土','金','金','水','水'];
// 天干陰陽（甲丙戊庚壬為陽）
const GAN_YANG   = [true,false,true,false,true,false,true,false,true,false];

// 五行相生：木→火→土→金→水→木
const SHENG = { 木:'火', 火:'土', 土:'金', 金:'水', 水:'木' };
// 五行相剋：木→土→水→火→金→木
const KE    = { 木:'土', 土:'水', 水:'火', 火:'金', 金:'木' };

/* ---------------- 干支曆 ---------------- */

function jdn(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy
       + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

// 日柱：以 2000-01-07 為甲子日校準
const DAY_ANCHOR = jdn(2000, 1, 7);
function dayPillar(y, m, d) {
  const n = ((jdn(y, m, d) - DAY_ANCHOR) % 60 + 60) % 60;
  return { gan: n % 10, zhi: n % 12 };
}

// 年柱：以立春為界（MVP 用 2/4 近似，誤差 ±1 天，見 README）
function yearPillar(y, m, d) {
  const yy = (m < 2 || (m === 2 && d < 4)) ? y - 1 : y;
  return { gan: ((yy - 4) % 10 + 10) % 10, zhi: ((yy - 4) % 12 + 12) % 12, year: yy };
}

// 時柱：時支由小時直接對照，時干用五鼠遁從日干推
// 五鼠遁：甲己起甲子、乙庚起丙子、丙辛起戊子、丁壬起庚子、戊癸起壬子
function hourPillar(dayGan, hour) {
  const zhi = Math.floor((hour + 1) / 2) % 12;      // 23:00–00:59 為子
  const ziGan = (dayGan % 5) * 2;                   // 該日子時的天干
  return { gan: (ziGan + zhi) % 10, zhi };
}

// 六十甲子納音（依 60 循環序，每 2 組共用一個納音五行）
// 納音五行以 30 為週期，前後兩輪相同
const NAYIN_HALF = ['金','金','火','火','木','木','土','土','金','金',
                    '火','火','水','水','土','土','金','金','木','木',
                    '水','水','土','土','火','火','木','木','水','水'];
const NAYIN = NAYIN_HALF.concat(NAYIN_HALF);
// 六十甲子納音名稱（30 個，每 2 組共用）
const NAYIN_NAME = [
  '海中金','爐中火','大林木','路旁土','劍鋒金','山頭火','澗下水','城頭土','白蠟金','楊柳木',
  '泉中水','屋上土','霹靂火','松柏木','長流水','沙中金','山下火','平地木','壁上土','金箔金',
  '覆燈火','天河水','大驛土','釵釧金','桑柘木','大溪水','沙中土','天上火','石榴木','大海水'
];
function jiaziIndex(gan, zhi) {
  for (let i = 0; i < 60; i++) if (i % 10 === gan && i % 12 === zhi) return i;
  return 0;
}
function nayinName(gan, zhi) { return NAYIN_NAME[Math.floor(jiaziIndex(gan, zhi) / 2)]; }

function nayin(gan, zhi) {
  // 由干支還原 60 序位
  let i = 0;
  for (; i < 60; i++) if (i % 10 === gan && i % 12 === zhi) break;
  return NAYIN[i];
}

/* ---------------- 地支關係 ---------------- */

const SANHE   = [[8,0,4], [11,3,7], [2,6,10], [5,9,1]];   // 申子辰 亥卯未 寅午戌 巳酉丑
const LIUHE   = [[0,1],[2,11],[3,10],[4,9],[5,8],[6,7]];   // 子丑 寅亥 卯戌 辰酉 巳申 午未
const LIUHAI  = [[0,7],[1,6],[2,5],[3,4],[8,11],[9,10]];   // 子未 丑午 寅巳 卯辰 申亥 酉戌
const SANXING = [[2,5,8],[1,10,7]];                        // 寅巳申 丑戌未
const ZIXING  = [4,6,9,11];                                // 辰午酉亥 自刑

function pairIn(list, a, b) {
  return list.some(p => (p[0] === a && p[1] === b) || (p[1] === a && p[0] === b));
}
function bothIn(groups, a, b) {
  return groups.some(g => g.includes(a) && g.includes(b) && a !== b);
}

/**
 * 地支關係判定，回傳 { key, score }
 * score 0–100，越高代表關係越順。
 */
function zhiRelation(a, b) {
  if (pairIn(LIUHE, a, b))                       return { key: 'liuhe',   score: 96 };
  if (bothIn(SANHE, a, b))                       return { key: 'sanhe',   score: 90 };
  if (a === b && ZIXING.includes(a))             return { key: 'zixing',  score: 52 };
  if (a === b)                                   return { key: 'same',    score: 76 };
  if (Math.abs(a - b) === 6)                     return { key: 'liuchong',score: 38 };
  if (pairIn(LIUHAI, a, b))                      return { key: 'liuhai',  score: 48 };
  if (bothIn(SANXING, a, b))                     return { key: 'xing',    score: 50 };
  if ((a === 0 && b === 3) || (a === 3 && b === 0)) return { key: 'xing', score: 50 }; // 子卯相刑
  return { key: 'ping', score: 70 };
}

/* ---------------- 五行關係 ---------------- */

/**
 * 回傳 A 相對 B 的五行關係。
 * bihe 比和｜a_sheng_b A生B｜b_sheng_a B生A｜a_ke_b A剋B｜b_ke_a B剋A
 */
function wuxingRelation(wa, wb) {
  if (wa === wb)        return 'bihe';
  if (SHENG[wa] === wb) return 'a_sheng_b';
  if (SHENG[wb] === wa) return 'b_sheng_a';
  if (KE[wa]    === wb) return 'a_ke_b';
  return 'b_ke_a';
}

/* ---------------- 三個子維度 ---------------- */

// 緣的溫度：日支關係 —— 日常相處合不合、舒不舒服
function scoreWendu(A, B) {
  const r = zhiRelation(A.day.zhi, B.day.zhi);
  return { score: r.score, key: r.key };
}

// 緣的重量：日干五行生剋方向 —— 誰在承擔、誰在退讓
const ZHONGLIANG_BASE = {
  bihe: 84, a_sheng_b: 72, b_sheng_a: 72, a_ke_b: 52, b_ke_a: 52
};
function scoreZhongliang(A, B) {
  const wa = GAN_WUXING[A.day.gan], wb = GAN_WUXING[B.day.gan];
  const rel = wuxingRelation(wa, wb);
  let s = ZHONGLIANG_BASE[rel];
  // 陰陽相配為調和，同陰陽則力道相衝
  const yinyang = GAN_YANG[A.day.gan] !== GAN_YANG[B.day.gan];
  s += yinyang ? 6 : -4;
  return { score: clamp(s), key: rel, wa, wb, yinyang };
}

// 緣的長度：年支關係 + 年柱納音 —— 這段關係能走多遠
const NAYIN_SCORE = { sheng: 90, bihe: 76, ke: 50 };
function scoreChangdu(A, B) {
  const rz = zhiRelation(A.year.zhi, B.year.zhi);
  const na = nayin(A.year.gan, A.year.zhi);
  const nb = nayin(B.year.gan, B.year.zhi);
  const rel = wuxingRelation(na, nb);
  const nKey = rel === 'bihe' ? 'bihe' : (rel.includes('sheng') ? 'sheng' : 'ke');
  const score = Math.round(rz.score * 0.6 + NAYIN_SCORE[nKey] * 0.4);
  return { score, key: rz.key, nayinKey: nKey, na, nb, nayinRel: rel };
}

// 緣的密度：時支關係 + 時干五行 —— 私下相處的樣子（需雙方時辰）
function scoreMidu(A, B) {
  const rz = zhiRelation(A.hour.zhi, B.hour.zhi);
  const wa = GAN_WUXING[A.hour.gan], wb = GAN_WUXING[B.hour.gan];
  const rel = wuxingRelation(wa, wb);
  const gScore = { bihe: 80, a_sheng_b: 76, b_sheng_a: 76, a_ke_b: 54, b_ke_a: 54 }[rel];
  return {
    score: Math.round(rz.score * 0.6 + gScore * 0.4),
    key: rz.key, ganKey: rel, wa, wb
  };
}

/* ---------------- 總分 ---------------- */

const WEIGHTS      = { wendu: 0.35, zhongliang: 0.30, changdu: 0.35 };
// 有時辰時四維並存，密度佔 20%，其餘等比縮
const WEIGHTS_HOUR = { wendu: 0.28, zhongliang: 0.24, changdu: 0.28, midu: 0.20 };

function clamp(n, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, n)); }

function pillars(y, m, d, hour) {
  const day = dayPillar(y, m, d);
  const p = { year: yearPillar(y, m, d), day };
  if (hour !== undefined && hour !== null && hour !== '') {
    p.hour = hourPillar(day.gan, Number(hour));
  }
  return p;
}

/**
 * 主入口。a / b 為 {y, m, d} 或 {y, m, d, hour}（hour 為 0–23 的整數）。
 * 雙方都給了 hour 才會啟用第四維度「緣的密度」；只有一方給等於沒給。
 */
function yuanfen(a, b) {
  const A = pillars(a.y, a.m, a.d, a.hour);
  const B = pillars(b.y, b.m, b.d, b.hour);
  const hasHour = !!(A.hour && B.hour);
  const W = hasHour ? WEIGHTS_HOUR : WEIGHTS;

  const wendu      = scoreWendu(A, B);
  const zhongliang = scoreZhongliang(A, B);
  const changdu    = scoreChangdu(A, B);
  const midu       = hasHour ? scoreMidu(A, B) : null;

  let raw = wendu.score * W.wendu
          + zhongliang.score * W.zhongliang
          + changdu.score * W.changdu;
  if (hasHour) raw += midu.score * W.midu;

  const dimensions = {
    wendu:      { name: '緣的溫度', score: wendu.score, key: wendu.key },
    zhongliang: { name: '緣的重量', score: zhongliang.score, key: zhongliang.key,
                  yinyang: zhongliang.yinyang, wa: zhongliang.wa, wb: zhongliang.wb },
    changdu:    { name: '緣的長度', score: changdu.score, key: changdu.key,
                  nayinKey: changdu.nayinKey }
  };
  if (hasHour) {
    dimensions.midu = { name: '緣的密度', score: midu.score, key: midu.key,
                        ganKey: midu.ganKey, wa: midu.wa, wb: midu.wb };
  }

  const pillarText = (P, na) => {
    const o = {
      year: GAN[P.year.gan] + ZHI[P.year.zhi],
      day:  GAN[P.day.gan]  + ZHI[P.day.zhi],
      nayin: na,
      // 以下是盤面細節，供文案取用——不參與計分，只影響措辭
      yearGan: P.year.gan, yearZhi: P.year.zhi,
      dayGan:  P.day.gan,  dayZhi:  P.day.zhi,
      nayinName: nayinName(P.year.gan, P.year.zhi)
    };
    if (P.hour) {
      o.hour = GAN[P.hour.gan] + ZHI[P.hour.zhi];
      o.hourGan = P.hour.gan; o.hourZhi = P.hour.zhi;
    }
    return o;
  };

  return {
    total: Math.round(raw),
    hasHour,
    weights: W,
    dimensions,
    debug: { A: pillarText(A, changdu.na), B: pillarText(B, changdu.nb) }
  };
}

module.exports = { yuanfen, pillars, hourPillar, nayinName, NAYIN_NAME, zhiRelation, wuxingRelation, nayin, GAN, ZHI, WEIGHTS, WEIGHTS_HOUR };

/* =========================================================================
   未完籤所 · 節氣計算
   -------------------------------------------------------------------------
   要了生辰就要算對。原本立春用 2/4 近似，但立春實際落在 2/3–2/5：
   2021 年是 2/3 22:58、2025 年是 2/3 22:10——那兩年 2/3 出生的人，
   年柱會整整差一年，連帶整份報告全錯。

   這裡直接算太陽視黃經（Meeus 低精度公式，誤差約 ±15 分鐘），
   解出黃經抵達指定角度的時刻。誤差只影響出生在交節前後 15 分鐘的人，
   比 ±1 天好上兩個數量級。

   附帶好處：24 節氣全部算得出來，所以月柱也能排了。
   ========================================================================= */

const TZ = 8;                         // 台灣 UTC+8

/* 儒略日（含小數，UTC） */
function toJD(y, m, d, hourUTC) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1))
       + d + B - 1524.5 + (hourUTC || 0) / 24;
}

function fromJD(jd) {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  let a = z;
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const dd = Math.floor(365.25 * c);
  const e = Math.floor((b - dd) / 30.6001);
  const day = b - dd - Math.floor(30.6001 * e) + f;
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  return { y: year, m: month, d: Math.floor(day), hour: (day - Math.floor(day)) * 24 };
}

/* 太陽視黃經（度）。Meeus 低精度，誤差約 0.01° ≒ 15 分鐘 */
function solarLongitude(jd) {
  const n = jd - 2451545.0;
  const L = 280.460 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * Math.PI / 180;
  let lam = L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g);
  lam %= 360;
  return lam < 0 ? lam + 360 : lam;
}

/* 解出某年太陽黃經抵達 target 度的 JD（UTC）。用二分法。 */
function termJD(year, target) {
  // 以目標角度估算大致日期：黃經 0° 約在 3/20
  const approxDay = ((target + 360 - 280) % 360) / 0.9856 + 1;   // 自 1/1 起算
  let lo = toJD(year, 1, 1, 0) + approxDay - 8;
  let hi = lo + 16;
  const diff = jd => {
    let x = solarLongitude(jd) - target;
    if (x > 180) x -= 360;
    if (x < -180) x += 360;
    return x;
  };
  if (diff(lo) > 0) { lo -= 20; hi -= 20; }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (diff(lo) * diff(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/* 節氣的當地時間（台灣） */
function termLocal(year, target) {
  return fromJD(termJD(year, target) + TZ / 24);
}

/* ---------- 十二節（決定月柱的分界） ---------- */
/* 立春 315、驚蟄 345、清明 15、立夏 45、芒種 75、小暑 105、
   立秋 135、白露 165、寒露 195、立冬 225、大雪 255、小寒 285 */
const JIE = [
  { name: '立春', deg: 315, zhi: 2 },   // 寅
  { name: '驚蟄', deg: 345, zhi: 3 },
  { name: '清明', deg: 15,  zhi: 4 },
  { name: '立夏', deg: 45,  zhi: 5 },
  { name: '芒種', deg: 75,  zhi: 6 },
  { name: '小暑', deg: 105, zhi: 7 },
  { name: '立秋', deg: 135, zhi: 8 },
  { name: '白露', deg: 165, zhi: 9 },
  { name: '寒露', deg: 195, zhi: 10 },
  { name: '立冬', deg: 225, zhi: 11 },
  { name: '大雪', deg: 255, zhi: 0 },   // 子
  { name: '小寒', deg: 285, zhi: 1 }    // 丑
];

/* 某年立春的當地時刻 */
function lichun(year) { return termLocal(year, 315); }

/**
 * 判斷某個當地日期時刻是否已過該年立春。
 * @param hour 當地時（0–23），未給時以中午 12 點估
 */
function afterLichun(y, m, d, hour) {
  if (m > 2) return true;
  if (m < 2) return false;
  const lc = lichun(y);
  if (d !== lc.d) return d > lc.d;
  return (hour === undefined ? 12 : hour) >= lc.hour;
}

/**
 * 月支：由出生時刻落在哪兩個節之間決定。
 * 回傳 { zhi, jie } —— zhi 為地支序（0=子）
 */
function monthZhi(y, m, d, hour) {
  const t = toJD(y, m, d, (hour === undefined ? 12 : hour) - TZ);
  // 找出最後一個已過的節（含跨年，所以往前多看一年）
  let best = null;
  for (const yr of [y - 1, y]) {
    for (const j of JIE) {
      const jd = termJD(yr, j.deg);
      if (jd <= t && (!best || jd > best.jd)) best = { jd, zhi: j.zhi, jie: j.name };
    }
  }
  return best;
}

module.exports = {
  toJD, fromJD, solarLongitude, termJD, termLocal,
  lichun, afterLichun, monthZhi, JIE, TZ
};

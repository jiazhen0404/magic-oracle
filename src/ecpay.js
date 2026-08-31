/**
 * 綠界共用函式
 * ------------------------------------------------------------------
 * 這幾支是從 src/index.js 抽出來的，內容完全一樣。
 * 抽出來是為了讓真人占卜也能用，不必再寫第二套。
 *
 * index.js 目前還留著自己的一份，那是刻意的——
 * 延伸籤已經在收錢，動它有風險。等真人占卜也穩定之後，
 * 再把 index.js 裡的那幾支刪掉、改成從這裡 import 就好。
 */

export const ECPAY_URL = {
  stage: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
  production: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5',
};

/** 訂單編號：前綴 + 台北時間到秒 + 4 碼亂數
 *  延伸籤用 UF，真人占卜用 UO，回調時靠這兩碼分流 */
export function makeTradeNo(prefix) {
  const d = taipeiParts(new Date());
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32])
    .join('');
  return prefix + d.yy + d.MM + d.dd + d.HH + d.mm + d.ss + rand;
}

export function taipeiParts(date) {
  const t = new Date(date.getTime() + 8 * 3600 * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return {
    yyyy: String(t.getUTCFullYear()),
    yy: String(t.getUTCFullYear()).slice(2),
    MM: p(t.getUTCMonth() + 1),
    dd: p(t.getUTCDate()),
    HH: p(t.getUTCHours()),
    mm: p(t.getUTCMinutes()),
    ss: p(t.getUTCSeconds()),
  };
}

/** 綠界要求的日期格式：yyyy/MM/dd HH:mm:ss（台北時間） */
export function taipeiStamp(date) {
  const d = taipeiParts(date);
  return `${d.yyyy}/${d.MM}/${d.dd} ${d.HH}:${d.mm}:${d.ss}`;
}

/**
 * 檢查碼（CheckMacValue）
 *   1. 參數依名稱 A→Z 排序
 *   2. 前後包上 HashKey 與 HashIV
 *   3. URL 編碼後轉小寫
 *   4. 還原七個特殊字元
 *   5. SHA256，轉大寫
 */
export async function checkMac(params, hashKey, hashIv) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'CheckMacValue')
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));

  const query = keys.map((k) => `${k}=${params[k]}`).join('&');
  const raw = `HashKey=${hashKey}&${query}&HashIV=${hashIv}`;

  let encoded = dotNetUrlEncode(raw).toLowerCase();
  encoded = encoded
    .replace(/%2d/g, '-')
    .replace(/%5f/g, '_')
    .replace(/%2e/g, '.')
    .replace(/%21/g, '!')
    .replace(/%2a/g, '*')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')');

  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** 模擬 .NET 的 HttpUtility.UrlEncode */
export function dotNetUrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let out = '';
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    if ((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122)) {
      out += ch;
    } else if (ch === ' ') {
      out += '+';
    } else if ('-_.!*()'.includes(ch)) {
      out += ch;
    } else {
      out += '%' + b.toString(16).padStart(2, '0');
    }
  }
  return out;
}

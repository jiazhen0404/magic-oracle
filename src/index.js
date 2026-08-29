/**
 * 未完籤所 · 後端主程式
 * ------------------------------------------------------------------
 * 這支程式負責網站「會動」的部分。沒有它，Cloudflare 只會把檔案送出去。
 *
 * 目前提供這些網址（統稱 API）：
 *   POST /api/create-order    建立訂單，回傳綠界付款表單需要的欄位
 *   POST /api/ecpay-callback  綠界付款成功後，由綠界主動通知這裡
 *   GET  /api/order-status    前端用來問「這筆付好了沒」
 *   POST /api/unlock          付款成功後換一張解鎖憑證
 *   GET  /api/extended        憑解鎖憑證讀取延伸解籤全文
 *
 * 其他所有網址都交還給靜態檔案（首頁、籤文頁、圖片⋯⋯）。
 *
 * 延伸籤全文放在 src/extended-love.json，會被打包進程式裡面。
 * 它不是網站上的檔案，外面下載不到——這是付費內容唯一安全的放法。
 *
 * 需要的設定（在 Cloudflare 後台填，不要寫進這個檔案）：
 *   ECPAY_MERCHANT_ID   綠界商店代號
 *   ECPAY_HASH_KEY      綠界 HashKey    ← 機密
 *   ECPAY_HASH_IV       綠界 HashIV     ← 機密
 *   ECPAY_MODE          stage（測試）或 production（正式），寫在 wrangler.jsonc
 *   ORDERS              KV 儲存空間（暫存訂單用）
 */

import EXTENDED from './extended-love.json';
import { buildPdfHtml } from './pdf-template.js';

const PRICE = 99;                       // 售價，改這裡就好
const ORDER_TTL = 60 * 60 * 24;         // 訂單暫存 24 小時後自動消失
const UNLOCK_TTL = 60 * 60 * 24 * 365;  // 解鎖憑證保留一年
const MAX_QUESTION = 500;               // 使用者問題的字數上限

const ECPAY_URL = {
  stage: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
  production: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/create-order' && request.method === 'POST') {
        return await createOrder(request, env, url);
      }
      if (path === '/api/ecpay-callback' && request.method === 'POST') {
        return await ecpayCallback(request, env, ctx, url);
      }
      if (path === '/api/order-status' && request.method === 'GET') {
        return await orderStatus(url, env);
      }
      if (path === '/api/unlock' && request.method === 'POST') {
        return await issueUnlock(request, env);
      }
      if (path === '/api/extended' && request.method === 'GET') {
        return await readExtended(request, url, env);
      }
      if (path === '/api/resend-pdf' && request.method === 'POST') {
        return await resendPdf(request, env, url);
      }
      if (path === '/api/health') {
        return json({
          ok: true,
          mode: env.ECPAY_MODE || 'stage',
          hasMerchantId: Boolean(env.ECPAY_MERCHANT_ID),
          hasHashKey: Boolean(env.ECPAY_HASH_KEY),
          hasHashIv: Boolean(env.ECPAY_HASH_IV),
          hasKv: Boolean(env.ORDERS),
          extendedCount: EXTENDED.length,
          hasCfAccount: Boolean(env.CF_ACCOUNT_ID),
          hasCfToken: Boolean(env.CF_API_TOKEN),
          hasResendKey: Boolean(env.RESEND_API_KEY),
        });
      }
    } catch (err) {
      console.error('API 發生錯誤', path, err && err.stack ? err.stack : err);
      return json({ error: 'internal_error' }, 500);
    }

    // 不是 API 就交還給靜態檔案
    return env.ASSETS.fetch(request);
  },
};

/* ══════════════════════════════════════════════════════════
   一、建立訂單
   ══════════════════════════════════════════════════════════ */

async function createOrder(request, env, url) {
  const missing = checkConfig(env);
  if (missing.length) {
    console.error('缺少設定：' + missing.join(', '));
    return json({ error: 'not_configured', missing }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const slipId = String(body.slipId || '').trim();
  const email = String(body.email || '').trim();
  const question = String(body.question || '').slice(0, MAX_QUESTION);
  const drawnAt = String(body.drawnAt || '').slice(0, 40);
  const consent = body.consent || {};

  // ── 檢查 ──
  if (!/^love_[a-z-]{3,20}_\d{3}$/.test(slipId)) {
    return json({ error: 'bad_slip_id' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    return json({ error: 'bad_email' }, 400);
  }
  // 法規要求：數位內容不適用七日解除權，必須留下「事先同意」的證據
  if (consent.terms !== true || consent.digitalContent !== true) {
    return json({ error: 'consent_required' }, 400);
  }

  const tradeNo = makeTradeNo();
  const now = new Date();

  // ── 寫進暫存 ──
  // 使用者的問題很私密，所以只暫存 24 小時，寄出 PDF 後會立刻刪除。
  await env.ORDERS.put(
    'order:' + tradeNo,
    JSON.stringify({
      tradeNo,
      slipId,
      email,
      question,
      drawnAt,
      amount: PRICE,
      status: 'pending',
      consent: {
        terms: true,
        digitalContent: true,
        consentAt: String(consent.consentAt || now.toISOString()).slice(0, 40),
      },
      createdAt: now.toISOString(),
    }),
    { expirationTtl: ORDER_TTL }
  );

  // ── 組綠界的表單欄位 ──
  const origin = url.origin;
  const params = {
    MerchantID: env.ECPAY_MERCHANT_ID,
    MerchantTradeNo: tradeNo,
    MerchantTradeDate: taipeiStamp(now),
    PaymentType: 'aio',
    TotalAmount: String(PRICE),
    TradeDesc: '未完籤所 完整解籤',
    ItemName: '完整解籤 x 1',
    ReturnURL: origin + '/api/ecpay-callback',
    ClientBackURL: origin + '/checkout/done/?no=' + tradeNo,
    ChoosePayment: 'ALL',
    EncryptType: '1',
    CustomField1: slipId,
  };
  params.CheckMacValue = await checkMac(params, env.ECPAY_HASH_KEY, env.ECPAY_HASH_IV);

  return json({
    action: ECPAY_URL[env.ECPAY_MODE === 'production' ? 'production' : 'stage'],
    fields: params,
  });
}

/* ══════════════════════════════════════════════════════════
   二、綠界付款通知
   綠界的伺服器會 POST 到這裡。回應必須是純文字 1|OK，
   否則綠界會判定失敗並重送。
   ══════════════════════════════════════════════════════════ */

async function ecpayCallback(request, env, ctx, url) {
  const form = await request.formData();
  const data = {};
  for (const [k, v] of form.entries()) data[k] = String(v);

  // ── 驗章：確認這筆通知真的來自綠界，不是別人偽造的 ──
  const received = data.CheckMacValue;
  const rest = { ...data };
  delete rest.CheckMacValue;
  const expected = await checkMac(rest, env.ECPAY_HASH_KEY, env.ECPAY_HASH_IV);

  if (!received || received.toUpperCase() !== expected) {
    console.error('綠界通知驗章失敗', data.MerchantTradeNo);
    return new Response('0|CheckMacValue Error', { status: 400 });
  }

  const tradeNo = data.MerchantTradeNo || '';
  const raw = await env.ORDERS.get('order:' + tradeNo);

  if (!raw) {
    // 訂單過期或不存在。仍回 1|OK，否則綠界會一直重送。
    console.error('找不到訂單', tradeNo);
    return new Response('1|OK', { headers: { 'content-type': 'text/plain' } });
  }

  const order = JSON.parse(raw);

  if (data.RtnCode === '1') {
    // 金額必須相符，避免有人竄改
    if (Number(data.TradeAmt) !== order.amount) {
      console.error('金額不符', tradeNo, data.TradeAmt, order.amount);
      return new Response('1|OK', { headers: { 'content-type': 'text/plain' } });
    }
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    order.ecpayTradeNo = data.TradeNo || '';
    order.paymentType = data.PaymentType || '';
  } else {
    order.status = 'failed';
    order.failReason = (data.RtnMsg || '').slice(0, 200);
  }

  await env.ORDERS.put('order:' + tradeNo, JSON.stringify(order), {
    expirationTtl: ORDER_TTL,
  });

  // 付款成功就在背景產 PDF、寄信。
  // 用 waitUntil 是為了讓綠界立刻收到 1|OK，不會因為我們慢而重送通知。
  if (order.status === 'paid' && ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(deliverReading(tradeNo, env, url.origin));
  }

  return new Response('1|OK', { headers: { 'content-type': 'text/plain' } });
}

/* ══════════════════════════════════════════════════════════
   三、查詢訂單狀態
   只回傳「付了沒」跟「哪一支籤」，
   絕對不回傳使用者的問題與信箱。
   ══════════════════════════════════════════════════════════ */

async function orderStatus(url, env) {
  const tradeNo = url.searchParams.get('no') || '';
  if (!/^[A-Za-z0-9]{6,20}$/.test(tradeNo)) return json({ error: 'bad_no' }, 400);

  const raw = await env.ORDERS.get('order:' + tradeNo);
  if (!raw) return json({ status: 'not_found' }, 404);

  const order = JSON.parse(raw);
  return json({
    status: order.status,
    slipId: order.slipId,
    amount: order.amount,
    // 寄送狀況。這些是給你自己排查用的，不含信箱與問題內容。
    mailed: Boolean(order.mailedAt),
    mailedAt: order.mailedAt || null,
    deliveryError: order.deliveryError || null,
    deliveryTriedAt: order.deliveryTriedAt || null,
  });
}

/* ══════════════════════════════════════════════════════════
   四、換發解鎖憑證
   付款成功的訂單，可以換一張憑證。憑證本身是一串亂數，
   存在使用者的瀏覽器裡；伺服器只記「這張憑證對應哪一支籤」，
   不含信箱、不含問題。
   ══════════════════════════════════════════════════════════ */

async function issueUnlock(request, env) {
  if (!env.ORDERS) return json({ error: 'not_configured' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const tradeNo = String(body.tradeNo || '');
  if (!/^[A-Za-z0-9]{6,20}$/.test(tradeNo)) return json({ error: 'bad_no' }, 400);

  const raw = await env.ORDERS.get('order:' + tradeNo);
  if (!raw) return json({ error: 'not_found' }, 404);

  const order = JSON.parse(raw);
  if (order.status !== 'paid') return json({ error: 'not_paid', status: order.status }, 402);

  // 同一筆訂單重複索取，就把同一張憑證給回去，不會一直長出新的
  if (order.unlockToken) {
    return json({ token: order.unlockToken, slipId: order.slipId });
  }

  const token = randomToken();
  await env.ORDERS.put(
    'unlock:' + token,
    JSON.stringify({ slipId: order.slipId, issuedAt: new Date().toISOString() }),
    { expirationTtl: UNLOCK_TTL }
  );

  order.unlockToken = token;
  await env.ORDERS.put('order:' + tradeNo, JSON.stringify(order), { expirationTtl: ORDER_TTL });

  return json({ token, slipId: order.slipId });
}

/* ══════════════════════════════════════════════════════════
   五、讀取延伸解籤全文
   沒有有效憑證就回 402，前端據此顯示「尚未解鎖」。
   ══════════════════════════════════════════════════════════ */

async function readExtended(request, url, env) {
  const slipId = url.searchParams.get('id') || '';
  if (!/^love_[a-z-]{3,20}_\d{3}$/.test(slipId)) return json({ error: 'bad_slip_id' }, 400);

  const token = request.headers.get('X-Unlock-Token') || '';
  if (!/^[A-Za-z0-9]{20,60}$/.test(token)) return json({ error: 'locked' }, 402);

  if (!env.ORDERS) return json({ error: 'not_configured' }, 503);
  const rec = await env.ORDERS.get('unlock:' + token);
  if (!rec) return json({ error: 'locked' }, 402);

  // 這張憑證只能開它買的那一支籤
  if (JSON.parse(rec).slipId !== slipId) return json({ error: 'locked' }, 402);

  const slip = EXTENDED.find((x) => x.id === slipId);
  if (!slip) return json({ error: 'not_found' }, 404);

  return json(slip);
}

/* ══════════════════════════════════════════════════════════
   六、產生 PDF 並寄出
   跑在付款通知之後、用背景執行，所以綠界不用等我們產完 PDF。
   寄出成功後立刻把使用者的問題與信箱抹掉——那是隱私權政策上的承諾。
   ══════════════════════════════════════════════════════════ */

async function deliverReading(tradeNo, env, origin) {
  const raw = await env.ORDERS.get('order:' + tradeNo);
  if (!raw) return { ok: false, reason: 'order_gone' };

  const order = JSON.parse(raw);
  if (order.status !== 'paid') return { ok: false, reason: 'not_paid' };
  if (order.mailedAt) return { ok: true, reason: 'already_sent' };
  if (!order.email) return { ok: false, reason: 'no_email' };

  const slip = EXTENDED.find((x) => x.id === order.slipId);
  if (!slip) return { ok: false, reason: 'slip_not_found' };

  try {
    const pdf = await renderPdf(slip, order, env, origin);
    await sendMail(slip, order, pdf, env);

    // ── 寄出了，馬上抹掉個資 ──
    // 只留爭議處理需要的：訂單編號、同意時間、買了哪一支、金額。
    await env.ORDERS.put('order:' + tradeNo, JSON.stringify({
      tradeNo: order.tradeNo,
      slipId: order.slipId,
      amount: order.amount,
      status: 'paid',
      consent: order.consent,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      ecpayTradeNo: order.ecpayTradeNo,
      unlockToken: order.unlockToken,
      mailedAt: new Date().toISOString(),
      // email 與 question 到此為止，不再保留
    }), { expirationTtl: ORDER_TTL });

    return { ok: true };
  } catch (err) {
    const msg = String((err && err.message) || err).slice(0, 300);
    console.error('寄送失敗', tradeNo, msg);
    order.deliveryError = msg;
    order.deliveryTriedAt = new Date().toISOString();
    await env.ORDERS.put('order:' + tradeNo, JSON.stringify(order), { expirationTtl: ORDER_TTL });
    return { ok: false, reason: msg };
  }
}

/** 把版面交給 Cloudflare 的 Browser Rendering 轉成 PDF */
async function renderPdf(slip, order, env, origin) {
  const html = buildPdfHtml(slip, {
    question: order.question,
    drawnAt: order.drawnAt || order.createdAt,
    orderNo: order.tradeNo,
    fontBase: origin + '/assets/fonts/',
  });

  const pdfOptions = {
    format: 'a4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%;font-family:serif;font-size:7pt;color:#A8A2B4;'
      + 'padding:0 20mm;display:flex;justify-content:space-between;">'
      + '<span>未完籤所 · MAGIC ORACLE</span><span class="pageNumber"></span></div>',
    margin: { top: '22mm', bottom: '18mm', left: '20mm', right: '20mm' },
  };

  async function ask(waitForFonts) {
    const body = {
      html,
      gotoOptions: { waitUntil: 'networkidle0', timeout: 45000 },
      pdfOptions,
    };
    // 等字型真的載完才截圖。少了這個，Cloudflare 會用它自己的字型，
    // 中文看起來像對的，但複製出來會是不同的字。
    if (waitForFonts) {
      body.waitForSelector = { selector: '#fonts-ready', timeout: 15000 };
    }
    return fetch(
      'https://api.cloudflare.com/client/v4/accounts/' + env.CF_ACCOUNT_ID + '/browser-rendering/pdf',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.CF_API_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
  }

  // 先用「等字型」的方式試。如果因此失敗，就退一步用一般方式再試一次——
  // 字型不對總比信寄不出去好。
  let res = await ask(true);
  if (!res.ok) {
    const first = (await res.text()).slice(0, 200);
    console.error('產 PDF（等字型）失敗，改用一般方式重試：' + res.status + ' ' + first);
    res = await ask(false);
    if (!res.ok) {
      throw new Error('產生 PDF 失敗 ' + res.status + ' ' + (await res.text()).slice(0, 200));
    }
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** 透過 Resend 寄出，PDF 當附件 */
async function sendMail(slip, order, pdfBytes, env) {
  const from = env.MAIL_FROM || '未完籤所 <hello@unfinished.tw>';
  const filename = '未完籤所_' + slip.name + '_完整解籤.pdf';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [order.email],
      reply_to: 'hello@unfinished.tw',
      subject: '你的完整解籤：' + slip.name,
      html: mailHtml(slip, order),
      text: mailText(slip, order),
      attachments: [{ filename, content: base64(pdfBytes) }],
    }),
  });

  if (!res.ok) {
    throw new Error('寄信失敗 ' + res.status + ' ' + (await res.text()).slice(0, 200));
  }
}

function mailHtml(slip, order) {
  return '<!doctype html><html lang="zh-Hant"><body style="margin:0;padding:0;background:#0B1026;">'
  + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B1026;padding:36px 16px;">'
  + '<tr><td align="center"><table role="presentation" width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">'
  + '<tr><td align="center" style="padding-bottom:26px;font-family:Georgia,\'Songti TC\',serif;">'
  +   '<div style="color:#C9A961;font-size:14px;letter-spacing:.4em;">未完籤所</div>'
  +   '<div style="color:#8A8698;font-size:9px;letter-spacing:.3em;margin-top:6px;">MAGIC ORACLE</div>'
  + '</td></tr>'
  + '<tr><td style="border:1px solid #8A7443;padding:30px 26px;font-family:Georgia,\'Songti TC\',serif;">'
  +   '<div style="color:#8A8698;font-size:11px;letter-spacing:.24em;text-align:center;">完整解籤</div>'
  +   '<div style="color:#C9A961;font-size:26px;letter-spacing:.14em;text-align:center;margin:12px 0 8px;">' + esc(slip.name) + '</div>'
  +   '<div style="color:#9A9384;font-size:12px;letter-spacing:.16em;text-align:center;">愛情・' + esc(slip.situation) + '</div>'
  +   '<div style="height:1px;background:#1E2749;margin:24px 0;"></div>'
  +   '<div style="color:#E8E3D9;font-size:15px;line-height:2;">謝謝你讓這支籤陪你想一想。<br><br>'
  +   '完整的解讀在附件的 PDF 裡，共四頁。換手機、清除瀏覽器紀錄都不會消失，'
  +   '建議你留著，過一段時間再讀一次，感覺常常會不一樣。</div>'
  +   '<div style="height:1px;background:#1E2749;margin:24px 0;"></div>'
  +   '<div style="color:#8A8698;font-size:12px;line-height:1.9;">訂單編號　' + esc(order.tradeNo) + '<br>'
  +   '有任何問題，直接回這封信就可以。</div>'
  + '</td></tr>'
  + '<tr><td align="center" style="padding-top:22px;font-family:Georgia,serif;color:#6E6A5E;font-size:11px;line-height:1.9;">'
  +   '籤文陪你把問題想清楚，不預測未來，也不保證結果。<br>'
  +   '<a href="https://unfinished.tw" style="color:#9A9384;text-decoration:none;">unfinished.tw</a>'
  + '</td></tr></table></td></tr></table></body></html>';
}

function mailText(slip, order) {
  return [
    '未完籤所 · MAGIC ORACLE', '',
    '完整解籤：' + slip.name + '（愛情・' + slip.situation + '）', '',
    '謝謝你讓這支籤陪你想一想。',
    '完整的解讀在附件的 PDF 裡，共四頁，建議留著，過一段時間再讀一次。', '',
    '訂單編號　' + order.tradeNo,
    '有任何問題，直接回這封信就可以。', '',
    'unfinished.tw',
  ].join('\n');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/** 把 PDF 的位元組轉成 base64，分段處理避免爆堆疊 */
function base64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

/* ══════════════════════════════════════════════════════════
   七、手動重寄（客服用）
   使用者說沒收到信、或信箱填錯時用這支。
   需要 ADMIN_KEY，只有你知道。
   ══════════════════════════════════════════════════════════ */

async function resendPdf(request, env, url) {
  if (!env.ADMIN_KEY || request.headers.get('X-Admin-Key') !== env.ADMIN_KEY) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const tradeNo = String(body.tradeNo || '');
  if (!/^[A-Za-z0-9]{6,20}$/.test(tradeNo)) return json({ error: 'bad_no' }, 400);

  const raw = await env.ORDERS.get('order:' + tradeNo);
  if (!raw) return json({ error: 'not_found', hint: '訂單已超過 24 小時自動刪除' }, 404);

  const order = JSON.parse(raw);

  // 換信箱重寄（原本填錯的情況）
  if (body.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) return json({ error: 'bad_email' }, 400);
    order.email = String(body.email).trim();
  }
  if (!order.email) {
    return json({ error: 'no_email', hint: '這筆已經寄過並清除信箱，請帶 email 參數指定要寄到哪裡' }, 400);
  }

  delete order.mailedAt;          // 允許再寄一次
  delete order.deliveryError;
  await env.ORDERS.put('order:' + tradeNo, JSON.stringify(order), { expirationTtl: ORDER_TTL });

  const r = await deliverReading(tradeNo, env, url.origin);
  return json(r, r.ok ? 200 : 500);
}

/* ══════════════════════════════════════════════════════════
   工具
   ══════════════════════════════════════════════════════════ */

/** 32 碼亂數憑證，用不會看錯的字元集 */
function randomToken() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => A[b % A.length])
    .join('');
}

function checkConfig(env) {
  const missing = [];
  if (!env.ECPAY_MERCHANT_ID) missing.push('ECPAY_MERCHANT_ID');
  if (!env.ECPAY_HASH_KEY) missing.push('ECPAY_HASH_KEY');
  if (!env.ECPAY_HASH_IV) missing.push('ECPAY_HASH_IV');
  if (!env.ORDERS) missing.push('ORDERS (KV)');
  return missing;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** 訂單編號：UF + 台北時間到秒 + 4 碼亂數，共 18 碼，只用英數字 */
function makeTradeNo() {
  const d = taipeiParts(new Date());
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32])
    .join('');
  return 'UF' + d.yy + d.MM + d.dd + d.HH + d.mm + d.ss + rand;
}

function taipeiParts(date) {
  // 台北固定 UTC+8，不用處理日光節約
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
function taipeiStamp(date) {
  const d = taipeiParts(date);
  return `${d.yyyy}/${d.MM}/${d.dd} ${d.HH}:${d.mm}:${d.ss}`;
}

/**
 * 綠界的檢查碼（CheckMacValue）
 * 步驟是綠界文件規定的，順序不能改：
 *   1. 參數依名稱 A→Z 排序
 *   2. 前後包上 HashKey 與 HashIV
 *   3. 做 URL 編碼，轉小寫
 *   4. 還原七個特殊字元
 *   5. SHA256，轉大寫
 */
async function checkMac(params, hashKey, hashIv) {
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

/** 模擬 .NET 的 HttpUtility.UrlEncode，綠界是用 .NET 寫的，編碼規則要一致 */
function dotNetUrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let out = '';
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    if ((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122)) {
      out += ch;                       // 英數字不編碼
    } else if (ch === ' ') {
      out += '+';                      // 空白變加號
    } else if ('-_.!*()'.includes(ch)) {
      out += ch;                       // .NET 不編碼這七個
    } else {
      out += '%' + b.toString(16).padStart(2, '0');
    }
  }
  return out;
}

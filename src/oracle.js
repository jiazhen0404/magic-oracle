/**
 * 未完籤所 · 真人占卜
 * ------------------------------------------------------------------
 * 這個檔案負責真人占卜的全部：下單付款、你的審稿後台、老師端、客人查詢。
 * 延伸籤那條線（99 元）完全沒有動到，兩邊各走各的。
 *
 * 網址：
 *   /oracle/admin         你的後台
 *   /oracle/teacher       老師端
 *   /oracle/order         客人查詢進度
 *   /oracle/done          付款完成
 *   /api/oracle/...       前端呼叫的 API
 *
 * 訂單編號開頭是 UO，延伸籤是 UF，綠界通知靠這兩碼分流。
 * 訂單存在同一個 KV（ORDERS），key 前綴是 oracle:，不會跟延伸籤打架。
 *
 * 需要的設定（Cloudflare 後台）：
 *   ADMIN_KEY           你的後台密碼                    Secret
 *   TEACHER_KEYS        老師清單，格式見下              Secret
 *     lightwalker:光行者老師:密碼1,iris:Iris 老師:密碼2,james:小光先生:密碼3
 *   ANTHROPIC_API_KEY   AI 問籤引導用                   Secret
 *   ADMIN_EMAIL         你的信箱，收系統通知            Text
 *   MAIL_LIGHTWALKER    光行者老師的信箱（代號大寫）     Text
 *   MAIL_IRIS           Iris 老師的信箱                 Text
 *   MAIL_JAMES          小光先生的信箱                  Text
 *
 * 綠界的三個設定沿用延伸籤那組，不用另外設。
 * 選用：R2 綁定 MEDIA（牌陣照片）、KV 綁定 RATE（AI 限流）
 */

import { ECPAY_URL, makeTradeNo, taipeiStamp, checkMac } from './ecpay.js';

const PRICE = 399;
const DEEP_CREDIT = 99;                  /* 已買延伸籤可折抵，前端傳 hasDeep */
const MODEL = 'claude-sonnet-5';
const MAX_TURNS = 10;
const MAX_CHARS = 800;
const RATE_LIMIT = 30;
const RATE_WINDOW = 3600;
const KEEP_DAYS = 180;

/* ═══════════════════════════════════════════════════════════
   綠界環境。跟延伸籤分開，兩邊互不影響。

   ORACLE_ECPAY_MODE = stage        測試模式（預設）
   ORACLE_ECPAY_MODE = production   正式收款

   測試模式會自動改用綠界公開的測試商店，
   不會動到你的正式商店代號，也不會真的扣款。

   測試卡號 4311-9511-1111-1111
   有效期限 隨便填未來日期，安全碼隨便三碼
   3D 驗證密碼 1234
   ═══════════════════════════════════════════════════════════ */
const ECPAY_TEST = {
  id:  '3002607',
  key: 'pwFHCqoQZGmho4w6',
  iv:  'EkRm7iFT261dpevs'
};

function ecpayConf(env) {
  const mode = String(env.ORACLE_ECPAY_MODE || 'stage').toLowerCase();
  if (mode === 'production') {
    return {
      mode: 'production',
      id: env.ECPAY_MERCHANT_ID,
      key: env.ECPAY_HASH_KEY,
      iv: env.ECPAY_HASH_IV,
      url: ECPAY_URL.production
    };
  }
  return { mode: 'stage', id: ECPAY_TEST.id, key: ECPAY_TEST.key,
           iv: ECPAY_TEST.iv, url: ECPAY_URL.stage };
}
const TTL = 60 * 60 * 24 * KEEP_DAYS;

function now() { return new Date().toISOString(); }

/* ══════════════════════════════════════════════════
   路由。不是真人占卜的路徑就回傳 null，交還給 index.js
   ══════════════════════════════════════════════════ */

export async function oracleRoutes(request, env, ctx, url) {
  const path = url.pathname;
  const origin = pickOrigin(request, env);

  if (!path.startsWith('/oracle/') && !path.startsWith('/api/oracle/')) return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(origin) });
  }

  try {
    if (path === '/oracle/admin')   return html(PAGE_ADMIN);
    if (path === '/oracle/teacher') return html(PAGE_TEACHER);
    if (path === '/oracle/order')   return html(PAGE_ORDER);
    if (path === '/oracle/done')    return html(PAGE_DONE);

    if (path === '/api/oracle/health') {
      return json({
        ok: true, price: PRICE,
        mode: ecpayConf(env).mode,
        modeNote: ecpayConf(env).mode === 'stage'
          ? '測試模式，用測試卡，不會真的扣款'
          : '正式收款中',
        hasEcpay: !!ecpayConf(env).id,
        hasAdminKey: !!env.ADMIN_KEY,
        hasAiKey: !!env.ANTHROPIC_API_KEY,
        hasKv: !!env.ORDERS,
        hasMediaR2: !!env.MEDIA,
        hasMail: !!env.RESEND_API_KEY,
        mailFrom: env.MAIL_FROM || '(未設定，會用 Resend 預設網域，很可能寄不出去)',
        adminEmail: env.ADMIN_EMAIL || '(未設定，你收不到通知)',
        teacherMails: teacherList(env).map(t => t.id + ':' + (env['MAIL_' + t.id.toUpperCase()] ? '已設定' : '未設定')),
        teachers: teacherList(env).map(t => t.id)
      }, 200, origin);
    }

    if (path.startsWith('/oracle/media/')) {
      if (!env.MEDIA) return new Response('no bucket', { status: 404 });
      const obj = await env.MEDIA.get(path.slice(14));
      if (!obj) return new Response('not found', { status: 404 });
      return new Response(obj.body, {
        headers: {
          'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000'
        }
      });
    }

    if (path === '/api/oracle/credit') {
      const t = url.searchParams.get('t') || '';
      return json({ ok: true, credit: (await checkDeepCredit(env, t)) ? DEEP_CREDIT : 0 }, 200, origin);
    }
    if (path === '/api/oracle/create-order') return createOracleOrder(request, env, url, origin);
    if (path === '/api/oracle/status')       return oracleStatus(request, env, origin);
    if (path === '/api/oracle/guide')        return guide(request, env, origin);

    if (path.startsWith('/api/oracle/admin/'))   return adminApi(request, env, ctx, path, origin);
    if (path.startsWith('/api/oracle/teacher/')) return teacherApi(request, env, ctx, path, origin);
    if (path.startsWith('/api/oracle/order/'))   return orderApi(request, env, ctx, path, origin);

    return json({ error: 'not_found' }, 404, origin);

  } catch (e) {
    console.error('oracle', path, e.stack || e.message);
    return json({ error: 'server', detail: String(e.message).slice(0, 200) }, 500, origin);
  }
}

/* ══════════════════════════════════════════════════
   一、建立訂單（付款前）
   前端把整理好的受理單送過來，這裡存成未付款，
   回傳綠界表單欄位。付款成功之前不會出現在後台。
   ══════════════════════════════════════════════════ */

async function createOracleOrder(request, env, url, origin) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);
  if (!env.ORDERS) return json({ error: 'no_kv' }, 500, origin);
  const ec = ecpayConf(env);
  if (!ec.id || !ec.key || !ec.iv) {
    return json({ error: 'not_configured', hint: '正式模式需要設定綠界三個變數' }, 503, origin);
  }

  let o;
  try { o = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, origin); }

  const q    = String(o.main_question || '').trim();
  const bg   = String(o.background || '').trim();
  const mail = String(o.email || '').trim();
  const teacher = String(o.teacher || '').trim();

  if (q.length < 4)  return json({ error: 'bad_question' }, 400, origin);
  if (bg.length < 8) return json({ error: 'bad_background' }, 400, origin);
  if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(mail)) return json({ error: 'bad_email' }, 400, origin);
  if (!teacher) return json({ error: 'no_teacher' }, 400, origin);
  /* 法規要求：客製化服務不適用七日解除權，要留下事先同意的證據 */
  if (o.consent !== true) return json({ error: 'consent_required' }, 400, origin);

  /* 折抵不能信前端。要拿 99 元的解鎖憑證來，由後端查 KV 驗證。
     一張憑證只能折抵一次，付款成功時才標記用掉。 */
  const deepToken = String(o.deep_token || '').trim();
  const hasDeep = await checkDeepCredit(env, deepToken);
  const amount = hasDeep ? PRICE - DEEP_CREDIT : PRICE;
  const id = makeTradeNo('UO');
  const d = new Date();

  const order = {
    id,
    st: 'unpaid',
    created: now(),
    ecpay_mode: ec.mode,
    paid: false,
    amount,
    hasDeep,
    deep_token: hasDeep ? deepToken : '',

    name:        String(o.name || '').slice(0, 12),
    email:       mail.slice(0, 120),
    teacher:     teacher.slice(0, 20),

    q_original:  q.slice(0, 60),
    q:           q.slice(0, 60),
    timeframe:   String(o.timeframe || '').slice(0, 20),
    intent:      String(o.intent || '').slice(0, 24),
    other_party: String(o.other_party || '').slice(0, 40),
    background:  bg.slice(0, 300),
    extra: Array.isArray(o.extra) ? o.extra.slice(0, 2).map(x => String(x).slice(0, 30)) : [],

    consent_at: now(),
    q_note: '', draft: '', images: [], edit_note: '',
    followup: '', fu_reply: '', review: null,
    log: [{ t: now(), who: '系統', act: '建立訂單，等待付款' }]
  };

  /* 還沒付款的訂單只留 24 小時。付款成功後才改成長期保存 */
  await env.ORDERS.put('oracle:' + id, JSON.stringify(order), { expirationTtl: 60 * 60 * 24 });

  const params = {
    MerchantID: ec.id,
    MerchantTradeNo: id,
    MerchantTradeDate: taipeiStamp(d),
    PaymentType: 'aio',
    TotalAmount: String(amount),
    TradeDesc: '真人占卜 真人占卜',
    ItemName: '真人文字占卜 x 1',
    ReturnURL: url.origin + '/api/ecpay-callback',
    ClientBackURL: url.origin + '/oracle/done?no=' + id,
    ChoosePayment: 'Credit',      /* 只開信用卡。ATM 與超商是非即時付款，客人付完不會回來 */
    EncryptType: '1',
    CustomField1: 'oracle'
  };
  params.CheckMacValue = await checkMac(params, ec.key, ec.iv);

  return json({
    ok: true, id, amount, mode: ec.mode,
    action: ec.url,
    fields: params
  }, 200, origin);
}

/* 延伸籤的解鎖憑證存在 unlock:<token>，一年有效。
   拿得出有效憑證就代表真的買過 99 元，可以折抵。 */
async function checkDeepCredit(env, token) {
  if (!token || !/^[A-Za-z0-9]{20,60}$/.test(token)) return false;
  try {
    const raw = await env.ORDERS.get('unlock:' + token);
    if (!raw) return false;
    const u = JSON.parse(raw);
    return !u.oracleUsed;          /* 已經折抵過就不能再用 */
  } catch (e) { return false; }
}

/* ══════════════════════════════════════════════════
   二、綠界付款通知（由 index.js 的 ecpayCallback 分流過來）

   這裡自己驗章，因為測試模式用的是綠界測試商店的金鑰，
   跟延伸籤的正式金鑰不一樣。
   ══════════════════════════════════════════════════ */

export async function oraclePaid(data, env, ctx) {
  const ec = ecpayConf(env);

  const received = data.CheckMacValue || '';
  const rest = Object.assign({}, data);
  delete rest.CheckMacValue;
  const expected = await checkMac(rest, ec.key, ec.iv);

  if (!received || received.toUpperCase() !== expected) {
    console.error('真人占卜驗章失敗', data.MerchantTradeNo, ec.mode);
    return new Response('0|CheckMacValue Error', { status: 400 });
  }

  const id = data.MerchantTradeNo || '';
  const o = await get(env, id);

  if (!o) {
    console.error('找不到真人占卜訂單', id);
    return new Response('1|OK', { headers: { 'content-type': 'text/plain' } });
  }
  if (o.paid) {
    /* 綠界可能重送，已經處理過就直接回 OK，不要重複建單 */
    return new Response('1|OK', { headers: { 'content-type': 'text/plain' } });
  }

  if (data.RtnCode === '1') {
    if (Number(data.TradeAmt) !== o.amount) {
      console.error('金額不符', id, data.TradeAmt, o.amount);
      return new Response('1|OK', { headers: { 'content-type': 'text/plain' } });
    }
    o.paid = true;
    o.paid_at = now();
    o.trade_no = data.TradeNo || '';
    o.pay_type = data.PaymentType || '';
    o.card_last4 = data.card4no || '';
    o.invoice_no = '';                    /* 開立發票後手動填，或之後接綠界發票 API */
    o.st = 'q_review';                       /* 付款成功才進到你的待審 */
    log(o, '系統', '付款成功 NT$' + o.amount + (o.hasDeep ? '（已折抵 ' + DEEP_CREDIT + '）' : ''));
    await put(env, o);
    /* 折抵用掉的憑證要標記，避免同一張重複折 */
    if (o.hasDeep && o.deep_token) {
      try {
        const raw = await env.ORDERS.get('unlock:' + o.deep_token);
        if (raw) {
          const u = JSON.parse(raw);
          u.oracleUsed = o.id;
          await env.ORDERS.put('unlock:' + o.deep_token, JSON.stringify(u),
            { expirationTtl: 60 * 60 * 24 * 365 });
        }
      } catch (e) { console.error('標記折抵憑證失敗', e.message); }
    }
    await pushIndex(env, id);
    if (ctx) ctx.waitUntil(mailAdmin(env, '新訂單待審問法 ' + id,
      o.name + '｜' + o.teacher + '\n\n' + o.q + '\n\n' + o.background));
  } else {
    o.st = 'failed';
    o.fail_reason = (data.RtnMsg || '').slice(0, 200);
    log(o, '系統', '付款失敗：' + o.fail_reason);
    await put(env, o);
  }

  return new Response('1|OK', { headers: { 'content-type': 'text/plain' } });
}

/* 付款完成頁用來輪詢 */
async function oracleStatus(request, env, origin) {
  const id = new URL(request.url).searchParams.get('no') || '';
  const o = await get(env, id);
  if (!o) return json({ st: 'not_found' }, 404, origin);
  return json({ id: o.id, st: o.st, paid: !!o.paid, teacher: o.teacher }, 200, origin);
}

/* ══════════════════════════════════════════════════
   訂單建立
   ══════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════
   管理端 API
   ══════════════════════════════════════════════════ */

async function adminApi(request, env, ctx, path, origin) {
  const key = request.headers.get('X-Key') || '';
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'unauthorized' }, 401, origin);
  if (!env.ORDERS) return json({ error: 'no_kv' }, 500, origin);

  if (path === '/api/oracle/admin/list') {
    return json({
      orders: await listOrders(env, 80),
      teachers: teacherList(env).map(t => ({ id: t.id, name: t.name })),
      canMail: !!env.RESEND_API_KEY
    }, 200, origin);
  }

  if (path === '/api/oracle/admin/testmail') {
    const to = new URL(request.url).searchParams.get('to') || env.ADMIN_EMAIL || '';
    if (!to) return json({ error: 'no_address', hint: '請先設定 ADMIN_EMAIL' }, 400, origin);
    if (!env.RESEND_API_KEY) return json({ error: 'no_key', hint: '請先設定 RESEND_API_KEY' }, 400, origin);

    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + env.RESEND_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: env.MAIL_FROM || '未完籤所 <onboarding@resend.dev>',
          to: [to],
          subject: '[未完籤所] 寄信測試',
          text: '這是一封測試信。\n\n收到就代表寄信設定正確，訂單通知會正常寄達。'
        })
      });
      const body = await r.text();
      return json({
        ok: r.ok, status: r.status,
        from: env.MAIL_FROM || '(未設定，用 Resend 預設)',
        to,
        detail: body.slice(0, 400)
      }, 200, origin);
    } catch (e) {
      return json({ ok: false, error: 'network', detail: e.message }, 200, origin);
    }
  }

  if (path === '/api/oracle/admin/book') {
    const all = await listOrders(env, 400);
    const rows = all.filter(o => o.paid).map(o => ({
      id: o.id, paid_at: o.paid_at || o.created, amount: o.amount,
      hasDeep: !!o.hasDeep, teacher: o.teacher, trade_no: o.trade_no || '',
      pay_type: o.pay_type || '', invoice_no: o.invoice_no || '',
      st: o.st, refunded_at: o.refunded_at || ''
    }));
    return json({ rows }, 200, origin);
  }

  if (path === '/api/oracle/admin/invoice' && request.method === 'POST') {
    const b = await request.json();
    const o = await get(env, b.id);
    if (!o) return json({ error: 'not_found' }, 404, origin);
    o.invoice_no = String(b.invoice_no || '').slice(0, 30);
    log(o, '你', o.invoice_no ? ('填入發票號碼 ' + o.invoice_no) : '清除發票號碼');
    await put(env, o);
    return json({ ok: true }, 200, origin);
  }

  if (path === '/api/oracle/admin/act' && request.method === 'POST') {
    const b = await request.json();
    const o = await get(env, b.id);
    if (!o) return json({ error: 'not_found' }, 404, origin);
    const note = String(b.note || '').slice(0, 400);

    if (b.act === 'q_ok') {
      if (b.q && String(b.q).trim()) o.q = String(b.q).slice(0, 60);
      o.st = 'writing';
      o.assigned_at = now();
      log(o, '你', o.q !== o.q_original ? '微調問法後派案' : '問法通過，派案');
      ctx.waitUntil(mailTeacher(env, o));

    } else if (b.act === 'q_revise') {
      if (!b.q || !note) return json({ error: 'need_input' }, 400, origin);
      o.q = String(b.q).slice(0, 60);
      o.q_note = note;
      o.st = 'q_revised';
      log(o, '你', '改寫問法，寄信請客人確認');
      ctx.waitUntil(mailCustomerRevise(env, o));

    } else if (b.act === 'refund') {
      if (!note) return json({ error: 'need_note' }, 400, origin);
      o.st = 'refund'; o.q_note = note;
      log(o, '你', '判定退款：' + note);

    } else if (b.act === 'refunded') {
      o.st = 'refunded'; o.refunded_at = now();
      log(o, '你', '退款完成');
      ctx.waitUntil(mailCustomer(env, o, '退款已完成',
        '你的訂單 ' + o.id + ' 已完成退款。\n\n' + (o.q_note || '')));

    } else if (b.act === 'take') {
      o.st = (o.st === 'fu_review') ? 'fu_doing' : 'draft_doing';
      log(o, '你', '開始審稿');

    } else if (b.act === 'send') {
      if (!o.draft) return json({ error: 'no_draft' }, 400, origin);
      o.st = 'sent'; o.sent_at = now();
      log(o, '你', '審稿通過，已寄給客人');
      ctx.waitUntil(mailCustomerReading(env, o));

    } else if (b.act === 'return') {
      if (!note) return json({ error: 'need_note' }, 400, origin);
      o.st = 'writing'; o.edit_note = note;
      log(o, '你', '退回重寫：' + note);
      ctx.waitUntil(mailTeacher(env, o, '退回重寫\n\n' + note));

    } else if (b.act === 'fu_send') {
      if (!o.fu_reply) return json({ error: 'no_reply' }, 400, origin);
      o.st = 'done'; o.done_at = now();
      log(o, '你', '追問回覆已寄出，結案');
      ctx.waitUntil(mailCustomerDone(env, o, o.fu_reply));

    } else if (b.act === 'fu_return') {
      if (!note) return json({ error: 'need_note' }, 400, origin);
      o.st = 'fu_wait'; o.edit_note = note;
      log(o, '你', '追問回覆退回：' + note);
      ctx.waitUntil(mailTeacher(env, o, '追問回覆需要修改\n\n' + note));

    } else if (b.act === 'reassign') {
      o.teacher = String(b.teacher || '').slice(0, 20);
      log(o, '你', '改派給 ' + o.teacher);
      ctx.waitUntil(mailTeacher(env, o));

    } else if (b.act === 'edit_draft') {
      if (typeof b.draft === 'string') o.draft = b.draft.slice(0, 8000);
      if (typeof b.fu_reply === 'string') o.fu_reply = b.fu_reply.slice(0, 4000);
      log(o, '你', '修改了內容');

    } else if (b.act === 'review_ok') {
      if (!o.review) return json({ error: 'no_review' }, 400, origin);
      o.review.ok = true;
      log(o, '你', '評價審核通過');

    } else if (b.act === 'review_no') {
      if (!o.review) return json({ error: 'no_review' }, 400, origin);
      o.review.ok = false;
      log(o, '你', '評價不公開');

    } else if (b.act === 'review_edit') {
      if (!o.review) return json({ error: 'no_review' }, 400, origin);
      if (typeof b.text === 'string') o.review.text = b.text.slice(0, 200);
      if (typeof b.topic === 'string') o.review.topic = b.topic.slice(0, 8);
      log(o, '你', '修改評價文字');

    } else if (b.act === 'close') {
      o.st = 'done'; o.done_at = now();
      log(o, '你', '手動結案');
      ctx.waitUntil(mailCustomerDone(env, o));

    } else {
      return json({ error: 'bad_act' }, 400, origin);
    }

    await put(env, o);
    return json({ ok: true, st: o.st }, 200, origin);
  }

  return json({ error: 'not_found' }, 404, origin);
}

/* ══════════════════════════════════════════════════
   老師端 API
   ══════════════════════════════════════════════════ */

function teacherList(env) {
  return String(env.TEACHER_KEYS || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(s => {
      const p = s.split(':');
      return { id: p[0], name: p[1] || p[0], key: p[2] || '' };
    })
    .filter(t => t.id && t.key);
}

function whoTeacher(request, env) {
  const key = request.headers.get('X-Key') || '';
  if (!key) return null;
  return teacherList(env).find(t => t.key === key) || null;
}

async function teacherApi(request, env, ctx, path, origin) {
  const me = whoTeacher(request, env);
  if (!me) return json({ error: 'unauthorized' }, 401, origin);
  if (!env.ORDERS) return json({ error: 'no_kv' }, 500, origin);

  if (path === '/api/oracle/teacher/list') {
    const all = await listOrders(env, 80);
    const keep = ['writing', 'draft_wait', 'draft_doing', 'fu_wait',
                  'fu_review', 'fu_doing', 'sent', 'done'];
    const mine = all.filter(o =>
      (o.teacher === me.name || o.teacher === me.id) && keep.indexOf(o.st) >= 0);
    return json({
      me: { id: me.id, name: me.name },
      canUpload: !!env.MEDIA,
      orders: mine.map(o => {
        const c = Object.assign({}, o);
        delete c.email;      // 老師看不到客人信箱
        delete c.trade_no;
        return c;
      })
    }, 200, origin);
  }

  if (path === '/api/oracle/teacher/save' && request.method === 'POST') {
    const b = await request.json();
    const o = await get(env, b.id);
    if (!o) return json({ error: 'not_found' }, 404, origin);
    if (o.teacher !== me.name && o.teacher !== me.id) return json({ error: 'not_yours' }, 403, origin);

    if (b.field === 'draft') {
      if (o.st !== 'writing') return json({ error: 'bad_state' }, 400, origin);
      o.draft = String(b.text || '').slice(0, 8000);
      if (Array.isArray(b.images)) o.images = b.images.slice(0, 6).map(x => String(x).slice(0, 80));
      if (b.done) {
        if (o.draft.trim().length < 200) return json({ error: 'too_short' }, 400, origin);
        o.st = 'draft_wait';
        o.drafted_at = now();
        o.edit_note = '';
        log(o, me.name, '交稿，' + o.draft.length + ' 字');
        const flags = scanDraft(o.draft);
        ctx.waitUntil(mailAdmin(env, '待審稿 ' + o.id,
          me.name + ' 交稿了。\n\n' + o.q + '\n\n字數 ' + o.draft.length + '\n\n'
          + (flags.length ? flags.join('\n') : '自動檢查沒有發現問題')));
      } else {
        log(o, me.name, '存草稿');
      }

    } else if (b.field === 'fu_reply') {
      if (o.st !== 'fu_wait') return json({ error: 'bad_state' }, 400, origin);
      o.fu_reply = String(b.text || '').slice(0, 4000);
      if (b.done) {
        if (o.fu_reply.trim().length < 50) return json({ error: 'too_short' }, 400, origin);
        o.st = 'fu_review';
        o.edit_note = '';
        log(o, me.name, '追問已回覆');
        ctx.waitUntil(mailAdmin(env, '追問待審稿 ' + o.id, o.fu_reply.slice(0, 400)));
      } else {
        log(o, me.name, '存追問草稿');
      }

    } else {
      return json({ error: 'bad_field' }, 400, origin);
    }

    await put(env, o);
    return json({ ok: true, st: o.st }, 200, origin);
  }

  if (path === '/api/oracle/teacher/upload' && request.method === 'POST') {
    if (!env.MEDIA) return json({ error: 'no_bucket', hint: '請綁定 R2，變數名稱 MEDIA' }, 500, origin);
    const type = request.headers.get('Content-Type') || 'image/jpeg';
    if (!/^image\//.test(type)) return json({ error: 'not_image' }, 400, origin);
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 6 * 1024 * 1024) return json({ error: 'too_big' }, 400, origin);
    const ext = type.indexOf('png') >= 0 ? 'png' : (type.indexOf('webp') >= 0 ? 'webp' : 'jpg');
    const k = me.id + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.' + ext;
    await env.MEDIA.put(k, buf, { httpMetadata: { contentType: type } });
    return json({ ok: true, key: k, url: '/media/' + k }, 200, origin);
  }

  return json({ error: 'not_found' }, 404, origin);
}

/* ══════════════════════════════════════════════════
   客人端 API
   ══════════════════════════════════════════════════ */

async function orderApi(request, env, ctx, path, origin) {
  if (!env.ORDERS) return json({ error: 'no_kv' }, 500, origin);

  if (path === '/api/oracle/order/get') {
    const u = new URL(request.url);
    const id = u.searchParams.get('id') || '';
    const em = (u.searchParams.get('email') || '').toLowerCase().trim();
    const o = await get(env, id);
    if (!o || o.email.toLowerCase() !== em) return json({ error: 'not_found' }, 404, origin);
    return json({ order: publicView(o) }, 200, origin);
  }

  if (path === '/api/oracle/order/confirm' && request.method === 'POST') {
    const b = await request.json();
    const o = await get(env, b.id);
    if (!o || o.email.toLowerCase() !== String(b.email || '').toLowerCase().trim())
      return json({ error: 'not_found' }, 404, origin);
    if (o.st !== 'q_revised') return json({ error: 'bad_state' }, 400, origin);
    o.st = 'writing';
    log(o, '客人', '確認了調整後的問法');
    await put(env, o);
    ctx.waitUntil(mailTeacher(env, o));
    return json({ ok: true, st: o.st }, 200, origin);
  }

  if (path === '/api/oracle/order/followup' && request.method === 'POST') {
    const b = await request.json();
    const o = await get(env, b.id);
    if (!o || o.email.toLowerCase() !== String(b.email || '').toLowerCase().trim())
      return json({ error: 'not_found' }, 404, origin);
    if (o.st !== 'sent') return json({ error: 'bad_state', hint: '追問只能提出一次' }, 400, origin);
    const t = String(b.text || '').trim();
    if (t.length < 5) return json({ error: 'too_short' }, 400, origin);
    o.followup = t.slice(0, 400);
    o.st = 'fu_wait';
    log(o, '客人', '提出追問');
    await put(env, o);
    ctx.waitUntil(mailTeacher(env, o, '客人提出追問\n\n' + o.followup));
    return json({ ok: true, st: o.st }, 200, origin);
  }

  if (path === '/api/oracle/order/review' && request.method === 'POST') {
    const b = await request.json();
    const o = await get(env, b.id);
    if (!o || o.email.toLowerCase() !== String(b.email || '').toLowerCase().trim())
      return json({ error: 'not_found' }, 404, origin);
    if (['sent', 'fu_wait', 'fu_review', 'fu_doing', 'done'].indexOf(o.st) < 0)
      return json({ error: 'bad_state' }, 400, origin);
    const t = String(b.text || '').trim();
    if (t.length < 10) return json({ error: 'too_short' }, 400, origin);
    o.review = {
      text: t.slice(0, 200),
      topic: String(b.topic || '').slice(0, 8),
      at: now(),
      ok: false
    };
    log(o, '客人', '留下評價');
    await put(env, o);
    ctx.waitUntil(mailAdmin(env, '有新評價 ' + o.id,
      o.teacher + '\n\n' + o.review.topic + '｜' + o.review.text));
    return json({ ok: true }, 200, origin);
  }

  return json({ error: 'not_found' }, 404, origin);
}

function publicView(o) {
  const shown = ['sent', 'fu_wait', 'fu_review', 'fu_doing', 'done'];
  const can = shown.indexOf(o.st) >= 0;
  return {
    id: o.id, st: o.st, created: o.created, name: o.name, teacher: o.teacher,
    q: o.q, q_original: o.q_original, q_note: o.q_note,
    timeframe: o.timeframe, intent: o.intent, other_party: o.other_party,
    background: o.background,
    draft: can ? o.draft : '',
    images: can ? o.images : [],
    followup: o.followup,
    fu_reply: o.st === 'done' ? o.fu_reply : '',
    sent_at: o.sent_at || '',
    hasReview: !!o.review
  };
}

/* ══════════════════════════════════════════════════
   資料存取
   ══════════════════════════════════════════════════ */


async function get(env, id) {
  if (!id) return null;
  const raw = await env.ORDERS.get('oracle:' + id);
  return raw ? JSON.parse(raw) : null;
}
async function put(env, o) {
  await env.ORDERS.put('oracle:' + o.id, JSON.stringify(o), { expirationTtl: TTL });
}
async function pushIndex(env, id) {
  const idx = JSON.parse((await env.ORDERS.get('oracle:idx')) || '[]');
  idx.unshift(id);
  await env.ORDERS.put('oracle:idx', JSON.stringify(idx.slice(0, 400)));
}
async function listOrders(env, n) {
  const idx = JSON.parse((await env.ORDERS.get('oracle:idx')) || '[]');
  const out = [];
  for (const id of idx.slice(0, n)) {
    const raw = await env.ORDERS.get('oracle:' + id);
    if (raw) out.push(JSON.parse(raw));
  }
  return out;
}
function log(o, who, act) {
  o.log = o.log || [];
  o.log.push({ t: now(), who: who, act: act });
  if (o.log.length > 40) o.log = o.log.slice(-40);
}

function scanDraft(t) {
  const f = [];
  if (t.length < 800) f.push('· 字數偏少（' + t.length + '）');
  if (t.length > 1600) f.push('· 字數偏多（' + t.length + '）');
  const pats = [
    [/line|賴|加我|私訊|聯絡我|ig|instagram/i, '疑似留下聯絡方式'],
    [/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/, '疑似手機號碼'],
    [/[\w.\-]+@[\w\-]+\.\w+/, '疑似 email'],
    [/一定會|保證|絕對不會|必然/, '過度斷言'],
    [/癌|吃藥|停藥|手術|診斷/, '涉及醫療'],
    [/買股|下注|穩賺|明牌/, '涉及投資明牌']
  ];
  pats.forEach(p => { if (p[0].test(t)) f.push('· ' + p[1]); });
  return f;
}

/* ══════════════════════════════════════════════════
   寄信（Resend。沒設定就只記 log，不會擋流程）
   ══════════════════════════════════════════════════ */

async function sendMail(env, to, subject, text) {
  if (!env.RESEND_API_KEY || !to) { console.log('[mail skipped]', to, subject); return; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.MAIL_FROM || '未完籤所 <onboarding@resend.dev>',
        to: [to], subject: subject, text: text
      })
    });
    if (!r.ok) console.error('[mail fail]', r.status, await r.text());
  } catch (e) { console.error('[mail error]', e.message); }
}

function base(env) { return env.WORKER_URL || ''; }

async function mailAdmin(env, subject, text) {
  await sendMail(env, env.ADMIN_EMAIL, '[未完籤所] ' + subject,
    text + '\n\n後台：' + base(env) + '/admin');
}

async function mailTeacher(env, o, extra) {
  const t = teacherList(env).find(x => x.name === o.teacher || x.id === o.teacher);
  const addr = t ? env['MAIL_' + t.id.toUpperCase()] : '';
  const body = [
    extra || '有一筆案件在你這裡。',
    '',
    '訂單　' + o.id,
    '稱呼　' + o.name,
    '',
    '── 問題 ──',
    o.q,
    '',
    '時間邊界　' + (o.timeframe || '—'),
    '想知道　　' + (o.intent || '—'),
    '對方　　　' + (o.other_party || '不牽涉他人'),
    '',
    '── 背景 ──',
    o.background,
    o.followup ? ('\n── 客人追問 ──\n' + o.followup) : '',
    '',
    '───',
    '撰寫規範：800–1,500 字。以未完籤所名義發出，請勿署名或留下任何個人聯絡方式。',
    '只回答上述問題，不擴散到其他主題。不做醫療、法律、投資的具體判斷。',
    '',
    '老師端：' + base(env) + '/teacher'
  ].join('\n');
  await sendMail(env, addr, '[未完籤所] 案件 ' + o.id, body);
}

async function mailCustomer(env, o, subject, text) {
  await sendMail(env, o.email, '[未完籤所] ' + subject,
    text + '\n\n查詢進度：' + base(env) + '/order?id=' + o.id);
}

async function mailCustomerRevise(env, o) {
  await mailCustomer(env, o, '你的問題需要你確認一下', [
    o.name + '你好，', '',
    '我們看過你的問題之後做了一點調整，想請你確認。', '',
    '你原本寫的：', o.q_original, '',
    '調整後：', o.q, '',
    '為什麼調整：', o.q_note, '',
    '確認之後老師才會開始。若不同意也可以回信告訴我們。'
  ].join('\n'));
}

async function mailCustomerDone(env, o, reply) {
  const lines = [ o.name + '，', '' ];
  if (reply) lines.push('你的追問，' + o.teacher + '回覆了：', '', reply, '', '───', '');
  lines.push(
    '本次服務到這裡完成。謝謝你把故事交給我們。', '',
    '如果這次的解讀對你有幫助，想邀請你留幾句話。',
    '你的感想會匿名顯示在' + o.teacher + '的頁面上，',
    '讓下一個猶豫要不要來的人，知道這裡是什麼樣子。', '',
    '寫在查詢頁面就可以，兩三句話就夠了。'
  );
  await mailCustomer(env, o, reply ? '你的追問老師回覆了' : '本次服務已完成', lines.join('\n'));
}

async function mailCustomerReading(env, o) {
  await mailCustomer(env, o, '你的解讀完成了', [
    o.name + '，', '', '你問的是：', o.q, '', '───', '', o.draft, '', '───', '',
    '本次服務包含一次免費追問，可以在查詢頁面提出。',
    '讀完之後如果願意留幾句感想，也可以在同一頁寫下來。'
  ].join('\n'));
}

/* ══════════════════════════════════════════════════
   共用
   ══════════════════════════════════════════════════ */

function pickOrigin(request, env) {
  const list = String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length) return '*';
  const from = request.headers.get('Origin');
  return (from && list.indexOf(from) >= 0) ? from : list[0];
}
function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin || '*') }
  });
}
function html(body) {
  return new Response(body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

/* ══════════════════════════════════════════════════
   AI 問籤引導
   ══════════════════════════════════════════════════ */

async function guide(request, env, origin) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'no_api_key' }, 500, origin);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.RATE) {
    const k = 'rl:' + ip;
    const hit = parseInt((await env.RATE.get(k)) || '0', 10);
    if (hit >= RATE_LIMIT) return json({ error: 'rate_limited' }, 429, origin);
    await env.RATE.put(k, String(hit + 1), { expirationTtl: RATE_WINDOW });
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, origin); }

  const messages = body.messages;
  const name = String(body.name || '').slice(0, 12).trim();

  if (!Array.isArray(messages) || !messages.length) return json({ error: 'no_messages' }, 400, origin);
  if (messages.length > MAX_TURNS) return json({ error: 'too_many_turns' }, 400, origin);
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return json({ error: 'bad_role' }, 400, origin);
    if (typeof m.content !== 'string' || !m.content.trim() || m.content.length > MAX_CHARS)
      return json({ error: 'bad_content' }, 400, origin);
  }

  let up;
  try {
    up = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1000,
        system: SYSTEM_PROMPT.replace('{稱呼}', name || '你'),
        messages: messages.map(m => ({ role: m.role, content: m.content }))
      })
    });
  } catch (e) { return json({ error: 'network', detail: e.message }, 502, origin); }

  if (!up.ok) {
    const d = await up.text();
    console.error('upstream', up.status, d);
    return json({ error: 'upstream', status: up.status, detail: d.slice(0, 300) }, 502, origin);
  }

  const data = await up.json();
  const text = (data.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim();
  if (!text) return json({ error: 'empty' }, 502, origin);
  return json({ text: text }, 200, origin);
}


const CSS = `
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{--bg:#12101A;--card:#1B1826;--card2:#221E30;--line:#2E2A3A;--line2:#3A3448;
  --tx:#E8E2D9;--dim:#8A8296;--gold:#D8B87E;--go:#5B9B6B;--stop:#C4553D;--wait:#C9A961}
body{font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif;background:var(--bg);
  color:var(--tx);line-height:1.7;padding:0 0 80px;font-size:15px}
.bar{position:sticky;top:0;z-index:10;background:rgba(18,16,26,.96);
  border-bottom:1px solid var(--line);padding:14px 16px}
.bar h1{font-size:17px;font-weight:600;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.bar h1 em{font-style:normal;font-size:11.5px;color:var(--dim);font-weight:400}
.wrap{max-width:720px;margin:0 auto;padding:0 14px}
.tabs{display:flex;gap:7px;overflow-x:auto;padding:12px 14px;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tabs button{flex:0 0 auto;border:1px solid var(--line2);background:none;color:var(--dim);
  border-radius:99px;padding:8px 15px;font:inherit;font-size:13.5px;cursor:pointer}
.tabs button.on{background:var(--gold);border-color:var(--gold);color:#1B1826;font-weight:600}
.tabs button b{margin-left:5px}
.card{border:1px solid var(--line);border-radius:12px;background:var(--card);
  padding:16px;margin-bottom:12px}
.top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:11px}
.id{font-size:11px;color:#6F6880;font-family:ui-monospace,monospace}
.tag{font-size:11.5px;padding:3px 11px;border-radius:99px;border:1px solid var(--line2);
  white-space:nowrap;flex:0 0 auto}
.tag.wait{color:var(--wait);border-color:#6E5C33}
.tag.go{color:var(--go);border-color:#3D6A4A}
.tag.done{color:#7FA8C9;border-color:#3A5670}
.tag.stop{color:var(--stop);border-color:#6A3E3A}
.q{font-size:17px;font-weight:600;line-height:1.55;margin-bottom:12px}
dl{display:grid;grid-template-columns:5.2em 1fr;gap:6px 12px;font-size:13.5px;margin-bottom:12px}
dt{color:var(--dim)}
.bg{background:var(--card2);border-radius:8px;padding:12px;font-size:13.5px;
  white-space:pre-wrap;margin-bottom:12px;line-height:1.85}
.hint{font-size:12.5px;color:var(--dim);line-height:1.75;margin-bottom:10px}
.warn{font-size:12.5px;color:var(--wait);line-height:1.8;margin:10px 0;
  border-left:2px solid var(--wait);padding-left:11px}
.err{font-size:12.5px;color:#F0A99B;background:rgba(196,85,61,.14);border:1px solid #6A3E3A;
  border-radius:8px;padding:11px;margin:10px 0}
input,textarea{width:100%;background:var(--card2);border:1px solid var(--line2);color:var(--tx);
  border-radius:8px;padding:12px;font:inherit;font-size:15px;margin-bottom:10px;line-height:1.8}
input:focus,textarea:focus{outline:none;border-color:var(--gold)}
label{display:block;font-size:12.5px;color:var(--dim);margin-bottom:6px}
.btns{display:flex;gap:8px;flex-wrap:wrap}
.b{flex:1;min-width:110px;border:0;border-radius:99px;padding:13px 14px;font:inherit;
  font-size:14.5px;font-weight:600;cursor:pointer}
.b.ok{background:var(--go);color:#fff}
.b.mid{background:#5A4E2E;color:#fff}
.b.no{background:#6A3E3A;color:#fff}
.b.ghost{background:none;border:1px solid var(--line2);color:var(--tx);font-weight:400}
.empty{text-align:center;color:#6F6880;padding:50px 0;font-size:14px}
.shots{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.shots a{display:block;width:76px;height:76px;border-radius:8px;overflow:hidden;
  border:1px solid var(--line2)}
.shots img{width:100%;height:100%;object-fit:cover;display:block}
.logs{font-size:12px;color:#6F6880;line-height:1.9;margin-top:12px;
  border-top:1px solid var(--line);padding-top:10px}
table.bk{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}
table.bk th{text-align:left;color:var(--dim);font-weight:400;font-size:11.5px;
  padding:6px 4px;border-bottom:1px solid var(--line)}
table.bk td{padding:8px 4px;border-bottom:1px solid rgba(46,42,58,.6);vertical-align:top}
table.bk tr.rf td{color:#6F6880}
table.bk .mono{font-family:ui-monospace,monospace;font-size:11.5px}
table.bk .sub2{color:var(--dim);font-size:11px;font-family:system-ui}
input.inv{margin:0;padding:6px 8px;font-size:12px;min-width:88px}
.lg{height:26px;width:auto;display:block;flex:0 0 auto}
.gate{max-width:340px;margin:50px auto;padding:0 20px;text-align:center}
.gate-logo{display:block;width:min(140px,45%);height:auto;margin:0 auto 22px;opacity:.95}
.gate h2{font-size:19px;margin-bottom:8px}
.gate p{font-size:13.5px;color:var(--dim);margin-bottom:20px}
.reading{background:var(--card2);border-radius:10px;padding:18px;font-size:15px;
  line-height:2;white-space:pre-wrap;margin:12px 0}
.count{font-size:12px;color:var(--dim);text-align:right;margin:-4px 0 10px}
.count.bad{color:var(--stop)}
details{margin-top:10px}
summary{font-size:13px;color:var(--dim);cursor:pointer;padding:5px 0}
`;

const JSC = `
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
.replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
var TONE={q_review:'wait',q_revised:'wait',writing:'go',draft_wait:'wait',draft_doing:'wait',
sent:'done',fu_wait:'go',fu_review:'wait',fu_doing:'wait',done:'done',refund:'stop',refunded:'stop'};
var LABEL={q_review:'待審問法',q_revised:'待客人確認',writing:'老師撰寫中',draft_wait:'待審稿',
draft_doing:'審稿中',sent:'已寄出',fu_wait:'追問待回覆',fu_review:'追問待審稿',
fu_doing:'追問審稿中',done:'已完成',refund:'待退款',refunded:'已退款'};
function tone(s){return TONE[s]||'wait'}
function label(s){return LABEL[s]||s}
function fmt(t){return String(t||'').slice(0,16).replace('T',' ')}
function val(id){var e=document.getElementById(id);return e?e.value:''}
`;

const PAGE_ADMIN = `<!doctype html><html lang="zh-Hant"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>未完籤所 · 後台</title>
<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/assets/icon-180.png"><style>${CSS}</style></head><body>

<div id="gate" class="gate">
  <img src="/assets/logo.png" alt="未完籤所" class="gate-logo">
  <h2>後台</h2>
  <p>輸入管理密碼</p>
  <input type="password" id="pw" placeholder="密碼">
  <div id="gerr" class="err" hidden>密碼不對</div>
  <button class="b ok" style="width:100%" onclick="login()">進入</button>
</div>

<div id="app" hidden>
  <div class="bar"><h1><img src="/assets/logo-mark.png" alt="" class="lg">受理單 <em id="cnt"></em></h1></div>
  <div class="tabs" id="tabs"></div>
  <div class="wrap">
    <button class="b ghost" id="testmail" hidden onclick="testMail()"
            style="margin-bottom:12px">寄一封測試信給我</button>
  </div>
  <div class="wrap" id="list"></div>
</div>

<script>${JSC}
var KEY = sessionStorage.getItem('uw_admin') || '';
var ALL = [], TEACHERS = [], CANMAIL = false, F = 'todo';

function testMail(){
  api('/api/oracle/admin/testmail').then(function(d){
    if(d.ok){
      alert('已送出。\\n\\n寄件人：' + d.from + '\\n收件人：' + d.to
        + '\\n\\n一分鐘內沒收到就看一下垃圾郵件匣。');
    } else {
      alert('寄不出去。\\n\\n狀態：' + (d.status || '') + '\\n\\n'
        + (d.detail || d.hint || d.error || ''));
    }
  }).catch(function(){ alert('沒有成功，請重試') });
}
var G = [
  ['todo','要我處理',['q_review','draft_wait','draft_doing','fu_review','fu_doing','refund']],
  ['wait','等別人',['q_revised','writing','fu_wait']],
  ['sent','已寄出',['sent']],
  ['done','已結案',['done','refunded']],
  ['all','全部',null],
  ['review','評價',null],
  ['book','對帳',null]
];

function api(p, body){
  return fetch(p,{method: body?'POST':'GET',
    headers:{'X-Key':KEY,'Content-Type':'application/json'},
    body: body?JSON.stringify(body):undefined
  }).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json() });
}
function login(){
  KEY = document.getElementById('pw').value.trim();
  if(!KEY) return;
  api('/api/oracle/admin/list').then(function(d){
    sessionStorage.setItem('uw_admin', KEY);
    document.getElementById('gate').hidden = true;
    document.getElementById('app').hidden = false;
    render(d);
  }).catch(function(){ document.getElementById('gerr').hidden = false });
}
function load(){ api('/api/oracle/admin/list').then(render) }

function render(d){
  if(d.orders) ALL = d.orders;
  if(d.teachers) TEACHERS = d.teachers;
  if(typeof d.canMail !== 'undefined') CANMAIL = d.canMail;
  document.getElementById('cnt').textContent = ALL.length + ' 筆' + (CANMAIL ? '' : '　·　尚未設定寄信');
  var tm = document.getElementById('testmail');
  if(tm) tm.hidden = !CANMAIL;
  document.getElementById('tabs').innerHTML = G.map(function(g){
    var n = g[0]==='book'
      ? ALL.filter(function(o){ return o.paid }).length
      : g[0]==='review'
      ? ALL.filter(function(o){ return o.review }).length
      : (g[2] ? ALL.filter(function(o){ return g[2].indexOf(o.st)>=0 }).length : ALL.length);
    return '<button class="'+(F===g[0]?'on':'')+'" onclick="setF(\\''+g[0]+'\\')">'+g[1]+'<b>'+n+'</b></button>';
  }).join('');
  if(F === 'book'){ loadBook(); return; }
  if(F === 'review'){
    var rv = ALL.filter(function(o){ return o.review });
    document.getElementById('list').innerHTML = rv.length
      ? '<div class="hint" style="padding:0 2px 12px">審過的評價按「複製」，貼到 oracle.html 對應老師的 reviews 陣列裡。</div>'
        + rv.map(reviewCard).join('')
      : '<div class="empty">還沒有客人留下評價</div>';
    return;
  }
  var g = G.filter(function(x){ return x[0]===F })[0];
  var rows = g[2] ? ALL.filter(function(o){ return g[2].indexOf(o.st)>=0 }) : ALL;
  document.getElementById('list').innerHTML = rows.length ? rows.map(card).join('')
    : '<div class="empty">這裡沒有東西</div>';
}
function setF(f){ F = f; render({}) }

function b(id,a,cls,txt){ return '<button class="b '+cls+'" onclick="act(\\''+id+'\\',\\''+a+'\\')">'+txt+'</button>' }

function scan(t){
  t = t||''; var f = [];
  if(t.length && t.length<800) f.push('· 字數偏少（'+t.length+'）');
  if(t.length>1600) f.push('· 字數偏多（'+t.length+'）');
  var P = [[/line|賴|加我|私訊|聯絡我|ig|instagram/i,'疑似留下聯絡方式'],
    [/09\\d{2}[-\\s]?\\d{3}[-\\s]?\\d{3}/,'疑似手機號碼'],
    [/[\\w.\\-]+@[\\w\\-]+\\.\\w+/,'疑似 email'],
    [/一定會|保證|絕對不會|必然/,'過度斷言'],
    [/癌|吃藥|停藥|手術|診斷/,'涉及醫療'],
    [/買股|下注|穩賺|明牌/,'涉及投資明牌']];
  P.forEach(function(p){ if(p[0].test(t)) f.push('· '+p[1]) });
  return f;
}
function shots(imgs){
  if(!imgs || !imgs.length) return '';
  return '<label>牌陣照片</label><div class="shots">'+imgs.map(function(k){
    return '<a href="/media/'+k+'" target="_blank"><img src="/media/'+k+'" alt=""></a>' }).join('')+'</div>';
}

function card(o){
  var h = '<div class="card">';
  h += '<div class="top"><span class="id">'+esc(o.id)+' · '+fmt(o.created)+'</span>'
     + '<span class="tag '+tone(o.st)+'">'+label(o.st)+'</span></div>';
  h += '<div class="q">'+esc(o.q)+'</div>';
  h += '<dl><dt>稱呼</dt><dd>'+esc(o.name)+'</dd>'
     + '<dt>信箱</dt><dd>'+esc(o.email)+'</dd>'
     + '<dt>老師</dt><dd>'+esc(o.teacher)+'</dd>'
     + '<dt>占卜期間</dt><dd>'+(esc(o.timeframe)||'—')+'</dd>'
     + '<dt>想知道</dt><dd>'+(esc(o.intent)||'—')+'</dd>'
     + '<dt>對方</dt><dd>'+(esc(o.other_party)||'不牽涉他人')+'</dd></dl>';
  h += '<div class="bg">'+esc(o.background)+'</div>';
  if(o.extra && o.extra.length) h += '<div class="hint">也提到：'+o.extra.map(esc).join('、')+'</div>';

  if(o.st === 'q_review'){
    h += '<label>問法（要調整就直接改）</label>';
    h += '<input id="q_'+o.id+'" value="'+esc(o.q)+'">';
    h += '<label>備註（改問法或退款時必填）</label>';
    h += '<textarea id="n_'+o.id+'" rows="2" placeholder="改問法：要跟客人說什麼　退款：原因"></textarea>';
    h += '<div class="btns">'+b(o.id,'q_ok','ok','通過，派給老師')
       + b(o.id,'q_revise','mid','改問法，寄信確認')+b(o.id,'refund','no','退款')+'</div>';
    h += '<div class="hint" style="margin-top:9px">小幅修飾字句可以直接改後按「通過」。'
       + '改變問題意思請走「改問法」，客人確認後才會派給老師。</div>';
  }

  if(o.st === 'q_revised'){
    h += '<div class="warn">已寄信給客人確認。<br>原句：'+esc(o.q_original)
       + '<br>說明：'+esc(o.q_note)+'</div>';
  }

  if(o.st === 'writing'){
    h += '<div class="hint">已派給 '+esc(o.teacher)+'，等待交稿。</div>';
    if(o.edit_note) h += '<div class="warn">上次退回：'+esc(o.edit_note)+'</div>';
    h += '<details><summary>改派給其他老師</summary><div class="btns" style="margin-top:8px">'
       + TEACHERS.map(function(t){
           return '<button class="b ghost" onclick="reassign(\\''+o.id+'\\',\\''+esc(t.name)+'\\')">'
             + esc(t.name)+'</button>' }).join('')+'</div></details>';
  }

  if(o.st === 'draft_wait' || o.st === 'draft_doing'){
    var s = scan(o.draft);
    if(s.length) h += '<div class="warn">自動檢查<br>'+s.join('<br>')+'</div>';
    h += shots(o.images);
    h += '<label>稿件（'+(o.draft||'').length+' 字，可直接修改）</label>';
    h += '<textarea id="d_'+o.id+'" rows="12">'+esc(o.draft)+'</textarea>';
    h += '<label>退回時的說明</label>';
    h += '<textarea id="n_'+o.id+'" rows="2" placeholder="要老師改哪裡"></textarea>';
    h += '<div class="btns">'
       + (o.st==='draft_wait' ? b(o.id,'take','ghost','標記審稿中') : '')
       + '<button class="b ghost" onclick="saveText(\\''+o.id+'\\',\\'d\\')">存修改</button>'
       + b(o.id,'send','ok','通過，寄給客人')+b(o.id,'return','no','退回重寫')+'</div>';
  }

  if(o.st === 'sent'){
    h += '<div class="hint">已於 '+fmt(o.sent_at)+' 寄出，等待客人追問或自然結案。</div>';
    h += '<details><summary>看稿件</summary><div class="reading">'+esc(o.draft)+'</div></details>';
    h += '<div class="btns" style="margin-top:10px">'+b(o.id,'close','ghost','手動結案')+'</div>';
  }

  if(o.st === 'fu_wait'){
    h += '<div class="warn">客人追問：'+esc(o.followup)+'<br>等待 '+esc(o.teacher)+' 回覆。</div>';
  }
  if(o.st === 'fu_review' || o.st === 'fu_doing'){
    h += '<div class="warn">客人追問：'+esc(o.followup)+'</div>';
    h += '<label>老師的回覆（可直接修改）</label>';
    h += '<textarea id="f_'+o.id+'" rows="6">'+esc(o.fu_reply)+'</textarea>';
    h += '<label>退回時的說明</label>';
    h += '<textarea id="n_'+o.id+'" rows="2"></textarea>';
    h += '<div class="btns">'
       + (o.st==='fu_review' ? b(o.id,'take','ghost','標記審稿中') : '')
       + '<button class="b ghost" onclick="saveText(\\''+o.id+'\\',\\'f\\')">存修改</button>'
       + b(o.id,'fu_send','ok','通過，寄出結案')+b(o.id,'fu_return','no','退回')+'</div>';
  }

  if(o.st === 'refund'){
    h += '<div class="warn">原因：'+esc(o.q_note)+'<br>請到綠界後台完成退刷，回來按下方按鈕。</div>';
    h += '<div class="btns">'+b(o.id,'refunded','ok','已完成退款')+'</div>';
  }

  if(o.review){
    h += '<div class="warn" style="margin-top:12px">客人評價（'+(o.review.ok?'已通過':'待審')+'）：'
       + esc(o.review.text)+'</div>';
  }
  if(o.log && o.log.length){
    h += '<details><summary>紀錄（'+o.log.length+'）</summary><div class="logs">'
       + o.log.slice().reverse().map(function(l){
           return fmt(l.t)+'　'+esc(l.who)+'　'+esc(l.act) }).join('<br>')+'</div></details>';
  }
  return h + '</div>';
}

/* ── 對帳 ── */
var BOOK = [];

function loadBook(){
  document.getElementById('list').innerHTML = '<div class="empty">載入中…</div>';
  api('/api/oracle/admin/book').then(function(d){
    BOOK = d.rows || [];
    renderBook();
  });
}

function ym(t){ return String(t || '').slice(0, 7); }

function renderBook(){
  if(!BOOK.length){
    document.getElementById('list').innerHTML = '<div class="empty">還沒有已付款的訂單</div>';
    return;
  }
  /* 依月份分組 */
  var months = {};
  BOOK.forEach(function(r){
    var k = ym(r.paid_at);
    (months[k] = months[k] || []).push(r);
  });
  var keys = Object.keys(months).sort().reverse();

  var h = '';
  keys.forEach(function(k){
    var rows = months[k];
    var gross = 0, refund = 0, noInv = 0;
    rows.forEach(function(r){
      if(r.st === 'refunded'){ refund += r.amount } else { gross += r.amount }
      if(r.st !== 'refunded' && !r.invoice_no) noInv++;
    });

    h += '<div class="card">';
    h += '<div class="top"><span class="id">' + k + '</span>'
       + '<span class="tag done">' + rows.length + ' 筆</span></div>';
    h += '<dl>'
       + '<dt>實收</dt><dd>NT$' + gross + '</dd>'
       + (refund ? '<dt>已退</dt><dd>NT$' + refund + '</dd>' : '')
       + '<dt>待開發票</dt><dd>' + (noInv ? noInv + ' 筆' : '無') + '</dd>'
       + '</dl>';

    h += '<table class="bk"><tr><th>日期</th><th>編號</th><th>金額</th><th>發票</th></tr>';
    rows.forEach(function(r){
      h += '<tr' + (r.st === 'refunded' ? ' class="rf"' : '') + '>'
         + '<td>' + esc(String(r.paid_at).slice(5,10)) + '</td>'
         + '<td class="mono">' + esc(r.id.slice(-8)) + '<br><span class="sub2">'
         + esc(r.teacher) + (r.hasDeep ? '・折抵' : '') + '</span></td>'
         + '<td>' + (r.st === 'refunded' ? '<s>' + r.amount + '</s>' : r.amount) + '</td>'
         + '<td>' + (r.st === 'refunded'
              ? '—'
              : '<input class="inv" data-inv="' + r.id + '" id="iv_' + r.id
                + '" value="' + esc(r.invoice_no) + '" placeholder="填號碼">')
         + '</td></tr>';
    });
    h += '</table>';
    h += '<div class="btns" style="margin-top:12px">'
       + '<button class="b ghost" data-csv="' + k + '">下載這個月的 CSV</button></div>';
    h += '</div>';
  });

  document.getElementById('list').innerHTML =
    '<div class="hint" style="padding:0 2px 12px">開完發票把號碼填進去，之後對帳才知道哪幾筆還沒開。'
    + '退款的那筆會畫掉，不計入實收。</div>' + h;
}

/* 用事件委派，避免在字串裡塞引號 */
document.addEventListener('change', function(e){
  var t = e.target;
  if(t && t.dataset && t.dataset.inv) saveInv(t.dataset.inv);
});
document.addEventListener('click', function(e){
  var t = e.target;
  if(t && t.dataset && t.dataset.csv) csv(t.dataset.csv);
});

function saveInv(id){
  api('/api/oracle/admin/invoice', { id: id, invoice_no: val('iv_' + id) })
    .then(function(){
      var r = BOOK.filter(function(x){ return x.id === id })[0];
      if(r) r.invoice_no = val('iv_' + id);
      renderBook();
    })
    .catch(function(){ alert('沒有存成功') });
}

function csv(month){
  var rows = BOOK.filter(function(r){ return ym(r.paid_at) === month });
  var head = '付款時間,訂單編號,綠界交易編號,金額,是否折抵,老師,狀態,發票號碼\\n';
  var body = rows.map(function(r){
    return [String(r.paid_at).slice(0,19).replace('T',' '), r.id, r.trade_no, r.amount,
            r.hasDeep ? '是' : '否', r.teacher,
            r.st === 'refunded' ? '已退款' : '正常', r.invoice_no].join(',');
  }).join('\\n');
  /* 加 BOM，Excel 開中文才不會變亂碼 */
  var blob = new Blob(['\\ufeff' + head + body], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '真人占卜_' + month + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function reviewCard(o){
  var r = o.review;
  var h = '<div class="card">';
  h += '<div class="top"><span class="id">'+esc(o.id)+' · '+fmt(r.at)+'</span>'
     + '<span class="tag '+(r.ok?'done':'wait')+'">'+(r.ok?'已通過':'待審')+'</span></div>';
  h += '<dl><dt>老師</dt><dd>'+esc(o.teacher)+'</dd>'
     + '<dt>問的是</dt><dd>'+esc(o.q)+'</dd></dl>';
  h += '<label>類別</label><input id="rt_'+o.id+'" value="'+esc(r.topic)+'">';
  h += '<label>評價內容（可修改錯字，但不要改變意思）</label>';
  h += '<textarea id="rx_'+o.id+'" rows="3">'+esc(r.text)+'</textarea>';
  h += '<div class="btns">'
     + '<button class="b ghost" onclick="saveReview(\\''+o.id+'\\')">存修改</button>'
     + (r.ok
        ? '<button class="b no" onclick="act2(\\''+o.id+'\\',\\'review_no\\')">取消公開</button>'
        : '<button class="b ok" onclick="act2(\\''+o.id+'\\',\\'review_ok\\')">通過</button>')
     + '<button class="b mid" onclick="copyReview(\\''+o.id+'\\')">複製</button>'
     + '</div>';
  if(r.ok) h += '<div class="hint" style="margin-top:9px">已通過。按「複製」拿到可以貼進 oracle.html 的那一行。</div>';
  return h + '</div>';
}

function saveReview(id){
  api('/api/oracle/admin/act', { id:id, act:'review_edit',
    text: val('rx_'+id), topic: val('rt_'+id) }).then(load);
}
function copyReview(id){
  var line = "{ who:'匿名', topic:'" + val('rt_'+id).replace(/'/g,'') + "', text:'"
           + val('rx_'+id).replace(/'/g,'').replace(/\\n/g,' ') + "' },";
  if(navigator.clipboard){
    navigator.clipboard.writeText(line).then(function(){ alert('複製好了，貼到 oracle.html 的 reviews 陣列裡') });
  } else {
    prompt('複製這一行：', line);
  }
}
function act2(id, a){
  api('/api/oracle/admin/act', { id:id, act:a }).then(load);
}

function saveText(id, kind){
  var body = { id: id, act: 'edit_draft' };
  if(kind === 'd') body.draft = val('d_'+id); else body.fu_reply = val('f_'+id);
  api('/api/oracle/admin/act', body).then(load).catch(function(){ alert('沒有成功') });
}

function act(id, a){
  var note = val('n_'+id);
  if((a==='q_revise'||a==='refund'||a==='return'||a==='fu_return') && !note.trim()){
    alert('這個動作需要填備註'); return;
  }
  var pre = Promise.resolve();
  if(a === 'send') pre = api('/api/oracle/admin/act', { id:id, act:'edit_draft', draft: val('d_'+id) });
  if(a === 'fu_send') pre = api('/api/oracle/admin/act', { id:id, act:'edit_draft', fu_reply: val('f_'+id) });
  pre.then(function(){
    return api('/api/oracle/admin/act', { id:id, act:a, note:note, q: val('q_'+id) });
  }).then(load).catch(function(){ alert('沒有成功，請重試') });
}
function reassign(id, name){
  if(!confirm('改派給 '+name+'？')) return;
  api('/api/oracle/admin/act', { id:id, act:'reassign', teacher:name }).then(load);
}

if(KEY){
  api('/api/oracle/admin/list').then(function(d){
    document.getElementById('gate').hidden = true;
    document.getElementById('app').hidden = false;
    render(d);
  }).catch(function(){ sessionStorage.removeItem('uw_admin') });
}
document.getElementById('pw').addEventListener('keydown', function(e){ if(e.key==='Enter') login() });
</script></body></html>`;

const PAGE_TEACHER = `<!doctype html><html lang="zh-Hant"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>未完籤所 · 老師端</title>
<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/assets/icon-180.png"><style>${CSS}</style></head><body>

<div id="gate" class="gate">
  <img src="/assets/logo.png" alt="未完籤所" class="gate-logo">
  <p>輸入你的專屬密碼</p>
  <input type="password" id="pw" placeholder="密碼">
  <div id="gerr" class="err" hidden>密碼不對</div>
  <button class="b ok" style="width:100%" onclick="login()">進入</button>
</div>

<div id="app" hidden>
  <div class="bar"><h1><img src="/assets/logo-mark.png" alt="" class="lg"><span id="me"></span><em id="cnt"></em></h1></div>
  <div class="tabs" id="tabs"></div>
  <div class="wrap" id="list"></div>
</div>

<script>${JSC}
var KEY = sessionStorage.getItem('uw_teacher') || '';
var ALL = [], CANUP = false, ME = '', F = 'todo';
var G = [
  ['todo','要寫的',['writing','fu_wait']],
  ['wait','審稿中',['draft_wait','draft_doing','fu_review','fu_doing']],
  ['done','已完成',['sent','done']]
];

function api(p, body){
  return fetch(p,{method: body?'POST':'GET',
    headers:{'X-Key':KEY,'Content-Type':'application/json'},
    body: body?JSON.stringify(body):undefined
  }).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json() });
}
function login(){
  KEY = document.getElementById('pw').value.trim();
  if(!KEY) return;
  api('/api/oracle/teacher/list').then(function(d){
    sessionStorage.setItem('uw_teacher', KEY);
    document.getElementById('gate').hidden = true;
    document.getElementById('app').hidden = false;
    render(d);
  }).catch(function(){ document.getElementById('gerr').hidden = false });
}
function load(){ api('/api/oracle/teacher/list').then(render) }

function render(d){
  if(d.orders) ALL = d.orders;
  if(typeof d.canUpload !== 'undefined') CANUP = d.canUpload;
  if(d.me) ME = d.me.name;
  document.getElementById('me').textContent = ME;
  var todo = ALL.filter(function(o){ return ['writing','fu_wait'].indexOf(o.st)>=0 }).length;
  document.getElementById('cnt').textContent = todo ? '有 '+todo+' 件要寫' : '目前沒有待辦';
  document.getElementById('tabs').innerHTML = G.map(function(g){
    var n = ALL.filter(function(o){ return g[2].indexOf(o.st)>=0 }).length;
    return '<button class="'+(F===g[0]?'on':'')+'" onclick="setF(\\''+g[0]+'\\')">'+g[1]+'<b>'+n+'</b></button>';
  }).join('');
  var g = G.filter(function(x){ return x[0]===F })[0];
  var rows = ALL.filter(function(o){ return g[2].indexOf(o.st)>=0 });
  document.getElementById('list').innerHTML = rows.length ? rows.map(card).join('')
    : '<div class="empty">這裡沒有東西</div>';
}
function setF(f){ F = f; render({}) }

function card(o){
  var h = '<div class="card">';
  h += '<div class="top"><span class="id">'+esc(o.id)+' · '+fmt(o.created)+'</span>'
     + '<span class="tag '+tone(o.st)+'">'+label(o.st)+'</span></div>';
  h += '<div class="q">'+esc(o.q)+'</div>';
  h += '<dl><dt>稱呼</dt><dd>'+esc(o.name)+'</dd>'
     + '<dt>占卜期間</dt><dd>'+(esc(o.timeframe)||'—')+'</dd>'
     + '<dt>想知道</dt><dd>'+(esc(o.intent)||'—')+'</dd>'
     + '<dt>對方</dt><dd>'+(esc(o.other_party)||'不牽涉他人')+'</dd></dl>';
  h += '<div class="bg">'+esc(o.background)+'</div>';
  if(o.extra && o.extra.length) h += '<div class="hint">也提到（不必回答）：'+o.extra.map(esc).join('、')+'</div>';

  if(o.st === 'writing'){
    if(o.edit_note) h += '<div class="warn">需要修改：'+esc(o.edit_note)+'</div>';
    h += '<label>牌陣照片（最多 6 張）</label>';
    h += '<div class="shots" id="s_'+o.id+'">'+(o.images||[]).map(function(k){
      return '<a href="/media/'+k+'" target="_blank"><img src="/media/'+k+'" alt=""></a>' }).join('')+'</div>';
    if(CANUP){
      h += '<input type="file" accept="image/*" id="u_'+o.id+'" style="display:none" onchange="upload(\\''+o.id+'\\',this)">';
      h += '<button class="b ghost" style="width:100%;margin-bottom:12px" onclick="document.getElementById(\\'u_'+o.id+'\\').click()">＋ 加一張照片</button>';
    } else {
      h += '<div class="hint">尚未開放上傳，請聯繫平台。</div>';
    }
    h += '<label>解讀內容</label>';
    h += '<textarea id="t_'+o.id+'" rows="14" oninput="cnt(\\''+o.id+'\\')" placeholder="800–1,500 字。以未完籤所名義撰寫，請勿署名或留下聯絡方式。">'+esc(o.draft)+'</textarea>';
    h += '<div class="count" id="c_'+o.id+'">'+(o.draft||'').length+' 字</div>';
    h += '<div class="btns">'
       + '<button class="b ghost" onclick="save(\\''+o.id+'\\',\\'draft\\',0)">先存起來</button>'
       + '<button class="b ok" onclick="save(\\''+o.id+'\\',\\'draft\\',1)">交稿</button></div>';
    h += '<div class="hint" style="margin-top:9px">交稿後由平台審閱，通過才寄給客人。'
       + '網頁沒有自動存檔，寫長文建議先在別的地方寫好再貼過來。</div>';
  }

  if(o.st === 'fu_wait'){
    h += '<div class="warn">客人追問：'+esc(o.followup)+'</div>';
    if(o.edit_note) h += '<div class="warn">需要修改：'+esc(o.edit_note)+'</div>';
    h += '<details><summary>看你上次寫的</summary><div class="reading">'+esc(o.draft)+'</div></details>';
    h += '<label>回覆</label>';
    h += '<textarea id="t_'+o.id+'" rows="7" oninput="cnt(\\''+o.id+'\\')">'+esc(o.fu_reply)+'</textarea>';
    h += '<div class="count" id="c_'+o.id+'">'+(o.fu_reply||'').length+' 字</div>';
    h += '<div class="btns">'
       + '<button class="b ghost" onclick="save(\\''+o.id+'\\',\\'fu_reply\\',0)">先存起來</button>'
       + '<button class="b ok" onclick="save(\\''+o.id+'\\',\\'fu_reply\\',1)">送出回覆</button></div>';
  }

  if(['draft_wait','draft_doing','fu_review','fu_doing'].indexOf(o.st) >= 0){
    h += '<div class="hint">已交出，等待平台審閱。</div>';
    h += '<details><summary>看你寫的</summary><div class="reading">'
       + esc(o.st.indexOf('fu')===0 ? o.fu_reply : o.draft)+'</div></details>';
  }
  if(o.st === 'sent' || o.st === 'done'){
    h += '<div class="hint">已寄給客人。</div>';
    h += '<details><summary>看內容</summary><div class="reading">'+esc(o.draft)+'</div></details>';
  }
  return h + '</div>';
}

function upload(id, input){
  var f = input.files && input.files[0];
  if(!f) return;
  if(f.size > 6*1024*1024){ alert('照片太大，請小於 6MB'); input.value=''; return }
  var o = ALL.filter(function(x){ return x.id===id })[0];
  if(o.images && o.images.length >= 6){ alert('最多 6 張'); input.value=''; return }
  fetch('/api/oracle/teacher/upload', { method:'POST',
    headers:{'X-Key':KEY,'Content-Type':f.type}, body:f
  }).then(function(r){ return r.json() }).then(function(d){
    if(!d.ok){ alert('上傳失敗'); return }
    o.images = (o.images||[]).concat([d.key]);
    document.getElementById('s_'+id).insertAdjacentHTML('beforeend',
      '<a href="'+d.url+'" target="_blank"><img src="'+d.url+'" alt=""></a>');
    save(id, 'draft', 0, true);
  }).catch(function(){ alert('上傳失敗') });
  input.value = '';
}
function cnt(id){
  var n = document.getElementById('t_'+id).value.length;
  var e = document.getElementById('c_'+id);
  e.textContent = n + ' 字';
  e.className = 'count' + (((n && n<800) || n>1600) ? ' bad' : '');
}
function save(id, field, done, silent){
  var o = ALL.filter(function(x){ return x.id===id })[0];
  var text = document.getElementById('t_'+id).value;
  if(done && field==='draft' && text.trim().length < 200){ alert('內容太短，還不能交稿'); return }
  if(done && !confirm(field==='draft' ? '確定交稿？' : '確定送出回覆？')) return;
  api('/api/oracle/teacher/save', { id:id, field:field, text:text, images:o.images||[], done: done?1:0 })
    .then(function(){ if(!silent){ alert(done?'已送出':'已存起來'); load() } })
    .catch(function(){ alert('沒有成功，請重試') });
}

if(KEY){
  api('/api/oracle/teacher/list').then(function(d){
    document.getElementById('gate').hidden = true;
    document.getElementById('app').hidden = false;
    render(d);
  }).catch(function(){ sessionStorage.removeItem('uw_teacher') });
}
document.getElementById('pw').addEventListener('keydown', function(e){ if(e.key==='Enter') login() });
</script></body></html>`;

const PAGE_ORDER = `<!doctype html><html lang="zh-Hant"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>未完籤所 · 查詢進度</title>
<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/assets/icon-180.png"><style>${CSS}
body{background:#0D0818}
.card{background:#1C1330;border-color:#3E2C5C}
.bar{background:rgba(13,8,24,.96);border-color:#3E2C5C}
</style></head><body>

<div class="bar"><h1><img src="/assets/logo-mark.png" alt="" class="lg">未完籤所 <em>查詢進度</em></h1></div>

<div id="gate" class="gate">
  <p>輸入訂單編號與你付款時填的信箱</p>
  <input id="oid" placeholder="訂單編號 UW…">
  <input id="mail" type="email" placeholder="your@email.com">
  <div id="gerr" class="err" hidden>查不到這筆訂單，請確認編號與信箱</div>
  <button class="b ok" style="width:100%" onclick="look()">查詢</button>
</div>

<div class="wrap" id="box"></div>

<script>${JSC}
var ID = '', MAIL = '', TOPIC = '感情';
var TOPICS = ['感情','曖昧','復合','工作','人生','其他'];
var qs = new URLSearchParams(location.search);
if(qs.get('id')) document.getElementById('oid').value = qs.get('id');

function look(){
  ID = document.getElementById('oid').value.trim();
  MAIL = document.getElementById('mail').value.trim();
  if(!ID || !MAIL) return;
  fetch('/api/oracle/order/get?id='+encodeURIComponent(ID)+'&email='+encodeURIComponent(MAIL))
    .then(function(r){ if(!r.ok) throw 0; return r.json() })
    .then(function(d){ document.getElementById('gate').hidden = true; show(d.order) })
    .catch(function(){ document.getElementById('gerr').hidden = false });
}

/* 客人最在意的是「什麼時候收到」。
   占卜期間是牌要看的範圍，兩者完全不同，一定要分開講。 */
function eta(o){
  if(o.st === 'sent' || o.st === 'done'){
    return '<dt>已寄出</dt><dd>'+esc(String(o.sent_at||'').slice(0,16).replace('T',' '))+'</dd>';
  }
  if(['refund','refunded'].indexOf(o.st) >= 0) return '';
  return '<dt>預計完成</dt><dd>付款後 24–48 小時內</dd>';
}

function show(o){
  var h = '<div class="card">';
  h += '<div class="top"><span class="id">'+esc(o.id)+'</span>'
     + '<span class="tag '+tone(o.st)+'">'+label(o.st)+'</span></div>';
  h += '<div class="q">'+esc(o.q)+'</div>';
  h += '<dl><dt>老師</dt><dd>'+esc(o.teacher)+'</dd>'
     + '<dt>占卜期間</dt><dd>'+(esc(o.timeframe)||'—')+'</dd>'
     + eta(o)
     + '</dl>';

  if(o.st === 'q_revised'){
    h += '<div class="warn">我們看過之後調整了你的問法，想請你確認。<br><br>'
       + '你原本寫的：'+esc(o.q_original)+'<br>調整後：'+esc(o.q)+'<br><br>'
       + '為什麼調整：'+esc(o.q_note)+'</div>';
    h += '<div class="btns"><button class="b ok" onclick="okQ()">可以，就這樣問</button></div>';
    h += '<div class="hint" style="margin-top:9px">不同意的話請回信告訴我們，我們會再調整或退款。</div>';
  }
  if(o.st === 'q_review') h += '<div class="hint">我們正在確認你的問法，確認後會交給老師。</div>';
  if(o.st === 'writing') h += '<div class="hint">'+esc(o.teacher)+'正在為你占卜與撰寫。</div>';
  if(o.st === 'draft_wait' || o.st === 'draft_doing')
    h += '<div class="hint">老師已完成，我們正在校閱，很快就會寄給你。</div>';
  if(o.st === 'refund') h += '<div class="warn">這一題我們沒有辦法接，正在為你辦理退款。</div>';
  if(o.st === 'refunded') h += '<div class="warn">退款已完成。</div>';

  if(o.draft){
    h += '<div class="reading">'+esc(o.draft)+'</div>';
    if(o.images && o.images.length){
      h += '<div class="shots">'+o.images.map(function(k){
        return '<a href="/media/'+k+'" target="_blank"><img src="/media/'+k+'" alt="牌陣"></a>' }).join('')+'</div>';
    }
  }

  if(o.st === 'sent'){
    h += '<label style="margin-top:16px">你還有一次免費追問</label>';
    h += '<textarea id="fu" rows="4" placeholder="針對上面的解讀，你還想問什麼？"></textarea>';
    h += '<div class="btns"><button class="b ok" onclick="sendFu()">送出追問</button></div>';
    h += '<div class="hint" style="margin-top:9px">追問只有一次，送出後不能修改。</div>';
  }
  if(o.followup) h += '<div class="warn" style="margin-top:14px">你的追問：'+esc(o.followup)+'</div>';
  if(['fu_wait','fu_review','fu_doing'].indexOf(o.st) >= 0)
    h += '<div class="hint">老師正在回覆你的追問。</div>';
  if(o.fu_reply) h += '<div class="reading">'+esc(o.fu_reply)+'</div>';
  if(o.st === 'done') h += '<div class="hint">本次服務已完成。謝謝你把故事交給我們。</div>';

  /* 評價 */
  if(['sent','fu_wait','fu_review','fu_doing','done'].indexOf(o.st) >= 0){
    if(o.hasReview){
      h += '<div class="hint" style="margin-top:18px;border-top:1px solid #3E2C5C;padding-top:16px">'
         + '謝謝你留下感想，我們收到了。</div>';
    } else {
      h += '<div style="margin-top:20px;border-top:1px solid #3E2C5C;padding-top:18px">';
      h += '<label>留幾句話給 ' + esc(o.teacher) + '</label>';
      h += '<div class="hint">會匿名顯示在老師的頁面上，讓下一個猶豫的人知道這裡是什麼樣子。<br>'
         + '不寫也完全沒關係。</div>';
      h += '<div class="tabs" style="padding:6px 0 10px" id="topics"></div>';
      h += '<textarea id="rv" rows="4" maxlength="200" placeholder="兩三句話就夠了。哪一段讓你有感覺、或跟你原本想的不一樣？"></textarea>';
      h += '<div class="btns"><button class="b ok" onclick="sendReview()">送出</button></div>';
      h += '</div>';
    }
  }

  document.getElementById('box').innerHTML = h + '</div>';

  var tb = document.getElementById('topics');
  if(tb){
    tb.innerHTML = TOPICS.map(function(t,i){
      return '<button class="'+(i===0?'on':'')+'" onclick="pickTopic(this)">'+t+'</button>' }).join('');
  }
}

function post(p, body){
  return fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)}).then(function(r){ if(!r.ok) throw 0; return r.json() });
}
function pickTopic(el){
  TOPIC = el.textContent;
  var bs = document.querySelectorAll('#topics button');
  for(var i=0;i<bs.length;i++) bs[i].className = (bs[i]===el ? 'on' : '');
}
function sendReview(){
  var t = document.getElementById('rv').value.trim();
  if(t.length < 10){ alert('再多寫一點點'); return }
  post('/api/oracle/order/review', { id:ID, email:MAIL, text:t, topic:TOPIC })
    .then(look).catch(function(){ alert('沒有成功，請重試') });
}
function okQ(){ post('/api/oracle/order/confirm',{id:ID,email:MAIL}).then(look).catch(function(){ alert('沒有成功') }) }
function sendFu(){
  var t = document.getElementById('fu').value.trim();
  if(t.length < 5){ alert('再多寫一點'); return }
  if(!confirm('追問只有一次，確定送出？')) return;
  post('/api/oracle/order/followup',{id:ID,email:MAIL,text:t}).then(look).catch(function(){ alert('沒有成功') });
}
document.getElementById('mail').addEventListener('keydown', function(e){ if(e.key==='Enter') look() });
</script></body></html>`;

/* ══════════════════════════════════════════════════
   付款完成頁
   ══════════════════════════════════════════════════ */

const PAGE_DONE = `<!doctype html><html lang="zh-Hant"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>未完籤所 · 付款完成</title>
<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/assets/icon-180.png"><style>${CSS}
body{background:#0D0818}
.card{background:#1C1330;border-color:#3E2C5C}
.bar{background:rgba(13,8,24,.96);border-color:#3E2C5C}
.big-logo{display:block;width:min(150px,40%);height:auto;margin:30px auto 10px;opacity:.95}
</style></head><body>
<div class="bar"><h1><img src="/assets/logo-mark.png" alt="" class="lg">真人占卜</h1></div>
<div class="wrap" id="box"><div class="empty">正在確認付款…</div></div>
<script>
var NO = new URLSearchParams(location.search).get('no') || '';
var tries = 0;

function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

function poll(){
  fetch('/api/oracle/status?no=' + encodeURIComponent(NO), { cache: 'no-store' })
    .then(function(r){ return r.json() })
    .then(function(d){
      if (d.paid) return done(d);
      if (++tries > 15) return slow();
      setTimeout(poll, 2000);
    })
    .catch(function(){ if (++tries > 15) slow(); else setTimeout(poll, 2000) });
}

function done(d){
  document.getElementById('box').innerHTML =
    '<img src="/assets/logo.png" alt="未完籤所" class="big-logo">'
  + '<div class="card" style="text-align:center">'
  + '<div class="q" style="text-align:center">收到了</div>'
  + '<p class="hint">你的問題已經送出，' + esc(d.teacher) + '會在 24 到 48 小時內完成。</p>'
  + '<dl style="grid-template-columns:6em 1fr;text-align:left;margin-top:16px">'
  + '<dt>訂單編號</dt><dd style="font-family:ui-monospace,monospace">' + esc(NO) + '</dd></dl>'
  + '<p class="hint" style="margin-top:14px">完成後會寄到你填的信箱。'
  + '這個編號請留著，之後查進度和提出追問都會用到。</p>'
  + '<a class="b ok" style="display:block;text-decoration:none;margin-top:16px" '
  + 'href="/oracle/order?id=' + encodeURIComponent(NO) + '">查詢進度</a>'
  + '</div>';
}

function slow(){
  document.getElementById('box').innerHTML =
    '<div class="card"><div class="q">還在確認中</div>'
  + '<p class="hint">銀行的通知偶爾會慢一點。你的訂單編號是 <b>' + esc(NO) + '</b>，'
  + '請先記下來。<br><br>幾分鐘後用下面的按鈕查詢，若超過半小時仍未成立，'
  + '請帶著這個編號跟我們聯繫。</p>'
  + '<a class="b ok" style="display:block;text-decoration:none;margin-top:14px" '
  + 'href="/oracle/order?id=' + encodeURIComponent(NO) + '">查詢進度</a></div>';
}
poll();
</script></body></html>`;


const SYSTEM_PROMPT = `你是「未完籤所」真人占卜服務的問題整理助理。

## 你的目標
跟使用者對話，把他的困擾整理成一個占卜師能夠解讀的問題。
達成目標就結束，不需要湊滿輪數。最多四輪。
第四輪結束後，無論是否齊全，一律輸出 JSON。缺的欄位留空字串，絕對不可以自己編。

輪數不多，能合併就合併。第二輪起，若時間邊界還沒拿到，
發問時必須一併帶到，不要單獨再花一輪。
例：「你們多久沒聯絡了？另外這題想看多久之內？」

## 什麼叫「能夠解讀」
需要五件事。前三件讓問題成立，第四件讓老師寫得出東西，第五件讓牌陣有指向。

1. 明確的對象與事件 —— 誰、什麼事
2. 一個時間邊界 —— 可以是期間（三個月內），也可以是事件（放榜前、他生日前、今年底前）
3. 清楚的問法 —— 問結果、問時間點、或問自己能做什麼
4. 一點背景 —— 這件事的來龍去脈。多久了、目前什麼狀態、發生過什麼
5. 對方是誰 —— 若這題牽涉到另一個人，需要他的名字或暱稱，以及你們是什麼關係

若都齊了，直接輸出 JSON，不要多問。
若缺，用最少的輪數補齊，可以在同一個問題裡帶到兩件事。

## 不要問「為什麼現在想問」
不要問使用者的動機、契機、為什麼突然想到要問這件事。
那不是老師需要的資訊，而且會讓人覺得被盤問。
你要的是處境，不是理由。

錯誤示範：
「最近怎麼會想到問這個？」
「是發生了什麼事嗎？」
「什麼原因讓你現在想算這個？」

正確示範：
「這段期間你們還有聯絡嗎？」
「目前是什麼狀態？」
「最後一次講話是什麼情況？」

## 問「他在想什麼」「為什麼」「他身邊有沒有別人」
這一類問的是**當下**，不是未來會不會發生，也沒有時間性。
是很常見的問法，不要硬把它改成別的。

處理方式：
- intent 填「他現在的想法或狀況」
- timeframe 填「當下」
- main_question 這時**不必**包含時間邊界

這是唯一一個 main_question 可以不含時間邊界的情況。

適用的問法：
- 「他到底怎麼想我」「他心裡還有沒有我」
- 「為什麼他突然冷淡」「為什麼他不回訊息」
- 「他身邊有沒有其他人」「他現在過得好不好」
- 「我們適不適合」

**不要問使用者「你想看多久之內」。** 這一類沒有時間範圍可言，
問了會讓人覺得你沒聽懂。 該問的還是名字、關係、現況。

## 時間邊界不是「事情發生的時間」
這兩個很容易混淆，一定要分清楚。

- 「他一年前離開」→ 這是**背景**。事情什麼時候發生的。
- 「一年內他會不會回來」→ 這是**時間邊界**。從現在往後看多久。

使用者提到過去的時間，不代表他指定了邊界。
沒問過就是沒有，必須主動問，不可以拿背景裡的時間來充數。

**這是最常犯的錯，輸出前一定要自我檢查一次：**
timeframe 裡的那個說法，使用者有沒有親口說過他想看這段時間？
沒有就留空字串。不可以從背景搬過來，也不可以自己挑一個看起來合理的。
留空不會怎麼樣，使用者會在下一頁自己選；填錯會讓老師整篇答錯題。

錯誤示範：
使用者說「他一年前離開的」→ 不可以填「一年內」。
使用者說「我們三個月沒聯絡了」→ 不可以填「三個月內」。
使用者說「下個月他要調職」→ 不可以填「一個月內」。
以上都是背景。使用者從頭到尾沒說過他想看多久之內。

## 時間邊界的上限是半年
占卜的有效期間大約半年，超過這個範圍準確度會下降。

若使用者說「一年內」「兩年內」「三年內」，回覆：
「占卜大概看得到半年左右。要不要改成半年內？」

事件型邊界也一樣。若那件事在半年之後（例如「明年結婚前」），
請他改成半年內的一個節點。

可接受的範圍：兩週內、一個月內、三個月內、半年內，
或半年內會發生的某件事（放榜前、他生日前、下次見面前、年底前）。

## 對方的名字
塔羅需要知道這次要算誰。沒有指名，牌陣找不到指向。

**牽涉到另一個人時，名字和關係兩件都要問到。**
名字讓牌陣有指向，關係讓老師知道這是什麼樣的一段連結。
兩件要在同一個問題裡一起問，不要分兩輪。

正確示範：「他叫什麼名字？你們現在是什麼關係，目前是什麼狀態？」
　　　　　「他叫什麼？你們是怎麼認識的，現在的狀況是什麼？」

只問到其中一件都不夠：
「他叫什麼名字？」→ 缺關係。
「你們現在是什麼關係？」→ 缺名字。

要問的情境：
- 感情：他／她叫什麼
- 職場：那位主管或同事叫什麼
- 家人：那位家人叫什麼
- 毛孩：牠叫什麼名字

**不牽涉他人的問題就不要問。** 例如：
- 「三個月內我會不會考上」
- 「半年內我的財務狀況會不會好轉」
- 「一個月內我該不該換工作」（沒有指定對象時）

這一項可以跟其他缺項合併問，不要單獨花一輪。
例：「他叫什麼名字？另外你們多久沒聯絡了？」

若使用者不願意給，接受「他」「前男友」這類代稱，不要追問第二次。

## 背景這一項不可以省略
老師要寫 800 到 1500 字。只有一句問題、沒有任何處境，他等於空手上場。
就算問題本身已經很完整，只要使用者沒說過背景，就要問一輪。
問法要具體，不要問「可以多說一點嗎」，那太空泛。
例：「這件事發生多久了？你們現在還有聯絡嗎？」

**若這題牽涉到另一個人，背景必須包含這兩件：**
- 你們是什麼關係（前男友、曖昧對象、同事、朋友、家人）
- 這段關係目前是什麼狀態（還有沒有聯絡、多久沒講話、上次見面是什麼情況）

只知道「他會不會回來」而不知道你們是什麼關係，老師寫不出東西。

背景要盡量沿用使用者的原話，不要改成比較得體的說法。
使用者說「都沒人要我」就寫「都沒人要我」，不要改成「都沒有人錄取我」。

## 判斷範例
「三個月內他會不會主動找我」
→ 問題完整，但沒有背景、也不知道對方是誰、更不知道是什麼關係。
　 問：「他叫什麼名字？你們現在是什麼關係，多久沒聯絡了？」

「他什麼時候會回來」
→ 缺時間邊界。問：「你想看的是多久之內？可以是一段時間，也可以是某件事情之前。」

「我適合什麼工作」
→ 對象事件太模糊。先收窄成一件具體的事。

「我最近運勢如何」
→ 幾乎都缺。先問他現在最在意哪一件事。

「我跟他冷戰兩個禮拜了，不知道該不該先開口，想問一個月內」
→ 事件、邊界、問法都有，背景只知道冷戰兩週，還缺名字和關係。
　 問：「他叫什麼名字？你們是什麼關係？」

「三個月內我會不會考上」
→ 不牽涉他人，不要問對方名字。只需補背景。

「他一年前離開，離開前我們吵了架，到現在沒聯絡」
→ 有事情經過，但不知道是什麼關係、對方叫什麼，也沒有時間邊界。
　 問：「他叫什麼名字，你們是什麼關係？另外你想看的是多久之內？」

「我想問一年內他會不會回來」
→ 超過半年。回：「占卜大概看得到半年左右。要不要改成半年內？」

「他目前身邊有沒有其他人」
→ 問的是當下，不要問時間範圍。intent 填「他現在的想法或狀況」，timeframe 填「當下」。
　 缺的是名字、關係、現況。
　 問：「他叫什麼名字？你們現在是什麼關係，多久沒聯絡了？」

「為什麼他最近突然冷淡」
→ 同上，問的是當下。不要改寫成「他會不會回心轉意」。

「我媽的病三個月內會不會好」
→ 醫療，不受理。回：「這一類我們沒有辦法接。身體的事情要看醫生，
　 占卜幫不上忙。你有沒有別的想問？」

「我朋友和她男友會不會分手」
→ 與使用者無關的兩個人。請他改成跟自己有關的問法。

「這期樂透開幾號」
→ 明牌，不受理。

## 不受理的題目
以下幾類不在服務範圍。遇到時不要整理成受理單，也不要輸出 JSON。
用一句話說明，然後問他有沒有別的想問的。不要說教、不要解釋原因兩次。

- **醫療與健康**：疾病會不會好、要不要開刀、能不能懷孕
　「這一類我們沒有辦法接。身體的事情要看醫生，占卜幫不上忙。你有沒有別的想問？」
- **法律與訴訟**：官司會不會贏、要不要告
　「訴訟的事我們沒有辦法接，那需要律師。你有沒有別的想問？」
- **生死**：誰會不會過世、還能活多久
　「這一類我們沒有辦法接。你有沒有別的想問？」
- **明牌與賭博**：樂透號碼、要買哪一支股票
　「我們不提供號碼或個股。如果是想問財務的整體走向，可以換個問法。」

**財務可以接**，但只能問走向，不能問標的。
可以：「三個月內我的財務會不會好轉」「這筆投資適不適合我」
不可以：「該買哪一支股票」「這期樂透幾號」

## 幫別人問 / 算不在場的人
使用者問的是自己與對方的關係，這是正常的，照常受理。

但若使用者問的是**兩個與他無關的人之間的事**（例如「我朋友和她男友會不會分手」），
回覆：「占卜看的是你自己的處境。你可以問你和這件事的關係，
例如你要不要介入、這件事會怎麼影響你。要換成這樣問嗎？」

## 同時牽涉兩個人
若使用者要在兩個人之間做選擇（「A 和 B 我該選誰」），
兩個名字都要問到，other_party 用頓號分隔，例如「小明、阿華」。
問法：「這兩位分別叫什麼名字？你和他們各自是什麼關係？」

## 一次只問一件事
若使用者同時提到多個主題（例如感情、工作、金錢），必須請他擇一：
「這裡有幾件事：A、B、C。老師這次只會回答一件。你想先問哪一件？」
絕對不可以說「都可以一起問」。未被選中的放進 extra。

## 對方的稱呼
這位使用者希望被稱為「{稱呼}」。
第一次回應時用一次這個稱呼，之後直接說事情，不要每句都叫名字。

## 語氣
像一個認真在聽的人，不是在填表格。克制但不冷淡。

**先接住他剛說的，再問下一件。** 這一句只是複述事實，不評價、不安慰。
　差：「你們現在是什麼關係？」
　好：「分手十年了。這段期間有聯絡過嗎？」
　差：「請提供對方的名字。」
　好：「他叫什麼名字？本名最準，暱稱也可以。」

**一次最多問兩件事。** 三個問句連在一起像審問，人會不想回。
若還缺三件以上，先問最關鍵的兩件，剩下的下一輪再問。

**用講話的方式寫，不要用表單的方式寫。**
不要用「請提供」「請說明」「需要確認以下資訊」這種公文語氣。
不要條列、不要編號。

每次回覆不超過三句話。不使用驚嘆號，不使用表情符號。使用台灣繁體中文。
絕對不要問使用者已經說過的事。

**接住不等於安慰。** 只複述他說過的事實，不要加上你的評價或情緒。
　可以：「分手十年了。」
　不可以：「分手十年一定很不容易。」「這麼久了還放不下，很正常。」

## 絕對禁止
- 不解讀、不預測、不評論吉凶
- 不給建議、不安慰、不同理
- 不提及或引用任何籤詩內容
- 不回答使用者的問題，即使他直接問你
- 不問使用者的動機或為什麼現在想問
- 禁用詞：我覺得、應該會、可能是、建議你、別擔心、會沒事的、他其實、看起來他、你可以試著

若使用者要求你解讀或回答，僅回覆：
「這部分會由老師回答。我這邊只負責幫你把問題整理清楚。」
說完直接接回上一個還沒問完的問題，不要停在那裡等。

## 安全例外（優先於以上所有規則）
若使用者提到想傷害自己、不想活了、或有立即的人身安全危險，
立刻停止整理流程，不輸出 JSON，僅回覆：

這件事需要真的有人陪你談。台灣可以打 1925 安心專線，24 小時都有人接。

這句話一字不可更動，前後不可加任何其他文字。之後不再繼續問問題。
即使已經問到第四輪、即使欄位都已齊全，只要出現上述狀況，一律改為只回這句話。

## 輸出
整理完成後，只輸出以下 JSON，不要有任何其他文字或標記：
{"main_question":"","timeframe":"","intent":"","other_party":"","background":"","extra":[]}

main_question：一句話，40字內，第一人稱，必須包含時間邊界。判斷不出來就留空字串。
　　　　　　　　唯一例外：intent 為「他現在的想法或狀況」時，可以不含時間邊界。
timeframe：使用者實際說的時間邊界，照他的說法寫（「三個月內」「放榜前」「今年底前」都可以）。
　　　　　 不可超過半年。不可以拿背景裡的時間（「一年前分手」）來當邊界。
　　　　　 使用者沒明確說過就不要填，回頭去問；四輪用完仍沒有就留空字串。
　　　　　 intent 為「他現在的想法或狀況」時，填「當下」。
intent：以下四者擇一，判斷不出來就留空字串。
　　　　「會不會發生」　　　問結果
　　　　「什麼時候會發生」　問落點
　　　　「我可以做什麼」　　問自己的行動
　　　　「他現在的想法或狀況」　問對方此刻怎麼想、目前是什麼狀態、為什麼會這樣
background：150字內，第一人稱，只寫使用者說過的事實。不推論、不補充、不美化。
　　　　　　盡量沿用原話。不可以只是把 main_question 換句話說。背景是處境，不是問題本身。
　　　　　　若使用者真的沒說過任何背景，留空字串，不要自己編。
other_party：這題要算的對方名字或暱稱。不牽涉他人就留空字串。
extra：未被選中的其他主題，最多兩項。

## JSON 字元規則
所有欄位皆為單行純文字。
- 不得含換行。使用者若分段講述，合併成一段。
- 使用者原文中的半形雙引號一律改為「」；半形單引號一律刪除。
- 不得使用反斜線。
- 不得含表情符號，一律刪除，不轉成文字描述。
- extra 為字串陣列，沒有內容時輸出 []，不可輸出 null 或空字串。`;

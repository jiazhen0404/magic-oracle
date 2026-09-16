/**
 * 未完籤所 · LINE Bot 限定「今日訊息籤」
 * ------------------------------------------------------------------
 * 這個功能只活在 LINE 裡。網站上沒有對應的抽籤頁，也不要做。
 *
 * 網址（統稱 API）：
 *   POST /api/line/webhook             LINE 平台把使用者的訊息／按鈕送到這裡
 *   GET  /api/line/go?d=&s=            「我有一件事想問」按鈕：記一筆導流，再轉到網站首頁（帶 UTM）
 *   GET  /api/line-daily/admin/summary 後台總覽數字（需 X-Admin-Key）
 *   GET  /api/line-daily/admin/fortunes 後台籤支列表＋每支統計（需 X-Admin-Key）
 *   POST /api/line-daily/admin/fortune  後台編輯一支籤（需 X-Admin-Key）
 *
 * 使用者流程：
 *   Rich Menu「✨ 今天，有一句話想給你」
 *     ├─ 今天還沒抽 → 顯示開場卡（不用想問題⋯）＋【接收今天的訊息】
 *     │     └─ 按下 → 正式抽籤 → 回覆今日訊息
 *     └─ 今天抽過了 → 直接回覆今天那一支（不重抽）
 *
 * 需要的設定：
 *   LINE_CHANNEL_SECRET        Messaging API 的 Channel secret        ← Secret
 *   LINE_CHANNEL_ACCESS_TOKEN  Messaging API 的長期 access token      ← Secret
 *   GA4_API_SECRET             GA4 Measurement Protocol 的 API secret ← Secret（沒設就不送 GA4，功能照常）
 *   GA4_MEASUREMENT_ID         G-71RMD00WPJ，寫在 wrangler.jsonc
 *   DB                         既有 D1（unfinished-articles），表結構見 src/line-daily.sql
 *
 * 平台坑（見 CLAUDE.md）：所有 JSON 回應都加 cache-control: no-store。
 */

const TZ_OFFSET_HOURS = 8;       // Asia/Taipei。台灣自 1979 年起沒有日光節約時間，固定 +8 最穩
const RECENT_WINDOWS = [14, 7, 1, 0];   // 防重複：先排除 14 天 → 7 天 → 昨天 → 全籤池
const CTA_LABEL = '我有一件事想問';
const UTM = 'utm_source=line&utm_medium=bot&utm_campaign=universe_daily';

// Rich Menu 若在「LINE 官方帳號管理後台」設定，只能用「文字」動作，
// 所以文字與 postback 兩種都接。比對前會去掉空白、emoji 與全半形逗號差異。
// 「宇宙指引」是 Rich Menu 圖卡上的名稱（UNIVERSE｜來自宇宙的訊息與提醒），點圖卡送出這四個字即可。
const OPEN_WORDS = ['宇宙指引', '今天有一句話想給你', '今日訊息', '今天的訊息'];
const DRAW_WORDS = ['接收今天的訊息'];
const PB_OPEN = 'line_daily=open';
const PB_DRAW = 'line_daily=draw';

const C = {               // 未完籤所色票：深靛藍＋金
  bg: '#15102A', gold: '#D9BD82', text: '#E8E3D9', soft: '#F3EDF7', faint: '#A89AB8', line: '#3A2D5C',
  btn: '#5A3F8A',
};

/* ══════════════════════════════════════════════════
   路由
   ══════════════════════════════════════════════════ */

export async function lineDailyRoutes(request, env, ctx, url) {
  const path = url.pathname;
  if (path === '/api/line/webhook' && request.method === 'POST') return webhook(request, env, ctx);
  if (path === '/api/line/go' && request.method === 'GET') return goToSite(url, env, ctx);
  if (path.startsWith('/api/line-daily/admin/')) return adminApi(request, env, url);
  return null;
}

/* ══════════════════════════════════════════════════
   日期：一律用台灣日期，不用伺服器的 UTC 日期
   ══════════════════════════════════════════════════ */

export function taipeiDate(now = new Date()) {
  return new Date(now.getTime() + TZ_OFFSET_HOURS * 3600e3).toISOString().slice(0, 10);
}

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* ══════════════════════════════════════════════════
   抽籤核心
   ══════════════════════════════════════════════════ */

function random01() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}

/** 依 weight 抽一支。weight 越小越難抽到，0 等於抽不到。 */
export function pickWeighted(list, rand = random01) {
  const total = list.reduce((s, f) => s + Math.max(0, Number(f.weight) || 0), 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const f of list) {
    r -= Math.max(0, Number(f.weight) || 0);
    if (r < 0) return f;
  }
  return list[list.length - 1];
}

/** 防重複：依序放寬排除範圍，保證只要籤池不是空的就一定抽得到。 */
export function candidatePool(pool, recent, today) {
  for (const days of RECENT_WINDOWS) {
    const cutoff = addDays(today, -days);
    const exclude = new Set(days === 0 ? [] : recent.filter(r => r.draw_date >= cutoff).map(r => r.fortune_id));
    const left = pool.filter(f => !exclude.has(f.fortune_id));
    if (left.length) return { list: left, window: days };
  }
  return { list: pool, window: 0 };
}

const TODAY_SQL =
  `SELECT d.id AS draw_id, d.fortune_id, d.draw_date, f.title, f.content, f.reminder, f.category
     FROM line_daily_draws d
     LEFT JOIN line_daily_fortunes f ON f.fortune_id = d.fortune_id
    WHERE d.line_user_id = ?1 AND d.draw_date = ?2`;

/**
 * 今天的籤。
 * 回傳 { status: 'existing' | 'new' | 'empty', draw }
 *   existing：今天已經抽過（包含「同時兩個請求，另一個先寫進去」的情況）
 *   new     ：這次才抽的
 *   empty   ：籤池沒有任何啟用中的籤
 * onlyPeek = true 時只查不抽（給「打開」用）。
 */
export async function drawToday(db, userId, { now = new Date(), onlyPeek = false, rand } = {}) {
  const today = taipeiDate(now);

  const existing = await db.prepare(TODAY_SQL).bind(userId, today).first();
  if (existing) return { status: 'existing', draw: existing };
  if (onlyPeek) return { status: 'none', draw: null };

  const { results: pool } = await db.prepare(
    `SELECT fortune_id, weight FROM line_daily_fortunes WHERE is_active = 1 AND weight > 0`
  ).all();
  if (!pool || !pool.length) return { status: 'empty', draw: null };

  const { results: recent } = await db.prepare(
    `SELECT fortune_id, draw_date FROM line_daily_draws
      WHERE line_user_id = ?1 AND draw_date >= ?2 AND draw_date < ?3`
  ).bind(userId, addDays(today, -RECENT_WINDOWS[0]), today).all();

  const { list } = candidatePool(pool, recent || [], today);
  const picked = pickWeighted(list, rand);

  // 關鍵：UNIQUE(line_user_id, draw_date)。撞到就什麼都不做，下面再讀回「先寫進去的那一支」。
  const ins = await db.prepare(
    `INSERT INTO line_daily_draws (line_user_id, fortune_id, draw_date, drawn_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(line_user_id, draw_date) DO NOTHING`
  ).bind(userId, picked.fortune_id, today, now.toISOString()).run();

  const row = await db.prepare(TODAY_SQL).bind(userId, today).first();
  const isNew = Boolean(ins && ins.meta && ins.meta.changes > 0);
  return { status: isNew ? 'new' : 'existing', draw: row };
}

async function logEvent(db, userId, event, draw, now = new Date()) {
  try {
    await db.prepare(
      `INSERT INTO line_daily_events (line_user_id, event, draw_id, fortune_id, event_date)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    ).bind(userId, event, draw ? draw.draw_id : null, draw ? draw.fortune_id : null, taipeiDate(now)).run();
  } catch (e) {
    console.error('LINE 今日訊息：事件寫入失敗', event, e && e.message);
  }
}

/* ══════════════════════════════════════════════════
   Webhook
   ══════════════════════════════════════════════════ */

async function webhook(request, env, ctx) {
  const raw = await request.text();
  if (!env.LINE_CHANNEL_SECRET) return json({ error: 'not_configured' }, 503);

  const ok = await verifySignature(raw, request.headers.get('x-line-signature') || '', env.LINE_CHANNEL_SECRET);
  if (!ok) return json({ error: 'bad_signature' }, 401);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'bad_json' }, 400); }

  // LINE 後台按「Verify」時 events 是空陣列，直接回 200 就好。
  const events = Array.isArray(body.events) ? body.events : [];
  const work = Promise.all(events.map(ev => handleEvent(ev, env, ctx).catch(err =>
    console.error('LINE 今日訊息：處理事件失敗', err && err.stack ? err.stack : err))));

  // 先回 200 給 LINE，事情在背景做完（回覆 token 有效時間約 1 分鐘，綽綽有餘）。
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work);
  else await work;
  return json({ ok: true });
}

export async function verifySignature(raw, signature, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

const norm = s => String(s || '').replace(/[\s✨✦☆★‍️]/g, '').replace(/[,，、。.!！]/g, '');

export function intentOf(ev) {
  if (ev.type === 'postback') {
    const d = String(ev.postback && ev.postback.data || '');
    if (d === PB_OPEN) return 'open';
    if (d === PB_DRAW) return 'draw';
    return null;
  }
  if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
    const t = norm(ev.message.text);
    if (DRAW_WORDS.some(w => norm(w) === t)) return 'draw';
    if (OPEN_WORDS.some(w => norm(w) === t)) return 'open';
  }
  return null;
}

async function handleEvent(ev, env, ctx) {
  const intent = intentOf(ev);
  if (!intent) return;                                   // 不是這個功能的訊息，不插手
  if (!ev.source || ev.source.type !== 'user' || !ev.source.userId) return;  // 只在一對一聊天使用
  if (!env.DB) { console.error('LINE 今日訊息：沒有 D1（DB）'); return; }

  const userId = ev.source.userId;
  const messages = await respond(intent, userId, env, ctx);
  if (messages) await reply(env, ev.replyToken, messages);
}

/** 產生要回的訊息。拆出來是為了測試時不必真的打 LINE。 */
export async function respond(intent, userId, env, ctx, opts = {}) {
  const db = env.DB;
  const bg = p => (ctx && typeof ctx.waitUntil === 'function') ? ctx.waitUntil(p) : p;

  if (intent === 'open') {
    const peek = await drawToday(db, userId, { ...opts, onlyPeek: true });
    if (peek.status === 'existing') {
      await logEvent(db, userId, 'repeat_view', peek.draw, opts.now);
      bg(ga4(env, userId, 'line_daily_repeat_view', { fortune_id: peek.draw.fortune_id }));
      return [await fortuneMessage(env, peek.draw, { repeat: true })];
    }
    return [introMessage()];
  }

  // intent === 'draw'
  const result = await drawToday(db, userId, opts);
  if (result.status === 'empty') {
    return [{ type: 'text', text: '今天的訊息還在整理中，晚一點再來找我們。\n\n—— 未完籤所 ——' }];
  }
  if (result.status === 'existing') {
    // 按鈕按第二次、或兩個請求同時進來：給同一支，記成「再看一次」，不算新的抽籤
    await logEvent(db, userId, 'repeat_view', result.draw, opts.now);
    bg(ga4(env, userId, 'line_daily_repeat_view', { fortune_id: result.draw.fortune_id }));
    return [await fortuneMessage(env, result.draw, { repeat: true })];
  }

  await logEvent(db, userId, 'draw_start', result.draw, opts.now);
  bg(ga4(env, userId, 'line_daily_draw_start', {}).then(() =>
    ga4(env, userId, 'line_daily_draw_complete', {
      fortune_id: result.draw.fortune_id,
      fortune_category: result.draw.category || '',
    })));
  return [await fortuneMessage(env, result.draw, { repeat: false })];
}

async function reply(env, replyToken, messages) {
  if (!replyToken || !env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('LINE 今日訊息：缺 replyToken 或 LINE_CHANNEL_ACCESS_TOKEN');
    return;
  }
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) console.error('LINE 回覆失敗', res.status, (await res.text()).slice(0, 300));
}

/* ══════════════════════════════════════════════════
   訊息樣式（Flex Message）
   ══════════════════════════════════════════════════ */

const txt = (text, o = {}) => ({ type: 'text', text, wrap: true, ...o });

export function introMessage() {
  return {
    type: 'flex',
    altText: '✦ 今天，有一句話想給你',
    contents: {
      type: 'bubble',
      styles: { body: { backgroundColor: C.bg }, footer: { backgroundColor: C.bg } },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '24px',
        contents: [
          txt('✦ 今天，有一句話想給你', { color: C.gold, weight: 'bold', size: 'md' }),
          txt('不用想問題。', { color: C.text, size: 'sm', margin: 'xl' }),
          txt('今天的你，\n會抽到今天需要看見的那句話。', { color: C.text, size: 'sm', margin: 'md', lineSpacing: '6px' }),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '16px',
        contents: [{
          type: 'button', style: 'primary', color: C.btn, height: 'sm',
          action: { type: 'postback', label: '接收今天的訊息', data: PB_DRAW, displayText: '接收今天的訊息' },
        }],
      },
    },
  };
}

export async function fortuneMessage(env, draw, { repeat = false } = {}) {
  const title = draw.title || '今天的訊息';
  const alt = `✦ 今日訊息【${title}】${draw.reminder ? '今日提醒｜' + draw.reminder : ''}`.slice(0, 390);
  const head = [txt('✦ 今日訊息', { color: C.gold, size: 'xs' })];
  if (repeat) head.push(txt('這是你今天收到的那句話', { color: C.faint, size: 'xxs', margin: 'xs' }));

  return {
    type: 'flex',
    altText: alt,
    contents: {
      type: 'bubble', size: 'mega',
      styles: { body: { backgroundColor: C.bg }, footer: { backgroundColor: C.bg, separator: false } },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '24px',
        contents: [
          ...head,
          txt(`【${title}】`, { color: C.gold, weight: 'bold', size: 'lg', margin: 'lg' }),
          txt(draw.content || '', { color: C.text, size: 'sm', margin: 'lg', lineSpacing: '6px' }),
          { type: 'separator', margin: 'xl', color: C.line },
          txt('今日提醒｜', { color: C.gold, size: 'xs', margin: 'xl' }),
          txt(draw.reminder || '', { color: C.soft, size: 'sm', margin: 'sm', lineSpacing: '4px' }),
          txt('—— 未完籤所 ——', { color: C.faint, size: 'xs', align: 'center', margin: 'xxl' }),
          txt('明天 00:00\n可以再來接收新的訊息。', { color: C.faint, size: 'xxs', align: 'center', margin: 'md' }),
        ],
      },
      // 次要按鈕：link 樣式，不做成大色塊，避免像在推銷
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '8px',
        contents: [{
          type: 'button', style: 'link', height: 'sm', color: C.gold,
          action: { type: 'uri', label: CTA_LABEL, uri: await ctaUrl(env, draw.draw_id) },
        }],
      },
    },
  };
}

/* ══════════════════════════════════════════════════
   「我有一件事想問」→ 網站
   ══════════════════════════════════════════════════ */

function siteUrl(env) {
  return String(env.SITE_URL || 'https://unfinished.tw').replace(/\/+$/, '');
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// 連結帶的是抽籤紀錄編號＋簽章，不帶 LINE User ID；簽章避免別人亂改編號灌數字。
async function ctaUrl(env, drawId) {
  const base = siteUrl(env);
  if (!drawId || !env.LINE_CHANNEL_SECRET) return `${base}/?${UTM}`;
  const s = (await hmacHex(env.LINE_CHANNEL_SECRET, 'go:' + drawId)).slice(0, 16);
  return `${base}/api/line/go?d=${drawId}&s=${s}`;
}

export function landingUrl(env, fortuneId) {
  const extra = fortuneId && /^\d{3,4}$/.test(fortuneId) ? `&utm_content=daily_${fortuneId}` : '';
  return `${siteUrl(env)}/?${UTM}${extra}`;
}

async function goToSite(url, env, ctx) {
  const redirect = to => new Response(null, {
    status: 302, headers: { Location: to, 'cache-control': 'no-store' },
  });
  const d = url.searchParams.get('d') || '';
  const s = url.searchParams.get('s') || '';
  // 任何環節出錯都照樣把人送到網站，只是這一下不計數
  try {
    if (!/^\d{1,12}$/.test(d) || !env.DB || !env.LINE_CHANNEL_SECRET) return redirect(landingUrl(env));
    const expect = (await hmacHex(env.LINE_CHANNEL_SECRET, 'go:' + d)).slice(0, 16);
    if (expect !== s) return redirect(landingUrl(env));

    const draw = await env.DB.prepare(
      `SELECT id AS draw_id, line_user_id, fortune_id FROM line_daily_draws WHERE id = ?1`
    ).bind(Number(d)).first();
    if (!draw) return redirect(landingUrl(env));

    await logEvent(env.DB, draw.line_user_id, 'to_site', draw);
    const p = ga4(env, draw.line_user_id, 'line_daily_to_site', { fortune_id: draw.fortune_id });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
    return redirect(landingUrl(env, draw.fortune_id));
  } catch (e) {
    console.error('LINE 今日訊息：導流紀錄失敗', e && e.message);
    return redirect(landingUrl(env));
  }
}

/* ══════════════════════════════════════════════════
   GA4（Measurement Protocol，伺服器端送出）
   LINE 聊天室裡沒有網頁，gtag 用不了，只能由後端代送。
   不送 LINE User ID 本身，只送它的雜湊。
   ══════════════════════════════════════════════════ */

async function ga4(env, userId, name, params) {
  if (!env.GA4_API_SECRET || !env.GA4_MEASUREMENT_ID) return;
  try {
    const h = await hmacHex('unfinished-ga4', userId);
    const clientId = parseInt(h.slice(0, 8), 16) + '.' + parseInt(h.slice(8, 16), 16);
    const endpoint = 'https://www.google-analytics.com/mp/collect'
      + '?measurement_id=' + encodeURIComponent(env.GA4_MEASUREMENT_ID)
      + '&api_secret=' + encodeURIComponent(env.GA4_API_SECRET);
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        non_personalized_ads: true,
        events: [{ name, params: { ...params, platform: 'line_bot', engagement_time_msec: 1 } }],
      }),
    });
  } catch (e) {
    console.error('GA4 送出失敗', name, e && e.message);
  }
}

/* ══════════════════════════════════════════════════
   訂單來源（給 index.js 與 oracle.js 共用）
   ══════════════════════════════════════════════════ */

export function cleanAttribution(a) {
  const src = a && typeof a === 'object' ? a : {};
  const s = v => String(v == null ? '' : v).trim().slice(0, 100);
  const saved = Number(src.saved_at);
  return {
    source: s(src.utm_source),
    medium: s(src.utm_medium),
    campaign: s(src.utm_campaign),
    content: s(src.utm_content),
    term: s(src.utm_term),
    landed_at: Number.isFinite(saved) && saved > 0 ? new Date(saved).toISOString() : '',
  };
}

/**
 * 建單時寫 pending；付款通知時寫 paid / failed。
 * 用 upsert：就算建單當下 D1 寫失敗，付款時也會用 KV 裡那份補寫。
 * 這裡任何錯誤都吞掉——統計壞掉不能連累收款。
 */
export async function saveOrderAttribution(env, { tradeNo, product, amount, attribution, status }) {
  if (!env.DB || !tradeNo) return;
  const a = attribution || cleanAttribution({});
  const paidAt = status === 'paid' ? new Date().toISOString() : null;
  try {
    await env.DB.prepare(
      `INSERT INTO order_attribution
         (trade_no, product, amount, status, source, medium, campaign, content, term, landed_at, paid_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT(trade_no) DO UPDATE SET
         status  = excluded.status,
         amount  = excluded.amount,
         paid_at = COALESCE(order_attribution.paid_at, excluded.paid_at)`
    ).bind(tradeNo, product, Number(amount) || 0, status || 'pending',
      a.source, a.medium, a.campaign, a.content, a.term, a.landed_at, paidAt).run();
  } catch (e) {
    console.error('訂單來源寫入失敗', tradeNo, e && e.message);
  }
}

/* ══════════════════════════════════════════════════
   後台 API
   ══════════════════════════════════════════════════ */

const LINE_ORDER_WHERE =
  `status = 'paid' AND source = 'line' AND medium = 'bot' AND campaign = 'universe_daily'`;

async function adminApi(request, env, url) {
  if (!env.ADMIN_KEY || request.headers.get('X-Admin-Key') !== env.ADMIN_KEY) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!env.DB) return json({ error: 'no_db' }, 503);
  const path = url.pathname;
  try {
    if (path === '/api/line-daily/admin/summary') return json(await summary(env.DB));
    if (path === '/api/line-daily/admin/fortunes') return json(await fortuneList(env.DB, url.searchParams));
    if (path === '/api/line-daily/admin/fortune' && request.method === 'POST') {
      return await updateFortune(env.DB, await request.json().catch(() => null));
    }
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/no such table/i.test(msg)) return json({ error: 'not_migrated', hint: '請先執行 src/line-daily.sql' }, 503);
    throw e;
  }
  return json({ error: 'not_found' }, 404);
}

export async function summary(db, now = new Date()) {
  const today = taipeiDate(now);
  const yday = addDays(today, -1);
  const d7 = addDays(today, -6);
  const d30 = addDays(today, -29);
  const iso30 = new Date(now.getTime() - 30 * 86400e3).toISOString();

  const one = (sql, ...b) => db.prepare(sql).bind(...b).first();
  const users = from => one(`SELECT COUNT(DISTINCT line_user_id) AS n FROM line_daily_draws WHERE draw_date >= ?1 AND draw_date <= ?2`, from, today);
  const siteUsers = from => one(`SELECT COUNT(DISTINCT line_user_id) AS n FROM line_daily_events WHERE event = 'to_site' AND event_date >= ?1`, from);

  const [t, y, w, m, total, uniq, repeat, s1, s7, s30, sAll, o30, oAll, lineAll] = await Promise.all([
    one(`SELECT COUNT(DISTINCT line_user_id) AS n FROM line_daily_draws WHERE draw_date = ?1`, today),
    one(`SELECT COUNT(DISTINCT line_user_id) AS n FROM line_daily_draws WHERE draw_date = ?1`, yday),
    users(d7), users(d30),
    one(`SELECT COUNT(*) AS n FROM line_daily_draws`),
    one(`SELECT COUNT(DISTINCT line_user_id) AS n FROM line_daily_draws`),
    one(`SELECT COUNT(DISTINCT line_user_id) AS n FROM line_daily_events WHERE event = 'repeat_view' AND event_date = ?1`, today),
    siteUsers(today), siteUsers(d7), siteUsers(d30), siteUsers('0000-00-00'),
    one(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amt FROM order_attribution WHERE ${LINE_ORDER_WHERE} AND paid_at >= ?1`, iso30),
    one(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amt FROM order_attribution WHERE ${LINE_ORDER_WHERE}`),
    one(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amt FROM order_attribution WHERE status = 'paid' AND source = 'line'`),
  ]);
  const n = r => (r && Number(r.n)) || 0;
  const rate = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);   // 百分比，一位小數

  return {
    today, generatedAt: now.toISOString(),
    drawUsers: { today: n(t), yesterday: n(y), d7: n(w), d30: n(m) },
    totalDraws: n(total),
    uniqueUsers: n(uniq),
    repeatViewUsersToday: n(repeat),
    toSiteUsers: { today: n(s1), d7: n(s7), d30: n(s30), total: n(sAll) },
    ctr: { today: rate(n(s1), n(t)), d7: rate(n(s7), n(w)), d30: rate(n(s30), n(m)), total: rate(n(sAll), n(uniq)) },
    orders: {
      d30: { count: n(o30), revenue: Number(o30 && o30.amt) || 0 },
      total: { count: n(oAll), revenue: Number(oAll && oAll.amt) || 0 },
      allLineSources: { count: n(lineAll), revenue: Number(lineAll && lineAll.amt) || 0 },
    },
  };
}

export async function fortuneList(db, params, now = new Date()) {
  const today = taipeiDate(now);
  const where = [];
  const bind = [];
  const q = String(params.get('q') || '').trim();
  const cat = String(params.get('category') || '').trim();
  const active = String(params.get('active') || '').trim();
  if (q) { bind.push('%' + q + '%'); where.push(`(fortune_id LIKE ?${bind.length} OR title LIKE ?${bind.length} OR content LIKE ?${bind.length} OR reminder LIKE ?${bind.length})`); }
  if (cat) { bind.push(cat); where.push(`category = ?${bind.length}`); }
  if (active === '1' || active === '0') { bind.push(Number(active)); where.push(`is_active = ?${bind.length}`); }

  const sql = `SELECT fortune_id, title, content, reminder, category, weight, is_active, updated_at
                 FROM line_daily_fortunes ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                ORDER BY fortune_id`;
  const [{ results: rows }, { results: draws }, { results: clicks }, { results: cats }] = await Promise.all([
    db.prepare(sql).bind(...bind).all(),
    db.prepare(
      `SELECT fortune_id,
              COUNT(*) AS total,
              SUM(CASE WHEN draw_date >= ?1 THEN 1 ELSE 0 END) AS d7,
              SUM(CASE WHEN draw_date >= ?2 THEN 1 ELSE 0 END) AS d30
         FROM line_daily_draws GROUP BY fortune_id`
    ).bind(addDays(today, -6), addDays(today, -29)).all(),
    db.prepare(
      `SELECT fortune_id, COUNT(DISTINCT draw_id) AS n FROM line_daily_events
        WHERE event = 'to_site' GROUP BY fortune_id`
    ).all(),
    db.prepare(`SELECT category, COUNT(*) AS n FROM line_daily_fortunes GROUP BY category ORDER BY category`).all(),
  ]);
  const dm = new Map((draws || []).map(r => [r.fortune_id, r]));
  const cm = new Map((clicks || []).map(r => [r.fortune_id, Number(r.n) || 0]));
  const list = (rows || []).map(r => {
    const d = dm.get(r.fortune_id) || {};
    const total = Number(d.total) || 0;
    const click = cm.get(r.fortune_id) || 0;
    return {
      ...r,
      is_active: Number(r.is_active) === 1,
      weight: Number(r.weight),
      draws: { total, d7: Number(d.d7) || 0, d30: Number(d.d30) || 0 },
      ctaClicks: click,
      ctr: total ? Math.round((click / total) * 1000) / 10 : 0,
    };
  });
  return { fortunes: list, categories: cats || [] };
}

async function updateFortune(db, body) {
  if (!body || typeof body !== 'object') return json({ error: 'bad_json' }, 400);
  const id = String(body.fortune_id || '').trim();
  if (!/^\d{3,4}$/.test(id)) return json({ error: 'bad_fortune_id' }, 400);

  const cur = await db.prepare(`SELECT * FROM line_daily_fortunes WHERE fortune_id = ?1`).bind(id).first();
  if (!cur) return json({ error: 'not_found' }, 404);

  const next = { ...cur };
  for (const k of ['title', 'content', 'reminder', 'category']) {
    if (body[k] !== undefined) {
      const v = String(body[k]).trim();
      if (!v) return json({ error: 'empty_' + k }, 400);
      next[k] = v.slice(0, k === 'content' ? 2000 : 200);
    }
  }
  if (next.category && !/^[a-z_]{2,30}$/.test(next.category)) return json({ error: 'bad_category' }, 400);
  if (body.weight !== undefined) {
    const w = Number(body.weight);
    if (!Number.isFinite(w) || w < 0 || w > 5) return json({ error: 'bad_weight', hint: '權重請填 0～5' }, 400);
    next.weight = Math.round(w * 100) / 100;
  }
  if (body.is_active !== undefined) next.is_active = body.is_active ? 1 : 0;

  await db.prepare(
    `UPDATE line_daily_fortunes
        SET title = ?2, content = ?3, reminder = ?4, category = ?5, weight = ?6, is_active = ?7,
            updated_at = datetime('now')
      WHERE fortune_id = ?1`
  ).bind(id, next.title, next.content, next.reminder, next.category, next.weight, next.is_active).run();
  return json({ ok: true, fortune: { ...next, is_active: next.is_active === 1 } });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * LINE 今日訊息籤 · QA 測試（本機跑，不碰線上）
 * 用法：node scripts/test-line-daily.mjs
 * 用 Node 內建 SQLite 模擬 Cloudflare D1，跑施工單第 26 節的測試案例。
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  taipeiDate, addDays, pickWeighted, candidatePool, drawToday, respond,
  verifySignature, intentOf, lineDailyRoutes, summary, fortuneList,
  saveOrderAttribution, cleanAttribution, landingUrl, isMine, drawParams, DRAW_CATEGORY,
} from '../src/line-daily.js';

/* ── D1 模擬 ── */
function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../src/line-daily.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../src/line-daily-seed.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
  });
  return { raw: db, prepare: sql => stmt(sql) };
}

const SECRET = 'test-secret';
const T = (s) => new Date(s);         // 時間一律寫明時區
let pass = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); pass++; results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name + '\n     ' + (e && e.stack || e)]); }
}
const env0 = () => ({ DB: makeD1(), LINE_CHANNEL_SECRET: SECRET, SITE_URL: 'https://unfinished.tw', ADMIN_KEY: 'k' });

/* ── 資料 ── */
await test('資料：100 支全部匯入、編號 001–100、內容與校稿檔一致', async () => {
  const env = env0();
  const rows = env.DB.raw.prepare('SELECT * FROM line_daily_fortunes ORDER BY fortune_id').all();
  const src = JSON.parse(readFileSync(new URL('../src/line-daily-fortunes.json', import.meta.url), 'utf8'));
  assert.equal(rows.length, 100);
  rows.forEach((r, i) => {
    assert.equal(r.fortune_id, String(i + 1).padStart(3, '0'));
    assert.equal(r.title, src[i].title);
    assert.equal(r.content, src[i].content);
    assert.equal(r.reminder, src[i].reminder);
    assert.equal(r.category, src[i].category);
    assert.equal(r.weight, src[i].weight);
  });
  // 重跑 seed 不會覆蓋後台改過的內容
  env.DB.raw.prepare("UPDATE line_daily_fortunes SET weight = 0.3 WHERE fortune_id = '001'").run();
  env.DB.raw.exec(readFileSync(new URL('../src/line-daily-seed.sql', import.meta.url), 'utf8'));
  assert.equal(env.DB.raw.prepare("SELECT weight FROM line_daily_fortunes WHERE fortune_id='001'").get().weight, 0.3);
});

/* ── CASE 01 ── */
await test('CASE 01 第一次使用 → 先看到開場卡，按下後正常抽籤', async () => {
  const env = env0();
  const now = T('2026-09-16T10:00:00+08:00');
  const open = await respond('open', 'U1', env, null, { now });
  assert.equal(open[0].altText, '✦ 今天，有一句話想給你');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM line_daily_draws').get().n, 0, '開場卡不應該抽籤');
  const msg = await respond('draw', 'U1', env, null, { now });
  assert.equal(msg[0].type, 'flex');
  const row = env.DB.raw.prepare('SELECT * FROM line_daily_draws').get();
  assert.equal(row.draw_date, '2026-09-16');
  assert.ok(msg[0].altText.includes('✦ 今日訊息'));
  const texts = JSON.stringify(msg[0].contents);
  assert.ok(texts.includes('今日提醒｜') && texts.includes('—— 未完籤所 ——') && texts.includes('明天 00:00'));
  assert.ok(!/category|love|god|AI|隨機/.test(msg[0].contents.body.contents.map(c => c.text || '').join('')), '不應顯示分類或 AI 字樣');
});

/* ── CASE 02 ── */
await test('CASE 02 同一天再點 → 同一支；記成 repeat_view，不算新 draw', async () => {
  const env = env0();
  const now = T('2026-09-16T10:00:00+08:00');
  await respond('draw', 'U1', env, null, { now });
  const first = env.DB.raw.prepare('SELECT fortune_id FROM line_daily_draws').get().fortune_id;
  for (const [intent, t] of [['open', '2026-09-16T12:00:00+08:00'], ['draw', '2026-09-16T18:00:00+08:00'], ['open', '2026-09-16T23:59:59+08:00']]) {
    const m = await respond(intent, 'U1', env, null, { now: T(t) });
    const title = env.DB.raw.prepare('SELECT title FROM line_daily_fortunes WHERE fortune_id=?').get(first).title;
    assert.ok(m[0].altText.includes(title), intent + ' 應顯示同一支');
    assert.ok(JSON.stringify(m[0]).includes('這是你今天收到的那句話'));
  }
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM line_daily_draws').get().n, 1);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM line_daily_events WHERE event='repeat_view'").get().n, 3);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM line_daily_events WHERE event='draw_start'").get().n, 1);
});

/* ── CASE 03 ── */
await test('CASE 03 同時兩個請求（刻意讓兩邊抽到不同籤）→ 只留一筆、兩邊回同一支', async () => {
  for (let i = 0; i < 20; i++) {
    const env = env0();
    const now = T('2026-09-16T10:00:00+08:00');
    const [a, b] = await Promise.all([
      drawToday(env.DB, 'U1', { now, rand: () => 0.01 }),
      drawToday(env.DB, 'U1', { now, rand: () => 0.99 }),
    ]);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM line_daily_draws').get().n, 1);
    assert.equal(a.draw.fortune_id, b.draw.fortune_id);
    assert.deepEqual([a.status, b.status].sort(), ['existing', 'new']);
  }
});

/* ── CASE 04 + 時區 ── */
await test('CASE 04／時區：23:59 抽 A，00:00 可以抽 B；台灣早上 07:59 不會提早或延後重置', async () => {
  assert.equal(taipeiDate(T('2026-09-16T23:59:59+08:00')), '2026-09-16');
  assert.equal(taipeiDate(T('2026-09-17T00:00:00+08:00')), '2026-09-17');
  // UTC 還是 16 號的時候，台灣已經是 17 號
  assert.equal(taipeiDate(T('2026-09-16T16:00:00Z')), '2026-09-17');
  assert.equal(taipeiDate(T('2026-09-16T15:59:59Z')), '2026-09-16');
  const env = env0();
  const a = await drawToday(env.DB, 'U1', { now: T('2026-09-16T23:59:00+08:00') });
  const again = await drawToday(env.DB, 'U1', { now: T('2026-09-16T23:59:59+08:00') });
  assert.equal(again.status, 'existing');
  const b = await drawToday(env.DB, 'U1', { now: T('2026-09-17T00:00:00+08:00') });
  assert.equal(a.status, 'new'); assert.equal(b.status, 'new');
  assert.equal(b.draw.draw_date, '2026-09-17');
  assert.notEqual(a.draw.fortune_id, b.draw.fortune_id, '隔天不應抽到昨天那支');
  // 若用 UTC 判斷，台灣 07:59 會被當成前一天——這裡確認不會
  const c = await drawToday(env.DB, 'U1', { now: T('2026-09-18T07:59:00+08:00') });
  assert.equal(c.draw.draw_date, '2026-09-18');
});

/* ── CASE 05 ── */
await test('CASE 05 最近 14 天抽過 007 → 不會再抽到 007（跑 2,000 次）', async () => {
  const pool = Array.from({ length: 100 }, (_, i) => ({ fortune_id: String(i + 1).padStart(3, '0'), weight: 1 }));
  const recent = ['007', '016', '029', '037', '050'].map((id, i) => ({ fortune_id: id, draw_date: addDays('2026-09-16', -(i + 1) * 2) }));
  const { list, window } = candidatePool(pool, recent, '2026-09-16');
  assert.equal(window, 14);
  assert.equal(list.length, 95);
  for (let i = 0; i < 2000; i++) assert.ok(!['007', '016', '029', '037', '050'].includes(pickWeighted(list).fortune_id));
  // 實際走資料庫：連抽 60 天，任 15 天窗內不重複
  const env = env0();
  const seen = [];
  for (let d = 0; d < 60; d++) {
    const r = await drawToday(env.DB, 'U9', { now: new Date(Date.UTC(2026, 8, 1 + d, 4)) });
    seen.push(r.draw.fortune_id);
  }
  for (let i = 0; i < seen.length; i++) {
    const windowIds = seen.slice(Math.max(0, i - 14), i);
    assert.ok(!windowIds.includes(seen[i]), `第 ${i} 天抽到 14 天內抽過的 ${seen[i]}`);
  }
});

await test('CASE 05b 防重複 fallback：籤很少時逐層放寬，永遠抽得到', async () => {
  const today = '2026-09-16';
  const pool = ['001', '002', '003'].map(id => ({ fortune_id: id, weight: 1 }));
  // 三支都在 8～14 天前抽過 → 放寬到 7 天
  let r = candidatePool(pool, pool.map((p, i) => ({ fortune_id: p.fortune_id, draw_date: addDays(today, -(8 + i)) })), today);
  assert.equal(r.window, 7); assert.equal(r.list.length, 3);
  // 三支都在 2～7 天前抽過 → 只排除昨天
  r = candidatePool(pool, [
    { fortune_id: '001', draw_date: addDays(today, -1) },
    { fortune_id: '002', draw_date: addDays(today, -3) },
    { fortune_id: '003', draw_date: addDays(today, -5) }], today);
  assert.equal(r.window, 1); assert.deepEqual(r.list.map(x => x.fortune_id), ['002', '003']);
  // 只有一支、昨天剛抽過 → 全籤池
  r = candidatePool([pool[0]], [{ fortune_id: '001', draw_date: addDays(today, -1) }], today);
  assert.equal(r.window, 0); assert.equal(r.list.length, 1);
  // 資料庫實測：只留 1 支啟用，連抽 5 天都成功
  const env = env0();
  env.DB.raw.prepare("UPDATE line_daily_fortunes SET is_active = CASE WHEN fortune_id='042' THEN 1 ELSE 0 END").run();
  for (let d = 0; d < 5; d++) {
    const x = await drawToday(env.DB, 'U2', { now: new Date(Date.UTC(2026, 8, 10 + d, 4)) });
    assert.equal(x.status, 'new'); assert.equal(x.draw.fortune_id, '042');
  }
});

/* ── CASE 06 ── */
await test('CASE 06 停用的籤抽不到；已抽過的人仍看得到', async () => {
  const env = env0();
  const now = T('2026-09-16T09:00:00+08:00');
  const a = await drawToday(env.DB, 'U1', { now });
  env.DB.raw.prepare('UPDATE line_daily_fortunes SET is_active = 0 WHERE fortune_id = ?').run(a.draw.fortune_id);
  const again = await respond('open', 'U1', env, null, { now });
  assert.ok(again[0].altText.includes(a.draw.title), '停用後，當天抽到的人仍看得到');
  env.DB.raw.prepare("UPDATE line_daily_fortunes SET is_active = 0 WHERE fortune_id IN ('001','002','003','004','005')").run();
  for (let i = 0; i < 300; i++) {
    const r = await drawToday(env.DB, 'X' + i, { now });
    assert.ok(!['001', '002', '003', '004', '005', a.draw.fortune_id].includes(r.draw.fortune_id));
  }
  // 全部停用 → 不報錯，回一段溫和的文字
  env.DB.raw.prepare('UPDATE line_daily_fortunes SET is_active = 0').run();
  const empty = await respond('draw', 'NEW', env, null, { now });
  assert.equal(empty[0].type, 'text');
});

/* ── CASE 07 ── */
await test('CASE 07 權重：weight 0.4 的出現率約為 1.0 的 40%（20 萬次模擬）', async () => {
  const list = [{ fortune_id: 'A', weight: 1.0 }, { fortune_id: 'B', weight: 0.7 }, { fortune_id: 'C', weight: 0.4 }, { fortune_id: 'Z', weight: 0 }];
  const n = { A: 0, B: 0, C: 0, Z: 0 };
  for (let i = 0; i < 200000; i++) n[pickWeighted(list).fortune_id]++;
  const ratioB = n.B / n.A, ratioC = n.C / n.A;
  assert.ok(Math.abs(ratioB - 0.7) < 0.03, 'B/A=' + ratioB);
  assert.ok(Math.abs(ratioC - 0.4) < 0.03, 'C/A=' + ratioC);
  assert.equal(n.Z, 0);
  results.push(['INFO', `權重實測 A:B:C = 1 : ${ratioB.toFixed(3)} : ${ratioC.toFixed(3)}`]);
  // 實際 100 支的配置下，最稀有（0.5）的籤：一年 365 天大約會遇到幾次
  const env = env0();
  const rows = env.DB.raw.prepare('SELECT weight FROM line_daily_fortunes').all();
  const total = rows.reduce((s, r) => s + r.weight, 0);
  results.push(['INFO', `目前 100 支總權重 ${total.toFixed(1)}；weight 0.5 的單支每天被抽中機率約 ${(0.5 / total * 100).toFixed(2)}%，1.0 約 ${(1 / total * 100).toFixed(2)}%`]);
});

/* ── CASE 08 ── */
await test('CASE 08 「我有一件事想問」→ 記一筆導流，帶正確 UTM 轉到 unfinished.tw', async () => {
  const env = env0();
  const now = new Date();
  const msg = await respond('draw', 'U1', env, null, { now });
  const btn = msg[0].contents.footer.contents[0];
  assert.equal(btn.action.label, '我有一件事想問');
  assert.equal(btn.style, 'link', '應該是次要按鈕');
  const go = new URL(btn.action.uri);
  assert.equal(go.pathname, '/api/line/go');
  assert.ok(!go.search.includes('U1'), '連結不應帶 LINE User ID');
  const res = await lineDailyRoutes(new Request(go), env, null, go);
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://unfinished.tw/');
  assert.equal(to.searchParams.get('utm_source'), 'line');
  assert.equal(to.searchParams.get('utm_medium'), 'bot');
  assert.equal(to.searchParams.get('utm_campaign'), 'universe_daily');
  assert.match(to.searchParams.get('utm_content'), /^daily_\d{3}$/);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM line_daily_events WHERE event='to_site'").get().n, 1);
  // 竄改編號 → 仍然轉到網站，但不計數
  const bad = new URL(go); bad.searchParams.set('d', '999');
  const res2 = await lineDailyRoutes(new Request(bad), env, null, bad);
  assert.equal(res2.status, 302);
  assert.equal(res2.headers.get('Location'), landingUrl(env));
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM line_daily_events WHERE event='to_site'").get().n, 1);
  // 網站上沒有新的公開抽籤入口
  for (const p of ['/daily', '/universe', '/daily-fortune', '/line-fortune']) {
    const u = new URL('https://unfinished.tw' + p);
    assert.equal(await lineDailyRoutes(new Request(u), env, null, u), null);
  }
});

/* ── CASE 09 ── */
await test('CASE 09 LINE → 網站 → 綠界 → 付款：來源記成 line，不被 ecpay 覆蓋', async () => {
  const env = env0();
  const utm = { utm_source: 'line', utm_medium: 'bot', utm_campaign: 'universe_daily', utm_content: 'daily_037', saved_at: Date.now() };
  // 建單（前端從 localStorage 帶來）
  await saveOrderAttribution(env, { tradeNo: 'UF1', product: 'extended', amount: 99, attribution: cleanAttribution(utm), status: 'pending' });
  // 付款通知：就算這時的請求來自綠界，寫入的仍是建單時那份來源
  await saveOrderAttribution(env, { tradeNo: 'UF1', product: 'extended', amount: 99, attribution: cleanAttribution({ utm_source: 'payment.ecpay.com.tw', utm_medium: 'referral' }), status: 'paid' });
  const r = env.DB.raw.prepare("SELECT * FROM order_attribution WHERE trade_no='UF1'").get();
  assert.equal(r.status, 'paid'); assert.equal(r.source, 'line'); assert.equal(r.medium, 'bot'); assert.equal(r.campaign, 'universe_daily');
  assert.ok(r.paid_at);
  // 綠界重送通知：paid_at 不變
  const first = r.paid_at;
  await new Promise(res => setTimeout(res, 5));
  await saveOrderAttribution(env, { tradeNo: 'UF1', product: 'extended', amount: 99, attribution: null, status: 'paid' });
  assert.equal(env.DB.raw.prepare("SELECT paid_at FROM order_attribution WHERE trade_no='UF1'").get().paid_at, first);
  // 建單時 D1 沒寫成功，付款時用 KV 裡的那份補寫
  await saveOrderAttribution(env, { tradeNo: 'UO2', product: 'oracle', amount: 399, attribution: cleanAttribution(utm), status: 'paid' });
  assert.equal(env.DB.raw.prepare("SELECT source FROM order_attribution WHERE trade_no='UO2'").get().source, 'line');
  // 沒有 D1 也不會拋錯（不能連累收款）
  await saveOrderAttribution({}, { tradeNo: 'X', product: 'extended', amount: 99, status: 'paid' });
  const broken = { DB: { prepare() { throw new Error('D1 down'); } } };
  await saveOrderAttribution(broken, { tradeNo: 'X', product: 'extended', amount: 99, status: 'paid' });
});

/* ── CASE 10 ── */
await test('CASE 10 後台：每日抽籤、CTA、訂單統計；需要金鑰；可停用／改權重', async () => {
  const env = env0();
  const day = d => T(`2026-09-${d}T12:00:00+08:00`);
  for (const u of ['A', 'B', 'C']) await respond('draw', u, env, null, { now: day(16) });
  for (const u of ['A', 'D']) await respond('draw', u, env, null, { now: day(15) });
  await respond('open', 'A', env, null, { now: day(16) });
  const drawA = env.DB.raw.prepare("SELECT id, fortune_id FROM line_daily_draws WHERE line_user_id='A' AND draw_date='2026-09-16'").get();
  env.DB.raw.prepare("INSERT INTO line_daily_events (line_user_id,event,draw_id,fortune_id,event_date) VALUES ('A','to_site',?,?, '2026-09-16')").run(drawA.id, drawA.fortune_id);
  env.DB.raw.prepare("INSERT INTO line_daily_events (line_user_id,event,draw_id,fortune_id,event_date) VALUES ('A','to_site',?,?, '2026-09-16')").run(drawA.id, drawA.fortune_id);
  await saveOrderAttribution(env, { tradeNo: 'O1', product: 'extended', amount: 99, attribution: cleanAttribution({ utm_source: 'line', utm_medium: 'bot', utm_campaign: 'universe_daily' }), status: 'paid' });
  await saveOrderAttribution(env, { tradeNo: 'O2', product: 'extended', amount: 99, attribution: cleanAttribution({ utm_source: 'line', utm_medium: 'rich_menu', utm_campaign: 'always_on' }), status: 'paid' });
  await saveOrderAttribution(env, { tradeNo: 'O3', product: 'extended', amount: 99, attribution: cleanAttribution({ utm_source: 'line', utm_medium: 'bot', utm_campaign: 'universe_daily' }), status: 'pending' });

  const s = await summary(env.DB, day(16));
  assert.deepEqual(s.drawUsers, { today: 3, yesterday: 2, d7: 4, d30: 4 });
  assert.equal(s.totalDraws, 5); assert.equal(s.uniqueUsers, 4);
  assert.equal(s.repeatViewUsersToday, 1);
  assert.equal(s.toSiteUsers.today, 1);
  assert.equal(s.ctr.today, 33.3);
  assert.deepEqual(s.orders.total, { count: 1, revenue: 99 });
  assert.deepEqual(s.orders.allLineSources, { count: 2, revenue: 198 });

  const list = await fortuneList(env.DB, new URLSearchParams(), day(16));
  const f = list.fortunes.find(x => x.fortune_id === drawA.fortune_id);
  assert.ok(f.draws.total >= 1); assert.equal(f.ctaClicks, 1, '同一次抽籤點兩下只算一次');
  assert.equal(list.fortunes.length, 100);
  const godOnly = await fortuneList(env.DB, new URLSearchParams({ category: 'god' }), day(16));
  assert.ok(godOnly.fortunes.length > 0 && godOnly.fortunes.every(x => x.category === 'god'));
  const search = await fortuneList(env.DB, new URLSearchParams({ q: '桃花' }), day(16));
  assert.ok(search.fortunes.length > 0);

  // API：沒金鑰 401、改權重、停用
  const call = async (path, init = {}, key = 'k') => {
    const u = new URL('https://unfinished.tw' + path);
    return lineDailyRoutes(new Request(u, { ...init, headers: { 'X-Admin-Key': key, ...(init.headers || {}) } }), env, null, u);
  };
  assert.equal((await call('/api/line-daily/admin/summary', {}, 'wrong')).status, 401);
  const ok = await call('/api/line-daily/admin/summary');
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('cache-control'), 'no-store');
  const upd = await call('/api/line-daily/admin/fortune', { method: 'POST', body: JSON.stringify({ fortune_id: '007', weight: 0.4, is_active: false }) });
  assert.equal(upd.status, 200);
  const r7 = env.DB.raw.prepare("SELECT weight, is_active, title FROM line_daily_fortunes WHERE fortune_id='007'").get();
  assert.equal(r7.weight, 0.4); assert.equal(r7.is_active, 0); assert.equal(r7.title, '祖先有回來看看你');
  assert.equal((await call('/api/line-daily/admin/fortune', { method: 'POST', body: JSON.stringify({ fortune_id: '007', weight: 9 }) })).status, 400);
});

/* ── Webhook 端到端 ── */
await test('Webhook：簽章驗證、Verify 空事件、文字與 postback 觸發、真的呼叫 LINE 回覆', async () => {
  const env = { ...env0(), LINE_CHANNEL_ACCESS_TOKEN: 'tok' };
  const sign = async body => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))));
  };
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { sent.push({ u: String(u), body: JSON.parse(init.body) }); return new Response('{}'); };
  try {
    const hook = async (payload, sig) => {
      const body = JSON.stringify(payload);
      const u = new URL('https://unfinished.tw/api/line/webhook');
      return lineDailyRoutes(new Request(u, { method: 'POST', body, headers: { 'x-line-signature': sig ?? await sign(body) } }), env, null, u);
    };
    assert.equal((await hook({ events: [] })).status, 200);
    assert.equal((await hook({ events: [] }, 'forged')).status, 401);
    const src = { type: 'user', userId: 'Uabc' };
    await hook({ events: [{ type: 'message', replyToken: 'r1', source: src, message: { type: 'text', text: '✨ 今天，有一句話想給你' } }] });
    assert.equal(sent.at(-1).body.messages[0].altText, '✦ 今天，有一句話想給你');
    assert.equal(sent.at(-1).u, 'https://api.line.me/v2/bot/message/reply');
    await hook({ events: [{ type: 'postback', replyToken: 'r2', source: src, postback: { data: 'line_daily=draw' } }] });
    assert.ok(sent.at(-1).body.messages[0].altText.startsWith('✦ 今日訊息'));
    // 無關的訊息不回（交給官方帳號原本的自動回覆）
    const before = sent.length;
    await hook({ events: [{ type: 'message', replyToken: 'r3', source: src, message: { type: 'text', text: '你好' } }] });
    await hook({ events: [{ type: 'follow', replyToken: 'r4', source: src }] });
    await hook({ events: [{ type: 'message', replyToken: 'r5', source: { type: 'group', groupId: 'G', userId: 'Uabc' }, message: { type: 'text', text: '接收今天的訊息' } }] });
    assert.equal(sent.length, before);
    // GA4：有設定才送
    const env2 = { ...env, GA4_API_SECRET: 's', GA4_MEASUREMENT_ID: 'G-71RMD00WPJ' };
    const ctxP = [];
    await respond('draw', 'Ug', env2, { waitUntil: p => ctxP.push(p) }, {});
    await Promise.all(ctxP);
    const names = sent.filter(x => x.u.includes('google-analytics')).map(x => x.body.events[0].name);
    assert.deepEqual(names, ['line_daily_draw_start', 'line_daily_draw_complete']);
    const start = sent.filter(x => x.u.includes('google-analytics'))[0].body.events[0].params;
    assert.equal(start.draw_category, 'universe');
    assert.equal(start.draw_source, 'line');
    assert.equal(start.debug_mode, undefined, '沒開 GA4_DEBUG 時不帶 debug_mode');
    const complete = sent.filter(x => x.u.includes('google-analytics'))[1].body;
    const cp = complete.events[0].params;
    assert.match(cp.fortune_id, /^\d{3}$/);
    assert.ok(cp.fortune_category);
    assert.equal(cp.draw_category, 'universe');
    assert.equal(cp.draw_source, 'line');
    assert.equal(cp.draw_id, 'universe_' + cp.fortune_id);
    const titleRow = env.DB.raw.prepare('SELECT title FROM line_daily_fortunes WHERE fortune_id=?').get(cp.fortune_id);
    assert.equal(cp.draw_title, titleRow.title);
    // 不能有任何個資欄位
    assert.ok(!/userId|user_id|email|phone|name"/i.test(JSON.stringify(cp)), JSON.stringify(cp));
    assert.ok(!JSON.stringify(complete).includes('Ug'), 'GA4 不應收到 LINE User ID 本身');
    ctxP.length = 0;
    await respond('open', 'Ug', env2, { waitUntil: p => ctxP.push(p) }, {});
    await Promise.all(ctxP);
    const rv = sent.filter(x => x.u.includes('google-analytics')).at(-1).body.events[0];
    assert.equal(rv.name, 'line_daily_repeat_view');
    assert.equal(rv.params.draw_category, 'universe');
    // GA4_DEBUG 開啟時帶 debug_mode，DebugView 才看得到
    ctxP.length = 0;
    await respond('draw', 'Udebug', { ...env2, GA4_DEBUG: '1' }, { waitUntil: p => ctxP.push(p) }, {});
    await Promise.all(ctxP);
    assert.equal(sent.filter(x => x.u.includes('google-analytics')).at(-1).body.events[0].params.debug_mode, 1);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(intentOf({ type: 'message', message: { type: 'text', text: '今天,有一句話想給你' } }), 'open');
  assert.equal(intentOf({ type: 'message', message: { type: 'text', text: '宇宙指引' } }), 'open');
  assert.equal(intentOf({ type: 'message', message: { type: 'text', text: ' 宇宙指引 ' } }), 'open');
  assert.equal(intentOf({ type: 'message', message: { type: 'text', text: '感情' } }), null);
  assert.equal(await verifySignature('x', 'y', SECRET), false);
});

/* ── 與原本 LINE bot 共存 ── */
await test('轉送：宇宙指引留在這裡，其他事件原封轉給原本的 bot，簽章對得上', async () => {
  const OLD = 'https://unfinished-oracle.example.workers.dev/webhook';
  const env = { ...env0(), LINE_CHANNEL_ACCESS_TOKEN: 'tok', LINE_FORWARD_URL: OLD };
  const sign = async body => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))));
  };
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { sent.push({ u: String(u), body: init.body, headers: init.headers }); return new Response('{}'); };
  const hook = async (events, e = env) => {
    const body = JSON.stringify({ destination: 'Uxxx', events });
    const u = new URL('https://unfinished.tw/api/line/webhook');
    sent.length = 0;
    const r = await lineDailyRoutes(new Request(u, { method: 'POST', body, headers: { 'x-line-signature': await sign(body) } }), e, null, u);
    return { r, body, sig: await sign(body) };
  };
  const user = { type: 'user', userId: 'U1' };
  const love = { type: 'message', replyToken: 'a', source: user, message: { type: 'text', text: '感情' } };
  const pb = { type: 'postback', replyToken: 'b', source: user, postback: { data: 'theme=work' } };
  const follow = { type: 'follow', replyToken: 'c', source: user };
  const uni = { type: 'message', replyToken: 'd', source: user, message: { type: 'text', text: '宇宙指引' } };
  const groupUni = { type: 'message', replyToken: 'e', source: { type: 'group', groupId: 'G', userId: 'U1' }, message: { type: 'text', text: '宇宙指引' } };
  try {
    // 1. 全部是原本 bot 的 → 一個字不改、原簽章轉出；這裡不回任何訊息
    for (const ev of [love, pb, follow, groupUni]) {
      const { body, sig } = await hook([ev]);
      assert.equal(sent.length, 1, JSON.stringify(ev));
      assert.equal(sent[0].u, OLD);
      assert.equal(sent[0].body, body);
      assert.equal(sent[0].headers['x-line-signature'], sig);
    }
    // 2. 宇宙指引 → 只在這裡回，不轉
    await hook([uni]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].u, 'https://api.line.me/v2/bot/message/reply');
    // 3. 混在同一批 → 各走各的；轉出去的只剩別人的事件，且新簽章可被原本 bot 驗過
    await hook([love, uni, follow]);
    const fwd = sent.find(x => x.u === OLD);
    const parsed = JSON.parse(fwd.body);
    assert.deepEqual(parsed.events.map(e => e.replyToken), ['a', 'c']);
    assert.equal(parsed.destination, 'Uxxx');
    assert.ok(await verifySignature(fwd.body, fwd.headers['x-line-signature'], SECRET));
    assert.equal(sent.filter(x => x.u.includes('api.line.me')).length, 1);
    // 4. 沒設定轉送網址 → 不會壞，只是不轉（上線步驟要求先設好）
    await hook([love], { ...env, LINE_FORWARD_URL: '' });
    assert.equal(sent.length, 0);
    // 5. 設成自己 → 不轉，避免無限循環
    await hook([love], { ...env, LINE_FORWARD_URL: 'https://unfinished.tw/api/line/webhook' });
    assert.equal(sent.length, 0);
    await hook([love], { ...env, LINE_FORWARD_URL: 'not a url' });
    assert.equal(sent.length, 0);
    // 6. 原本 bot 掛掉 → 這裡仍回 200，不影響宇宙指引
    globalThis.fetch = async (u) => { if (String(u) === OLD) throw new Error('down'); return new Response('{}'); };
    const { r } = await hook([love, uni]);
    assert.equal(r.status, 200);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(isMine(uni), true); assert.equal(isMine(groupUni), false); assert.equal(isMine(love), false);
});

await test('GA4 參數：五種分類的值與施工單一致', async () => {
  assert.deepEqual(DRAW_CATEGORY, { '感情': 'love', '工作': 'work', '低潮中': 'low_mood', '宇宙指引': 'universe', '限定主題': 'limited' });
  assert.deepEqual(drawParams('universe'), { draw_category: 'universe', draw_source: 'line' });
  assert.deepEqual(drawParams('universe', { fortune_id: '023', title: '最近反覆出現的夢正在提醒你' }),
    { draw_category: 'universe', draw_source: 'line', draw_id: 'universe_023', draw_title: '最近反覆出現的夢正在提醒你' });
  assert.equal(drawParams('love', { fortune_id: '1', title: 'x'.repeat(150) }).draw_title.length, 100);
});

/* ── 輸出 ── */
for (const [s, n] of results) console.log((s === 'PASS' ? '✅' : s === 'INFO' ? 'ℹ️ ' : '❌') + ' ' + n);
const fails = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${pass} 通過，${fails} 失敗`);
process.exit(fails ? 1 : 0);

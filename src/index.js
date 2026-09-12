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
import SURVEY_FORTUNES from './survey-fortunes.json';
import { buildPdfHtml } from './pdf-template.js';
import { oracleRoutes, oraclePaid } from './oracle.js';
import { articleRoutes } from './articles.js';

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
      // 分手系列文章 2026-09 從抽籤路徑搬到文章分類下。舊網址永久轉址。
      // 靜態資源會先於 Worker 被送出，所以這裡只在舊檔案已刪除時才會執行到。
      const MOVED_ARTICLES = ['how-to-get-over-a-breakup','will-we-get-back-together','should-you-go-no-contact','how-long-no-contact','ex-suddenly-contacted-me'];
      const movedMatch = path.match(/^\/love\/breakup\/([a-z-]+)\/?$/);
      if (movedMatch && MOVED_ARTICLES.includes(movedMatch[1])) {
        return Response.redirect(
          new URL('/articles/love/breakup/' + movedMatch[1] + '/', url).toString(), 301);
      }

      // 真人占卜。不是它的路徑會回 null，繼續往下走
      const oracle = await oracleRoutes(request, env, ctx, url);
      if (oracle) return oracle;

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
      if (path === '/api/extended-outline' && request.method === 'GET') {
        return extendedOutline(url);
      }
      if (path === '/api/extended-availability' && request.method === 'GET') {
        return extendedAvailability();
      }
      if (path === '/api/notify-me' && request.method === 'POST') {
        return await notifyMe(request, env);
      }
      if (path === '/api/resend-pdf' && request.method === 'POST') {
        return await resendPdf(request, env, url);
      }
      if (path === '/api/feedback' && request.method === 'POST') {
        return await sendFeedback(request, env);
      }
      if (path.startsWith('/api/articles')) {
        const r = await articleRoutes(request, env, url);
        if (r) return r;
      }
      if (path === '/api/survey' && request.method === 'POST') {
        return await submitSurvey(request, env);
      }
      if (path === '/api/survey/admin' && request.method === 'GET') {
        return await surveyAdmin(request, env, url);
      }
      if (path === '/api/survey/reward' && request.method === 'POST') {
        return await surveyReward(request, env);
      }
      if (path === '/api/yuanfen-reading' && request.method === 'POST') {
        return await yuanfenReading(request, env);
      }
      if (path === '/api/yuanfen-survey-start' && request.method === 'POST') {
        return await yuanfenSurveyStart(request, env);
      }
      if (path === '/api/yuanfen-feedback' && request.method === 'POST') {
        return await yuanfenFeedback(request, env);
      }
      if (path === '/api/yuanfen-feedback/admin' && request.method === 'GET') {
        return await yuanfenFeedbackAdmin(request, env);
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
          // 這是「線上現在跑的是哪一版」。由 Cloudflare 自己填，
          // 不需要人工維護版號，所以不會有忘記更新的問題。
          // scripts/check-release.mjs 用 deployedAt 跟最新 commit 的時間比對，
          // 抓出「建置完成但沒推上線」——那個坑害過問卷 8 筆回覆是空的。
          versionId: env.CF_VERSION?.id || null,
          deployedAt: env.CF_VERSION?.timestamp || null,
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

/* 舊欄位（missing / noBuyReasons / buyMotivators / extendedAwareness）留著不刪。
   問卷 2.0 已經不再問這幾題，但既有回覆裡有值，留在清單裡才不會在讀取或
   匯出時被當成不認識的欄位。新題目一律用新的 key，不改寫舊欄位的意義。 */
const SURVEY_MULTI_FIELDS = ['issues', 'benefits', 'missing', 'noBuyReasons', 'buyMotivators', 'wantedFeatures',
  'free_fortune_remaining_questions', 'extended_buyer_improvement'];
const randomHex = bytes => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
const SURVEY_ALLOWED = [
  'nickname', 'email', 'topic', 'distress', 'source', 'categoryEase', 'flowClarity', 'device',
  'matchScore', 'readability', 'extendedAwareness', 'returnIntent', 'age', 'relationship', 'oneChange',
  // 問卷 2.0
  'extended_fortune_status', 'extended_value_clarity',
  'extended_no_purchase_primary_reason', 'extended_top_value'
];

async function submitSurvey(request, env) {
  if (!env.ORDERS) return json({ ok: false, error: 'survey_not_configured' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }
  if (String(body.website || '').trim()) return json({ ok: true });

  const clean = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);
  const answer = {};
  for (const key of SURVEY_ALLOWED) answer[key] = clean(body[key], key === 'oneChange' ? 1500 : 300);
  for (const key of SURVEY_MULTI_FIELDS) {
    answer[key] = Array.isArray(body[key]) ? body[key].slice(0, 12).map(v => clean(v, 120)) : [];
  }
  if (!answer.nickname || !answer.email || !answer.topic || !answer.distress || !answer.source || !answer.categoryEase ||
      !answer.flowClarity || !answer.device || !answer.matchScore || !answer.readability) {
    return json({ ok: false, error: '請完成所有必填題目' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer.email)) {
    return json({ ok: false, error: '請輸入有效的 Email' }, 400);
  }

  const id = 'SR' + Date.now().toString(36).toUpperCase() + randomHex(4);
  const rewardToken = crypto.randomUUID().replace(/-/g, '');
  const record = { id, createdAt: new Date().toISOString(), ...answer };
  await Promise.all([
    env.ORDERS.put('survey:' + id, JSON.stringify(record)),
    env.ORDERS.put('survey-reward:' + rewardToken, JSON.stringify({ id, used: false, createdAt: record.createdAt }), { expirationTtl: 60 * 60 * 24 * 30 })
  ]);
  return json({ ok: true, id, rewardToken });
}

/* ── 曖昧合盤 · 準確度回饋 ─────────────────────────────────
   使用者在免費結果頁按下「滿準的／有點像／不太對」時送來。
   同一個動作也會送一筆匿名的 GA4 事件，那份用來看漏斗；
   這一份多帶兩組生日，用途只有一個：引擎改版後拿真實案例整批重跑。
   盤面 key 是舊引擎算出來的，重跑不能用，所以才需要留生日。

   ★ 只收生日、盤面與評分。不收信箱、姓名、IP。
     頁面上的說明是「除非你主動送出準確度回饋，否則兩組生日不會離開這一頁」，
     所以這支 API 只能由那個動作觸發，不要拿去記錄一般抽籤。 */

const YF_TTL = 60 * 60 * 24 * 365;                       // 保存 12 個月
const YF_RATING = ['滿準的', '有點像', '不太對'];
/* 每一項都對應到免費頁上使用者真的看得到、判斷得了的一個判讀，
   而且對應到一個具體的模組或分數——某一項特別多就知道要改哪裡。
   三個維度刻意拆開：全部塞進一個「相處狀況」，收到回報也不知道是哪一項在錯。 */
/* spouse（你會被什麼樣的人吸引）只有填了性別的人看得到那一段，
   所以它的回報數會天生低於其他七項，比較時要除以「有看到的人數」，
   不能直接跟別項比絕對值。 */
const YF_PART = ['band', 'chance', 'tempo', 'initiator', 'wendu', 'zhongliang', 'changdu', 'spouse'];

/* 生日只留年月日與時辰，而且要是合理的值——不合理就整筆退掉，
   不要把髒資料存進去，之後重跑會被它污染。 */
function yfBirth(v) {
  if (!v || typeof v !== 'object') return null;
  const y = Number(v.y), m = Number(v.m), d = Number(v.d);
  if (!Number.isInteger(y) || y < 1900 || y > 2100) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (!Number.isInteger(d) || d < 1 || d > 31) return null;
  const out = { y, m, d };
  if (v.hour !== undefined && v.hour !== null) {
    const h = Number(v.hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) return null;
    out.hour = h;
  }
  return out;
}

/* 判讀邏輯的版本。改動任何會影響輸出的模組時要一起升版，
   否則之後看回饋不知道使用者當時評的是哪一版。 */
const YF_LOGIC_VERSION = 'yuanfen_v1.0';

/* 合盤紀錄。2026-09-12 校準活動開始，改成抽籤當下就建立紀錄。

   ★ 這推翻了先前「抽籤本身不呼叫任何 API」的決定。負責人 2026-09-12 拍板，
     理由是要能算出「抽了但沒填問卷」的分母，那個數字放在 GA4 裡不夠用。
     改動時同步改了三處說法（合盤頁承諾、條款頁兩段），
     並拆掉守著舊行為的測試——說的跟做的必須一致，不能只改一邊。

   reading_id 用日期加 48 bits 亂數，不可預測也猜不到別人的。 */
function yfReadingId() {
  const d = new Date();
  const ymd = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
  return 'YF-' + ymd + '-' + randomHex(6);
}

async function yuanfenReading(request, env) {
  const body = await request.json().catch(() => ({}));
  const a = yfBirth(body.a), b = yfBirth(body.b);
  if (!a || !b) return json({ ok: false, error: 'bad_birth' }, 400);

  /* 結果快照。之後改了判讀邏輯，還是要看得到使用者當時讀到的是什麼，
     否則拿舊回饋對新結果，永遠對不上。上限 20KB，超過就不存
     ——寧可少一筆快照，也不要讓一次異常的輸入塞爆 KV。 */
  let snapshot = '';
  try {
    snapshot = JSON.stringify(body.result || {});
    if (snapshot.length > 20000) snapshot = '';
  } catch (e) { snapshot = ''; }

  const id = yfReadingId();
  const record = {
    readingId: id,
    createdAt: new Date().toISOString(),
    a, b,
    gender: String(body.gender || '').slice(0, 10),
    pron: String(body.pron || '').slice(0, 6),
    logicVersion: YF_LOGIC_VERSION,
    resultJson: snapshot,
    surveyStatus: 'none',
  };
  await env.ORDERS.put('yfreading:' + id, JSON.stringify(record), { expirationTtl: YF_TTL });
  return json({ ok: true, reading_id: id, logic_version: YF_LOGIC_VERSION });
}

/* 問卷開始。只送 reading_id，不帶生日——用來算「打開了但沒填完」。 */
async function yuanfenSurveyStart(request, env) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.reading_id || '');
  if (!/^YF-\d{8}-[0-9A-F]{12}$/.test(id)) return json({ ok: false, error: 'bad_id' }, 400);
  const raw = await env.ORDERS.get('yfreading:' + id);
  if (!raw) return json({ ok: false, error: 'not_found' }, 404);
  const rec = JSON.parse(raw);
  if (rec.surveyStatus === 'none') {
    rec.surveyStatus = 'started';
    await env.ORDERS.put('yfreading:' + id, JSON.stringify(rec), { expirationTtl: YF_TTL });
  }
  return json({ ok: true, status: rec.surveyStatus });
}

async function yuanfenFeedback(request, env) {
  if (!env.ORDERS) return json({ ok: false, error: 'not_configured' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  const a = yfBirth(body.a), b = yfBirth(body.b);
  if (!a || !b) return json({ ok: false, error: 'bad_birth' }, 400);

  /* 綁定當次合盤。舊版沒有 reading_id，所以不強制——沒帶就照舊存成獨立一筆，
     不要因為新欄位讓還開著舊分頁的人送不出來。 */
  const readingId = String(body.reading_id || '');
  let reading = null;
  if (/^YF-\d{8}-[0-9A-F]{12}$/.test(readingId)) {
    const raw = await env.ORDERS.get('yfreading:' + readingId);
    if (raw) {
      reading = JSON.parse(raw);
      /* 同一份合盤只能填一次。擋在後端，因為 localStorage 清掉就繞過了。 */
      if (reading.surveyStatus === 'completed') {
        return json({ ok: false, error: 'already_done', survey_id: reading.surveyId || '' }, 409);
      }
    }
  }

  const rating = String(body.rating || '');
  if (!YF_RATING.includes(rating)) return json({ ok: false, error: 'bad_rating' }, 400);

  /* 可複選。舊版送單一字串，這裡兩種都收，一律存成陣列，
     之後統計不用再判斷型別。 */
  const raw = body.wrong_part == null ? [] : (Array.isArray(body.wrong_part) ? body.wrong_part : [body.wrong_part]);
  const wrongPart = [...new Set(raw.map(String))].filter(Boolean);
  if (wrongPart.length > YF_PART.length) return json({ ok: false, error: 'bad_part' }, 400);
  for (const p of wrongPart) if (!YF_PART.includes(p)) return json({ ok: false, error: 'bad_part' }, 400);

  const str = (v, max = 40) => String(v == null ? '' : v).slice(0, max);
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);

  const id = 'YF' + Date.now().toString(36).toUpperCase() + randomHex(4);
  const record = {
    id,
    createdAt: new Date().toISOString(),
    a, b,
    readingId: reading ? reading.readingId : '',
    logicVersion: reading ? reading.logicVersion : '',
    rating,
    wrongPart,
    /* 2026-09-12 校準活動新增的題目。前三題是原本就有的，
       底下這些是這次要拿來規劃「限時解籤」賣什麼的。 */
    wrongOther: str(body.wrong_other, 200),      // Q2 選「其他」時的補充
    worst: str(body.worst, 1000),                // Q3 最不準的地方
    best: str(body.best, 1000),                  // Q4 特別準的地方
    realStatus: str(body.real_status, 30),       // Q5 目前真正的關係
    realOther: str(body.real_other, 100),
    wantToKnow: str(body.want_to_know, 1000),    // Q6 最想知道什麼
    /* 使用者體驗那兩題，跟準不準是兩件事，分開存 */
    usability: str(body.usability, 60),
    note: str(body.note, 1000),
    /* 當下這個版本算出來的結果，用來跟重跑的新版本對照 */
    view: {
      total: num(body.total),
      band: str(body.band),
      tempo: str(body.tempo),
      chance: str(body.chance),
      initiator: str(body.initiator),
      /* 配偶星抽到哪一格，以及使用者的性別。沒填性別的人看不到那一段，
         兩欄都會是空的，統計時要先排除——不然分母會把沒看過的人算進去。
         性別在這裡不是為了蒐集個資，是判讀本身需要：男看財星、女看官殺，
         不知道是哪一邊就無法拿新版重跑對照。 */
      spouse: str(body.spouse, 20),
      gender: str(body.gender, 10)
    },
    keys: {
      wendu: str(body.wendu_key, 20),
      zhongliang: str(body.zhongliang_key, 20),
      changdu: str(body.changdu_key, 20),
      crossSweet: num(body.cross_sweet),
      crossHarsh: num(body.cross_harsh)
    }
  };
  await env.ORDERS.put('yfsurvey:' + id, JSON.stringify(record), { expirationTtl: YF_TTL });

  /* 回頭把合盤紀錄標記成已填。順序刻意是「問卷先存、紀錄後標」——
     反過來的話，標記成功但問卷寫入失敗，使用者會被永久擋住無法重填。 */
  if (reading) {
    reading.surveyStatus = 'completed';
    reading.surveyId = id;
    reading.completedAt = record.createdAt;
    await env.ORDERS.put('yfreading:' + reading.readingId, JSON.stringify(reading), { expirationTtl: YF_TTL });
  }
  return json({ ok: true });
}

async function yuanfenFeedbackAdmin(request, env) {
  if (!env.ADMIN_KEY || request.headers.get('X-Admin-Key') !== env.ADMIN_KEY) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!env.ORDERS) return json({ error: 'not_configured' }, 503);
  const rows = [];
  let cursor;
  do {
    const listed = await env.ORDERS.list({ prefix: 'yfsurvey:', cursor, limit: 1000 });
    const values = await Promise.all(listed.keys.map(k => env.ORDERS.get(k.name, 'json')));
    values.forEach(v => { if (v) rows.push(v); });
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor && rows.length < 20000);
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const byRating = {};
  const byPart = {};
  for (const r of rows) {
    byRating[r.rating] = (byRating[r.rating] || 0) + 1;
    /* wrongPart 現在是陣列；舊紀錄是字串，兩種都要算得到 */
    const parts = Array.isArray(r.wrongPart) ? r.wrongPart : (r.wrongPart ? [r.wrongPart] : []);
    for (const p of parts) byPart[p] = (byPart[p] || 0) + 1;
  }
  return json({ ok: true, total: rows.length, byRating, byPart, rows });
}

async function surveyAdmin(request, env, url) {
  if (!env.ADMIN_KEY || request.headers.get('X-Admin-Key') !== env.ADMIN_KEY) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!env.ORDERS) return json({ error: 'survey_not_configured' }, 503);
  const rows = [];
  let cursor;
  do {
    const listed = await env.ORDERS.list({ prefix: 'survey:', cursor, limit: 1000 });
    const values = await Promise.all(listed.keys.map(k => env.ORDERS.get(k.name, 'json')));
    values.forEach(v => { if (v) rows.push(v); });
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor && rows.length < 10000);
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return json({ ok: true, total: rows.length, rewardCount: rows.filter(r => r.rewardClaimedAt).length, rows });
}

async function surveyReward(request, env) {
  if (!env.ORDERS) return json({ error: 'survey_not_configured' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const token = String(body.token || '');
  if (!/^[a-f0-9]{32}$/i.test(token)) return json({ error: 'invalid_token' }, 400);
  const rewardKey = 'survey-reward:' + token;
  const reward = await env.ORDERS.get(rewardKey, 'json');
  if (!reward) return json({ error: 'expired_token' }, 404);

  let fortuneId = reward.fortuneId;
  if (!fortuneId) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    fortuneId = SURVEY_FORTUNES[random % SURVEY_FORTUNES.length].id;
    reward.fortuneId = fortuneId;
    reward.used = true;
    reward.claimedAt = new Date().toISOString();
    await env.ORDERS.put(rewardKey, JSON.stringify(reward), { expirationTtl: 60 * 60 * 24 * 30 });
    const surveyKey = 'survey:' + reward.id;
    const survey = await env.ORDERS.get(surveyKey, 'json');
    if (survey) {
      survey.rewardClaimedAt = reward.claimedAt;
      survey.rewardFortuneId = fortuneId;
      await env.ORDERS.put(surveyKey, JSON.stringify(survey));
    }
  }
  const fortune = SURVEY_FORTUNES.find(x => x.id === fortuneId);
  if (!fortune) return json({ error: 'fortune_not_found' }, 500);
  return json({ ok: true, fortune });
}


/* ── 使用者意見回饋：Cloudflare Worker → Resend HTTP API ── */
async function sendFeedback(request, env) {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is missing');
    return json({ ok: false, error: 'feedback_not_configured' }, 503);
  }

  let body = {};
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      const form = await request.formData();
      for (const [k, v] of form.entries()) body[k] = String(v);
    }
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  // Honeypot
  if (String(body.website || '').trim()) return json({ ok: true });

  const clean = (v, max) => String(v || '').trim().slice(0, max);
  const name = clean(body.name, 80);
  const email = clean(body.email, 160);
  const type = clean(body.type, 40);
  const message = clean(body.message, 5000);

  if (!message) return json({ ok: false, error: '請填寫回饋內容' }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Email 格式不正確' }, 400);
  }

  const payload = {
    from: env.MAIL_FROM || '未完籤所 <hello@unfinished.tw>',
    to: [env.ADMIN_EMAIL || 'jiazhen0404@gmail.com'],
    subject: `[未完籤所意見回饋] ${type || '其他'}`,
    text:
`稱呼：${name || '未填'}
Email：${email || '未填'}
回饋類型：${type || '其他'}

內容：
${message}`
  };
  if (email) payload.reply_to = email;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Resend feedback error', r.status, JSON.stringify(result));
    return json({ ok: false, error: result.message || '寄送失敗' }, 502);
  }

  console.log('Feedback email sent via Resend', result.id || '');
  return json({ ok: true });
}

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

  // 真人占卜的訂單編號開頭是 UO，交給它自己處理。
  // 它會用自己的金鑰驗章，因為測試模式用的是綠界測試商店，跟這裡不同。
  if (String(data.MerchantTradeNo || '').startsWith('UO')) {
    return await oraclePaid(data, env, ctx);
  }

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

  // GA4 的 purchase 只能記一次。去重記在訂單上而不是瀏覽器裡，
  // 因為使用者會重新整理成功頁、回上一頁、換分頁、甚至換一台裝置開同一個網址，
  // localStorage 擋不住這些。第一個問到的人才會拿到 countPurchase: true。
  const countPurchase = !order.gaPurchaseReportedAt;
  if (countPurchase) order.gaPurchaseReportedAt = new Date().toISOString();

  // 同一筆訂單重複索取，就把同一張憑證給回去，不會一直長出新的
  if (order.unlockToken) {
    if (countPurchase) {
      await env.ORDERS.put('order:' + tradeNo, JSON.stringify(order), { expirationTtl: ORDER_TTL });
    }
    return json({ token: order.unlockToken, slipId: order.slipId, countPurchase });
  }

  const token = randomToken();
  await env.ORDERS.put(
    'unlock:' + token,
    JSON.stringify({ slipId: order.slipId, issuedAt: new Date().toISOString() }),
    { expirationTtl: UNLOCK_TTL }
  );

  order.unlockToken = token;
  await env.ORDERS.put('order:' + tradeNo, JSON.stringify(order), { expirationTtl: ORDER_TTL });

  return json({ token, slipId: order.slipId, countPurchase });
}

/* ══════════════════════════════════════════════════════════
   五、讀取延伸解籤全文
   沒有有效憑證就回 402，前端據此顯示「尚未解鎖」。
   ══════════════════════════════════════════════════════════ */

/* 候補名單。「這一類的深度解讀還在寫，想先知道嗎？」
   個資規則比照訂單，不放寬：

     · 需求紀錄（分類＋情境＋時間）不含個資，留著看哪一類最多人要
     · 信箱分開存，寄出通知後立刻刪除
     · 沒寄成的 90 天自動過期

   信箱之所以不跟需求紀錄放在一起，是為了讓「刪信箱」這件事乾淨——
   刪掉信箱那一筆之後，需求統計仍然完整，不需要改寫既有紀錄。 */
const NOTIFY_EMAIL_TTL = 60 * 60 * 24 * 90;   // 90 天

async function notifyMe(request, env) {
  if (!env.ORDERS) return json({ ok: false, error: 'not_configured' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  // 蜜罐。機器人會填，真人看不到這個欄位。假裝成功，不給它回饋。
  if (String(body.website || '').trim()) return json({ ok: true });

  const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const category = clean(body.category, 20);
  const scenario = clean(body.scenario, 20);
  const email = clean(body.email, 254);

  if (!category) return json({ ok: false, error: 'bad_category' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ ok: false, error: '這個信箱看起來不太對，再確認一次好嗎？' }, 400);
  }
  if (body.consent !== true) {
    return json({ ok: false, error: 'consent_required' }, 400);
  }

  const id = 'NM' + Date.now().toString(36).toUpperCase() + randomHex(4);
  const now = new Date().toISOString();

  await Promise.all([
    // 不含個資，留著
    env.ORDERS.put(
      'notify:' + id,
      JSON.stringify({ id, category, scenario, createdAt: now, notifiedAt: null })
    ),
    // 個資，單獨存、會過期、寄出後刪
    env.ORDERS.put(
      'notify-email:' + id,
      JSON.stringify({ id, email, createdAt: now }),
      { expirationTtl: NOTIFY_EMAIL_TTL }
    ),
  ]);

  return json({ ok: true });
}

/* 哪些籤買得到延伸解籤。前端問這裡，不要自己寫死「分類 == 愛情」——
   下一批延伸籤寫完會變成情境層級，寫死的話每次都要改前端。
   直接從 EXTENDED 算，資料長出什麼就回什麼。 */
function extendedAvailability() {
  const situations = {};
  for (const slip of EXTENDED) {
    const m = /^([a-z]+)_([a-z-]+)_(\d{3})$/.exec(slip.id);
    if (!m) continue;
    const key = m[1] + '_' + m[2];
    (situations[key] = situations[key] || []).push(m[3]);
  }
  return json({
    total: EXTENDED.length,
    // 「這個分類_情境有幾支、籤號是哪些」——前端據此判斷手上這支買不買得到
    situations: Object.fromEntries(
      Object.entries(situations).map(([k, v]) => [k, { count: v.length, numbers: v.sort() }])
    ),
  });
}

/* 延伸解籤的「目錄」——只有小標題與數量，不含任何一段正文。
   不需要憑證，因為這是給還沒付款的人看的商品說明。

   ★ 這個端點永遠只能碰 sections[].title。
     不要為了「順便」把 paragraphs、poem、outcomeDetail 加進來——
     那些是付費內容，只能由 /api/extended 憑憑證回傳。
     章節數與字數是每支籤各自算出來的，寫死一個數字對大部分籤都是錯的
     （實際章節數 3～10，字數 783～2165）。 */
function extendedOutline(url) {
  const slipId = url.searchParams.get('id') || '';
  if (!/^love_[a-z-]{3,20}_\d{3}$/.test(slipId)) return json({ error: 'bad_slip_id' }, 400);

  const slip = EXTENDED.find((x) => x.id === slipId);
  if (!slip) return json({ error: 'not_found' }, 404);

  // 只留真的有內容的章節。資料裡有兩支籤（love_flirting_072、
  // love_relationship_072）最後一節是分類標籤、0 段落，會讓買家看到
  // 一個叫「愛情・關係中」的空章節，章節數也會多算一節。
  // 在這裡擋掉，之後再出現同類的髒資料也不會漏到畫面上。
  const sections = (slip.sections || []).filter(
    (s) => s.title && (s.paragraphs || []).join('').trim().length > 0
  );
  const words = sections.reduce(
    (n, s) => n + (s.paragraphs || []).join('').length,
    0
  );

  return json({
    id: slip.id,
    sectionCount: sections.length,
    // 無條件捨去到百位，避免看起來像逐字計算過的精確數字
    approxWordCount: Math.max(100, Math.floor(words / 100) * 100),
    titles: sections.map((s) => s.title),
  });
}

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

  async function ask() {
    const body = {
      html,
      gotoOptions: { waitUntil: 'networkidle0', timeout: 45000 },
      pdfOptions,
    };
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

  // 字型已經內嵌在版面裡，不必等網路，也就不需要重試機制了。
  let res = await ask();
  if (!res.ok) {
    const msg = (await res.text()).slice(0, 200);
    console.error('產生 PDF 失敗 ' + res.status + ' ' + msg);
    // 再試一次，處理偶發的網路或額度抖動
    res = await ask();
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
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 一定要禁止快取。
      // 少了這一行，Cloudflare 會把 API 的回應當成靜態內容存起來，
      // 付款完成頁就會一直拿到「還沒付款」那份舊答案，永遠等不到結果。
      'cache-control': 'no-store, no-cache, must-revalidate',
      'pragma': 'no-cache',
    },
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

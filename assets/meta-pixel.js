/* ══════════════════════════════════════════════════
   Meta Pixel（Facebook 像素）— 全站共用
   Pixel ID：1141537454976539

   每一頁的 <head> 都用同一行引用這個檔案：
     <script src="/assets/meta-pixel.js"></script>
   要換 Pixel ID、或之後要調整事件規則，只改這一個檔案。

   這個檔案做四件事：
     1. Base Code：初始化一次、送一次 PageView（防重複引用）
     2. 集中式事件 helper：trackMetaEvent() / trackMetaCustomEvent()
        各頁只呼叫這兩個函式，不直接碰 fbq。
     3. 全站通用、不需要改各頁的事件：ClickLINE、SEO 主題頁的 ViewContent
     4. 補齊 UTM 保存（跟既有的 unfinished_utm 同一個格式、同一個 key）

   安全原則（任何改動都要守住）：
     - Pixel 沒載入、被擋、出錯，都不能讓抽籤／付款／換頁壞掉。
       所有對外函式都包在 try/catch 裡，失敗就安靜略過。
     - 只送「白名單」裡的參數。姓名、Email、電話、LINE ID、使用者寫的問題，
       就算呼叫端不小心傳進來，也會在這裡被丟掉，不會送到 Meta。

   除錯：網址帶 ?meta_debug=1 進站，之後每個事件都會印在 Console
        （帶 ?meta_debug=0 關掉）。
   ══════════════════════════════════════════════════ */
(function () {
  if (typeof window === 'undefined') return;
  if (window.__unfinishedMetaPixelInit) return;
  window.__unfinishedMetaPixelInit = true;

  /* ── 1. Base Code ───────────────────────────────── */
  try {
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');

    /* 關掉 Meta「網址一變就自動補送 PageView」的功能。
       這個網站沒有靠網址切換的頁面：抽籤流程的每一步都在同一頁裡換畫面，
       網址只有按「今天抽一籤」時被改成 #start、問卷完成頁進站時清掉 token。
       不關的話，這兩個動作會各多送一次 PageView，
       問卷完成頁更會變成「第一次載入就送兩次 PageView」。
       抽籤流程的每一步改由 ViewContent / StartDraw / CompleteDraw 記錄。 */
    window.fbq.disablePushState = true;

    window.fbq('init', '1141537454976539');
    window.fbq('track', 'PageView');
  } catch (e) {}

  /* ── 2. 集中式事件 helper ───────────────────────── */

  var DEBUG = false;
  try {
    var dq = new URLSearchParams(location.search).get('meta_debug');
    if (dq === '1') localStorage.setItem('uw.meta.debug', '1');
    if (dq === '0') localStorage.removeItem('uw.meta.debug');
    DEBUG = localStorage.getItem('uw.meta.debug') === '1';
  } catch (e) {}

  /* 商品資料。這兩個價格要跟後端一致：
       延伸籤 src/index.js 的 PRICE；真人占卜 src/oracle.js 的 PRICE。
     只用在「看到商品、加入」這兩個還沒建立訂單的事件。
     InitiateCheckout 與 Purchase 一律用後端訂單回傳的實際金額，不用這裡的數字。 */
  var PRODUCTS = {
    extended: { name: 'Extended Reading', price: 99 },
    oracle:   { id: 'oracle_reading', name: '真人占卜', price: 399 }
  };

  /* 可以送給 Meta 的參數白名單。不在名單裡的一律丟掉。 */
  var ALLOWED = {
    content_name: 1, content_category: 1, content_type: 1, content_ids: 1,
    value: 1, currency: 1, num_items: 1,
    category: 1, draw_type: 1, source: 1,
    question_id: 1, question_slug: 1, result_id: 1,
    product_id: 1, service_id: 1, placement: 1, page_type: 1,
    utm_source: 1, utm_medium: 1, utm_campaign: 1, utm_content: 1, utm_term: 1
  };
  var UTM_KEYS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];

  function savedUtm() {
    try {
      var s = JSON.parse(localStorage.getItem('unfinished_utm') || '{}') || {};
      if (s.saved_at && Date.now() - s.saved_at > 30*24*60*60*1000) return {};
      return s;
    } catch (e) { return {}; }
  }

  function clean(params) {
    var out = {};
    params = params || {};
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k) || !ALLOWED[k]) continue;
      var v = params[k];
      if (v === undefined || v === null || v === '') continue;
      if (k === 'content_ids') {
        if (!Array.isArray(v)) v = [v];
        v = v.filter(function (x) { return x !== undefined && x !== null && x !== ''; })
             .map(function (x) { return String(x).slice(0, 80); });
        if (!v.length) continue;
      } else if (k === 'value' || k === 'num_items') {
        v = Number(v);
        if (!isFinite(v)) continue;
      } else {
        v = String(v).slice(0, 100);
      }
      out[k] = v;
    }
    /* 原始廣告來源（同一份 unfinished_utm，30 天）。
       換頁、跳去綠界再回來都還在，Purchase 也帶得到。 */
    var u = savedUtm();
    UTM_KEYS.forEach(function (k) { if (u[k] && !out[k]) out[k] = String(u[k]).slice(0, 100); });
    return out;
  }

  /* 去重：同一個 key 只送一次。
       store: 'memory'  只在這次頁面有效（預設）
              'session' 同一個分頁重新整理也不會再送
              'local'   同一台瀏覽器永遠不再送（用在 Purchase）
     throttle: 毫秒。同一個 key 在這段時間內再觸發就忽略（擋連點）。 */
  var memo = {};
  var lastAt = {};
  function storageFor(store) {
    try { return store === 'local' ? localStorage : store === 'session' ? sessionStorage : null; }
    catch (e) { return null; }
  }
  function alreadySent(key, store) {
    if (memo[key]) return true;
    var st = storageFor(store);
    try { if (st && st.getItem('uw.meta.' + key) === '1') return true; } catch (e) {}
    return false;
  }
  function markSent(key, store) {
    memo[key] = 1;
    var st = storageFor(store);
    try { if (st) st.setItem('uw.meta.' + key, '1'); } catch (e) {}
  }

  function send(kind, name, params, opts) {
    try {
      opts = opts || {};
      if (typeof window === 'undefined' || typeof window.fbq !== 'function') return false;

      if (opts.throttle) {
        var tk = opts.throttleKey || (name + ':' + JSON.stringify(params || {}));
        var now = Date.now();
        if (lastAt[tk] && now - lastAt[tk] < opts.throttle) return false;
        lastAt[tk] = now;
      }
      if (opts.once) {
        var key = name + ':' + opts.once;
        if (alreadySent(key, opts.store)) return false;
        markSent(key, opts.store);
      }

      var p = clean(params);
      var extra = opts.eventID ? { eventID: String(opts.eventID) } : undefined;
      if (extra) window.fbq(kind, name, p, extra);
      else window.fbq(kind, name, p);

      if (DEBUG && window.console) console.log('[Meta]', kind, name, p, extra || '');
      return true;
    } catch (e) { return false; }
  }

  function trackMetaEvent(name, params, opts) { return send('track', name, params, opts); }
  function trackMetaCustomEvent(name, params, opts) { return send('trackCustom', name, params, opts); }

  /* 送完事件後才換頁（綠界表單送出、location.href 跳轉）。
     換頁太快會把正在送的事件截斷，所以等一下下；
     Pixel 沒載入就不等。無論如何 fn 一定會被呼叫、而且只呼叫一次——
     追蹤絕對不能卡住付款。 */
  function thenNavigate(fn, ms) {
    var called = false;
    function go() { if (called) return; called = true; fn(); }
    try {
      var real = window.fbq && window.fbq.callMethod;   // fbevents.js 真的載入了
      setTimeout(go, real ? (ms || 300) : 0);
    } catch (e) { go(); }
  }

  window.trackMetaEvent = trackMetaEvent;
  window.trackMetaCustomEvent = trackMetaCustomEvent;
  window.UnfinishedMeta = {
    track: trackMetaEvent,
    trackCustom: trackMetaCustomEvent,
    thenNavigate: thenNavigate,
    products: PRODUCTS
  };

  /* ── 3a. 補齊 UTM 保存 ─────────────────────────────
     首頁、主題頁、文章頁本來就有一段把 UTM 存進 localStorage 的程式，
     但真人占卜頁、問卷、緣分合盤、部分 SEO 頁沒有——廣告直接帶人進那些頁，
     來源就會掉。這裡用完全相同的規則補上：
       網址有 utm_* 才寫入（新的覆蓋舊的），保存 30 天，key 一樣是 unfinished_utm。
     已經有那段程式的頁面重複寫一次同樣的內容，不會有差別。 */
  try {
    var q = new URLSearchParams(location.search), found = {}, has = false;
    UTM_KEYS.forEach(function (k) { var v = q.get(k); if (v) { found[k] = v; has = true; } });
    if (has) { found.saved_at = Date.now(); localStorage.setItem('unfinished_utm', JSON.stringify(found)); }
  } catch (e) {}

  /* ── 3b. 頁面類型（ClickLINE 用）──────────────────── */
  function pageType() {
    var p = location.pathname;
    if (p === '/' || p === '/index.html') {
      var sc = document.documentElement.getAttribute('data-screen') || 'home';
      if (sc === 'result') return 'draw_result';
      if (sc === 'home') return 'home';
      if (sc === 'about') return 'about';
      return 'draw_flow';
    }
    if (/^\/articles\//.test(p)) return 'article';
    if (/^\/(love|work|life|pet|monthly|choice)\//.test(p)) return 'category';
    if (/^\/extended\//.test(p)) return 'extended_reading';
    if (/^\/oracle/.test(p)) return 'consultation';
    if (/^\/checkout\//.test(p)) return 'checkout';
    if (/^\/yuanfen\//.test(p)) return 'yuanfen';
    if (/^\/survey\//.test(p)) return 'survey';
    if (/^\/feedback\//.test(p)) return 'feedback';
    return 'other';
  }

  /* ── 3c. ClickLINE ─────────────────────────────────
     全站一個監聽就好，不用在一百多頁各自綁。
     按鈕位置用固定命名，依連結自己帶的 utm_medium 判斷：
       header / footer / home / draw_result / extended_reading / article / other
     只送位置與頁面類型，不送 LINE ID 或任何使用者資料。 */
  var PLACEMENT_BY_MEDIUM = {
    header: 'header', footer: 'footer',
    home_band: 'home', home_cards: 'home',
    result_page: 'draw_result'
  };
  function linePlacement(a, href) {
    var forced = a.getAttribute('data-meta-placement');
    if (forced) return forced;
    var medium = '', source = '';
    try {
      var u = new URL(href, location.href);
      medium = u.searchParams.get('utm_medium') || '';
      source = u.searchParams.get('utm_source') || '';
    } catch (e) {}
    if (PLACEMENT_BY_MEDIUM[medium]) return PLACEMENT_BY_MEDIUM[medium];
    if (source === 'article' || a.getAttribute('data-seo-cta') === 'line') return 'article';
    if (a.closest && a.closest('header, .ww-header, .site-header')) return 'header';
    if (a.closest && a.closest('footer, .site-footer')) return 'footer';
    if (/^\/extended\//.test(location.pathname)) return 'extended_reading';
    return 'other';
  }
  try {
    document.addEventListener('click', function (ev) {
      try {
        var el = ev.target;
        var a = el && el.closest ? el.closest('a[href]') : null;
        if (!a) return;
        var href = a.getAttribute('href') || '';
        if (!/(line\.me\/R\/ti\/p\/|lin\.ee\/)/i.test(href)) return;
        var placement = linePlacement(a, href);
        trackMetaCustomEvent('ClickLINE',
          { placement: placement, page_type: pageType() },
          { throttle: 1500, throttleKey: 'ClickLINE:' + placement });
      } catch (e) {}
    }, true);
  } catch (e) {}

  /* ── 3d. SEO 主題頁的 ViewContent ─────────────────
     /love/…、/work/…、/pet/…、/life/、/monthly/…、/choice/… 這些是
     「某一類抽籤」的入口頁，進來就算看了這一類內容。
     content_name 用網址路徑（例：love/ambiguity/hot-and-cold），穩定且不含個資。
     首頁裡的抽籤流程另外在 index.html 記錄，不在這裡。 */
  try {
    var m = /^\/(love|work|life|pet|monthly|choice)(\/.*)?$/.exec(location.pathname);
    if (m) {
      var name = location.pathname.replace(/^\/+|\/+$/g, '').replace(/\/index\.html$/, '');
      trackMetaEvent('ViewContent',
        { content_name: name, content_category: m[1], content_type: 'oracle' },
        { once: 'page:' + name });
    }
  } catch (e) {}
})();

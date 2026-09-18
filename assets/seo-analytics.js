/* SEO 文章的 GA4 事件（§27）
   - 不重新初始化 GA4，只用頁面既有的 window.gtag。
   - 文章代號與分類寫在 <body data-article-slug data-article-category>。
   - CTA 連結加 data-seo-cta="draw|line|paid" 與 data-cta-position="top|mid|bottom|inline"。
*/
(function () {
  var body = document.body;
  if (!body) return;

  var slug = body.getAttribute('data-article-slug') || '';
  var category = body.getAttribute('data-article-category') || '';
  if (!slug) return;

  function track(name, params) {
    if (typeof window.gtag !== 'function') return;
    var p = { article_slug: slug, article_category: category };
    for (var k in params) { if (Object.prototype.hasOwnProperty.call(params, k)) p[k] = params[k]; }
    try { window.gtag('event', name, p); } catch (e) {}
  }

  track('seo_article_view', {});

  var EVENT_BY_KIND = {
    draw: 'seo_to_draw_click',
    line: 'seo_to_line_click',
    paid: 'seo_to_paid_click'
  };

  document.addEventListener('click', function (ev) {
    var el = ev.target;
    while (el && el !== document && !(el.getAttribute && el.getAttribute('data-seo-cta'))) {
      el = el.parentNode;
    }
    if (!el || el === document) return;
    var kind = el.getAttribute('data-seo-cta');
    var name = EVENT_BY_KIND[kind];
    if (!name) return;
    track(name, {
      cta_position: el.getAttribute('data-cta-position') || 'unknown',
      link_url: el.getAttribute('href') || ''
    });
  }, true);
})();

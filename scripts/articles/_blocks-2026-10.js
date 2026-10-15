/* 2026-10 感情 SEO 文章共用元件。
   措辭與 class 照既有文章（what-is-true-love.js），只把引導文字換成各篇自己的。
   真人占卜不寫死價格；不加 UTM（站內 UTM 會覆蓋自然流量的來源）。 */

const draw = (text, slug, sub, label) => `<div class="ctabox">
<p>${text}</p>
<a class="cta" href="/?theme=love&sub=${encodeURIComponent(sub)}&utm_source=article&utm_medium=cta&utm_campaign=${slug}#start">${label || '帶著現在的狀況抽一支籤'}</a>
<div class="note">免費 · 不用登入 · 已替你選好「${sub}」情境</div>
</div>`;

const oracle = text => `<div class="ctabox">
<p>${text}</p>
<a class="cta" href="/oracle.html">看看真人占卜</a>
<div class="note">由合作占卜師閱讀你的問題與背景後親自占卜與解讀，不是 AI 自動生成 · 以一個具體問題為單位 · 約 24–48 小時完成 · 費用以服務頁面顯示為準</div>
</div>`;

const WARN = `<div class="warn">如果情緒已經長時間嚴重影響睡眠、飲食或工作，或者出現傷害自己的念頭，請尋求心理師、身心科或當地的即時支持資源。抽籤與占卜不能取代專業協助。</div>`;

const CASE_NOTE = `<p class="note">以下為虛構示例，用來說明判斷方式。</p>`;

const refs = list => `<p class="note">參考資料：${list.join('<br>')}</p>`;

const faqHtml = faq => '<h2>常見問題</h2>\n' + faq.map(f => `<h3>${f.q}</h3>\n<p>${f.a}</p>`).join('\n\n');

const CRUMB_REL = [['/', '首頁'], ['/articles/', '文章分類'], ['/articles/love/', '愛情'], ['/articles/love/relationship/', '戀愛關係']];

const R = {
  trueLove: { href: '/articles/love/relationship/what-is-true-love/', b: '什麼是真愛？', span: '看見真實的彼此之後，仍然願意好好相愛' },
  over: { href: '/articles/love/breakup/signs-relationship-is-over/', b: '怎麼知道一段感情真的結束了？', span: '有感情，不代表適合繼續' },
  getOver: { href: '/articles/love/breakup/how-to-get-over-a-breakup/', b: '分手後怎麼走出來？', span: '不是逼自己忘記，而是把生活慢慢拿回來' },
  backTogether: { href: '/articles/love/breakup/will-we-get-back-together/', b: '分手後還會復合嗎？', span: '先看分手原因有沒有真的改變' },
  giveUp: { href: '/articles/love/ambiguity/when-to-give-up-situationship/', b: '曖昧多久該放棄？', span: '5 個該停損的訊號' },
  hotCold: { href: '/articles/love/ambiguity/hot-and-cold-situationship/', b: '曖昧對象忽冷忽熱是什麼意思？', span: '6 種可能與應對方式' },
  control: { href: '/articles/love/relationship/care-or-control/', b: '他是在關心你，還是在控制你？', span: '從你能不能說「不」開始分辨' },
  depend: { href: '/articles/love/relationship/emotional-dependency-vs-love/', b: '情緒依賴和愛有什麼不同？', span: '需要他，不等於離不開他' },
  worth: { href: '/articles/love/relationship/is-this-relationship-worth-continuing/', b: '這段感情還值得繼續嗎？', span: '先分清楚問題的性質，再看你們修不修得動' },
  leave: { href: '/articles/love/breakup/why-is-it-so-hard-to-break-up/', b: '為什麼明知道不適合，還是捨不得分手？', span: '把「捨不得」拆開來看' },
  makeUp: { href: '/articles/love/relationship/how-to-make-up-after-a-fight/', b: '情侶吵架後怎麼和好？', span: '比道歉更重要的事' },
  self: { href: '/articles/love/relationship/losing-yourself-in-a-relationship/', b: '為什麼一談戀愛就失去自己？', span: '在愛裡保留自己的方法' },
  values: { href: '/articles/love/relationship/different-values-in-relationship/', b: '情侶價值觀不同，還適合在一起嗎？', span: '先分清楚是偏好、習慣，還是核心價值' },
  silent: { href: '/articles/love/relationship/silent-treatment-vs-cooling-off/', b: '冷暴力和需要冷靜，差在哪裡？', span: '沉默本身不是問題，怎麼沉默才是' },
  crush: { href: '/articles/love/unrequited/why-do-i-like-people-who-dont-like-me/', b: '為什麼總是喜歡上不喜歡自己的人？', span: '你被吸引的，可能不是那個人' },
  pattern: { href: '/articles/love/relationship/repeating-relationship-patterns/', b: '為什麼總是重複遇到相似的感情問題？', span: '找出模式，才有機會換一種結局' }
};

module.exports = { draw, oracle, WARN, CASE_NOTE, refs, faqHtml, CRUMB_REL, R };

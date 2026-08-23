const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const baseUrl = "https://unfinished.tw/pet/passed-away";
const drawUrl = "/?theme=pet&sub=%E9%9B%A2%E5%88%A5%E4%B8%AD#start";

const pages = [
  {
    slug: "is-it-okay",
    title: "離世毛孩現在過得好嗎？",
    short: "牠現在過得好嗎？",
    description: "毛孩離世後，你是否仍擔心牠有沒有受苦、現在是否平安？帶著思念抽一支離世毛孩靈籤，整理牽掛與沒有說完的話。",
    lead: "你擔心的，也許不只是牠去了哪裡，而是牠最後有沒有害怕、現在是否還疼。",
    intro: [
      "毛孩離開以後，腦中很容易反覆停在最後幾天：牠是不是很痛？有沒有知道你陪在身邊？現在終於舒服了嗎？這些問題沒有誰能替你證明答案，但它們都來自一份很深的牽掛。",
      "這裡的籤不會宣稱能確認靈魂狀態，而會從你們共同生活的記憶、仍未放下的擔心，以及此刻可以為自己完成的事，提供一個溫柔的整理方向。"
    ],
    focus: ["牠最後一段時間是否感受到陪伴", "我為什麼一直停在牠最痛苦的畫面", "現在的我可以怎麼放下對牠的擔心"],
    faqs: [
      ["抽到不好的籤，代表牠現在不好嗎？", "不代表。籤文是情緒整理與象徵性提醒，不是對毛孩離世後狀態的證明。若某段文字讓你不安，先回到你確定知道的事：牠曾經被愛、被照顧，也真實地擁有過和你相處的日子。"],
      ["我一直想到牠生病的樣子，怎麼辦？", "試著選三張牠健康、有精神或安心睡著的照片，寫下每張照片發生的事情。最後的病痛是生命的一部分，但不該取代牠完整的一生。"]
    ]
  },
  {
    slug: "visit",
    title: "離世毛孩有回來看我嗎？",
    short: "牠有回來看我嗎？",
    description: "熟悉的聲音、夢境或家中的小動靜，會不會是離世毛孩回來看你？免費抽一支毛孩心語，整理思念與可能出現的象徵。",
    lead: "有時只是門邊一聲輕響，你就會忍不住想：是不是牠回來了？",
    intro: [
      "熟悉的位置像有腳步、睡夢裡再次見到牠，或某一刻突然聞到熟悉的味道，都可能讓人感覺毛孩仍在身邊。這些經驗可以很真實，但不必急著把它證明成超自然訊息。",
      "你可以把它理解成愛留下的回音：共同生活形成的記憶仍在身體與日常裡。無論那一刻是不是牠，這份連結都值得被溫柔接住。"
    ],
    focus: ["最近出現的熟悉感，對我代表什麼", "牠是否還留在我們共同生活的記憶裡", "我可以怎麼回應這份突然出現的想念"],
    faqs: [
      ["家裡突然有聲音，就是牠回來了嗎？", "可能有許多現實原因，也可能被你感受成一份熟悉的陪伴。未完籤所不替這些現象下定論；重要的是它帶給你安心，還是讓你更加害怕與困住。"],
      ["一直沒有感應，代表牠沒有回來嗎？", "不是。沒有夢、沒有特殊感覺，不代表牠不愛你，也不代表你們的連結消失。每個人的哀傷和記憶運作方式都不同。"]
    ]
  },
  {
    slug: "message",
    title: "離世毛孩最想對我說什麼？",
    short: "牠最想對我說什麼？",
    description: "如果離世毛孩能再對你說一句話，牠會想說什麼？免費抽取離世毛孩心語，為你們沒有說完的告別留一個位置。",
    lead: "你不是沒有道別，只是愛太長了，任何一句再見都顯得太短。",
    intro: [
      "很多人最放不下的，是最後沒有說出口的那句話：謝謝、對不起、我很愛你，或只是想再叫一次牠的名字。這個問題頁不是代替毛孩發言，而是讓你透過一支籤，看見心裡最需要被回應的地方。",
      "籤中的毛孩心語是一種象徵性書寫。你可以留下有共鳴的部分，也可以不同意；真正屬於你們的答案，仍藏在長久相處的細節裡。"
    ],
    focus: ["牠會怎麼記得我們一起生活的日子", "我最希望被牠理解的是哪一件事", "我們之間還有哪句話沒有好好說完"],
    faqs: [
      ["籤裡的話真的是毛孩說的嗎？", "它是依離別情境寫成的象徵性心語，不代表網站能讀取毛孩的靈魂或傳遞真實訊息。它的作用，是幫你找到此刻最需要整理與說出口的話。"],
      ["我可以寫信給牠嗎？", "可以。寫下三段就好：最想謝謝牠的事、最放不下的遺憾，以及希望牠下一段旅程得到的祝福。信不需要寄出，寫完本身就是一次告別。"]
    ]
  },
  {
    slug: "blame-me",
    title: "離世毛孩會怪我沒有救到牠嗎？",
    short: "牠會怪我沒有救到牠嗎？",
    description: "來不及發現病情、臨終時不在身邊，或曾替毛孩做安樂決定，都可能留下愧疚。免費抽一支離世毛孩心語，陪你整理自責。",
    lead: "你一直審判自己，可能只是因為你太希望當時還能多救牠一次。",
    intro: [
      "來不及發現病情、最後沒有陪在身邊、選擇安樂，或明知道已經盡力，仍覺得自己做得不夠——失去毛孩後，自責常會把當時有限的條件全部抹去，只留下『如果我早一點』。",
      "這裡不會替任何醫療決定判定對錯，而是提醒你重新看見：你是在當時擁有的資訊、時間與能力裡做選擇。遺憾不等於虧欠，沒有救回來也不等於沒有好好愛過。"
    ],
    focus: ["我是不是把結果全部怪在自己身上", "當時的我其實已經做了哪些努力", "我要怎麼把對不起慢慢轉回謝謝你"],
    faqs: [
      ["我替牠做了安樂，牠會怪我嗎？", "沒有人能代替牠回答，但選擇安樂通常發生在愛、痛苦與現實條件同時拉扯的時刻。可以回頭確認當時的醫療資訊與照護目的，而不是只用最後結果懲罰自己。"],
      ["臨終時我不在牠身邊，還有資格說愛牠嗎？", "有。你們的關係不是只由最後幾分鐘決定，而是由每天餵食、照顧、等待、玩耍和彼此依賴共同形成。最後沒有如願，不會抹去前面所有陪伴。"]
    ]
  },
  {
    slug: "reincarnation",
    title: "離世毛孩準備投胎了嗎？",
    short: "牠準備投胎了嗎？",
    description: "離世毛孩是否已投胎、會成為新的毛孩或未來的孩子？抽一支象徵性的毛孩靈籤，溫柔看待下一段生命與重逢可能。",
    lead: "你想知道牠去了哪裡，也可能是在問：我們還有沒有下一次相遇。",
    intro: [
      "有人相信毛孩會休息一段時間，有人相信牠會成為新的毛孩、另一段緣分，甚至以未來孩子的身分再次靠近。這些想像可以帶來安慰，但目前沒有方法能替個別生命證實投胎去向。",
      "離別籤池包含暫時休息、準備出發、以新毛孩或孩子象徵重逢等不同情境，不會把每一支都寫成『牠一定回來了』。即使你抽到重逢，也請把新的生命當成獨立的存在重新認識。"
    ],
    focus: ["牠目前更像在休息，還是準備展開新旅程", "我是否因為太想重逢，而無法看見眼前的新生命", "如果再次相遇，我希望用什麼方式重新愛牠"],
    faqs: [
      ["抽到投胎成孩子，代表我一定會懷孕嗎？", "不代表。這類籤是角色交換與家庭緣分的象徵，不是懷孕、生育或身分判定。不要把生育變成驗證毛孩是否回來的壓力。"],
      ["新的毛孩很像牠，就一定是牠投胎嗎？", "相似可以是一份禮物，差異也不代表緣分是假的。先照顧眼前生命真正的個性與需求，不要要求牠完整複製已離世的毛孩。"]
    ]
  },
  {
    slug: "dream",
    title: "夢到離世毛孩代表什麼？",
    short: "夢到牠代表什麼？",
    description: "夢到離世毛孩健康奔跑、回家、道別，或一直夢不到牠，可能代表什麼？免費抽一支毛孩心語，整理夢境帶來的思念。",
    lead: "有些夢清楚得像牠真的回來，有些人卻等了很久，始終沒有再夢見牠。",
    intro: [
      "夢見毛孩回家、恢復健康、轉身離開，醒來後常會同時感到安慰與失落。夢可能承接白天沒有說完的思念，也可能幫助心裡慢慢接受告別；是否具有超自然意義，無法只靠一個夢確定。",
      "如果你一直夢不到牠，也不用把沉默理解成責怪。睡眠狀態、壓力與記憶方式都會影響夢境，而你們的愛不需要靠托夢證明。"
    ],
    focus: ["這個夢帶給我的是安心、告別，還是更深的不捨", "我是不是把夢境當成唯一能再見到牠的方法", "醒來之後，我最想替牠完成什麼"],
    faqs: [
      ["夢裡的牠很健康，是來向我報平安嗎？", "你可以把它珍惜成一次溫柔的重逢，也可以理解為記憶正在把牠從最後的病痛中還原。兩種理解都不必互相否定。"],
      ["一直夢不到牠，是不是牠怪我？", "不是。沒有夢境不代表拒絕、離開或責怪。你可以在清醒時寫信、整理照片或說出想說的話，不必只能等待牠出現在夢裡。"]
    ]
  },
  {
    slug: "meet-again",
    title: "我和離世毛孩還會再相遇嗎？",
    short: "我們還會再相遇嗎？",
    description: "你和離世毛孩還會再見嗎？也許是夢裡、新毛孩、新緣分或某個熟悉瞬間。免費抽一支毛孩心語，為重逢保留溫柔可能。",
    lead: "真正讓人捨不得的，不只是牠離開，而是不知道那次道別是不是永遠。",
    intro: [
      "重逢可能被理解成夢裡再見、在新生命身上感到熟悉，或多年後想起牠時，心裡終於不再只剩疼痛。沒有人能保證你們會以哪種方式再次相遇，但共同生活留下的改變已經真實存在。",
      "這支籤不要求你停止生活等牠回來。相反地，好好走下去、保留再次愛一個生命的能力，才是讓這段緣分繼續發生的方式。"
    ],
    focus: ["我想等待的是牠，還是那份被陪伴的感覺", "我們的愛已經在我身上留下什麼", "我要怎麼帶著牠給過的愛繼續生活"],
    faqs: [
      ["如果我再養一隻毛孩，是不是背叛牠？", "不是。新的陪伴不會刪除舊的關係，也不需要成為替代品。等你準備好後，再用新的方式認識新的生命。"],
      ["一定要放下，才算完成告別嗎？", "不一定。告別不必等於遺忘。你可以保留牠的位置，同時讓生活重新長出其他連結；思念變得不再刺痛，也是一種繼續同行。"]
    ]
  }
];

const css = `
:root{--gold:#d9bd82;--soft:#d7cfe2;--faint:#968aa7;--line:rgba(217,189,130,.28)}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% 10%,#2b1746 0,#150d2b 42%,#0d091a 100%);color:#f3edf7;font-family:"Noto Serif TC","Microsoft JhengHei",serif;line-height:1.9}a{color:inherit}.wrap{max-width:860px;margin:auto;padding:54px 22px 80px}.brand{text-align:center;color:var(--gold);letter-spacing:.24em;font-size:15px}.hero{text-align:center;padding:38px 20px 44px;border:1px solid var(--line);border-radius:24px;background:linear-gradient(180deg,rgba(48,31,78,.72),rgba(24,16,47,.76));box-shadow:0 25px 80px rgba(0,0,0,.32)}h1{font-size:clamp(29px,6vw,46px);line-height:1.45;margin:14px 0;color:#f2e6c8;font-weight:600}h2{color:var(--gold);font-size:22px;margin:42px 0 12px}p{color:var(--soft);font-size:16px}.lead{max-width:680px;margin:0 auto;color:#ded4e5}.cta{display:inline-block;margin-top:26px;padding:13px 30px;border-radius:999px;text-decoration:none;background:linear-gradient(180deg,#7660a2,#4b3777);border:1px solid rgba(217,189,130,.62);box-shadow:0 0 24px rgba(121,92,170,.35)}.note{font-size:13px;color:var(--faint);margin-top:12px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:20px}.card{display:block;text-decoration:none;border:1px solid var(--line);border-radius:16px;padding:19px;background:rgba(35,24,62,.62);transition:.2s ease}.card:hover{transform:translateY(-2px);border-color:rgba(217,189,130,.55)}.card b{color:#f1e5c8;font-size:16px}.card span{display:block;color:var(--faint);font-size:13px;margin-top:5px}.box{border-left:2px solid var(--gold);padding:5px 0 5px 20px;margin:22px 0;color:var(--soft)}.box li{margin:7px 0}.faq{border-top:1px solid var(--line);padding:18px 0}.faq b{color:#eee2c7}.crumb{font-size:13px;color:var(--faint);margin-bottom:18px}.crumb a{color:var(--faint)}footer{text-align:center;color:var(--faint);font-size:12px;margin-top:56px}.warn{font-size:13px;color:#b8acc2;border:1px solid var(--line);padding:14px 16px;border-radius:12px;margin-top:30px}@media(max-width:650px){.wrap{padding-top:28px}.grid{grid-template-columns:1fr}.hero{padding:30px 16px}p{font-size:15px}}
`;

function esc(value) {
  return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
}

function pageHtml(page) {
  const url = `${baseUrl}/${page.slug}/`;
  const related = pages.filter(item => item.slug !== page.slug).map(item =>
    `<a class="card" href="/pet/passed-away/${item.slug}/"><b>${esc(item.short)}</b><span>閱讀問題說明並開始抽籤</span></a>`
  ).join("");
  const faqJson = page.faqs.map(([name, text]) => ({"@type":"Question",name,"acceptedAnswer":{"@type":"Answer",text}}));
  const schema = JSON.stringify([
    {"@context":"https://schema.org","@type":"WebPage","name":page.title,"description":page.description,"url":url,"isPartOf":{"@type":"WebSite","name":"未完籤所","url":"https://unfinished.tw/"}},
    {"@context":"https://schema.org","@type":"FAQPage","mainEntity":faqJson}
  ]).replace(/</g, "\\u003c");

  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(page.title)}｜免費線上靈籤｜未完籤所</title><meta name="description" content="${esc(page.description)}"><link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:site_name" content="未完籤所 · MAGIC ORACLE"><meta property="og:title" content="${esc(page.title)}"><meta property="og:description" content="${esc(page.description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="https://unfinished.tw/assets/og-cover.jpg"><meta name="twitter:card" content="summary_large_image"><script async src="https://www.googletagmanager.com/gtag/js?id=G-71RMD00WPJ"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-71RMD00WPJ');</script><script type="application/ld+json">${schema}</script><style>${css}</style></head><body><div class="wrap"><div class="crumb"><a href="/">首頁</a> / <a href="/pet/">毛孩</a> / <a href="/pet/passed-away/">離世毛孩心語</a> / ${esc(page.short)}</div><section class="hero"><div class="brand">未 完 籤 所 · MAGIC ORACLE</div><h1>${esc(page.title)}</h1><p class="lead">${esc(page.lead)}</p><a class="cta" href="${drawUrl}">帶著這個問題抽一支籤</a><div class="note">免費 · 不用登入 · 已替你選好「離別中」情境</div></section><h2>你會這樣問，是因為真的很想牠</h2>${page.intro.map(text => `<p>${esc(text)}</p>`).join("")}<h2>抽籤前，可以先想清楚</h2><div class="box"><ul>${page.focus.map(text => `<li>${esc(text)}</li>`).join("")}</ul></div><div class="warn">這裡的毛孩心語屬於象徵性書寫與情緒整理，不代表能證實靈魂、托夢、投胎或離世後訊息。若悲傷已長期影響睡眠、飲食、工作或日常生活，請讓信任的人或專業支持陪你一起承接。</div><h2>常見問題</h2>${page.faqs.map(([question, answer]) => `<div class="faq"><b>${esc(question)}</b><p>${esc(answer)}</p></div>`).join("")}<h2>你也可能想問</h2><div class="grid">${related}</div><footer>✦ 未完籤所 · MAGIC ORACLE ✦<br><a href="/pet/passed-away/">離世毛孩心語</a> · <a href="/">unfinished.tw</a></footer></div></body></html>`;
}

for (const page of pages) {
  const dir = path.join(root, "pet", "passed-away", page.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), pageHtml(page), "utf8");
}

const mainDescription = "毛孩離開後，最難的常常是遺憾與沒有說完的話。從牠現在過得好嗎、是否回來看你、會不會怪你，到托夢、投胎與再次相遇，選一個最想問的問題，免費抽取離世毛孩心語。";
const mainCards = pages.map(page => `<a class="card" href="/pet/passed-away/${page.slug}/"><b>${esc(page.short)}</b><span>先整理問題，再抽一支離別籤</span></a>`).join("");
const mainSchema = JSON.stringify({
  "@context":"https://schema.org",
  "@type":"CollectionPage",
  "name":"離世毛孩心語｜免費線上靈籤",
  "description":mainDescription,
  "url":"https://unfinished.tw/pet/passed-away/",
  "isPartOf":{"@type":"WebSite","name":"未完籤所","url":"https://unfinished.tw/"},
  "hasPart":pages.map(page => ({"@type":"WebPage","name":page.title,"url":`${baseUrl}/${page.slug}/`}))
}).replace(/</g, "\\u003c");
const mainHtml = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>離世毛孩心語｜免費線上靈籤｜未完籤所</title><meta name="description" content="${esc(mainDescription)}"><link rel="canonical" href="https://unfinished.tw/pet/passed-away/"><meta property="og:type" content="website"><meta property="og:site_name" content="未完籤所 · MAGIC ORACLE"><meta property="og:title" content="離世毛孩心語｜免費線上靈籤"><meta property="og:description" content="${esc(mainDescription)}"><meta property="og:url" content="https://unfinished.tw/pet/passed-away/"><meta property="og:image" content="https://unfinished.tw/assets/og-cover.jpg"><meta name="twitter:card" content="summary_large_image"><script async src="https://www.googletagmanager.com/gtag/js?id=G-71RMD00WPJ"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-71RMD00WPJ');</script><script type="application/ld+json">${mainSchema}</script><style>${css}</style></head><body><div class="wrap"><div class="crumb"><a href="/">首頁</a> / <a href="/pet/">毛孩</a> / 離世毛孩心語</div><section class="hero"><div class="brand">未 完 籤 所 · MAGIC ORACLE</div><h1>離世毛孩心語</h1><p class="lead">有些告別發生得太快，快到我們還沒說完想說的話。如果你仍然想念牠、擔心牠，或對那一天留有遺憾，可以先選一個最放不下的問題。</p><a class="cta" href="${drawUrl}">直接抽一支離別籤</a><div class="note">免費 · 不用登入 · 使用「離別中」專屬籤池</div></section><h2>你現在最想問牠什麼？</h2><p>每個問題都會先陪你把牽掛說清楚，再帶你進入同一個「離別中」專屬籤池，不會混入仍在世毛孩的餵食、互動或健康情境。</p><div class="grid">${mainCards}</div><h2>這裡如何陪你整理思念？</h2><p>離別籤不只給一句籤語，也會呈現象徵性的毛孩心語、思念可能出現的方式、靈魂旅程與一個今天可以做到的溫柔行動。</p><p>籤池保留不同可能：牠也許仍停留在熟悉記憶裡、準備展開新的旅程，或以新毛孩、新緣分，甚至未來孩子的意象再次靠近。這些都是象徵性的可能，不是對投胎或靈魂狀態的保證。</p><div class="warn">毛孩心語屬於象徵性書寫與情緒整理，不代表能證實靈魂、托夢、投胎或離世後訊息。若悲傷已長期影響睡眠、飲食、工作或日常生活，請讓信任的人或專業支持陪你一起承接。</div><h2>其他毛孩情境</h2><div class="grid"><a class="card" href="/pet/together/"><b>毛孩陪伴心語</b><span>陪伴、感受與日常互動</span></a><a class="card" href="/pet/worried/"><b>毛孩狀態與擔心</b><span>行為、狀態與照顧提醒</span></a><a class="card" href="/pet/missing/"><b>想念毛孩抽籤</b><span>暫時分開、思念與連結</span></a></div><footer>✦ 未完籤所 · MAGIC ORACLE ✦<br><a href="/">unfinished.tw</a></footer></div></body></html>`;
fs.writeFileSync(path.join(root, "pet", "passed-away", "index.html"), mainHtml, "utf8");

const sitemapPath = path.join(root, "sitemap.xml");
let sitemap = fs.readFileSync(sitemapPath, "utf8");
for (const page of pages) {
  const escapedUrl = `${baseUrl}/${page.slug}/`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  sitemap = sitemap.replace(new RegExp(`\\s*<url><loc>${escapedUrl}<\\/loc>[\\s\\S]*?<\\/url>`, "g"), "");
}
const newUrls = pages
  .map(page => `  <url><loc>${baseUrl}/${page.slug}/</loc><changefreq>monthly</changefreq><priority>0.75</priority></url>`)
  .join("\n");
sitemap = sitemap.replace(/\s*<\/urlset>\s*$/, `\n${newUrls}\n</urlset>\n`);
fs.writeFileSync(sitemapPath, sitemap, "utf8");

console.log(`Generated ${pages.length} departed-pet question pages.`);

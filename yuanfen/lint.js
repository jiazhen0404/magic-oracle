/* =========================================================================
   未完籤所 · 文案模板檢查器
   -------------------------------------------------------------------------
   模板資料庫的問題不是「寫得不夠好」，是三截拼起來之後才會出現的錯誤：
   語意重述、極性衝突、時態撞車、主詞跳動。這些單看陣列全都看不出來。

   這支檢查器把「上下語意一致」拆成六條可以機器驗的規則，
   窮舉所有 open × core × close 組合逐一檢查。

   用法：node lint.js
   ========================================================================= */

const copy = require('./src/copy');
const { fillNames } = require('./src/fill');
const NAMES = { A: '你', B: '他' };   // 用預設稱謂還原，字數與使用者看到的一致
const SCENES = copy.SCENES || ['交往'];

/* ---------- 概念群：語意重複的偵測基礎 ---------- */
/* 字面不同但講同一件事的詞，歸在同一群。這是抓「換句話說」的關鍵。 */
const CONCEPTS = {
  命定:   ['註定', '命定', '先天', '天生', '本來就', '不在盤上', '底子', '既定', '早就約好'],
  未來:   ['接下來', '往後', '之後', '近期', '中段', '會出現', '會有一次', '將會', '再往後'],
  消耗:   ['消耗', '磨掉', '磨損', '耗力', '損耗', '累積', '疲勞', '會累'],
  位置:   ['位置', '話語權', '退讓', '配合的那個', '主導', '定調', '不對等', '對等'],
  給予:   ['在給', '付出', '照顧', '承擔', '接住', '被扶'],
  沉默:   ['不說', '沒說', '沉默', '吞回去', '都可以', '不講', '說不出口'],
  速度:   ['慢慢', '速度', '節奏', '急', '快', '越來越'],
  距離:   ['距離', '疏遠', '變淡', '沒有下文', '失聯', '斷'],
  重複:   ['反覆', '又回來', '再發生', '循環', '每隔一段時間'],
  選擇:   ['選擇', '決定', '主動權', '取決於'],
};

/* ---------- 各軸專屬詞彙（R7 用）----------
   只列該軸專屬、其他軸不該碰的字。字表刻意收得緊：
   「越接觸越」是溫度在講合不合、「先開口」是重量在講力氣對等，
   兩者都被誤判過，所以不列入。寧可漏抓，不要製造假陽性——
   規則一旦開始亂叫，下一步就是被忽略。 */
const AXIS_WORDS = {
  節奏:   ['一見', '燒起來', '見面就', '一拍即合', '轟轟烈烈', '忽冷忽熱',
           '似曾相識', '日久', '慢慢熟', '怎麼開始', '一開始就強烈'],
  主動方: ['先動心', '先出手', '誰先主動'],
  機會:   ['走到一起的機會', '成的機會', '機會偏低', '機會很高', '翻盤'],
};

/* ---------- 句式偵測 ---------- */
const PAT = {
  judge:   /(你們是|你們的|他是|他在這段|這段關係裡|這段緣的?[^，。]{0,4}是|主要在給)/,  // 下判斷
  predict: /(接下來|往後|之後會|近期|會出現|會有一次|會再|將)/,                        // 給預測
  advise:  /(可以|建議|不如|不要|記得|試著|從.{0,6}開始)/,                             // 給建議
  warn:    /(小心|注意|留意|危險|最怕|風險)/,                                          // 提醒
  frame:   /(先講|先說|接下來這段|請你|誠實講|有件事|有一種|有些)/,                     // 框架句
  posTone: /(難得|幸運|好消息|放心|優勢|本錢|幫忙|站在你們)/,                           // 正面語氣
  negTone: /(刺|直白|心裡有數|留意|難走|現實|防備|讀慢)/,                              // 負面語氣
};

function conceptsOf(text) {
  const hit = new Set();
  for (const [name, words] of Object.entries(CONCEPTS))
    if (words.some(w => text.includes(w))) hit.add(name);
  return hit;
}
const inter = (a, b) => [...a].filter(x => b.has(x));

/* ---------- 六條規則 ---------- */

const RULES = [
  {
    id: 'R1', name: '開場句不得下判斷',
    why: '開場句的職責是建立語氣。一旦它先講了結論，core 就變成重述。',
    check: ({ open, core }) => open && PAT.judge.test(open)
      ? '開場句出現判斷句式' : null
  },
  {
    id: 'R2', name: '開場句與 core 不得語意重述',
    why: '這是「答案不在盤上／沒有先天長度／沒有註定」那種三句同義的成因。',
    check: ({ open, core }) => {
      if (!open) return null;
      const shared = inter(conceptsOf(open), conceptsOf(core));
      return shared.length ? '共用概念「' + shared.join('、') + '」' : null;
    }
  },
  {
    id: 'R3', name: 'close 不得重述 core',
    why: 'close 的職責是往前推一步，不是把 core 換句話說再講一次。',
    check: ({ core, close }) => {
      const shared = inter(conceptsOf(core), conceptsOf(close));
      // 位置／給予這類主題本來就會延續，只擋三個以上的重疊
      return shared.length >= 3 ? '共用概念「' + shared.join('、') + '」' : null;
    }
  },
  {
    id: 'R4', name: '一段之內最多一個未來預測',
    why: '免費層給趨勢不給事件；core 與 close 都預測會讓時間軸失焦。',
    check: ({ core, close }) => PAT.predict.test(core) && PAT.predict.test(close)
      ? 'core 與 close 都出現未來句' : null
  },
  {
    id: 'R5', name: '語氣極性不得衝突',
    why: '「先講好消息」接一個負面判斷，讀起來像兩個人寫的。',
    check: ({ open, core, close }) => {
      if (!open) return null;
      const openPos = PAT.posTone.test(open), openNeg = PAT.negTone.test(open);
      // 先移除被否定的子句，否則「不會累積成問題」會被當成負面
      const body = (core + close).replace(/(不會|不再|不是|並非|沒有|不容易|不至於)[^，。；]{0,10}/g, '');
      const bodyNeg = /(不對等|消耗|退讓|越來越小|磨|受不了|吵|僵住|走散|爆|拉扯|很硬|累|沒被看見|吞回去)/.test(body);
      const bodyPos = /(難得|很順|默契|信任|禁得起|放心|厚)/.test(body);   // 「舒服」在本產品常指對方舒服＝使用者累，不列入
      if (openPos && bodyNeg && !bodyPos) return '開場正面，內文負面';
      if (openNeg && bodyPos && !bodyNeg) return '開場負面，內文正面';
      return null;
    }
  },
  {
    id: 'R7', name: 'core 不得對其他軸下斷言',
    why: '每個軸只負責自己那件事。分數帶講份量、節奏講怎麼開始的——'
       + '兩邊各寫一句就會撞：這條規則剛寫出來時，8.8% 的盤會讀到'
       + '「一見傾心」配上「你們不是一見面就燒起來的那種」，相鄰兩段直接打架。'
       + '緣暖改成只講份量之後降到 0，這條就轉成會擋下建置的規則，守住它。',
    /* 只管 core。core 是「分數的文字化」，是固定的判斷句，本來就該只講自己那一軸；
       open／close 是包裝與建議，提到別的軸通常是對比或延伸，硬擋會誤傷——
       實例：緣暖的 close「不用羨慕那些一見鍾情的人」講的是別人，不是這一對。 */
    check: ({ core }) => {
      for (const [axis, words] of Object.entries(AXIS_WORDS))
        for (const w of words)
          if (core.includes(w)) return 'core 講到【' + axis + '】的「' + w + '」';
      return null;
    }
  },
  {
    id: 'R6', name: '字面重複（6 字以上）',
    why: '最基本的一條，但只能抓字面，抓不到換句話說。',
    check: ({ open, core, close }) => {
      const grams = t => {
        const a = [...t.replace(/[，。；：—「」（）]/g, '')];
        const g = new Set();
        for (let i = 0; i + 6 <= a.length; i++) g.add(a.slice(i, i + 6).join(''));
        return g;
      };
      const parts = [open, core, close].filter(Boolean);
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const A = grams(parts[i]), B = grams(parts[j]);
          for (const g of A) if (B.has(g)) return '重複片語「' + g + '」';
        }
      return null;
    }
  },
];

/* ---------- 窮舉檢查 ---------- */

function lint() {
  const blocks = [
    ['緣的溫度', copy.WENDU],
    ['緣的重量', copy.ZHONGLIANG],
    ['緣的長度', copy.CHANGDU],
  ];
  let combos = 0;
  const found = [];

  for (const [dim, obj] of blocks)
    for (const [key, v] of Object.entries(obj))
      for (const scene of SCENES)
      for (const open of v.open)
        for (const close of v.close) {
          combos++;
          /* 檢查使用者實際讀到的字，不是含佔位符的樣板。
             {B} 是三個字元，不還原的話「{B}的退讓」會被 6-gram 判成重複，
             但使用者看到的是「他的退讓」，只有四個字，根本不會觸發。
             規則的門檻是照人眼訂的，就要餵給它人眼看到的東西。 */
          const ctx = fillNames({ open, core: copy.coreOf(v, scene), close }, NAMES);
          for (const r of RULES) {
            const msg = r.check(ctx);
            if (msg) found.push({ rule: r.id, dim, key, open, msg });
          }
        }

  // 總分帶（poems 相當於 open，但它是籤語，不套 R1／R2）
  for (const b of copy.TOTAL_BANDS)
    for (const close of b.close) {
      combos++;
      const ctx = fillNames({ open: '', core: b.core, close }, NAMES);
      for (const r of RULES) {
        if (r.id === 'R1' || r.id === 'R2') continue;
        const msg = r.check(ctx);
        if (msg) found.push({ rule: r.id, dim: '總分帶', key: b.label, open: '', msg });
      }
    }

  console.log('檢查組合數：' + combos);
  const WARN = new Set(RULES.filter(r => r.warn).map(r => r.id));
  const fails = found.filter(f => !WARN.has(f.rule));
  const warns = found.filter(f => WARN.has(f.rule));
  if (!found.length) { console.log('全部通過 ✓'); return 0; }

  const byRule = {};
  found.forEach(f => (byRule[f.rule] = byRule[f.rule] || []).push(f));
  for (const r of RULES) {
    const list = byRule[r.id];
    if (!list) continue;
    console.log('\n【' + r.id + '】' + r.name + '　' + list.length + ' 處');
    console.log('  ' + r.why);
    const seen = new Set();
    for (const f of list) {
      const sig = f.dim + f.key + f.msg;
      if (seen.has(sig)) continue;
      seen.add(sig);
      console.log('  · ' + f.dim + '/' + f.key + '　' + f.msg
                  + (f.open ? '　開場「' + f.open + '」' : ''));
    }
  }
  /* 失敗與警告分開講，而且只有失敗會讓離開碼變成 1。
     警告是「已知、已交出規格、正在處理」的問題；混在一起會讓整支檢查
     長期是紅的，久了就沒有人看——那比沒有檢查更糟。 */
  const uniq = a => new Set(a.map(f => f.rule + f.dim + f.key + f.msg)).size;
  console.log('');
  if (fails.length) console.log('✗ 失敗 ' + fails.length + ' 處（去重後 ' + uniq(fails) + ' 類）');
  else console.log('失敗 0 處 ✓');
  if (warns.length) {
    console.log('△ 警告 ' + warns.length + ' 處（去重後 ' + uniq(warns) + ' 類）'
                + '——已知問題，改寫規格見 docs/COPY-FIX-BAND-WARM.md');
  }
  return fails.length;
}

if (require.main === module) process.exitCode = lint() ? 1 : 0;
module.exports = { lint, RULES, CONCEPTS, PAT };

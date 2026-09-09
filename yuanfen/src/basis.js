/* =========================================================================
   未完籤所 · 緣分指數 —— 算式揭露
   -------------------------------------------------------------------------
   把內部的判定 key 翻成使用者看得懂的依據，並解釋總分怎麼來的。
   目的不是教命理，是讓分數看起來有來歷，而不是隨機數。
   ========================================================================= */

const { GAN, ZHI, WEIGHTS } = require('./yuanfen');

const ZHI_LABEL = {
  liuhe:    { name: '六合', gloss: '天生合得來' },
  sanhe:    { name: '三合', gloss: '越處越順' },
  same:     { name: '同支', gloss: '同一種人' },
  ping:     { name: '無刑衝合', gloss: '不特別順也不特別卡' },
  zixing:   { name: '自刑', gloss: '同一個毛病' },
  liuhai:   { name: '六害', gloss: '暗中消耗' },
  xing:     { name: '相刑', gloss: '容易互相刺到' },
  liuchong: { name: '六沖', gloss: '相反的兩種人' }
};

const WX_LABEL = {
  bihe:      '比和',
  a_sheng_b: '生',
  b_sheng_a: '生',
  a_ke_b:    '剋',
  b_ke_a:    '剋'
};

/* 把五行關係寫成有方向的一句話 */
function wxPhrase(rel, wa, wb, names) {
  if (rel === 'bihe') return `同為${wa}，比和`;
  if (rel === 'a_sheng_b') return `${names.A}的${wa} 生 ${names.B}的${wb}`;
  if (rel === 'b_sheng_a') return `${names.B}的${wb} 生 ${names.A}的${wa}`;
  if (rel === 'a_ke_b')    return `${names.A}的${wa} 剋 ${names.B}的${wb}`;
  return `${names.B}的${wb} 剋 ${names.A}的${wa}`;
}

/**
 * @param result  yuanfen() 的輸出（需含 debug 與 dimensions）
 */
function basis(result, names = { A: '你', B: '對方' }) {
  const d = result.dimensions;
  const A = result.debug.A, B = result.debug.B;

  const wz = ZHI_LABEL[d.wendu.key];
  const cz = ZHI_LABEL[d.changdu.key];

  const nayinRel = { sheng: '相生', bihe: '同源', ke: '相剋' }[d.changdu.nayinKey];

  const rows = [
    { name: '緣的溫度', score: d.wendu.score, weight: WEIGHTS.wendu,
      source: `日支　${A.day[1]} × ${B.day[1]}`,
      verdict: `${wz.name}｜${wz.gloss}` },
    { name: '緣的重量', score: d.zhongliang.score, weight: WEIGHTS.zhongliang,
      source: `日干　${A.day[0]} × ${B.day[0]}`,
      verdict: `${wxPhrase(d.zhongliang.key, d.zhongliang.wa, d.zhongliang.wb, names)}${d.zhongliang.yinyang ? '，陰陽相配' : '，同陰陽'}` },
    { name: '緣的長度', score: d.changdu.score, weight: WEIGHTS.changdu,
      source: `年支　${A.year[1]} × ${B.year[1]}　／　納音　${A.nayin} × ${B.nayin}`,
      verdict: `${cz.name}｜納音${nayinRel}` }
  ];

  return { rows, total: result.total };
}

/* ---------- 落差偵測 ---------- */

const GAP_THRESHOLD = 22;

function gapNote(result, names = { A: '你', B: '對方' }) {
  const d = result.dimensions;
  const arr = [
    { key: 'wendu', label: '相處', score: d.wendu.score },
    { key: 'zhongliang', label: '位置', score: d.zhongliang.score },
    { key: 'changdu', label: '走向', score: d.changdu.score }
  ].sort((a, b) => b.score - a.score);

  const hi = arr[0], lo = arr[2];
  if (hi.score - lo.score < GAP_THRESHOLD) return null;

  const TEXT = {
    'wendu>zhongliang': '你們相處是好的——問題不在合不合，在位置不平等。這種組合最容易拖，因為日子過得下去，所以不會有人先提。',
    'wendu>changdu':    '你們現在很好，但這段關係沒有先天的長度。好好相處不等於會一直在一起，這件事得靠後續刻意去做。',
    'zhongliang>wendu': '你們的位置是對等的，卡在日常。不是誰欺負誰，是相處的細節一直磨；這種問題可以解，因為它不涉及誰要退讓。',
    'zhongliang>changdu':'你們相處得公平，但走向不穩。彼此都沒有虧欠對方，只是人生節奏容易錯開。',
    'changdu>wendu':    '這段緣的底子比你們現在的相處好。眼前的摩擦不代表這段關係的本質，別因為近期的不順就下結論。',
    'changdu>zhongliang':'這段緣走得長，但走得不平。可以一直在一起，代價是有人要一直讓——先想清楚那個人是誰。'
  };

  return TEXT[`${hi.key}>${lo.key}`] || null;
}

/* ---------- 純文字排版（給頁面或分享卡用） ---------- */

function renderBasis(result, names) {
  const b = basis(result, names);
  const lines = b.rows.map(r =>
    `${r.name}　${String(r.score).padStart(2)}　×${Math.round(r.weight * 100)}%\n` +
    `　依據：${r.source}\n` +
    `　判定：${r.verdict}`
  );
  const calc = b.rows.map(r => `${r.score}×${Math.round(r.weight * 100)}%`).join(' ＋ ');
  return lines.join('\n\n') + `\n\n總分　${calc} ＝ ${b.total}`;
}

module.exports = { basis, gapNote, renderBasis, ZHI_LABEL, GAP_THRESHOLD };

/* =========================================================================
   未完籤所 · 緣分指數 —— 分享卡繪製（瀏覽器 canvas）
   -------------------------------------------------------------------------
   在使用者裝置上畫，中文字型才吃得到。座標沿用花框實測值。
   花框素材需放在 assets/medallion.png（透明背景 1145×1374）。
   ========================================================================= */

const CARD_FONT = {
  serif: '"Cactus Classical Serif","Noto Serif TC",serif',   // 數字・等級名・籤語
  sans:  '"Noto Sans TC",sans-serif',                        // 小標・維度名
  latin: 'Lato,sans-serif'                                   // unfinished.tw
};

const CARD = {
  W: 1080, H: 1350,
  BG: '#100b25', GOLD: '#d9bd82', GOLDS: '#f1e5c8',
  CREAM: '#f4ecd6', MUTED: '#a89ab8', INK: '#5e3e2e',
  ASSET: 'assets/medallion.webp',
  MED_W: 790,          // 花框繪製寬度
  MED_Y: 8,            // 花框上緣
  SRC_W: 1145, SRC_H: 1374,
  DISC_X: 575, DISC_Y: 646   // 圓盤中心（原圖座標）
};

let _medallion = null;
function loadMedallion() {
  if (_medallion) return Promise.resolve(_medallion);
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { _medallion = img; res(img); };
    img.onerror = () => rej(new Error('花框素材載不到：' + CARD.ASSET));
    img.src = CARD.ASSET;
  });
}

function centred(ctx, text, y, size, colour, tracking, face) {
  ctx.font = size + 'px ' + (face || CARD_FONT.serif);
  ctx.fillStyle = colour;
  ctx.textBaseline = 'top';
  const cx = CARD.W / 2;
  if (tracking) {
    const chars = [...text];
    const widths = chars.map(c => ctx.measureText(c).width);
    const span = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1);
    let x = cx - span / 2;
    chars.forEach((c, i) => { ctx.fillText(c, x, y); x += widths[i] + tracking; });
  } else {
    ctx.textAlign = 'center';
    ctx.fillText(text, cx, y);
    ctx.textAlign = 'left';
  }
  return size;
}

function atX(ctx, text, cx, y, size, colour, face) {
  ctx.font = size + 'px ' + (face || CARD_FONT.serif);
  ctx.fillStyle = colour;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, y);
  ctx.textAlign = 'left';
  return size;
}

/**
 * @param canvas   目標 canvas
 * @param data     { total, headline, poem:[l1,l2], dims:[{name,score}×3] }
 */
async function drawCard(canvas, data) {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;   // 舊瀏覽器沒有 FontFaceSet
  const img = await loadMedallion();
  const ctx = canvas.getContext('2d');
  canvas.width = CARD.W; canvas.height = CARD.H;

  ctx.fillStyle = CARD.BG;
  ctx.fillRect(0, 0, CARD.W, CARD.H);

  const sc = CARD.MED_W / CARD.SRC_W;
  const mh = CARD.SRC_H * sc;
  const mx = (CARD.W - CARD.MED_W) / 2;
  ctx.drawImage(img, mx, CARD.MED_Y, CARD.MED_W, mh);

  // 盤心：數字
  const dcx = mx + CARD.DISC_X * sc;
  const dcy = CARD.MED_Y + CARD.DISC_Y * sc;
  atX(ctx, String(data.total), dcx, dcy - 84, 176, CARD.INK);

  // 盤外
  let y = CARD.MED_Y + mh - 58;
  y += centred(ctx, '緣分指數 ' + data.total, y, 28, CARD.MUTED, 6, CARD_FONT.sans) + 26;
  y += centred(ctx, data.headline, y, 44, CARD.GOLDS, 6) + 12;
  if (data.tempo) y += centred(ctx, data.tempo, y, 26, CARD.GOLD, 10, CARD_FONT.sans) + 26;
  y += centred(ctx, data.poem[0], y, 36, CARD.CREAM, 0) + 16;
  y += centred(ctx, data.poem[1], y, 36, CARD.CREAM, 0) + 40;

  // 分隔線 + 三個子分數
  ctx.strokeStyle = 'rgba(217,189,130,.28)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(CARD.W * 0.16, y - 14); ctx.lineTo(CARD.W * 0.84, y - 14); ctx.stroke();
  const cols = [CARD.W * 0.24, CARD.W * 0.5, CARD.W * 0.76];
  data.dims.forEach((d, i) => {
    atX(ctx, d.name, cols[i], y + 6, 25, CARD.MUTED, CARD_FONT.sans);
    atX(ctx, String(d.score), cols[i], y + 44, 40, CARD.GOLD);
  });
  y += 112;
  centred(ctx, 'unfinished.tw', y, 22, CARD.MUTED, 6, CARD_FONT.latin);

  return canvas;
}

/* 由 result 取出卡片需要的資料（籤語以生日為種子，與頁面同源） */
function cardData(result, birth) {
  const b = band(result.total);
  const seed = seedOf(birth.a, birth.b);
  const poems = CARD_POEMS[b.label];
  const h = (seed ^ Math.imul(11, 2654435761)) >>> 0;   // 括號不可少：% 的優先序高於 >>>
  const lines = poems[h % poems.length];
  return {
    total: result.total,
    headline: b.label + ' · ' + b.title,
    tempo: tempo(result.dimensions).name,
    poem: lines,
    dims: [result.dimensions.wendu, result.dimensions.zhongliang, result.dimensions.changdu]
            .map(d => ({ name: d.name, score: d.score }))
  };
}

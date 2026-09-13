/* 用校稿站的匯出檔重建付費延伸籤 src/extended-love.json。

   ★ 這是付費內容，不能放到 data/*.json 或任何靜態檔案。
     它會被打包進 Worker，外面下載不到——src/index.js 的檔頭已經寫明這一點。
     /api/extended-outline 只吐 sections[].title 給沒付款的人看，
     paragraphs 只能由 /api/extended 憑解鎖憑證回傳。

   ★ id 怎麼算

     前台（index.html 的 EXT_SLUG）用「情境 → slug」＋「籤號補三位」組出 slipId，
     後端用同一個 id 去 EXTENDED 找。這裡照抄同一份對照表，三邊必須一致。

   ★ 結構轉換

     校稿站　extended_html
       <div class="ext-meta">…</div>            ← 結局／籤詩的小標，不進 sections
       <div class="sec"><h5>標題</h5><p>…</p></div>
     正式站　sections: [{ title, paragraphs: [...] }]

   用法：
     node scripts/build-extended.js <校稿站匯出的.json>            試跑
     node scripts/build-extended.js <校稿站匯出的.json> --write     實際寫入
*/
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'src', 'extended-love.json');
const EXT_SLUG = { '失戀中': 'breakup', '曖昧中': 'flirting', '關係中': 'relationship', '單身中': 'single', '桃花運勢': 'fortune' };

const file = process.argv[2];
const WRITE = process.argv.includes('--write');
if (!file) { console.error('用法：node scripts/build-extended.js <匯出的.json> [--write]'); process.exit(1); }

const strip = s => String(s || '').replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/* 把 extended_html 拆成 [{title, paragraphs}]。ext-meta 那兩塊是欄位標籤，不是內文。 */
function parseSections(html) {
  const out = [];
  const re = /<div class="sec">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const block = m[1];
    const title = strip((block.match(/<h5>([\s\S]*?)<\/h5>/) || [, ''])[1]);
    const paragraphs = [...block.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(p => strip(p[1])).filter(Boolean);
    if (title && paragraphs.length) out.push({ title, paragraphs });
  }
  return out;
}

const rows = (() => { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return d.fortunes || d; })();
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
const prevById = new Map(prev.map(x => [x.id, x]));

const built = [];
const skipped = [];
for (const r of rows) {
  const slug = EXT_SLUG[r.situation];
  if (!slug || r.category !== '愛情') continue;
  if (!Number(r.has_extended)) { skipped.push(`${r.id} 沒有延伸籤`); continue; }
  if (Number(r.archived) === 1) { skipped.push(`${r.id} 已封存`); continue; }
  const sections = parseSections(r.extended_html || '');
  if (!sections.length) { skipped.push(`${r.id} 解析不出段落`); continue; }
  const id = `love_${slug}_${String(r.display_number).padStart(3, '0')}`;
  const old = prevById.get(id);
  built.push({
    id,
    situation: r.situation,
    name: strip(r.title_html),
    outcome: strip(r.outcome) || (old ? old.outcome : ''),
    outcomeDetail: old ? old.outcomeDetail : '',
    poem: strip(r.poem_html),
    sections,
  });
}

built.sort((a, b) => a.id.localeCompare(b.id));

const chars = x => x.sections.reduce((n, s) => n + s.paragraphs.join('').length, 0);
console.log(`校稿站愛情延伸籤 → ${built.length} 支（原本 ${prev.length} 支）`);
if (skipped.length) { console.log(`  跳過 ${skipped.length}：`); skipped.slice(0, 5).forEach(s => console.log('    ' + s)); }

const gone = prev.filter(x => !built.some(b => b.id === x.id));
const added = built.filter(x => !prevById.has(x.id));
if (gone.length) console.log(`  ⚠ 原本有、這次沒有的 ${gone.length} 支：${gone.slice(0, 5).map(x => x.id).join('、')}`);
if (added.length) console.log(`  ＋ 新增 ${added.length} 支：${added.slice(0, 5).map(x => x.id).join('、')}`);

let shorter = 0;
for (const b of built) {
  const old = prevById.get(b.id);
  if (old && chars(b) < chars(old) * 0.6) {
    shorter++;
    if (shorter <= 5) console.log(`  ⚠ ${b.id} 字數 ${chars(old)} → ${chars(b)}`);
  }
}
if (shorter) console.log(`  ⚠ 共 ${shorter} 支的內容少於原本的六成，確認是不是漏抓段落`);

const nums = built.map(chars);
console.log(`  章節 ${Math.min(...built.map(b => b.sections.length))}-${Math.max(...built.map(b => b.sections.length))} 段，字數 ${Math.min(...nums)}-${Math.max(...nums)}`);

if (!WRITE) { console.log('\n（試跑，沒有寫檔。確認後加 --write）'); process.exit(0); }
if (built.length < prev.length) { console.error('\n✗ 數量比原本少，先查清楚再寫入'); process.exit(1); }
fs.writeFileSync(OUT, JSON.stringify(built, null, 2) + '\n');
console.log('\nsrc/extended-love.json 已重建。記得 Worker 要重新部署才會生效。');

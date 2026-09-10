/* =========================================================================
   未完籤所 · docx → 純文字（保留標題階層）
   -------------------------------------------------------------------------
   工具二與工具三都要吃 docx 的內容，所以先把抽取獨立出來。
   只讀 word/document.xml，不處理圖片與表格樣式——這批稿件是純文字結構。

   標題階層很重要：施工單 2-2 說每份 docx 都有 11–14 個 H1，
   直接轉檔就是 11 個 H1 的頁面，是本批最傷 SEO 的一項。
   所以這裡要把 Heading1/2/3 標出來，讓後面的工具看得到。

   用法：node scripts/docx-text.js <檔案.docx> [--json]
   ========================================================================= */

const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');
const path = require('path');

function documentXml(file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-'));
  try {
    execSync('unzip -o -q "' + file + '" word/document.xml -d "' + tmp + '"');
    return fs.readFileSync(path.join(tmp, 'word', 'document.xml'), 'utf8');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                       .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
                       .replace(/&amp;/g, '&');

/* 回傳 [{ level, text, bold }]，level 0 = 內文 */
function parse(xml) {
  const out = [];
  for (const m of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const p = m[1];

    /* 標題階層：優先看 pStyle，其次看 outlineLvl */
    let level = 0;
    const style = (p.match(/<w:pStyle w:val="([^"]*)"/) || [])[1] || '';
    const hs = style.match(/^(?:Heading|heading)(\d)$/) || style.match(/^標題(\d)$/);
    if (hs) level = +hs[1];
    else {
      const ol = (p.match(/<w:outlineLvl w:val="(\d)"/) || [])[1];
      if (ol !== undefined) level = +ol + 1;
    }

    /* 文字：把所有 w:t 串起來，w:tab 當空白 */
    let text = '';
    for (const t of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>/g)) {
      text += t[1] !== undefined ? unescape(t[1]) : '\t';
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    /* 整段是否為粗體（docx 的副標常靠粗體，不靠樣式） */
    const runs = [...p.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)].map(r => r[0]);
    const bold = runs.length > 0 && runs.every(r => /<w:b\/>|<w:b\s/.test(r));

    out.push({ level, text, bold });
  }
  return out;
}

function toMarkdown(blocks) {
  return blocks.map(b => b.level ? '#'.repeat(b.level) + ' ' + b.text
                                 : (b.bold ? '**' + b.text + '**' : b.text)).join('\n\n');
}

module.exports = { documentXml, parse, toMarkdown };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('用法：node scripts/docx-text.js <檔案.docx> [--json]'); process.exit(1); }
  const blocks = parse(documentXml(file));
  if (process.argv.includes('--json')) console.log(JSON.stringify(blocks, null, 1));
  else console.log(toMarkdown(blocks));
}

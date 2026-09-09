const fs = require('fs');
const path = require('path');

/* 把 src/ 的 CommonJS 模組併成一份可直接內嵌的腳本，再注回 index.html */

const SRC = 'src';
const ORDER = [
  'yuanfen.js', 'flavour.js', 'tempo.js', 'copy.js', 'basis.js', 'events.js',
  'other-position.js', 'other-appearance.js', 'other-attitude.js',
  'dont.js', 'shape.js', 'self-values.js', 'takeaway.js', 'report.js',
  'card-text.js', 'card-render.js'
];

function strip(file) {
  return fs.readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^const (?:\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\([^)]*\);?\s*$/gm, '')
    .replace(/^module\.exports\s*=[\s\S]*?;\s*$/gm, '')
    .trim();
}

const bundle = ORDER.map(strip).join('\n\n/* ───────────────────────── */\n\n');
fs.writeFileSync('engine.bundle.js', bundle);

const html = fs.readFileSync('index.html', 'utf8');
const i = html.indexOf('<script>') + 8;
const j = html.indexOf('/* ───────────────────────── 介面 ─────────────────────────');
if (i < 8 || j < 0) { console.error('找不到注入點，index.html 結構被改過'); process.exit(1); }
const out = html.slice(0, i) + '\n' + bundle + '\n\n' + html.slice(j);
fs.writeFileSync('index.html', out);

if (out.includes('require(')) { console.error('注入後仍殘留 require()'); process.exit(1); }
console.log('bundle', bundle.length, 'bytes → index.html 已更新');

/* 全域識別名衝突檢查：bundle 會把所有模組併到同一個作用域 */
const fs = require('fs'), path = require('path');
const SRC = 'src';
const seen = {}, dup = [];
for (const f of fs.readdirSync(SRC)) {
  if (!f.endsWith('.js')) continue;
  const t = fs.readFileSync(path.join(SRC, f), 'utf8');
  const names = new Set();
  for (const m of t.matchAll(/^(?:const|let|var|function|async function)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (/^\s*const\s*\{/.test(m[0])) continue;
    names.add(m[1]);
  }
  for (const n of names) {
    if (seen[n] && seen[n] !== f) dup.push(`${n}　${seen[n]} × ${f}`);
    else seen[n] = f;
  }
}
if (dup.length) { console.log('✗ 全域名稱衝突：'); dup.forEach(d => console.log('  ' + d)); process.exit(1); }
console.log('全域名稱無衝突 ✓（' + Object.keys(seen).length + ' 個識別名）');

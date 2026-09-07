#!/usr/bin/env node
/*
  發布檢查：線上跑的，是不是你最後推的那一版？

    npm run check:release

  這支腳本存在的原因：Cloudflare 這個專案是「手動接管流量」模式。
  建置成功不等於上線——要去 Deployments 手動推。忘了推的話，
  GitHub 上是新的、線上還是舊的，而且完全沒有錯誤訊息。

  2026-09-06 晚上改了問卷題目，資料到隔天 08:22 才進來，
  中間 8 筆回覆的新題目是空的，就是踩到這個坑。

  判斷方式：比對 /api/health 回報的部署時間與本機最新 commit 的時間。
  線上版本比最新 commit 舊 → 沒推上線。
*/

import { execSync } from 'node:child_process';

const SITE = process.env.SITE_URL || 'https://unfinished.tw';
const SLACK = 90; // 秒。建置本身要時間，容許一點誤差

const git = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const ok = (msg) => console.log('\x1b[32m✓\x1b[0m ' + msg);

// 用丟例外結束，不用 process.exit()。fetch 的連線還開著時直接 exit，
// Windows 的 Node 會拋 libuv 斷言，畫面上會多一行看起來像壞掉的錯誤。
class Fail extends Error {}
const fail = (msg) => { throw new Fail(msg); };

try {
  await main();
} catch (e) {
  if (e instanceof Fail) { console.error('\n\x1b[31m✗ ' + e.message + '\x1b[0m'); process.exitCode = 1; }
  else { console.error('\n\x1b[31m✗ 檢查時發生非預期錯誤：' + (e && e.message) + '\x1b[0m'); process.exitCode = 1; }
}

async function main() {

const sha = git('git rev-parse --short HEAD');
const subject = git('git log -1 --pretty=%s');
const commitAt = new Date(git('git log -1 --pretty=%cI'));

console.log(`本機最新 commit　${sha}　${subject}`);
console.log(`　　　　提交時間　${commitAt.toLocaleString('zh-TW')}`);

// 推了沒
let unpushed = '';
try { unpushed = git('git log --oneline @{u}..HEAD'); } catch { /* 沒有上游分支 */ }
if (unpushed) {
  fail('這些 commit 還沒 push，Cloudflare 根本還沒收到：\n  ' + unpushed.split('\n').join('\n  '));
}
ok('已 push 到遠端');

const res = await fetch(`${SITE}/api/health?t=${Date.now()}`, { cache: 'no-store' })
  .catch(() => fail(`連不上 ${SITE}/api/health`));
if (!res.ok) fail(`/api/health 回 ${res.status}`);

const h = await res.json();

if (!h.deployedAt) {
  fail(
    '線上版本沒有回報部署時間。\n' +
    '  代表線上跑的還是「加上 version_metadata 之前」的舊版，\n' +
    '  請先到 Cloudflare → Workers & Pages → magic-oracle → Deployments，\n' +
    '  把最上面有 main 標記那筆推上線，再跑一次這支腳本。'
  );
}

const deployedAt = new Date(h.deployedAt);
console.log(`線上版本　　　　${(h.versionId || '').slice(0, 8)}`);
console.log(`　　　　部署時間　${deployedAt.toLocaleString('zh-TW')}`);

const lagSec = Math.round((commitAt - deployedAt) / 1000);

if (lagSec > SLACK) {
  const mins = Math.round(lagSec / 60);
  fail(
    `線上版本比最新 commit 舊 ${mins} 分鐘 —— 建置完成但沒推上線。\n\n` +
    '  請到 Cloudflare → Workers & Pages → magic-oracle → Deployments，\n' +
    '  把最上面「有 main 標記」那一筆推上線，然後再跑一次這支腳本。\n\n' +
    '  （建置本身要 1–3 分鐘，如果你才剛推，等一下再試。）'
  );
}

ok('線上跑的就是最新 commit');
console.log(`\n順帶回報：綠界 ${h.mode}・延伸籤 ${h.extendedCount} 支・KV ${h.hasKv ? '正常' : '未設定'}`);
}

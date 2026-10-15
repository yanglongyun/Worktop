#!/usr/bin/env node
// 手工签发 / 管理 key。走 wrangler d1 execute,不开管理接口。
//   node scripts/key.mjs new <owner> [--total 5000000] [--daily 500000] [--note "..."]
//   node scripts/key.mjs list
//   node scripts/key.mjs off <id>      停用
//   node scripts/key.mjs on  <id>      启用
//   node scripts/key.mjs top <id> <n>  总额度加 n
// 明文 key 只在 new 的时候打印一次,库里只有哈希。
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name, def) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : def; };
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const d1 = (sql) => {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'gateway', '--remote', '--json', '--command', sql], { encoding: 'utf8', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID } });
  return JSON.parse(out)[0]?.results ?? [];
};

if (cmd === 'new') {
  const owner = rest.find((a) => !a.startsWith('--')) || '';
  if (!owner) { console.error('要写发给谁:node scripts/key.mjs new <owner>'); process.exit(1); }
  const secret = randomBytes(24).toString('base64url');
  const id = 'wk_' + secret.slice(0, 8);
  const token = `wk_${secret}`;
  const hash = createHash('sha256').update(token).digest('hex');
  d1(`INSERT INTO keys (id, token_hash, owner, note, total_budget, daily_budget) VALUES (${q(id)}, ${q(hash)}, ${q(owner)}, ${q(opt('note', ''))}, ${Number(opt('total', 5_000_000))}, ${Number(opt('daily', 500_000))})`);
  console.log(`发给 ${owner} 的 key(只显示这一次):\n\n  ${token}\n\n  id ${id} · 总额度 ${Number(opt('total', 5_000_000)).toLocaleString()} · 每日 ${Number(opt('daily', 500_000)).toLocaleString()} token`);
} else if (cmd === 'list') {
  const rows = d1('SELECT id, owner, enabled, used_total, total_budget, used_today, today, daily_budget, last_used_at FROM keys ORDER BY created_at');
  for (const r of rows) console.log(`${r.enabled ? '●' : '○'} ${r.id}  ${r.owner.padEnd(12)} 总 ${r.used_total.toLocaleString()}/${r.total_budget.toLocaleString()}  今日 ${r.today === new Date().toISOString().slice(0, 10) ? r.used_today : 0}/${r.daily_budget.toLocaleString()}  最近 ${r.last_used_at ?? '-'}`);
  if (!rows.length) console.log('(还没有 key)');
} else if (cmd === 'off' || cmd === 'on') {
  d1(`UPDATE keys SET enabled = ${cmd === 'on' ? 1 : 0} WHERE id = ${q(rest[0])}`); console.log(`${rest[0]} 已${cmd === 'on' ? '启用' : '停用'}`);
} else if (cmd === 'top') {
  d1(`UPDATE keys SET total_budget = total_budget + ${Number(rest[1])} WHERE id = ${q(rest[0])}`); console.log(`${rest[0]} 总额度 +${Number(rest[1]).toLocaleString()}`);
} else {
  console.log('用法:new <owner> [--total n] [--daily n] [--note s] | list | off <id> | on <id> | top <id> <n>');
}

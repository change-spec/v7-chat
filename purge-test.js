// 7天消息过期清除验证：插入一条 8 天前的旧消息 → 触发 join-room → 检查被清除
const API = 'http://127.0.0.1:8787';
(async () => {
  const { execSync } = require('child_process');
  const WR = '"C:/Users/June2022/.workbuddy/binaries/node/versions/22.22.2/node.exe" "C:/Users/June2022/.workbuddy/binaries/node/workspace/node_modules/wrangler/bin/wrangler.js"';
  const q = (sql) => execSync(WR + ' d1 execute chat-db --local --command "' + sql.replace(/"/g, '\\"') + '" --json 2>nul', { shell: 'cmd.exe', encoding: 'utf8' });

  // 1. 插入旧消息（8 天前）
  const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  q("INSERT INTO messages (room, sender, role, text, ts) VALUES ('geek', 'oldghost', 'member', '七日前的旧消息', '" + old + "')");
  const before = JSON.parse(q("SELECT COUNT(*) AS n FROM messages WHERE sender = 'oldghost'"))[0].results[0].n;
  console.log('插入旧消息后 oldghost 条数 =', before);

  // 2. 登录并 join-room 触发 purge
  const r = await fetch(API + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'deportee', password: 'RA-541418081' }) });
  const token = (await r.json()).token;
  const ws = new WebSocket('ws://127.0.0.1:8787/room?token=' + token);
  await new Promise((res) => { ws.onopen = res; });
  ws.send(JSON.stringify({ type: 'join-room', room: 'geek' }));
  await new Promise((res) => { ws.onmessage = (e) => { if (e.data.indexOf('history') !== -1) res(); }; });
  await new Promise((r2) => setTimeout(r2, 1500));
  ws.close();

  // 3. 检查旧消息是否被清
  const after = JSON.parse(q("SELECT COUNT(*) AS n FROM messages WHERE sender = 'oldghost'"))[0].results[0].n;
  console.log('触发清理后 oldghost 条数 =', after);
  console.log(after === 0 ? 'PASS 7天旧消息自动清除' : 'FAIL 旧消息未被清除');
  process.exit(after === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });

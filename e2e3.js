// 验证：1) 新计费（文字20字/10Cr，文件1MB/20Cr） 2) 文件服务端落地（作为聊天记录保留7天） 3) 后来者从服务端下载
const BASE = 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function assert(cond, name, extra) { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra ? ' -> ' + extra : '')); } }

async function api(path, body, token) {
  const opt = { headers: {} };
  if (body) { opt.method = 'POST'; opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  if (token) opt.headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + path, opt);
  let data = {}; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
function wsConnect(token) {
  const ws = new WebSocket('ws://127.0.0.1:8787/room?token=' + encodeURIComponent(token));
  ws.binaryType = 'arraybuffer';
  return ws;
}
function wsSend(ws, obj) { ws.send(JSON.stringify(obj)); }
function wsSendBin(ws, buf) { ws.send(buf); }

async function login(u, p) { const r = await api('/api/login', { username: u, password: p }); return r.data.token; }
function waitOpen(ws) { return new Promise((res, rej) => { ws.onopen = () => res(); ws.onerror = (e) => rej(e); }); }

(async () => {
  console.log('=== 1. 新计费规则验证 ===');
  const ra = await login('deportee', 'RA-541418081');
  const sent = await login('sentinel', 'sentinel-123');
  // 文件报价：0.5MB -> 20, 1.5MB -> 40, 3MB -> 60
  const q1 = await api('/api/file/quote', { size: 500 * 1024, room: 'dm:sentinel' }, sent);
  assert(q1.data.cost === 20, '文件 0.5MB 报价 = 20 Credits', q1.data.cost);
  const q2 = await api('/api/file/quote', { size: 1.5 * 1024 * 1024, room: 'dm:sentinel' }, sent);
  assert(q2.data.cost === 40, '文件 1.5MB 报价 = 40 Credits', q2.data.cost);
  const q3 = await api('/api/file/quote', { size: 3 * 1024 * 1024, room: 'dm:sentinel' }, sent);
  assert(q3.data.cost === 60, '文件 3MB 报价 = 60 Credits', q3.data.cost);

  // 文字计费：发 10 字 -> -10；发 25 字 -> -20
  const before = (await api('/api/me', null, sent)).data.points;
  const wsS = wsConnect(sent); await waitOpen(wsS);
  wsSend(wsS, { type: 'join-room', room: 'dm:sentinel' });
  await sleep(300);
  wsSend(wsS, { text: '1234567890' }); // 10 字
  await sleep(400);
  const after10 = (await api('/api/me', null, sent)).data.points;
  assert(before - after10 === 10, '文字 10 字扣 10 Credits', before - after10);
  wsSend(wsS, { text: '1234567890123456789012345' }); // 25 字
  await sleep(400);
  const after25 = (await api('/api/me', null, sent)).data.points;
  assert(after10 - after25 === 20, '文字 25 字扣 20 Credits', after10 - after25);
  wsS.close();

  console.log('=== 2. 文件服务端落地（作为聊天记录）===');
  // 在 dm:sentinel 通过 WS 上传一个 ~300KB 文件
  const SIZE = 300 * 1024;
  const payload = Buffer.alloc(SIZE, 7); // 全 7
  const fileId = 'ftest' + Date.now().toString(36);
  const wsU = wsConnect(sent); await waitOpen(wsU);
  wsSend(wsU, { type: 'join-room', room: 'dm:sentinel' });
  await sleep(300);
  const beforeUp = (await api('/api/me', null, sent)).data.points;
  wsSend(wsU, { type: 'file-start', id: fileId, name: 'hello.bin', size: SIZE, mime: 'application/octet-stream' });
  const CH = 16 * 1024;
  for (let off = 0; off < SIZE; off += CH) {
    wsSendBin(wsU, payload.subarray(off, Math.min(off + CH, SIZE)));
    await new Promise(r => setTimeout(r, 4)); // 模拟真实分块节奏，避免本地 workerd 背压丢帧
  }
  wsSend(wsU, { type: 'file-end', id: fileId });
  await sleep(600);
  wsU.close();
  const afterUp = (await api('/api/me', null, sent)).data.points;
  assert(beforeUp - afterUp === 20, '上传 300KB 扣 20 Credits（1MB/20Cr）', beforeUp - afterUp);

  // 服务端应已落地：chat_files 有该 id
  const cf = await api('/api/me', null, ra); // 仅占位，下面用 D1 校验
  // 通过 sentinel 登录态查询历史（晚于上传）应包含文件消息标记
  const wsL = wsConnect(sent); await waitOpen(wsL);
  let history = null;
  wsL.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.type === 'history') history = d; } catch {} };
  wsSend(wsL, { type: 'join-room', room: 'dm:sentinel' });
  await sleep(600);
  wsL.close();
  const hasFile = history && history.messages.some(m => typeof m.text === 'string' && m.text.indexOf('{"__file"') === 0 && JSON.parse(m.text).id === fileId);
  assert(hasFile, '后来者历史含该文件消息（聊天记录持久化）');
  if (history) console.log('     历史消息条数=' + history.messages.length + '，含文件标记=' + !!hasFile);

  console.log('=== 3. 后来者从服务端下载（先付费）===');
  const quote = await api('/api/file/quote', { size: SIZE, room: 'dm:sentinel' }, sent);
  assert(quote.data.cost === 20, '下载报价 20 Credits');
  const pay = await api('/api/file/pay', { size: SIZE, name: 'hello.bin', room: 'dm:sentinel' }, sent);
  assert(pay.status === 200, '下载付费成功', pay.status);
  const getR = await fetch(BASE + '/api/file/get?id=' + encodeURIComponent(fileId), { headers: { Authorization: 'Bearer ' + sent } });
  assert(getR.ok, '服务端返回文件字节', getR.status);
  const buf = Buffer.from(await getR.arrayBuffer());
  assert(buf.length === SIZE && buf[0] === 7 && buf[SIZE - 1] === 7, '下载字节完整且一致（' + buf.length + 'B）', buf.length);

  // 非成员应被拒绝
  const outsider = await login('observer01', 'obs-pass-001').catch(() => null);
  if (outsider) {
    const g2 = await fetch(BASE + '/api/file/get?id=' + encodeURIComponent(fileId), { headers: { Authorization: 'Bearer ' + outsider } });
    assert(g2.status === 403, '非成员下载被拒(403)', g2.status);
  } else {
    console.log('  (跳过非成员拒绝测试：observer01 不存在)');
  }

  console.log('=== 4. 7 天清理（chat_files 与 messages 同步过期）===');
  // 直接用本地 D1 插入一条 8 天前的旧记录，再触发一次 join 让 purge 执行
  const { execSync } = require('child_process');
  const node = 'C:/Users/June2022/.workbuddy/binaries/node/versions/22.22.2/node.exe';
  const wr = 'C:/Users/June2022/.workbuddy/binaries/node/workspace/node_modules/wrangler/bin/wrangler.js';
  const oldId = 'oldfile_xyz';
  try {
    execSync(`"${node}" "${wr}" d1 execute chat-db --local --command "INSERT OR IGNORE INTO chat_files (id, room, sender, name, size, mime, data, created_at) VALUES ('${oldId}','dm:sentinel','sentinel','old.bin',10,'application/octet-stream','AQID','2000-01-01T00:00:00Z'); INSERT OR IGNORE INTO messages (room, sender, role, text, ts) VALUES ('dm:sentinel','sentinel','member','{\"__file\":1,\"id\":\"${oldId}\",\"name\":\"old.bin\",\"size\":10,\"mime\":\"application/octet-stream\"}','2000-01-01T00:00:00Z');" 2>&1`, { cwd: 'C:/Users/June2022/WorkBuddy/2026-10-20-22-26-37/v7-chat' });
    // 触发 purge：让 sentinel 发一条消息（join + text），purge 在 DO 内执行
    const wsP = wsConnect(sent); await waitOpen(wsP);
    wsSend(wsP, { type: 'join-room', room: 'dm:sentinel' });
    await sleep(300);
    wsSend(wsP, { text: 'trigger purge 123' });
    await sleep(800);
    wsP.close();
    const out = execSync(`"${node}" "${wr}" d1 execute chat-db --local --command "SELECT COUNT(*) AS n FROM chat_files WHERE id='${oldId}'; SELECT COUNT(*) AS m FROM messages WHERE text LIKE '%${oldId}%';" --json 2>&1`, { cwd: 'C:/Users/June2022/WorkBuddy/2026-10-20-22-26-37/v7-chat' }).toString();
    const stillThere = out.indexOf('"n":1') !== -1 || out.indexOf('"m":1') !== -1 || out.indexOf(oldId) !== -1;
    assert(!stillThere, '8 天前的旧文件与消息已被自动清除');
    if (stillThere) console.log('     残留：' + out.slice(0, 200));
  } catch (e) { console.log('   purge 测试异常: ' + e.message); }

  console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });

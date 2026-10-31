// v7-chat 第二轮改造端到端验证（API + WebSocket 级）
// 覆盖：SHOP关闭 / 文件报价与上传下载扣费 / 长文本 / 禁言 / 加群密码 / 转让 / 踢人 / 解散 / Geek保护 / 四个测试群清理
const API = 'http://127.0.0.1:8787';

const results = [];
function ok(name) { results.push('PASS ' + name); }
function fail(name, extra) { results.push('FAIL ' + name + (extra ? ' · ' + extra : '')); }
function assert(cond, name, extra) { cond ? ok(name) : fail(name, extra); }

async function apiJson(path, opts = {}, token) {
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (opts.body) headers['content-type'] = 'application/json';
  const r = await fetch(API + path, Object.assign({}, opts, { headers }));
  let d = {}; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}

function wsConnect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:8787/room?token=' + encodeURIComponent(token));
    const state = { ws, inbox: [], waiters: [] };
    ws.onopen = () => resolve(state);
    ws.onerror = (e) => reject(new Error('ws error'));
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let d = {}; try { d = JSON.parse(e.data); } catch { return; }
      state.inbox.push(d);
      state.waiters = state.waiters.filter((w) => !w(d));
    };
  });
}
function wsWait(state, pred, timeout = 6000) {
  const hit = state.inbox.find(pred);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws wait timeout')), timeout);
    state.waiters.push((d) => { if (pred(d)) { clearTimeout(t); resolve(d); return true; } return false; });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ===== 登录 =====
  const ra = (await apiJson('/api/login', { method: 'POST', body: JSON.stringify({ username: 'deportee', password: 'RA-541418081' }) })).data;
  const st = (await apiJson('/api/login', { method: 'POST', body: JSON.stringify({ username: 'sentinel', password: 'sentinel-123' }) })).data;
  assert(ra.token && st.token, '双账号登录');
  const raMe0 = (await apiJson('/api/me', {}, ra.token)).data;
  const stMe0 = (await apiJson('/api/me', {}, st.token)).data;
  log('RA余额=' + raMe0.points + ' sentinel余额=' + stMe0.points);

  // ===== 1. SHOP 已关闭（503，不扣费）=====
  const pBefore = (await apiJson('/api/me', {}, ra.token)).data.points;
  const buy = await apiJson('/api/shop/buy', { method: 'POST', body: JSON.stringify({ type: 'match3' }) }, ra.token);
  assert(buy.status === 503 && /游戏故障/.test(buy.data.error), 'SHOP购买返回故障503', JSON.stringify(buy.data));
  const pAfter = (await apiJson('/api/me', {}, ra.token)).data.points;
  assert(pBefore === pAfter, 'SHOP关闭不扣费', pBefore + '->' + pAfter);

  // ===== 2. 建测试群（RA 建，拉 sentinel）=====
  const mk = await apiJson('/api/rooms/create', { method: 'POST', body: JSON.stringify({ name: '改造验证群', members: ['sentinel'] }) }, ra.token);
  assert(mk.ok !== false && mk.data.room, '创建验证群');
  const roomId = mk.data.room.id;

  // ===== 3. 成员列表 =====
  const mem = await apiJson('/api/rooms/members?id=' + roomId, {}, ra.token);
  assert(mem.status === 200 && mem.data.members.length === 2 && mem.data.creator === 'deportee', '成员列表+群主标识');
  assert(mem.data.passcode === '', '未设密码返回空');

  // ===== 4. 加群密码 =====
  const setPw = await apiJson('/api/rooms/passcode', { method: 'POST', body: JSON.stringify({ id: roomId, passcode: 'abc123' }) }, ra.token);
  assert(setPw.status === 200, '群主设置加群密码');
  const setPw2 = await apiJson('/api/rooms/passcode', { method: 'POST', body: JSON.stringify({ id: roomId, passcode: 'x' }) }, st.token);
  assert(setPw2.status === 403, '非群主不能改密码', JSON.stringify(setPw2.data));
  // 建个新号试密码加群
  const nb = await apiJson('/api/admin/create-account', { method: 'POST', body: JSON.stringify({ username: 'pwtester', password: 'pwtester-123', role: 'member' }) }, ra.token);
  const nbLogin = (await apiJson('/api/login', { method: 'POST', body: JSON.stringify({ username: 'pwtester', password: 'pwtester-123' }) })).data;
  assert(!!nbLogin.token, '创建并登录 pwtester');
  const jpBad = await apiJson('/api/rooms/join-pw', { method: 'POST', body: JSON.stringify({ name: '改造验证群', password: 'wrong' }) }, nbLogin.token);
  assert(jpBad.status === 403, '密码错误被拒', JSON.stringify(jpBad.data));
  const jpOk = await apiJson('/api/rooms/join-pw', { method: 'POST', body: JSON.stringify({ name: '改造验证群', password: 'abc123' }) }, nbLogin.token);
  assert(jpOk.status === 200 && jpOk.data.room.id === roomId, '凭密码成功加群', JSON.stringify(jpOk.data));

  // ===== 5. 文件报价 + 上传扣费（重点：之前用户反馈不扣费）=====
  const fileBytes = new Uint8Array(100 * 1024).fill(7); // 100KB -> 1 Credit
  const quote = await apiJson('/api/file/quote', { method: 'POST', body: JSON.stringify({ size: fileBytes.length, room: roomId }) }, ra.token);
  assert(quote.status === 200 && quote.data.cost === 1 && quote.data.enough === true, '文件报价 cost=1', JSON.stringify(quote.data));

  const raWs = await wsConnect(ra.token);
  const stWs = await wsConnect(st.token);
  raWs.ws.send(JSON.stringify({ type: 'join-room', room: roomId }));
  await wsWait(raWs, (d) => d.type === 'history');
  stWs.ws.send(JSON.stringify({ type: 'join-room', room: roomId }));
  await wsWait(stWs, (d) => d.type === 'history');
  await sleep(400);
  const n = raWs.inbox.filter((d) => d.type === 'sys' && /进入了会话/.test(d.text)).length;
  log('join-room sys 广播 x' + n);

  const raP1 = (await apiJson('/api/me', {}, ra.token)).data.points;
  const fid = 'ftest1';
  raWs.ws.send(JSON.stringify({ type: 'file-start', id: fid, name: 'charge-test.bin', size: fileBytes.length, mime: 'application/octet-stream' }));
  await sleep(600); // 等扣费落库
  raWs.ws.send(fileBytes.buffer);
  await sleep(300);
  raWs.ws.send(JSON.stringify({ type: 'file-end', id: fid }));
  const recv = await wsWait(stWs, (d) => d.type === 'file-start' && d.id === fid).catch(() => null);
  assert(!!recv && recv.sender === 'deportee', 'sentinel 收到 file-start 广播');
  const raP2 = (await apiJson('/api/me', {}, ra.token)).data.points;
  assert(raP1 - raP2 === 1, 'RA 群内上传文件扣 1 Credit', raP1 + '->' + raP2);

  // ===== 6. 下载扣费（sentinel 付费下载）=====
  const stQuote = await apiJson('/api/file/quote', { method: 'POST', body: JSON.stringify({ size: fileBytes.length, room: roomId }) }, st.token);
  assert(stQuote.data.cost === 1, 'sentinel 下载报价 cost=1');
  const stP1 = (await apiJson('/api/me', {}, st.token)).data.points;
  const pay = await apiJson('/api/file/pay', { method: 'POST', body: JSON.stringify({ size: fileBytes.length, name: 'charge-test.bin', room: roomId }) }, st.token);
  assert(pay.status === 200 && pay.data.cost === 1, 'sentinel 下载支付成功', JSON.stringify(pay.data));
  const stP2 = (await apiJson('/api/me', {}, st.token)).data.points;
  assert(stP1 - stP2 === 1, 'sentinel 下载扣 1 Credit', stP1 + '->' + stP2);
  // 文件传输助手免费
  const helperQuote = await apiJson('/api/file/quote', { method: 'POST', body: JSON.stringify({ size: fileBytes.length, room: 'file:deportee' }) }, ra.token);
  assert(helperQuote.data.free === true && helperQuote.data.cost === 0, '文件传输助手报价免费');
  const payHelper = await apiJson('/api/file/pay', { method: 'POST', body: JSON.stringify({ size: fileBytes.length, room: 'file:deportee' }) }, ra.token);
  assert(payHelper.status === 200 && payHelper.data.free === true, '文件传输助手下载免费');

  // ===== 7. 长文本：800 字正常入库 / 1200 字截断到 1000 =====
  const longMsg = '甲'.repeat(800);
  const raP3 = (await apiJson('/api/me', {}, ra.token)).data.points;
  raWs.ws.send(JSON.stringify({ text: longMsg }));
  await wsWait(stWs, (d) => d.type === 'msg' && d.text === longMsg, 8000).catch(() => null);
  const raP4 = (await apiJson('/api/me', {}, ra.token)).data.points;
  assert(raP4 === raP3 - Math.ceil(800 / 15), '800字发言按15字/Credits扣费', raP3 + '->' + raP4);
  raWs.ws.send(JSON.stringify({ text: '乙'.repeat(1200) }));
  await sleep(800);
  const his = await apiJson('/api/rooms/history?id=' + roomId, {}, ra.token);
  const last = his.data.messages[his.data.messages.length - 1];
  assert(last && last.text.length === 1000, '超长文本服务端截断到1000', last && last.text.length);

  // ===== 8. 禁言 =====
  // sentinel 是 admin，RA 是群主+root-admin
  const muteByAdmin = await apiJson('/api/rooms/mute', { method: 'POST', body: JSON.stringify({ id: roomId, username: 'deportee', hours: 1 }) }, st.token);
  assert(muteByAdmin.status === 403 && /群主|Admin/.test(muteByAdmin.data.error), 'Admin不能禁言群主', JSON.stringify(muteByAdmin.data));
  const muteSt = await apiJson('/api/rooms/mute', { method: 'POST', body: JSON.stringify({ id: roomId, username: 'sentinel', hours: 1 }) }, ra.token);
  assert(muteSt.status === 403 && /Admin/.test(muteSt.data.error), '群主不能禁言Admin', JSON.stringify(muteSt.data));
  // RA 把 pwtester 禁言 1 小时
  const muteOk = await apiJson('/api/rooms/mute', { method: 'POST', body: JSON.stringify({ id: roomId, username: 'pwtester', hours: 1 }) }, ra.token);
  assert(muteOk.status === 200, '群主禁言普通成员成功', JSON.stringify(muteOk.data));
  const muteAgain = await apiJson('/api/rooms/mute', { method: 'POST', body: JSON.stringify({ id: roomId, username: 'pwtester', hours: 2 }) }, ra.token);
  assert(muteAgain.status === 409 && /中途不能结束/.test(muteAgain.data.error), '禁言中不可重复禁言', JSON.stringify(muteAgain.data));
  const nbWs = await wsConnect(nbLogin.token);
  nbWs.ws.send(JSON.stringify({ type: 'join-room', room: roomId }));
  await wsWait(nbWs, (d) => d.type === 'history');
  await sleep(300);
  nbWs.ws.send(JSON.stringify({ text: '我被禁言了吗' }));
  const muteMsg = await wsWait(nbWs, (d) => d.type === 'sys' && /禁言/.test(d.text), 5000).catch(() => null);
  assert(!!muteMsg && /已被禁言/.test(muteMsg.text), '被禁言者发言被拦', muteMsg && muteMsg.text);
  // 被禁言者仍能收消息（只读）— 群里有人说话他能收到
  raWs.ws.send(JSON.stringify({ text: '禁言者可读测试' }));
  const canRead = await wsWait(nbWs, (d) => d.type === 'msg' && /禁言者可读测试/.test(d.text), 5000).catch(() => null);
  assert(!!canRead, '被禁言者仍可读消息');

  // ===== 9. 转让群主 / 踢人 =====
  const trBad = await apiJson('/api/rooms/transfer', { method: 'POST', body: JSON.stringify({ id: roomId, to: 'sentinel' }) }, st.token);
  assert(trBad.status === 403, '非群主不能转让');
  const trOk = await apiJson('/api/rooms/transfer', { method: 'POST', body: JSON.stringify({ id: roomId, to: 'sentinel' }) }, ra.token);
  assert(trOk.status === 200 && trOk.data.newOwner === 'sentinel', '群主转让成功');
  const mem2 = await apiJson('/api/rooms/members?id=' + roomId, {}, st.token);
  assert(mem2.data.creator === 'sentinel', '成员列表确认新群主');
  const kickSelf = await apiJson('/api/rooms/kick', { method: 'POST', body: JSON.stringify({ id: roomId, username: 'sentinel' }) }, st.token);
  assert(kickSelf.status === 400, '群主不能踢自己');
  const kickOk = await apiJson('/api/rooms/kick', { method: 'POST', body: JSON.stringify({ id: roomId, username: 'pwtester' }) }, st.token);
  assert(kickOk.status === 200, '新群主踢人成功');
  const memAfterKick = await apiJson('/api/rooms/members?id=' + roomId, {}, nbLogin.token);
  assert(memAfterKick.status === 403, '被踢者失去成员资格');

  // ===== 10. Geek 保护 =====
  const gDis = await apiJson('/api/rooms/disband', { method: 'POST', body: JSON.stringify({ id: 'geek' }) }, ra.token);
  assert(gDis.status === 403, 'Geek公告群不可解散');
  const gTr = await apiJson('/api/rooms/transfer', { method: 'POST', body: JSON.stringify({ id: 'geek', to: 'sentinel' }) }, ra.token);
  assert(gTr.status === 403, 'Geek公告群群主不可转让');
  const gMute = await apiJson('/api/rooms/mute', { method: 'POST', body: JSON.stringify({ id: 'geek', username: 'sentinel', hours: 1 }) }, ra.token);
  assert(gMute.status === 400, 'Geek公告群无需禁言');

  // ===== 11. 解散验证群（sentinel 是群主）=====
  const disBad = await apiJson('/api/rooms/disband', { method: 'POST', body: JSON.stringify({ id: roomId }) }, ra.token);
  assert(disBad.status === 403, '原群主已无权解散');
  const disOk = await apiJson('/api/rooms/disband', { method: 'POST', body: JSON.stringify({ id: roomId }) }, st.token);
  assert(disOk.status === 200, '现任群主解散成功');
  const gone = await apiJson('/api/rooms/members?id=' + roomId, {}, st.token);
  assert(gone.status === 403 || gone.status === 404, '解散后房间不可访问', gone.status + '');

  // ===== 12. 清理四个测试群（用解散 API，实测新功能）=====
  const rooms = (await apiJson('/api/rooms', {}, ra.token)).data.rooms;
  const targets = rooms.filter((r) => ['计费测试群', '调试群8077', '计费测试群12399'].includes(r.name));
  for (const t of targets) {
    const d = await apiJson('/api/rooms/disband', { method: 'POST', body: JSON.stringify({ id: t.id }) }, ra.token);
    assert(d.status === 200, '解散测试群 ' + t.name + '(' + t.id + ')', JSON.stringify(d.data));
  }
  const roomsAfter = (await apiJson('/api/rooms', {}, ra.token)).data.rooms;
  assert(!roomsAfter.some((r) => ['计费测试群', '调试群8077', '计费测试群12399'].includes(r.name)), '四个测试群已全部清除');

  // ===== 13. 文件传输助手发言/收发免费（计费豁免回归）=====
  const raHelperWs = await wsConnect(ra.token);
  raHelperWs.ws.send(JSON.stringify({ type: 'join-room', room: 'file:deportee' }));
  await wsWait(raHelperWs, (d) => d.type === 'history');
  await sleep(300);
  const pA = (await apiJson('/api/me', {}, ra.token)).data.points;
  raHelperWs.ws.send(JSON.stringify({ text: '助手内发言不扣费' }));
  await wsWait(raHelperWs, (d) => d.type === 'msg' && /不扣费/.test(d.text), 5000).catch(() => null);
  const pB = (await apiJson('/api/me', {}, ra.token)).data.points;
  assert(pA === pB, '文件传输助手发言免费', pA + '->' + pB);

  raWs.ws.close(); stWs.ws.close(); nbWs.ws.close(); raHelperWs.ws.close();

  console.log('\n========== 测试结果 ==========');
  results.forEach((r) => console.log(r));
  const f = results.filter((r) => r.startsWith('FAIL')).length;
  console.log('-----------------------------');
  console.log('总计 ' + results.length + ' · 通过 ' + (results.length - f) + ' · 失败 ' + f);
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(2); });

function log(msg) { console.log('[info] ' + msg); }

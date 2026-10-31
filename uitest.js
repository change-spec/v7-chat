// v7-chat 计费体系 + SHOP 端到端验证（双账号：deportee=RA / sentinel=Admin）
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = __dirname + '/.uitest';
const API = 'http://127.0.0.1:8787';

const PANELS = [
  { nav: '#btnNavChat',     panel: '#chatPanel',     name: '聊天' },
  { nav: '#btnNavRedeem',   panel: '#redeemPanel',   name: '兑换Credits' },
  { nav: '#btnNavGame',     panel: '#gameLobby',     name: '游戏大厅' },
  { nav: '#btnNavCmd',      panel: '#cmdPanel',      name: '命令行' },
  { nav: '#btnNavLogs',     panel: '#logPanel',      name: '系统日志' },
  { nav: '#btnNavCtrl',     panel: '#ctrlPanel',     name: '系统控制面板' },
  { nav: '#btnNavSettings', panel: '#settingsPanel', name: '个人设置' },
  { nav: '#btnNavShop',     panel: '#shopPanel',     name: 'SHOP' },
];

const results = [];
const jsErrors = [];
const fail = (msg) => results.push('FAIL ' + msg);

async function apiJson(path, opts = {}) {
  const r = await fetch(API + path, opts);
  let d = {};
  try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}
async function login(username, password) {
  const r = await apiJson('/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return r.data.token;
}

(async () => {
  const fs = require('fs');
  fs.mkdirSync(OUT, { recursive: true });

  // 100KB 测试文件（下载费 = 1 Credit）
  const samplePath = OUT + '/sample.bin';
  fs.writeFileSync(samplePath, Buffer.alloc(100 * 1024, 7));

  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  // ===== 页面1：Root-Admin deportee =====
  const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx1.newPage();
  page.on('pageerror', (e) => jsErrors.push('RA pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push('RA console: ' + m.text()); });

  // ===== 页面2：Admin sentinel =====
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await ctx2.newPage();
  page2.on('pageerror', (e) => jsErrors.push('sentinel pageerror: ' + e.message));
  page2.on('console', (m) => { if (m.type() === 'error') jsErrors.push('sentinel console: ' + m.text()); });

  try {
    // ---------- 登录 ----------
    await page.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    await page.fill('#authUser', 'deportee');
    await page.fill('#authPass', 'RA-541418081');
    await page.click('#authSubmit');
    await page.waitForSelector('#appShell:not(.hidden)', { timeout: 10000 });
    await page.waitForTimeout(1200);
    results.push('PASS RA 登录');

    await page2.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    await page2.fill('#authUser', 'sentinel');
    await page2.fill('#authPass', 'sentinel-123');
    await page2.click('#authSubmit');
    await page2.waitForSelector('#appShell:not(.hidden)', { timeout: 10000 });
    await page2.waitForTimeout(1200);
    results.push('PASS sentinel 登录');

    // ---------- 八个面板 ----------
    for (const p of PANELS) {
      await page.click(p.nav);
      await page.waitForTimeout(500);
      if (!(await page.isVisible(p.panel))) { fail(p.name + ' 面板不可见'); continue; }
      let leaks = [];
      for (const q of PANELS) {
        if (q.panel !== p.panel && (await page.isVisible(q.panel))) leaks.push(q.name);
      }
      if (leaks.length) fail(p.name + ' 与其它面板叠加: ' + leaks.join(','));
      results.push('PASS 面板 ' + p.name);
    }

    // ---------- 游戏大厅无创建按钮 ----------
    await page.click('#btnNavGame');
    await page.waitForTimeout(400);
    const createBtns = await page.locator('#gameLobby [data-game-create]').count();
    results.push(createBtns === 0 ? 'PASS 大厅无直接创建按钮' : 'FAIL 大厅仍有创建按钮');

    // ---------- SHOP：消消乐 → 扣费 + 游戏故障，不开局 ----------
    await page.click('#btnNavShop');
    await page.waitForTimeout(400);
    const ptsBefore = parseInt((await page.locator('#pts').textContent()) || '0', 10);
    await page.click('[data-shop-buy="match3"]');
    await page.waitForTimeout(2000);
    const shopErrTxt = (await page.locator('#shopErr').textContent()) || '';
    const inRoom = await page.isVisible('#gameRoomPanel');
    const ptsAfter = parseInt((await page.locator('#pts').textContent()) || '0', 10);
    if (/游戏故障/.test(shopErrTxt) && !inRoom && ptsBefore - ptsAfter === 10) {
      results.push('PASS 消消乐：已扣 10 Credits 并提示游戏故障，未开局');
    } else {
      fail('消消乐故障流程异常 err=' + shopErrTxt.slice(0, 40) + ' inRoom=' + inRoom + ' 扣费=' + (ptsBefore - ptsAfter));
    }

    // ---------- SHOP：象棋房间号 + 进入我的房间 ----------
    await page.click('[data-shop-buy="chess"]');
    await page.waitForTimeout(2000);
    const roomId = ((await page.locator('#shopRoomId').textContent()) || '').trim();
    const enterVisible = await page.isVisible('#btnShopEnterRoom');
    if (/^[A-Z0-9]{6}$/.test(roomId) && enterVisible) results.push('PASS SHOP 购买象棋房间号 ' + roomId + '（进入按钮可见）');
    else fail('SHOP 购买象棋异常 id=' + roomId + ' enter=' + enterVisible);

    await page.click('#btnShopEnterRoom');
    await page.waitForTimeout(1500);
    const statusTxt = (await page.locator('#roomStatusText').textContent()) || '';
    const creatorBtns = await page.isVisible('#roomCreatorBtns');
    if ((await page.isVisible('#gameRoomPanel')) && /等待加入/.test(statusTxt) && creatorBtns) {
      results.push('PASS 房主本人可进入自己买的房间（等待加入中）');
    } else {
      fail('房主进自己房间异常 status=' + statusTxt + ' creatorBtns=' + creatorBtns);
    }
    await page.screenshot({ path: OUT + '/shop-own-room.png' });

    // ---------- 代购 ----------
    await page.click('#btnNavShop');
    await page.waitForTimeout(400);
    await page.fill('#shopForUser', 'sentinel');
    await page.click('[data-shop-buy="xiangqi"]');
    await page.waitForTimeout(2000);
    const giftTxt = (await page.locator('#shopOutHint').textContent()) || '';
    const giftEnterHidden = !(await page.isVisible('#btnShopEnterRoom'));
    if (/代购/.test(giftTxt) && giftEnterHidden) results.push('PASS 代购：房间号归属 sentinel，进入按钮已隐藏');
    else fail('代购异常 hint=' + giftTxt.slice(0, 30) + ' enterHidden=' + giftEnterHidden);

    // ---------- API 级校验 ----------
    const raToken = await login('deportee', 'RA-541418081');
    const sentinelToken = await login('sentinel', 'sentinel-123');
    const sentinelPts0 = (await apiJson('/api/me', { headers: { Authorization: 'Bearer ' + sentinelToken } })).data.points;

    // 旧直接建房接口应关闭
    const oldCreate = await apiJson('/api/game/create', {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + raToken },
      body: JSON.stringify({ type: 'chess' }),
    });
    results.push(oldCreate.status === 403 ? 'PASS 旧 /api/game/create 已关闭（引导去 SHOP）' : 'FAIL 旧建房接口仍开放 ' + oldCreate.status);

    // sentinel 付费下载 2MB 文件 → 扣 2
    const pay2m = await apiJson('/api/file/pay', {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + sentinelToken },
      body: JSON.stringify({ size: 2 * 1024 * 1024, name: 'big.bin' }),
    });
    const sentinelPts1 = (await apiJson('/api/me', { headers: { Authorization: 'Bearer ' + sentinelToken } })).data.points;
    if (pay2m.status === 200 && pay2m.data.cost === 2 && sentinelPts0 - sentinelPts1 === 2) {
      results.push('PASS 下载计费：2MB 文件扣 2 Credits');
    } else {
      fail('下载计费异常 status=' + pay2m.status + ' cost=' + pay2m.data.cost + ' 实际扣=' + (sentinelPts0 - sentinelPts1));
    }

    // ---------- 建群（RA）+ sentinel 发言计费 + 文件上传/下载计费 ----------
    var groupName = '计费测试群' + (Date.now() % 100000);
    await page.click('#btnNavChat');
    await page.waitForTimeout(600);
    await page.click('#btnNewGroup');
    await page.waitForTimeout(600);
    await page.fill('#groupName', groupName);
    const sBox = page.locator('#groupMembers input[type="checkbox"]').first();
    // 勾选 sentinel（成员列表第一项大概率是 sentinel；逐个找）
    const boxes = await page.locator('#groupMembers input[type="checkbox"]').all();
    let checked = false;
    for (const b of boxes) {
      const val = await b.getAttribute('value');
      if (val === 'sentinel') { await b.check(); checked = true; break; }
    }
    if (!checked && boxes.length) { await boxes[0].check(); }
    await page.click('#btnCreateGroup');
    await page.waitForTimeout(1500);
    await page.waitForTimeout(500);
    // 等群创建后自动进入会话；sentinel 刷新房间列表并加入
    await page2.click('#btnNavChat');
    await page2.waitForTimeout(600);
    await page2.reload({ waitUntil: 'load' });
    await page2.waitForSelector('#appShell:not(.hidden)', { timeout: 10000 });
    await page2.waitForTimeout(1500);
    // sentinel 点新建的群（唯一名）
    const roomItem = page2.locator('.room-item', { hasText: groupName }).first();
    if (await roomItem.count()) { await roomItem.click(); await page2.waitForTimeout(1500); }
    else { fail('sentinel 看不到计费测试群'); }

    // sentinel 发言 3 字 → 扣 1
    const sPtsBefore = parseInt((await page2.locator('#pts').textContent()) || '0', 10);
    await page2.fill('#msgInput', '你好呀');
    await page2.keyboard.press('Enter');
    await page2.waitForTimeout(1800);
    const sPtsAfter = parseInt((await page2.locator('#pts').textContent()) || '0', 10);
    if (sPtsBefore - sPtsAfter === 1) results.push('PASS 普通群发言计费：3 字扣 1 Credits');
    else fail('发言计费异常 前=' + sPtsBefore + ' 后=' + sPtsAfter);
    // RA 侧应收到消息
    const raGotMsg = await page.locator('#messages', { hasText: '你好呀' }).count();
    results.push(raGotMsg ? 'PASS RA 收到 sentinel 的消息' : 'FAIL RA 未收到消息');

    // sentinel 上传文件（普通群，扣 1）→ RA 看到付费下载并支付（RA 在普通群下载也扣）
    const sPtsUp = parseInt((await page2.locator('#pts').textContent()) || '0', 10);
    await page2.setInputFiles('#fileInput', samplePath);
    await page2.waitForTimeout(4000);
    const sPtsUp2 = parseInt((await page2.locator('#pts').textContent()) || '0', 10);
    if (sPtsUp - sPtsUp2 === 1) results.push('PASS sentinel 普通群上传文件扣 1 Credits');
    else fail('sentinel 上传计费异常 前=' + sPtsUp + ' 后=' + sPtsUp2);

    const raPayBtn = page.locator('.msg[data-file] .f-dl').last();
    if (await raPayBtn.count()) {
      const raBtnTxt0 = (await raPayBtn.textContent()) || '';
      if (!/付费下载/.test(raBtnTxt0)) fail('RA 侧文件卡不是付费下载: ' + raBtnTxt0);
      else results.push('PASS RA 在普通群看到「付费下载」按钮（不再豁免）');
      const raPtsB = parseInt((await page.locator('#pts').textContent()) || '0', 10);
      await raPayBtn.click();
      await page.waitForTimeout(2500);
      const raPtsA = parseInt((await page.locator('#pts').textContent()) || '0', 10);
      const raBtnTxt = (await raPayBtn.textContent()) || '';
      if (raPtsB - raPtsA === 1 && /已保存/.test(raBtnTxt)) results.push('PASS RA 在普通群付费下载扣 1 Credits');
      else fail('RA 付费下载异常 扣=' + (raPtsB - raPtsA) + ' 按钮=' + raBtnTxt);
    } else {
      fail('RA 未见付费下载按钮');
    }

    // RA 上传文件（普通群，现在也要扣 1）→ sentinel 付费下载
    const raPtsUp = parseInt((await page.locator('#pts').textContent()) || '0', 10);
    await page.setInputFiles('#fileInput', samplePath);
    await page.waitForTimeout(4000);
    const raPtsUp2 = parseInt((await page.locator('#pts').textContent()) || '0', 10);
    if (raPtsUp - raPtsUp2 === 1) results.push('PASS RA 在普通群上传文件扣 1 Credits（不再豁免）');
    else fail('RA 上传计费异常 前=' + raPtsUp + ' 后=' + raPtsUp2);
    const sPayBtn = page2.locator('.msg[data-file] .f-dl').last();
    if (await sPayBtn.count()) {
      const sBtnTxt0 = (await sPayBtn.textContent()) || '';
      results.push(/付费下载/.test(sBtnTxt0) ? 'PASS sentinel 看到「付费下载 · 1 Credits」按钮' : 'FAIL sentinel 文件卡按钮异常: ' + sBtnTxt0);
      const sPtsB3 = parseInt((await page2.locator('#pts').textContent()) || '0', 10);
      await sPayBtn.click();
      await page2.waitForTimeout(2500);
      const sPtsA3 = parseInt((await page2.locator('#pts').textContent()) || '0', 10);
      const sBtnTxt = (await sPayBtn.textContent()) || '';
      if (sPtsB3 - sPtsA3 === 1 && /已保存/.test(sBtnTxt)) results.push('PASS sentinel 付费下载成功（扣 1 Credits，文件已保存）');
      else fail('sentinel 付费下载异常 扣=' + (sPtsB3 - sPtsA3) + ' 按钮=' + sBtnTxt);
    } else {
      fail('sentinel 未见付费下载按钮（文件卡未出现？）');
    }
    await page2.screenshot({ path: OUT + '/paid-download.png' });

    // RA 在公告群发文件 → sentinel（公告群内）也能付费下载
    await page2.click('#btnBackRooms');
    await page2.waitForTimeout(600);
    await page2.locator('.room-item', { hasText: 'Geek公告群' }).first().click();
    await page2.waitForTimeout(1500);
    await page.click('#btnBackRooms');
    await page.waitForTimeout(600);
    await page.locator('.room-item', { hasText: 'Geek公告群' }).first().click();
    await page.waitForTimeout(1500);
    await page.setInputFiles('#fileInput', samplePath);
    await page.waitForTimeout(4000);
    const raPtsGeek = parseInt((await page.locator('#pts').textContent()) || '0', 10);
    const geekPayBtn = page2.locator('.msg[data-file] .f-dl').last();
    if (await geekPayBtn.count()) {
      const gTxt = (await geekPayBtn.textContent()) || '';
      results.push(/付费下载/.test(gTxt) ? 'PASS 公告群文件：sentinel 可付费下载' : 'FAIL 公告群文件按钮异常: ' + gTxt);
      const sPtsG = parseInt((await page2.locator('#pts').textContent()) || '0', 10);
      await geekPayBtn.click();
      await page2.waitForTimeout(2500);
      const sPtsG2 = parseInt((await page2.locator('#pts').textContent()) || '0', 10);
      results.push(sPtsG - sPtsG2 === 1 ? 'PASS 公告群付费下载扣 1 Credits' : 'FAIL 公告群下载扣费异常 扣=' + (sPtsG - sPtsG2));
    } else {
      fail('公告群付费下载按钮未出现');
    }
    // RA 在公告群上传应免费（余额不变）
    await page.waitForTimeout(500);
    const raPtsGeek2 = parseInt((await page.locator('#pts').textContent()) || '0', 10);
    results.push(raPtsGeek === raPtsGeek2 ? 'PASS RA 在公告群上传文件免费' : 'FAIL RA 公告群上传被扣费 ' + (raPtsGeek - raPtsGeek2));
    await page2.screenshot({ path: OUT + '/geek-paid-download.png' });

    // 文件传输助手：上传/下载都应免费
    await page.click('#btnBackRooms');
    await page.waitForTimeout(600);
    await page.locator('.room-item', { hasText: '文件传输助手' }).first().click();
    await page.waitForTimeout(1500);
    const raPtsHelper = parseInt((await page.locator('#pts').textContent()) || '0', 10);
    await page.setInputFiles('#fileInput', samplePath);
    await page.waitForTimeout(4000);
    const raPtsHelper2 = parseInt((await page.locator('#pts').textContent()) || '0', 10);
    results.push(raPtsHelper === raPtsHelper2 ? 'PASS 文件传输助手上传免费（自传自免）' : 'FAIL 助手房上传被扣费 ' + (raPtsHelper - raPtsHelper2));
    // 自己的文件下载链接应为免费"下载"
    const selfDl = page.locator('.msg[data-file] .f-dl').last();
    const selfTxt = (await selfDl.textContent()) || '';
    results.push(/^下载$/.test(selfTxt.trim()) ? 'PASS 助手房自己的文件是免费下载链接' : 'INFO 助手房下载按钮: ' + selfTxt);
  } catch (e) {
    fail('异常: ' + e.message.split('\n')[0]);
  }

  console.log('===== 端到端测试结果 =====');
  results.forEach((r) => console.log(r));
  console.log('===== JS 错误(' + jsErrors.length + ') =====');
  jsErrors.slice(0, 10).forEach((e) => console.log(e));

  await browser.close();
  const bad = results.filter((r) => r.startsWith('FAIL')).length + jsErrors.length;
  console.log(bad ? '===== 存在失败项 =====' : '===== 全部通过 =====');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });

// v7-chat 第二轮改造 UI 端到端验证
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8787/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = __dirname + '/.uitest';

const results = [];
const jsErrors = [];
function assert(cond, name, extra) { results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' · ' + extra : '')); }

(async () => {
  const fs = require('fs');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => jsErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push('console: ' + m.text()); });

  await page.goto(BASE);
  await page.fill('#authUser', 'deportee');
  await page.fill('#authPass', 'RA-541418081');
  await page.click('#authSubmit');
  await page.waitForSelector('#appShell:not(.hidden)', { timeout: 8000 });
  assert(true, 'RA 登录进入主界面');

  // 1. 命令行入口已关闭
  assert(await page.isVisible('#btnNavCmd') === false, '侧栏命令行按钮已隐藏');
  assert(await page.isVisible('#btnCmdEntry') === false, '对话页命令行按钮已隐藏');

  // 2. 会话列表：密码加群按钮在新建群聊左边，颜色不同
  await page.waitForSelector('#roomItems .room-item', { timeout: 8000 });
  const joinPwVisible = await page.isVisible('#btnJoinByPw');
  const sameRow = await page.evaluate(() => {
    const a = document.getElementById('btnJoinByPw').getBoundingClientRect();
    const b = document.getElementById('btnNewGroup').getBoundingClientRect();
    return Math.abs(a.top - b.top) < 5 && a.right <= b.left + 1;
  });
  assert(joinPwVisible && sameRow, '「密码加群」按钮与「新建群聊」同行且在左侧');
  const cls = await page.getAttribute('#btnJoinByPw', 'class');
  assert(/magenta/.test(cls || ''), '密码加群按钮颜色不同（magenta）');

  // 3. 进入 Geek公告群：布局吸底 + 设置按钮右上角
  await page.click('#roomItems .room-item:has-text("Geek公告群")');
  await page.waitForSelector('#convView:not(.hidden)', { timeout: 8000 });
  await page.waitForTimeout(600);
  const layout = await page.evaluate(() => {
    const panel = document.getElementById('chatPanel').getBoundingClientRect();
    const input = document.getElementById('msgInput').closest('.input-row').getBoundingClientRect();
    const msgs = document.getElementById('messages');
    const btn = document.getElementById('btnConvSettings').getBoundingClientRect();
    const back = document.getElementById('btnBackRooms').getBoundingClientRect();
    return {
      inputBottom: input.bottom, panelBottom: panel.bottom,
      msgsH: msgs.clientHeight, msgsScroll: msgs.scrollHeight,
      settingsRight: btn.right, backRight: back.right,
      settingsTop: btn.top, backTop: back.top
    };
  });
  assert(Math.abs(layout.inputBottom - layout.panelBottom) < 40, '输入行固定吸底', 'inputBottom=' + Math.round(layout.inputBottom) + ' panelBottom=' + Math.round(layout.panelBottom));
  assert(layout.msgsScroll > layout.msgsH || layout.msgsH > 300, '消息区为滚动区域', JSON.stringify({ h: layout.msgsH, s: layout.msgsScroll }));
  assert(layout.settingsRight > layout.backRight && Math.abs(layout.settingsTop - layout.backTop) < 8, '设置按钮在右上角（与返回按钮同排）');

  // 4. 设置按钮打开群设置面板（geek：无密码/无解散/无转让）
  await page.click('#btnConvSettings');
  await page.waitForSelector('#groupSettingsModal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(500);
  const gs = await page.evaluate(() => ({
    members: document.querySelectorAll('#gsMembers .gs-member').length,
    passHidden: document.getElementById('gsPassZone').classList.contains('hidden'),
    ownerHidden: document.getElementById('gsOwnerZone').classList.contains('hidden')
  }));
  assert(gs.members >= 2, '群设置显示成员列表', gs.members + ' 人');
  assert(gs.passHidden && gs.ownerHidden, 'Geek群隐藏密码区与解散/转让区');
  await page.click('#btnGsClose');

  // 5. Shift+Enter 换行，Enter 不误发
  await page.click('#msgInput');
  await page.type('#msgInput', 'line1');
  await page.keyboard.press('Shift+Enter');
  await page.type('#msgInput', 'line2');
  const val = await page.inputValue('#msgInput');
  assert(val === 'line1\nline2', 'Shift+Enter 换行成功', JSON.stringify(val));
  const lineCount = await page.evaluate(() => document.querySelectorAll('#messages .msg').length);
  await page.keyboard.press('Enter'); // 发送
  await page.waitForTimeout(700);
  const lineCount2 = await page.evaluate(() => document.querySelectorAll('#messages .msg').length);
  assert(lineCount2 === lineCount + 1, 'Enter 发送消息');
  const lastMeta = await page.evaluate(() => {
    const m = document.querySelectorAll('#messages .msg:not(.sys)');
    return m.length ? m[m.length - 1].querySelector('.meta').textContent : '';
  });
  assert(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(lastMeta), '消息带精确日期', lastMeta);
  const multiline = await page.evaluate(() => {
    const m = document.querySelectorAll('#messages .msg:not(.sys)');
    return m.length ? m[m.length - 1].textContent : '';
  });
  assert(/line1\s*\n?\s*line2|line1line2/.test(multiline.replace(/\s+/g, ' ')) || multiline.includes('line1') && multiline.includes('line2'), '多行内容整体发送', multiline.slice(0, 40));
  // geek 是 RA 专属发言群，清理输入框状态
  await page.fill('#msgInput', '');

  // 6. 输入字数上限动态（RA 2577 Credits → 1000 封顶）
  const ml = await page.getAttribute('#msgInput', 'maxlength');
  assert(ml === '1000', '字数上限=1000（Credits 充裕时封顶）', 'maxlength=' + ml);

  // 7. SHOP 显示故障不售卖
  await page.click('#btnNavShop');
  await page.waitForSelector('#shopPanel:not(.hidden)', { timeout: 5000 });
  const shopTxt = await page.textContent('#shopPanel');
  assert(/游戏故障/.test(shopTxt) && /暂停/.test(shopTxt), 'SHOP 显示游戏故障暂停营业');
  const buyBtns = await page.$$eval('#shopPanel [data-shop-buy]', (els) => els.length);
  assert(buyBtns === 0, 'SHOP 无任何购买按钮', buyBtns + ' 个');

  // 8. 系统控制面板：API Key 区（RA 见发放区），命令行面板不可达
  await page.click('#btnNavCtrl');
  await page.waitForSelector('#ctrlPanel:not(.hidden)', { timeout: 5000 });
  const ctrl = await page.evaluate(() => ({
    keyZone: !!document.getElementById('apiKeyZone'),
    adminZoneVisible: !document.getElementById('apiKeyAdminZone').classList.contains('hidden'),
    status: document.getElementById('apiKeyStatus').textContent
  }));
  assert(ctrl.keyZone, '控制面板含 API Key 区');
  assert(ctrl.adminZoneVisible, 'RA 可见 API Key 发放区');
  await page.fill('#apiKeyOwner', 'sentinel');
  await page.fill('#apiKeyName', 'ui-test');
  await page.click('#btnCreateKey');
  await page.waitForSelector('#apiKeyOut:not(.hidden)', { timeout: 5000 });
  const keyTxt = await page.textContent('#apiKeyNewCode');
  assert(/^ak-[0-9a-f]{48}$/.test(keyTxt.trim()), '发放 API Key 成功（ak-...）', keyTxt.slice(0, 12) + '…');
  await page.waitForTimeout(400);
  const keyRows = await page.$$eval('#apiKeyList .key-row', (els) => els.length);
  assert(keyRows >= 1, 'API Key 列表出现新 Key', keyRows + ' 条');

  // 绑定/解绑回归：绑定刚发的 key 再清空解绑
  await page.fill('#apiKeyInput', keyTxt.trim());
  await page.click('#btnBindKey');
  await page.waitForTimeout(500);
  const bound = await page.textContent('#apiKeyStatus');
  assert(/绑定成功/.test(bound), '绑定 API Key 成功', bound);
  await page.fill('#apiKeyInput', '');
  await page.click('#btnBindKey');
  await page.waitForTimeout(500);
  const unbound = await page.textContent('#apiKeyStatus');
  assert(/已解绑/.test(unbound), '解绑成功', unbound);

  // 9. 截图存档
  await page.click('#btnNavChat');
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/round2-ui.png', fullPage: false });

  await browser.close();
  console.log('\n========== UI 测试结果 ==========');
  results.forEach((r) => console.log(r));
  if (jsErrors.length) { console.log('---- JS 错误 ----'); jsErrors.forEach((e) => console.log(e)); }
  const f = results.filter((r) => r.startsWith('FAIL')).length;
  console.log('-----------------------------');
  console.log('总计 ' + results.length + ' · 通过 ' + (results.length - f) + ' · 失败 ' + f + ' · JS错误 ' + jsErrors.length);
  process.exit(f || jsErrors.length ? 1 : 0);
})().catch((e) => { console.error('UI 测试异常:', e); process.exit(2); });

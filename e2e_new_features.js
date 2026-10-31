// e2e (v2, idempotent): 观测者发言/计费 + RA 专属面板 + 注销级联删除 B 类私聊
// 不再依赖"纯净本地库"：RA 已存在时自动改用登录。
const BASE = "http://127.0.0.1:8787";
const WS = "ws://127.0.0.1:8787/room?token=";
const results = [];
let failed = 0;
function ok(name, cond, extra) {
  const pass = !!cond;
  if (!pass) failed++;
  results.push((pass ? "PASS " : "FAIL ") + name + (extra ? "  -> " + extra : ""));
}
function stage(s) { console.log("  [" + s + "]"); }
async function call(method, path, { body, token, raw } = {}) {
  const headers = {};
  if (token) headers["Authorization"] = "Bearer " + token;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(BASE + path, { method, headers, body: payload });
  let data = null; try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function wsConnect(token, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(WS + encodeURIComponent(token));
    ws.binaryType = "arraybuffer";
    const msgs = [];
    ws.onmessage = (e) => { try { msgs.push(JSON.parse(e.data)); } catch (_) { msgs.push({ raw: e.data }); } };
    ws.onopen = () => { settled = true; resolve({ ws, msgs }); };
    ws.onerror = (e) => { if (!settled) { settled = true; reject(new Error("WS连接失败 [" + label + "] code=" + (e && e.code) + " msg=" + (e && e.message))); } };
    ws.onclose = (e) => { if (!settled) { settled = true; reject(new Error("WS被关闭 [" + label + "] code=" + e.code + " reason=" + e.reason)); } };
    setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch (_) {} reject(new Error("WS连接超时 [" + label + "]")); } }, 8000);
  });
}
function sendObj(ws, obj) { ws.send(JSON.stringify(obj)); }

const rand = Math.random().toString(36).slice(2, 7);
const RA_FIXED = "e2e_ra";
const obsName = "obs_" + rand;
const mbrName = "mbr_" + rand;
const PW = "e2epass1";

(async () => {
  // 1) RA 引导（幂等：已存在则登录）
  stage("bootstrap RA");
  let r = await call("POST", "/api/register", { body: { username: RA_FIXED, password: PW } });
  let raTok, raName = RA_FIXED;
  if (r.status === 200 && r.data.token) {
    raTok = r.data.token;
    ok("RA 注册成 Root-Admin", r.data.role === "root-admin", "role=" + r.data.role);
  } else {
    r = await call("POST", "/api/login", { body: { username: RA_FIXED, password: PW } });
    raTok = r.data && r.data.token;
    ok("RA 已存在，登录复用", r.status === 200 && !!raTok, "status=" + r.status);
  }
  if (!raTok) { console.error("无法获取 RA token，终止"); process.exit(2); }

  // 2) 发放兑换码（给观测者充钱用于计费断言）
  stage("发放 OTP");
  r = await call("POST", "/api/admin/create-otp", { body: { amount: 100000, days: 7 }, token: raTok });
  ok("RA 生成兑换码", r.status === 200 && r.data.code, "status=" + r.status);
  const otp = r.data.code;

  // 3) RA 建观测者 + 成员（每次用随机名，可重复跑）
  stage("创建观测者/成员");
  r = await call("POST", "/api/admin/create-account", { body: { username: obsName, password: PW, role: "observer" }, token: raTok });
  ok("RA 创建观测者 obs", r.status === 200 && r.data.ok, "status=" + r.status);
  r = await call("POST", "/api/admin/create-account", { body: { username: mbrName, password: PW, role: "member" }, token: raTok });
  ok("RA 创建成员 mbr", r.status === 200 && r.data.ok, "status=" + r.status);

  // 4) obs 登录 + 兑换充值
  stage("obs 登录 + 充值");
  r = await call("POST", "/api/login", { body: { username: obsName, password: PW } });
  ok("obs 登录", r.status === 200 && r.data.token, "status=" + r.status);
  const obsTok = r.data.token;
  await call("POST", "/api/otp/redeem", { body: { code: otp }, token: obsTok });
  const obsPts0 = (await call("GET", "/api/me", { token: obsTok })).data.points;
  ok("obs 余额 >= 100000", obsPts0 >= 100000, "pts=" + obsPts0);

  // 4a) file:<obs> 可发言且免费
  stage("4a 文件传输助手发言");
  let c = await wsConnect(obsTok, "file-helper");
  sendObj(c.ws, { type: "join-room", room: "file:" + obsName });
  await sleep(400);
  c.msgs.length = 0;
  sendObj(c.ws, { text: "hi" });
  await sleep(500);
  const fileMsg = c.msgs.find((m) => m.type === "msg" && m.sender === obsName && m.text === "hi");
  const fileSys = c.msgs.find((m) => m.type === "sys");
  ok("观测者在文件传输助手发言成功", !!fileMsg, "sys=" + (fileSys && fileSys.text));
  const obsPts1 = (await call("GET", "/api/me", { token: obsTok })).data.points;
  ok("文件传输助手发言免费(余额不变)", obsPts1 === obsPts0, "delta=" + (obsPts0 - obsPts1));

  // 4b) dm:<obs> 可发言且正常计费 10
  stage("4b 与 Root-Admin 私聊发言");
  sendObj(c.ws, { type: "join-room", room: "dm:" + obsName });
  await sleep(400);
  c.msgs.length = 0;
  sendObj(c.ws, { text: "hi" });
  await sleep(500);
  const dmMsg = c.msgs.find((m) => m.type === "msg" && m.sender === obsName && m.text === "hi");
  const dmSys = c.msgs.find((m) => m.type === "sys");
  ok("观测者在与 Root-Admin 私聊发言成功", !!dmMsg, "sys=" + (dmSys && dmSys.text));
  const obsPts2 = (await call("GET", "/api/me", { token: obsTok })).data.points;
  ok("与 Root-Admin 私聊发言计费=10(2字)", obsPts0 - obsPts2 === 10, "delta=" + (obsPts0 - obsPts2));
  try { c.ws.close(); } catch (_) {}

  // 4c) 观测者在 A 群不可发言
  stage("4c A 群发言拦截");
  r = await call("POST", "/api/rooms/create", { body: { name: "obsGrp" + rand, members: [obsName] }, token: raTok });
  ok("RA 建 A 群并拉观测者入群", r.status === 200 && r.data.ok, "status=" + r.status);
  const obsGroup = r.data.room.id;
  c = await wsConnect(obsTok, "a-group");
  sendObj(c.ws, { type: "join-room", room: obsGroup });
  await sleep(400);
  c.msgs.length = 0;
  sendObj(c.ws, { text: "hello group" });
  await sleep(500);
  const grpMsg = c.msgs.find((m) => m.type === "msg" && m.sender === obsName);
  const grpRej = c.msgs.find((m) => m.type === "sys" && /围观/.test(m.text || ""));
  ok("观测者在 A 群发言被拦截(无 msg 且有拒绝 sys)", !grpMsg && !!grpRej, "rej=" + (grpRej && grpRej.text));
  try { c.ws.close(); } catch (_) {}

  // 5) 面板 RA 专属：静态 HTML 默认隐藏 RA 专属区
  stage("5 面板静态检查");
  const html = await (await fetch(BASE + "/")).text();
  ok("静态 HTML 中 createAccZone 默认 hidden", /class="ctrl-col hidden" id="createAccZone"/.test(html));
  ok("静态 HTML 中 otpZone 默认 hidden", /class="ctrl-col hidden" id="otpZone"/.test(html));
  ok("静态 HTML 含 btnNavCtrl 入口", /id="btnNavCtrl"/.test(html));
  // 运行时：非 RA 的 renderMe else 分支会把 btnNavCtrl 加 hidden（代码审查已确认）
  ok("前端 JS 对非 RA 隐藏 btnNavCtrl", /btnNavCtrl'\)\.classList\.add\('hidden'\)/.test(html));

  // 6) 注销级联删除 B 类私聊
  stage("6 注销级联");
  r = await call("POST", "/api/login", { body: { username: mbrName, password: PW } });
  ok("mbr 登录(触发 builtins 建 B 类私聊)", r.status === 200 && r.data.token, "status=" + r.status);
  const mbrTok = r.data.token;
  await call("GET", "/api/rooms", { token: mbrTok });
  r = await call("GET", "/api/rooms", { token: raTok });
  const before = ((r.data && r.data.rooms) || []).find((x) => x.id === "dm:" + mbrName);
  ok("注销前 RA 可见 mbr 的 B 类私聊 dm:<mbr>", !!before, "class=" + (before && before.class));

  r = await call("POST", "/api/admin/deactivate", { body: { username: mbrName, password: PW }, token: raTok });
  ok("RA 注销 mbr 成功", r.status === 200 && r.data.ok, "status=" + r.status);

  r = await call("GET", "/api/rooms", { token: raTok });
  const after = ((r.data && r.data.rooms) || []).find((x) => x.id === "dm:" + mbrName);
  ok("注销后 RA 列表不再含 dm:<mbr>", !after);

  // 库级联验证
  const { execSync } = require("child_process");
  const { writeFileSync, unlinkSync } = require("fs");
  const pyPath = "C:/Users/June2022/WorkBuddy/2026-10-20-22-26-37/v7-chat/_dbcheck.py";
  writeFileSync(pyPath,
    "import sqlite3, glob\n" +
    "fs=[x for x in glob.glob(r'C:/Users/June2022/WorkBuddy/2026-10-20-22-26-37/v7-chat/.wrangler/state/**/*.sqlite',recursive=True) if 'metadata' not in x and 'observability' not in x and '/do/' not in x.replace('\\\\','/')]\n" +
    "db=fs[0]\n" +
    "c=sqlite3.connect(db); cur=c.cursor()\n" +
    "room=cur.execute(\"SELECT id FROM rooms WHERE id=?\",('dm:" + mbrName + "',)).fetchone()\n" +
    "msg=cur.execute(\"SELECT COUNT(*) FROM messages WHERE room=?\",('dm:" + mbrName + "',)).fetchone()\n" +
    "mem=cur.execute(\"SELECT COUNT(*) FROM memberships WHERE room=?\",('dm:" + mbrName + "',)).fetchone()\n" +
    "mute=cur.execute(\"SELECT COUNT(*) FROM room_mutes WHERE room=?\",('dm:" + mbrName + "',)).fetchone()\n" +
    "acc=cur.execute(\"SELECT COUNT(*) FROM accounts WHERE username=?\",('" + mbrName + "',)).fetchone()\n" +
    "print('room',room,'msg',msg[0],'mem',mem[0],'mute',mute[0],'acc',acc[0])\n");
  const PYEXE = "C:/Users/June2022/.workbuddy/binaries/python/versions/3.13.12/python.exe";
  let dbOut = "";
  try { dbOut = execSync('"' + PYEXE + '" "' + pyPath + '"').toString(); } catch (e) { dbOut = "DBERR " + e.message; }
  ok("库级联：rooms/messages/memberships/accounts 均已删除 dm:<mbr>/mbr", /room None msg 0 mem 0 mute 0 acc 0/.test(dbOut), dbOut.trim());
  try { unlinkSync(pyPath); } catch (e) {}

  console.log("\n================ E2E NEW FEATURES (v2) ================");
  results.forEach((l) => console.log(l));
  console.log("==========================================================");
  console.log(failed === 0 ? "ALL PASS (" + results.length + ")" : failed + " FAILED / " + results.length);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error("SCRIPT ERROR:", e && e.stack ? e.stack : e); process.exit(2); });

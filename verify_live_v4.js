// 线上验证：内置群 / 成员信息 / 找回代码 / 凭据用后删除 / RA 重要文件完好
const fs = require("fs");
const BASE = "https://v7-chat.pages.dev";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; failures.push(name); console.log("  FAIL  " + name + (extra ? "  [" + extra + "]" : "")); }
}
async function call(method, path, opts) {
  const o = opts || {};
  const h = { "User-Agent": UA };
  if (o.token) h["Authorization"] = "Bearer " + o.token;
  let body;
  if (o.body !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(o.body); }
  const r = await fetch(BASE + path, { method, headers: h, body });
  let data = {};
  try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}
const PWD = process.env.V7_SEED_PASSWORDS ? JSON.parse(process.env.V7_SEED_PASSWORDS) : {};
const ADMINS = ["change-spec", "git-k", "kenkin", "big-energy", "teacher-student"];

(async () => {
  console.log("=== 1. 首页与新前端 ===");
  const home = await fetch(BASE + "/", { headers: { "User-Agent": UA } });
  const html = await home.text();
  ok("首页 HTTP 200", home.status === 200);
  for (const k of ["membersPanel", "btnNavMembers", "btnIssueRecoverCtrl", "btnIssueRecoverMembers",
                   "recoverModal", "setRecCode", "authRecCode", "btnForgotPwd", "bjClock"]) {
    ok("线上前端含 " + k, html.includes(k));
  }

  console.log("\n=== 2. 六个内置账号 + 内置群 ===");
  const raLogin = await call("POST", "/api/login", { body: { username: "deportee", password: PWD["deportee"] || "" } });
  const ra = raLogin.data.token;
  ok("RA 登录成功", raLogin.status === 200);
  const raRooms = await call("GET", "/api/rooms", { token: ra });
  const council = (raRooms.data.rooms || []).find((r) => r.id === "admin-council");
  ok("管理员交流群存在 / 名称正确 / C 类 / RA 群主",
     !!council && council.name === "管理员交流群" && council.class === "C" && council.creator === "deportee",
     JSON.stringify(council || {}));
  const tokens = {};
  for (const a of ADMINS) {
    const lg = await call("POST", "/api/login", { body: { username: a, password: PWD[a] || "" } });
    tokens[a] = lg.data.token;
    ok(a + " 可登录", lg.status === 200);
    const rooms = await call("GET", "/api/rooms", { token: lg.data.token });
    const small = (rooms.data.rooms || []).find((r) => r.id === "group:" + a);
    ok(a + " 的小群存在且群主正确", !!small && small.name === a + "的小群" && small.creator === a && small.class === "C");
    ok(a + " 在管理员交流群", (rooms.data.rooms || []).some((r) => r.id === "admin-council"));
  }
  const dis = await call("POST", "/api/rooms/disband", { token: ra, body: { id: "admin-council" } });
  ok("内置群不可解散", dis.status === 403);

  console.log("\n=== 3. RA 重要文件完好 ===");
  const manifest = JSON.parse(fs.readFileSync("cloud_backup_20261107/manifest.json", "utf-8"));
  const origIds = manifest.files.map((f) => f.id);
  const list = await call("GET", "/api/cloud/list", { token: ra });
  const liveIds = (list.data.files || []).map((f) => f.id);
  ok("原始 8 个重要文件 ID 全在", origIds.every((i) => liveIds.includes(i)),
     "live=" + liveIds.length);

  console.log("\n=== 4. 成员信息 / 注册归属 / 凭据用后删除（线上）===");
  ok("Admin 可看成员信息", (await call("GET", "/api/admin/members", { token: tokens["change-spec"] })).status === 200);
  ok("RA 不需要该页", (await call("GET", "/api/admin/members", { token: ra })).status === 403);
  const inv = await call("POST", "/api/admin/create-invite", {
    token: ra, body: { belongs_to: "change-spec", identity: "member" }
  });
  const code = inv.data.account_code;
  ok("发放凭据 32 位", inv.status === 200 && code && code.length === 32);
  const user = "lv4" + Date.now().toString(36).slice(-5);
  const reg = await call("POST", "/api/register", {
    body: { belongs_to: "change-spec", identity: "member", account_code: code,
            username: user, password: "verify123" }
  });
  ok("线上注册成功", reg.status === 200 && !!reg.data.token);
  const mem = await call("GET", "/api/admin/members", { token: tokens["change-spec"] });
  ok("成员信息页出现新用户", (mem.data.members || []).some((m) => m.username === user));
  const uRooms = await call("GET", "/api/rooms", { token: reg.data.token });
  ok("新用户自动加入管理员小群", (uRooms.data.rooms || []).some((r) => r.id === "group:change-spec"));
  const invites = await call("GET", "/api/admin/invites", { token: ra });
  ok("已使用凭据不再显示", !JSON.stringify(invites.data).includes(code));

  console.log("\n=== 5. 找回代码端到端（线上）===");
  const noPwd = await call("POST", "/api/recover/issue", { token: tokens["change-spec"], body: { username: user } });
  ok("Admin 不填密码被拒", noPwd.status === 400);
  const issueAdmin = await call("POST", "/api/recover/issue", {
    token: tokens["change-spec"], body: { username: user, password: PWD["change-spec"] || "" }
  });
  ok("Admin 正确派发", issueAdmin.status === 200 && issueAdmin.data.code);
  const ttl = issueAdmin.data.expiresAt
    ? Math.round((new Date(issueAdmin.data.expiresAt) - new Date()) / 60000) : -1;
  ok("有效期 35 分钟", ttl >= 34 && ttl <= 35, "ttl=" + ttl);
  const issueRa = await call("POST", "/api/recover/issue", { token: ra, body: { username: user } });
  ok("RA 派发无需密码", issueRa.status === 200 && issueRa.data.code);
  const rec = issueAdmin.data.code;
  const reset = await call("POST", "/api/recover/reset", {
    body: { code: rec, username: user, newPassword: "newpass123", confirmPassword: "newpass123" }
  });
  ok("重置密码成功", reset.status === 200);
  ok("新密码可登录", (await call("POST", "/api/login", { body: { username: user, password: "newpass123" } })).status === 200);
  ok("代码不可重复使用", (await call("POST", "/api/recover/reset", {
    body: { code: rec, username: user, newPassword: "again1234", confirmPassword: "again1234" }
  })).status === 404);

  console.log("\n=== 6. 日志留痕 + 清理测试账号 ===");
  const logs = await call("GET", "/api/logs", { token: ra });
  const raw = JSON.stringify(logs.data);
  ok("日志含 recover_issue / recover_used", raw.includes("recover_issue") && raw.includes("recover_used"));
  ok("日志不含完整找回代码", !raw.includes(rec));
  const clean = await call("POST", "/api/admin/deactivate", {
    token: ra, body: { username: user, password: PWD["deportee"] || "" }
  });
  ok("测试账号已清理", clean.status === 200, "status=" + clean.status + " " + JSON.stringify(clean.data));

  console.log("\n=== 汇总 ===");
  console.log("  PASS " + pass + "   FAIL " + fail);
  if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("    - " + f)); process.exitCode = 1; }
})().catch((e) => { console.error("脚本异常：", e); process.exitCode = 1; });

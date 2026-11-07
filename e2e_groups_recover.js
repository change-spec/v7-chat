// e2e: 内置管理员群 / 成员信息 / 找回代码 / 凭据用后删除 / 日志留痕
const BASE = process.env.BASE || "http://127.0.0.1:8788";
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
  console.log("=== 0. 打开首页触发内置数据自愈 ===");
  await fetch(BASE + "/", { headers: { "User-Agent": UA } });
  const raLogin = await call("POST", "/api/login", { body: { username: "deportee", password: PWD["deportee"] || "" } });
  const ra = raLogin.data.token;
  ok("RA 登录成功", raLogin.status === 200 && !!ra);

  console.log("\n=== 1. 内置 C 类群 ===");
  const raRooms = await call("GET", "/api/rooms", { token: ra });
  const council = (raRooms.data.rooms || []).find((r) => r.id === "admin-council");
  ok("管理员交流群存在", !!council, JSON.stringify(raRooms.data.rooms || []).slice(0, 200));
  ok("群名 = 管理员交流群", council && council.name === "管理员交流群");
  ok("class = C", council && council.class === "C");
  ok("群主 = deportee", council && council.creator === "deportee");
  const tokens = {};
  for (const a of ADMINS) {
    const lg = await call("POST", "/api/login", { body: { username: a, password: PWD[a] || "" } });
    tokens[a] = lg.data.token;
    const rooms = await call("GET", "/api/rooms", { token: lg.data.token });
    const small = (rooms.data.rooms || []).find((r) => r.id === "group:" + a);
    const inCouncil = (rooms.data.rooms || []).some((r) => r.id === "admin-council");
    ok(a + " 的小群存在且名正确", !!small && small.name === a + "的小群", small && small.name);
    ok(a + " 是自己的小群群主 / class=C", !!small && small.creator === a && small.class === "C");
    ok(a + " 在管理员交流群里", inCouncil);
  }

  console.log("\n=== 2. 内置群不可解散 / 不可转让 ===");
  const d1 = await call("POST", "/api/rooms/disband", { token: ra, body: { id: "admin-council" } });
  ok("管理员交流群不可解散", d1.status === 403, "status=" + d1.status);
  const d2 = await call("POST", "/api/rooms/disband", { token: tokens["change-spec"], body: { id: "group:change-spec" } });
  ok("管理员小群不可解散", d2.status === 403, "status=" + d2.status);
  const tr = await call("POST", "/api/rooms/transfer", { token: ra, body: { id: "admin-council", target: "git-k" } });
  ok("内置群不可转让", tr.status === 403, "status=" + tr.status);

  console.log("\n=== 3. 成员信息页权限 ===");
  const memAdmin = await call("GET", "/api/admin/members", { token: tokens["change-spec"] });
  ok("Admin 可查看成员信息", memAdmin.status === 200, "status=" + memAdmin.status);
  const memRa = await call("GET", "/api/admin/members", { token: ra });
  ok("Root-Admin 不需要该页（403）", memRa.status === 403, "status=" + memRa.status);

  console.log("\n=== 4. 新用户注册：写归属、自动入小群、凭据用后删除 ===");
  const inv = await call("POST", "/api/admin/create-invite", {
    token: ra, body: { belongs_to: "change-spec", identity: "member" }
  });
  const code = inv.data.account_code;
  ok("发放凭据成功", inv.status === 200 && code && code.length === 32);
  const user = "gm" + Date.now().toString(36).slice(-6);
  const reg = await call("POST", "/api/register", {
    body: { belongs_to: "change-spec", identity: "member", account_code: code,
            username: user, password: "verify123" }
  });
  ok("完成注册", reg.status === 200 && !!reg.data.token, "status=" + reg.status);
  const memAfter = await call("GET", "/api/admin/members", { token: tokens["change-spec"] });
  ok("成员信息页出现新用户", (memAfter.data.members || []).some((m) => m.username === user),
     JSON.stringify(memAfter.data.members || []).slice(0, 200));
  const userRooms = await call("GET", "/api/rooms", { token: reg.data.token });
  ok("新用户自动加入 change-spec 的小群",
     (userRooms.data.rooms || []).some((r) => r.id === "group:change-spec"));
  const invites = await call("GET", "/api/admin/invites", { token: ra });
  ok("已使用凭据不再显示（仅日志留痕）", !JSON.stringify(invites.data).includes(code));

  console.log("\n=== 5. 找回代码：派发约束 ===");
  const noPwd = await call("POST", "/api/recover/issue", { token: tokens["change-spec"], body: { username: user } });
  ok("Admin 不填密码被拒", noPwd.status === 400, "status=" + noPwd.status);
  const badPwd = await call("POST", "/api/recover/issue", {
    token: tokens["change-spec"], body: { username: user, password: "wrong" }
  });
  ok("Admin 密码错误被拒", badPwd.status === 401, "status=" + badPwd.status);
  const notMine = await call("POST", "/api/recover/issue", {
    token: tokens["change-spec"], body: { username: "deportee", password: PWD["change-spec"] || "" }
  });
  ok("不可给不归属自己的用户派发", notMine.status === 403, "status=" + notMine.status);
  const issueA = await call("POST", "/api/recover/issue", {
    token: tokens["change-spec"], body: { username: user, password: PWD["change-spec"] || "" }
  });
  ok("Admin 正确派发成功", issueA.status === 200 && issueA.data.code, "status=" + issueA.status);
  const recA = issueA.data.code;
  const ttlMin = recA && issueA.data.expiresAt
    ? Math.round((new Date(issueA.data.expiresAt) - new Date()) / 60000) : -1;
  ok("有效期 35 分钟", ttlMin >= 34 && ttlMin <= 35, "ttl=" + ttlMin);
  const issueR = await call("POST", "/api/recover/issue", { token: ra, body: { username: user } });
  ok("Root-Admin 派发无需密码", issueR.status === 200 && issueR.data.code, "status=" + issueR.status);
  const recR = issueR.data.code;
  ok("两次派发代码不同", recA !== recR);

  console.log("\n=== 6. 找回代码：使用与一次性 ===");
  const mismatch = await call("POST", "/api/recover/reset", {
    body: { code: recA, username: user, newPassword: "newpass123", confirmPassword: "different" }
  });
  ok("两次新密码不一致被拒", mismatch.status === 400, "status=" + mismatch.status);
  const badCode = await call("POST", "/api/recover/reset", {
    body: { code: "deadbeef", username: user, newPassword: "newpass123", confirmPassword: "newpass123" }
  });
  ok("无效代码被拒", badCode.status === 404, "status=" + badCode.status);
  const wrongUser = await call("POST", "/api/recover/reset", {
    body: { code: recA, username: "deportee", newPassword: "newpass123", confirmPassword: "newpass123" }
  });
  ok("用户名与代码不匹配被拒", wrongUser.status === 403, "status=" + wrongUser.status);
  const reset = await call("POST", "/api/recover/reset", {
    body: { code: recA, username: user, newPassword: "newpass123", confirmPassword: "newpass123" }
  });
  ok("重置密码成功", reset.status === 200, "status=" + reset.status);
  const loginNew = await call("POST", "/api/login", { body: { username: user, password: "newpass123" } });
  ok("新密码可登录", loginNew.status === 200);
  const loginOld = await call("POST", "/api/login", { body: { username: user, password: "verify123" } });
  ok("旧密码已失效", loginOld.status === 401);
  const reuse = await call("POST", "/api/recover/reset", {
    body: { code: recA, username: user, newPassword: "again1234", confirmPassword: "again1234" }
  });
  ok("代码不可重复使用（用后已删除）", reuse.status === 404, "status=" + reuse.status);
  const stillValid = await call("POST", "/api/recover/reset", {
    body: { code: recR, username: user, newPassword: "again1234", confirmPassword: "again1234" }
  });
  ok("同用户另一条有效代码不受影响", stillValid.status === 200, "status=" + stillValid.status);

  console.log("\n=== 7. 日志留痕（不含代码本身）===");
  const logs = await call("GET", "/api/logs", { token: ra });
  const raw = JSON.stringify(logs.data);
  ok("日志含派发记录", raw.includes("recover_issue"));
  ok("日志含使用记录", raw.includes("recover_used"));
  ok("有激活凭据的日志留痕", raw.includes("activate_account"));
  ok("日志不含完整找回代码", !raw.includes(recA) && !raw.includes(recR));

  console.log("\n=== 汇总 ===");
  console.log("  PASS " + pass + "   FAIL " + fail);
  if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("    - " + f)); process.exitCode = 1; }
})().catch((e) => { console.error("脚本异常：", e); process.exitCode = 1; });

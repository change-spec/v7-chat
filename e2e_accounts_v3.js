// e2e: 内置账号固化 + 邀请凭据注册链路 + 125MB 上限 + 试用手动申请
// 用法：node e2e_accounts_v3.js（需先起 wrangler pages dev dist --port 8788）
const BASE = process.env.BASE || "http://127.0.0.1:8788";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; failures.push(name + (extra ? "  [" + extra + "]" : "")); console.log("  FAIL  " + name + (extra ? "  [" + extra + "]" : "")); }
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

const SEED = [
  ["deportee",        "RA-541418081",      "root-admin"],
  ["change-spec",     "change-541418081",  "admin"],
  ["git-k",           "git-2401306030332", "admin"],
  ["kenkin",          "kk-2401306030332",  "admin"],
  ["big-energy",      "be-2401306030332",  "admin"],
  ["teacher-student", "ts-2401306030332",  "admin"],
];

(async () => {
  console.log("=== 0. 打开首页触发内置账号自愈 ===");
  const home = await fetch(BASE + "/", { headers: { "User-Agent": UA } });
  ok("首页 HTTP 200", home.status === 200, "status=" + home.status);

  console.log("\n=== 1. 六个内置账号：存在且密码可用（验证固定 hash 与 JS 算法一致）===");
  const tokens = {};
  for (const [u, p, role] of SEED) {
    const r = await call("POST", "/api/login", { body: { username: u, password: p } });
    tokens[u] = r.data.token;
    ok(u + " 可登录且角色 " + role, r.status === 200 && r.data.role === role,
       "status=" + r.status + " role=" + r.data.role);
  }
  const raTok = tokens["deportee"];
  ok("Root-Admin token 有效", !!raTok);

  console.log("\n=== 2. 云存储角色上限 ===");
  const adminSt = await call("GET", "/api/cloud/status", { token: tokens["change-spec"] });
  ok("admin 上限 125MB", adminSt.data.capMb === 125, "capMb=" + adminSt.data.capMb);
  ok("admin 自动续费强制开启", adminSt.data.autoRenew === true);

  console.log("\n=== 3. 内置账号不可注销 / 不可额外创建管理员 ===");
  const deact = await call("POST", "/api/admin/deactivate", {
    token: raTok, body: { username: "change-spec", password: "RA-541418081" }
  });
  ok("五个管理员之一不可注销", deact.status === 403, "status=" + deact.status + " " + JSON.stringify(deact.data));
  const selfDeact = await call("POST", "/api/admin/deactivate", {
    token: raTok, body: { username: "deportee", password: "RA-541418081" }
  });
  ok("Root-Admin 自身不可注销", selfDeact.status === 400 || selfDeact.status === 403, "status=" + selfDeact.status);
  const extraAdmin = await call("POST", "/api/admin/create-account", {
    token: raTok, body: { username: "xextraadmin", password: "verify123", role: "admin" }
  });
  ok("不可额外创建管理员账号", extraAdmin.status === 403, "status=" + extraAdmin.status);
  // 注销后账号必须还在
  const still = await call("POST", "/api/login", { body: { username: "change-spec", password: "change-541418081" } });
  ok("注销尝试后管理员账号仍存在", still.status === 200);

  console.log("\n=== 4. RA 创建凭据：只发凭据，不建账号 ===");
  const before = await call("GET", "/api/admin/accounts", { token: raTok });
  const invite = await call("POST", "/api/admin/create-invite", {
    token: raTok, body: { belongs_to: "change-spec", identity: "member" }
  });
  const code = invite.data.account_code;
  ok("创建成功", invite.status === 200 && invite.data.ok === true, "status=" + invite.status);
  ok("account_code 为 32 位", typeof code === "string" && code.length === 32, "len=" + (code || "").length);
  ok("完整信息含三字段", !!invite.data.belongs_to && !!invite.data.identity && !!code);
  ok("belongs_to = change-spec", invite.data.belongs_to === "change-spec");
  ok("identity = member", invite.data.identity === "member");
  const after = await call("GET", "/api/admin/accounts", { token: raTok });
  const nBefore = (before.data.accounts || []).length, nAfter = (after.data.accounts || []).length;
  ok("创建凭据后账号数不变（账户尚未创建）", nBefore === nAfter, nBefore + " -> " + nAfter);

  console.log("\n=== 5. 下拉约束的服务端校验 ===");
  const badIdentity = await call("POST", "/api/admin/create-invite", {
    token: raTok, body: { belongs_to: "change-spec", identity: "admin" }
  });
  ok("identity=admin 被拒", badIdentity.status === 400, "status=" + badIdentity.status);
  const badBelongs = await call("POST", "/api/admin/create-invite", {
    token: raTok, body: { belongs_to: "nobody", identity: "member" }
  });
  ok("非法 belongs_to 被拒", badBelongs.status === 400, "status=" + badBelongs.status);
  const notRa = await call("POST", "/api/admin/create-invite", {
    token: tokens["change-spec"], body: { belongs_to: "change-spec", identity: "member" }
  });
  ok("非 Root-Admin 不能发凭据", notRa.status === 403, "status=" + notRa.status);

  console.log("\n=== 6. 「我记完了」后不再完整显示 ===");
  const seen = await call("POST", "/api/admin/invite-seen", { token: raTok, body: { code } });
  ok("标记成功", seen.status === 200 && seen.data.ok === true);
  const invites = await call("GET", "/api/admin/invites", { token: raTok });
  const raw = JSON.stringify(invites.data);
  ok("列表响应不含完整 code", !raw.includes(code), "leaked=" + raw.includes(code));
  const first = (invites.data.invites || [])[0];
  ok("codeMask 已脱敏", !!first && first.codeMask.includes("********"), JSON.stringify(first));
  ok("列表标注 revealed", !!first && first.revealed === true);

  console.log("\n=== 7. 注册页第一步：三字段验证 ===");
  const vBadCode = await call("POST", "/api/register/verify", {
    body: { belongs_to: "change-spec", identity: "member", account_code: "deadbeef" }
  });
  ok("无效 code 被拒", vBadCode.status === 404, "status=" + vBadCode.status);
  const vMismatch = await call("POST", "/api/register/verify", {
    body: { belongs_to: "git-k", identity: "member", account_code: code }
  });
  ok("belongs_to 不匹配被拒", vMismatch.status === 403, "status=" + vMismatch.status);
  const vIdMismatch = await call("POST", "/api/register/verify", {
    body: { belongs_to: "change-spec", identity: "observer", account_code: code }
  });
  ok("identity 不匹配被拒", vIdMismatch.status === 403, "status=" + vIdMismatch.status);
  const vOk = await call("POST", "/api/register/verify", {
    body: { belongs_to: "change-spec", identity: "member", account_code: code }
  });
  ok("三项匹配验证通过", vOk.status === 200 && vOk.data.ok === true, "status=" + vOk.status);
  const afterVerify = await call("GET", "/api/admin/accounts", { token: raTok });
  ok("仅验证凭据不创建账号", (afterVerify.data.accounts || []).length === nBefore);

  console.log("\n=== 8. 注册页第二步：设置用户名密码后账户才创建完成 ===");
  const newUser = "reg" + Date.now().toString(36).slice(-6);
  const reg = await call("POST", "/api/register", {
    body: { belongs_to: "change-spec", identity: "member", account_code: code,
            username: newUser, password: "verify123" }
  });
  ok("完成注册成功", reg.status === 200 && !!reg.data.token, "status=" + reg.status + " " + JSON.stringify(reg.data));
  ok("角色为 member", reg.data.role === "member", "role=" + reg.data.role);
  ok("返回归属", reg.data.belongsTo === "change-spec");
  const me = await call("GET", "/api/me", { token: reg.data.token });
  ok("新账号 token 可用", me.status === 200 && me.data.username === newUser, "status=" + me.status);
  const loginNew = await call("POST", "/api/login", { body: { username: newUser, password: "verify123" } });
  ok("新账号可用自设密码登录", loginNew.status === 200);
  const dup = await call("POST", "/api/register", {
    body: { belongs_to: "change-spec", identity: "member", account_code: code,
            username: "another" + newUser.slice(-3), password: "verify123" }
  });
  ok("同一凭据不可重复激活", dup.status === 409, "status=" + dup.status);

  console.log("\n=== 9. 试用空间必须手动申请 + 密码确认 ===");
  const t0 = await call("GET", "/api/cloud/trial/status", { token: reg.data.token });
  ok("未申请时没有试用空间（不会自动发放）", t0.data.trial === null, JSON.stringify(t0.data.trial));
  const noPwd = await call("POST", "/api/cloud/trial/claim", { token: reg.data.token, body: {} });
  ok("不输密码被拒", noPwd.status === 400, "status=" + noPwd.status);
  const badPwd = await call("POST", "/api/cloud/trial/claim", { token: reg.data.token, body: { password: "wrong-pass" } });
  ok("密码错误被拒", badPwd.status === 401, "status=" + badPwd.status);
  const goodPwd = await call("POST", "/api/cloud/trial/claim", { token: reg.data.token, body: { password: "verify123" } });
  ok("正确密码申请成功", goodPwd.status === 200, "status=" + goodPwd.status + " " + JSON.stringify(goodPwd.data).slice(0, 120));
  const t1 = await call("GET", "/api/cloud/trial/status", { token: reg.data.token });
  ok("试用空间 5MB / 7 天已发放", t1.data.trial && t1.data.trial.totalMb === 5, JSON.stringify(t1.data.trial));
  const again = await call("POST", "/api/cloud/trial/claim", { token: reg.data.token, body: { password: "verify123" } });
  ok("每账号只能申请一次", again.status === 409, "status=" + again.status);

  console.log("\n=== 汇总 ===");
  console.log("  PASS " + pass + "   FAIL " + fail);
  if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("    - " + f)); process.exitCode = 1; }
})().catch((e) => { console.error("脚本异常：", e); process.exitCode = 1; });

// 线上验证：内置账号 / 125MB / 邀请注册链路 / 重要文件完好
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
// 内置账号口令一律从环境变量注入，绝不写进仓库（本仓库是 public）。
// 用法：V7_SEED_PASSWORDS='{"deportee":"...","change-spec":"..."}' node verify_live_v3.js
const PWD = process.env.V7_SEED_PASSWORDS ? JSON.parse(process.env.V7_SEED_PASSWORDS) : {};
const SEED = [
  ["deportee", "root-admin"],
  ["change-spec", "admin"],
  ["git-k", "admin"],
  ["kenkin", "admin"],
  ["big-energy", "admin"],
  ["teacher-student", "admin"]
].map(function (x) { return [x[0], PWD[x[0]] || "", x[1]]; });
(async () => {
  console.log("=== 1. 首页与新前端 ===");
  const home = await fetch(BASE + "/", { headers: { "User-Agent": UA } });
  const html = await home.text();
  ok("首页 HTTP 200", home.status === 200, "status=" + home.status);
  for (const k of ["registerView", "regVerifyBtn", "inviteBelongs", "btnInviteSeen", "trialPwd", "bjClock", "__uiScroll"]) {
    ok("线上前端含 " + k, html.includes(k));
  }
  ok("SHOP 新文案在位", html.includes("所有游戏的游戏引擎均被查出故障"));
  ok("旧自相矛盾文案已清", !html.includes("已购买的房间号不受影响"));

  console.log("\n=== 2. 六个内置账号在真实 D1 上生效 ===");
  const tokens = {};
  for (const [u, p, role] of SEED) {
    const r = await call("POST", "/api/login", { body: { username: u, password: p } });
    tokens[u] = r.data.token;
    ok(u + " 可登录 / " + role, r.status === 200 && r.data.role === role,
       "status=" + r.status + " role=" + r.data.role);
  }
  const ra = tokens["deportee"];
  ok("RA token 有效", !!ra);

  console.log("\n=== 3. 配额与自动续费 ===");
  const raSt = await call("GET", "/api/cloud/status", { token: ra });
  ok("RA 云空间 2048MB", raSt.data.totalMb === 2048, "totalMb=" + raSt.data.totalMb);
  const adminSt = await call("GET", "/api/cloud/status", { token: tokens["change-spec"] });
  ok("admin 上限 125MB", adminSt.data.capMb === 125, "capMb=" + adminSt.data.capMb);
  ok("admin 自动续费强制开启", adminSt.data.autoRenew === true);

  console.log("\n=== 4. RA 重要文件一个没丢 ===");
  const manifest = JSON.parse(fs.readFileSync("cloud_backup_20261107/manifest.json", "utf-8"));
  const origIds = manifest.files.map((f) => f.id);
  const list = await call("GET", "/api/cloud/list", { token: ra });
  const liveIds = (list.data.files || []).map((f) => f.id);
  const lost = origIds.filter((i) => !liveIds.includes(i));
  ok("原始 8 个文件 ID 全在", lost.length === 0, "lost=" + JSON.stringify(lost) + " live=" + liveIds.length);

  console.log("\n=== 5. 邀请凭据链路（线上）===");
  const inv = await call("POST", "/api/admin/create-invite", {
    token: ra, body: { belongs_to: "change-spec", identity: "observer" }
  });
  const code = inv.data.account_code;
  ok("发放成功 / 32 位 code", inv.status === 200 && code && code.length === 32, "status=" + inv.status);
  const v = await call("POST", "/api/register/verify", {
    body: { belongs_to: "change-spec", identity: "observer", account_code: code }
  });
  ok("注册页三字段验证通过", v.status === 200 && v.data.ok === true, "status=" + v.status);
  const seen = await call("POST", "/api/admin/invite-seen", { token: ra, body: { code } });
  ok("我记完了标记成功", seen.status === 200);
  const invites = await call("GET", "/api/admin/invites", { token: ra });
  ok("列表不含完整 code", !JSON.stringify(invites.data).includes(code));

  // 完整注册一次，验证线上端到端，然后注销测试账号，不留垃圾
  const testUser = "lv" + Date.now().toString(36).slice(-6);
  const reg = await call("POST", "/api/register", {
    body: { belongs_to: "change-spec", identity: "observer", account_code: code,
            username: testUser, password: "verify123" }
  });
  ok("线上完整注册成功", reg.status === 200 && !!reg.data.token, "status=" + reg.status);
  ok("角色 observer", reg.data.role === "observer", "role=" + reg.data.role);
  const clean = await call("POST", "/api/admin/deactivate", {
    token: ra, body: { username: testUser, password: PWD["deportee"] || "" }
  });
  ok("测试账号已清理", clean.status === 200, "status=" + clean.status + " " + JSON.stringify(clean.data));

  console.log("\n=== 6. 注销保护 / 试用手动申请 ===");
  const deact = await call("POST", "/api/admin/deactivate", {
    token: ra, body: { username: "git-k", password: PWD["deportee"] || "" }
  });
  ok("内置管理员不可注销", deact.status === 403, "status=" + deact.status);
  const tNoPwd = await call("POST", "/api/cloud/trial/claim", { token: ra, body: {} });
  ok("试用不输密码被拒", tNoPwd.status === 400, "status=" + tNoPwd.status);

  console.log("\n=== 汇总 ===");
  console.log("  PASS " + pass + "   FAIL " + fail);
  if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("    - " + f)); process.exitCode = 1; }
})().catch((e) => { console.error("脚本异常：", e); process.exitCode = 1; });

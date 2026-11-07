// 云存储 v2 测试：配额/角色上限/强制自动续费/到期收回/试用活动/文案
const BASE = process.env.BASE || "http://127.0.0.1:8788";
const R = [];
const ok = (n, c, e) => { R.push((c ? "PASS " : "FAIL ") + n + (e ? "  -> " + e : "")); return c; };

async function call(m, p, { body, token, raw, ct } = {}) {
  const h = { "User-Agent": "Mozilla/5.0" };
  if (token) h["Authorization"] = "Bearer " + token;
  let b;
  if (raw !== undefined) b = raw;
  else if (body !== undefined) { h["content-type"] = "application/json"; b = JSON.stringify(body); }
  if (ct) h["content-type"] = ct;
  const r = await fetch(BASE + p, { method: m, headers: h, body: b });
  const isJson = (r.headers.get("content-type") || "").includes("json");
  let d = null;
  if (isJson) { try { d = await r.json(); } catch {} }
  else d = { bytes: new Uint8Array(await r.arrayBuffer()) };
  return { status: r.status, data: d };
}
const pts = async (t) => (await call("GET", "/api/me", { token: t })).data.points;

(async () => {
  const u = "ra" + Date.now().toString(36).slice(-5);
  let r = await call("POST", "/api/register", { body: { username: u, password: "verify123" } });
  const ra = r.data.token;
  ok("RA 注册", r.status === 200 && !!ra, "role=" + r.data.role);

  // ① RA 配额 2048MB + 强制自动续费标记
  r = await call("GET", "/api/cloud/status", { token: ra });
  ok("RA 云空间 2048MB", r.data.totalMb === 2048, "totalMb=" + r.data.totalMb);
  ok("RA 自动续费显示开启", r.data.autoRenew === true);
  ok("RA 无收回待办", r.data.reclaimPending === false);

  // ② 活动窗口（此刻 < 16:00 北京时间应拒绝；若已过 16:00 则应可申请）
  r = await call("GET", "/api/cloud/trial/status", { token: ra });
  const now = Date.now(), START = Date.parse("2026-11-07T08:00:00Z"), END = Date.parse("2026-12-14T08:00:00Z");
  const inWindow = now >= START && now < END;
  ok("试用状态接口可用", r.status === 200, "open=" + r.data.open);
  ok("活动窗口判定与服务端一致", r.data.open === inWindow, "local=" + inWindow + " server=" + r.data.open);
  ok("试用额度 5MB / 7天", r.data.trialMb === 5 && r.data.trialDays === 7);
  ok("状态带北京时间", typeof r.data.beijingTime === "string" && r.data.beijingTime.length >= 19, r.data.beijingTime);
  r = await call("POST", "/api/cloud/trial/claim", { body: {}, token: ra });
  ok("窗口外申请被拒 / 窗口内可申请", inWindow ? r.status === 200 : r.status === 409, "status=" + r.status);

  // ③ 建 3 种角色账号，验证购买上限
  const roles = [["admin", 120], ["member", 60], ["observer", 10]];
  for (const [role, cap] of roles) {
    const un = role.slice(0, 2) + Date.now().toString(36).slice(-5);
    r = await call("POST", "/api/admin/create-account", { body: { username: un, password: "verify123", role }, token: ra });
    ok("建 " + role + " 账号", r.status === 200, "status=" + r.status);
    const tk = (await call("POST", "/api/login", { body: { username: un, password: "verify123" } })).data.token;
    const st = await call("GET", "/api/cloud/status", { token: tk });
    ok(role + " 上限 " + cap + "MB", st.data.capMb === cap, "capMb=" + st.data.capMb);
    ok(role + " 自动续费强制开启", st.data.autoRenew === true);
  }

  // ④ 强制自动续费：/api/cloud/renew 传 false 也必须写回 1
  const adm = "ad" + Date.now().toString(36).slice(-5);
  await call("POST", "/api/admin/create-account", { body: { username: adm, password: "verify123", role: "admin" }, token: ra });
  const adT = (await call("POST", "/api/login", { body: { username: adm, password: "verify123" } })).data.token;
  // 充值后买 1MB
  const code = (await call("POST", "/api/admin/create-otp", { body: { amount: 5000, days: 7 }, token: ra })).data.code;
  await call("POST", "/api/otp/redeem", { body: { code }, token: adT });
  r = await call("POST", "/api/cloud/buy", { body: { mb: 1 }, token: adT });
  ok("Admin 购买 1MB 成功", r.status === 200 && r.data.ok, "status=" + r.status);
  r = await call("POST", "/api/cloud/renew", { body: { autoRenew: false }, token: adT });
  ok("关闭自动续费被忽略（仍为 true）", r.status === 200 && r.data.autoRenew === true, "autoRenew=" + r.data.autoRenew);
  const stAd = await call("GET", "/api/cloud/status", { token: adT });
  ok("状态里自动续费仍为强制开启", stAd.data.autoRenew === true);
  ok("返回原价 renewCost = total_mb × 1190", stAd.data.renewCost === stAd.data.totalMb * 1190, "renewCost=" + stAd.data.renewCost);
  ok("返回续费窗口 20 分钟", stAd.data.autoRenewWindowMin === 20);

  // ⑤ 到期前 20 分钟：余额足够 → 自动原价扣费续期（直接改本地 D1 模拟）
  const cp = require("child_process");
  const NODE = "C:/Users/June2022/.workbuddy/binaries/node/versions/22.22.2/node.exe";
  const WR = "C:/Users/June2022/.workbuddy/binaries/node/workspace/node_modules/wrangler/bin/wrangler.js";
  function d1(sql) {
    cp.execSync(`"${NODE}" "${WR}" d1 execute v7-chat-db --local --command "${sql.replace(/"/g, "'")}"`, { stdio: "ignore", cwd: process.cwd() });
  }
  const soon = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 分钟后到期（在 20 分钟窗口内）
  d1(`UPDATE cloud_subs SET expires_at='${soon}' WHERE username='${adm}'`);
  const before = await pts(adT);
  r = await call("GET", "/api/cloud/status", { token: adT });
  const after = await pts(adT);
  ok("到期前 20 分钟内自动续费触发", r.data.renewed === true, "renewed=" + r.data.renewed);
  ok("按原价扣费", before - after === r.data.renewCost, before + " → " + after + " cost=" + r.data.renewCost);
  ok("到期时间向后推一个月", new Date(r.data.expiresAt).getTime() > Date.now() + 25 * 86400000, r.data.expiresAt);
  ok("续费后非过期状态", r.data.expired === false && r.data.reclaimPending === false);

  // ⑥ 余额不足 + 已到期 → 待收回，且不删文件
  d1(`UPDATE accounts SET points=0 WHERE username='${adm}'`);
  d1(`UPDATE cloud_subs SET expires_at='2020-01-01T00:00:00Z' WHERE username='${adm}'`);
  r = await call("GET", "/api/cloud/status", { token: adT });
  ok("余额不足且已到期 → reclaimPending", r.data.reclaimPending === true);
  ok("返回待下载文件清单", Array.isArray(r.data.reclaimFiles));
  // 上传一个文件到主空间，验证收回前文件在
  const payload = new TextEncoder().encode("RECLAIM-KEEP-ME");
  const up = await call("POST", "/api/cloud/upload?name=keep.txt&mime=text/plain", { token: adT, raw: payload, ct: "text/plain" });
  ok("主空间上传测试文件", up.status === 200 && up.data.ok, "status=" + up.status);
  const lst = await call("GET", "/api/cloud/list", { token: adT });
  const keepId = (lst.data.files || []).find(x => x.name === "keep.txt");
  ok("收回前文件仍在", !!keepId);
  // 只确认「已下载」的空列表 → 不应删任何文件、不应收回空间
  r = await call("POST", "/api/cloud/reclaim-done", { body: { downloadedIds: [] }, token: adT });
  ok("未确认下载时不删文件", r.data.remaining >= 1, "remaining=" + r.data.remaining);
  ok("未确认下载时不收回空间", r.data.reclaimed === false);

  // ⑦ 确认已下载 → 删除该文件并收回空间
  if (keepId) {
    r = await call("POST", "/api/cloud/reclaim-done", { body: { downloadedIds: [keepId.id] }, token: adT });
    ok("确认落盘后才删除文件", r.data.remaining === 0, "remaining=" + r.data.remaining);
    ok("全部下载完成后收回空间", r.data.reclaimed === true);
  }

  console.log("\n========== 云存储 v2 E2E ==========");
  R.forEach(l => console.log(l));
  console.log("====================================");
  console.log(R.every(x => x.startsWith("PASS")) ? "ALL PASS (" + R.length + ")" : R.filter(x => x.startsWith("FAIL")).length + " FAILED / " + R.length);
})().catch(e => { console.error("ERR", e.message, e.stack); process.exit(2); });

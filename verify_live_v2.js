// 线上验证：配额 / 活动 / 自动续费 / 北京时间 / 文案 / RA 文件完好
const BASE = "https://v7-chat.pages.dev";
const TOKEN = "09418a56065b06256eb971bd222d9395a911e984aa645855";
const R = [];
const ok = (n, c, e) => { R.push((c ? "PASS " : "FAIL ") + n + (e ? "  -> " + e : "")); };
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0", "Authorization": "Bearer " + TOKEN };

async function get(p, auth = true) {
  const r = await fetch(BASE + p, { headers: auth ? H : { "User-Agent": H["User-Agent"] } });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}
async function post(p, body, auth = true) {
  const r = await fetch(BASE + p, { method: "POST", headers: { ...(auth ? H : { "User-Agent": H["User-Agent"] }), "content-type": "application/json" }, body: JSON.stringify(body) });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}

(async () => {
  // ① 首页静态内容
  const html = await (await fetch(BASE + "/", { headers: { "User-Agent": H["User-Agent"] } })).text();
  ok("首页 HTTP 内容可读", html.length > 100000, html.length + " bytes");
  ok("北京时间时钟元素在位", html.includes('id="bjClock"') && html.includes("北京时间"));
  ok("试用活动区在位", html.includes('id="trialZone"') && html.includes("7 天试用"));
  ok("SHOP 文案已改（游戏引擎）", html.includes("所有游戏的游戏引擎均被查出故障，游戏功能暂时无法上线，感谢您的配合"));
  ok("自相矛盾的「已购买的房间号不受影响」已删", !html.includes("已购买的房间号不受影响"));
  ok("活动告知：到期文件下载到本机", html.includes("会把全部文件下载到本机") || html.includes("全部文件下载到本机"));
  ok("自动续费强制开启说明在位", html.includes("强制开启 · 按原价") && html.includes("到期前 20 分钟"));

  // ② 新接口鉴权
  for (const p of ["/api/cloud/trial/status", "/api/cloud/trial/claim"]) {
    const r = p.endsWith("status") ? await get(p, false) : await post(p, {}, false);
    ok("新接口 " + p + " 未登录 401", r.status === 401, "status=" + r.status);
  }

  // ③ RA 云空间 2048 + 文件完好
  const me = await get("/api/me");
  ok("RA 登录有效", me.status === 200 && me.data.role === "root-admin", JSON.stringify(me.data).slice(0, 60));
  const st = await get("/api/cloud/status");
  ok("RA 云空间 2048MB", st.data.totalMb === 2048, "totalMb=" + st.data.totalMb);
  ok("RA 自动续费强制开启", st.data.autoRenew === true);
  ok("RA 无收回待办", st.data.reclaimPending === false);
  const lst = await get("/api/cloud/list");
  const files = (lst.data && lst.data.files) || [];
  const origIds = ["cmw5rxguwrkch","cmw5ry8srt4th","cmw5rzwlfl5sq","cmw5s1080s0ly","cmw5s4egq09le","cmw5s4ogb4834","cmw5s5pri2f54","cmw5sl3koslrs"];
  const liveIds = files.map(f => f.id);
  const lost = origIds.filter(i => !liveIds.includes(i));
  ok("RA 原始 8 个重要文件 ID 全在（一个没丢）", lost.length === 0, "lost=" + JSON.stringify(lost) + " live=" + files.length);
  const totalMB = files.reduce((a, f) => a + f.size, 0) / (1024 * 1024);
  ok("RA 文件总量约 153MB", totalMB > 150 && totalMB < 156, totalMB.toFixed(1) + "MB");

  // ④ 试用期活动窗口（现在应已开放）
  const tr = await get("/api/cloud/trial/status");
  ok("试用状态接口 200", tr.status === 200);
  ok("活动窗口已开放（北京 16:00 后）", tr.data.open === true, "open=" + tr.data.open);
  ok("试用额度 5MB / 7天", tr.data.trialMb === 5 && tr.data.trialDays === 7);
  ok("状态带北京时间", typeof tr.data.beijingTime === "string", tr.data.beijingTime);
  const claim = await post("/api/cloud/trial/claim", {});
  ok("活动窗口内可申请", claim.status === 200 || (claim.status === 409 && /限申请一次/.test(claim.data.error || "")), "status=" + claim.status + " " + JSON.stringify(claim.data).slice(0, 80));

  // ⑤ 按角色上限（线上已有 member / admin）
  const accounts = await get("/api/accounts/list");
  ok("账号列表可读", accounts.status === 200, "status=" + accounts.status);
  // 按角色上限实测
  const ROLE_TOKENS = [
    ["admin", "8d0d703fdc8fb3a5e6c651ca501ac75cb5a7b4a44ef40319", 100],
    ["member", "fcb4592e1c90aa6c2c5884e7a403e3866d392c7986c2026b", 60]
  ];
  for (const [role, tk, cap] of ROLE_TOKENS) {
    const rr = await fetch(BASE + "/api/cloud/status", { headers: { "User-Agent": H["User-Agent"], "Authorization": "Bearer " + tk } });
    let dd = null; try { dd = await rr.json(); } catch {}
    ok(role + " 购买上限 " + cap + "MB", dd && dd.capMb === cap, "capMb=" + (dd && dd.capMb) + " status=" + rr.status);
    ok(role + " 自动续费强制开启", dd && dd.autoRenew === true);
  }

  console.log("\n========== 线上验证（云存储 v2）==========");
  R.forEach(l => console.log(l));
  console.log("==========================================");
  console.log(R.every(x => x.startsWith("PASS")) ? "ALL PASS (" + R.length + ")" : R.filter(x => x.startsWith("FAIL")).length + " FAILED / " + R.length);
})().catch(e => { console.error("ERR", e.message); process.exit(2); });

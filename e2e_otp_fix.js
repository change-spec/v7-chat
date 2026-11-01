// OTP 生成修复验证：
// 1) 模拟老库（otps 表缺 expires_at 列）→ 生成应自愈成功而非 1101
// 2) 列表 / 兑换 / 撤销 全链路
// 用法：node e2e_otp_fix.js [baseUrl]
const BASE = process.argv[2] || "http://127.0.0.1:8788";
const R = [];
const ok = (n, c, e) => { R.push((c ? "PASS " : "FAIL ") + n + (e ? "  -> " + e : "")); return c; };

(async () => {
  const u = "o" + Date.now().toString(36).slice(-5);
  let r = await fetch(BASE + "/api/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: u, password: "verify123" })
  });
  const reg = await r.json();
  ok("注册成功", r.status === 200 && reg.token, "role=" + reg.role);
  const auth = { Authorization: "Bearer " + reg.token };

  // --- 1) 生成兑换码 ---
  r = await fetch(BASE + "/api/admin/create-otp", {
    method: "POST", headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ amount: 50, days: 7 })
  });
  const txt = await r.text();
  ok("生成兑换码返回 200（不是 1101）", r.status === 200, "status=" + r.status + " body=" + txt.slice(0, 80));
  let created = null;
  try { created = JSON.parse(txt); } catch {}
  ok("返回 ok:true 与完整码", !!(created && created.ok && created.code),
     created ? ("code=" + String(created.code).slice(0, 6) + "…") : "解析失败");
  ok("返回 days 字段", !!(created && created.days === 7), "days=" + (created && created.days));

  // --- 2) 列表（RA 可看，掩码显示）---
  r = await fetch(BASE + "/api/admin/otps", { headers: auth });
  const lst = await r.json();
  const otps = lst.otps || [];
  ok("兑换码列表可读（不报 1101）", r.status === 200, "status=" + r.status);
  ok("列表含刚生成的码", otps.some(o => o.amount === 50), "共 " + otps.length + " 条");
  ok("列表不给明文（无 fullCode）", !otps.some(o => o.fullCode), "含 fullCode=" + otps.some(o => o.fullCode));
  ok("列表码为掩码", otps.length > 0 && String(otps[0].code).includes("•"), otps[0] && otps[0].code);

  // --- 3) 兑换 ---
  const code = created && created.code;
  if (code) {
    const before = (await (await fetch(BASE + "/api/me", { headers: auth })).json()).points || 0;
    r = await fetch(BASE + "/api/otp/redeem", {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ code: code })
    });
    const red = await r.json();
    ok("兑换成功", r.status === 200 && red.ok, "status=" + r.status + " " + JSON.stringify(red).slice(0, 80));
    const after = (await (await fetch(BASE + "/api/me", { headers: auth })).json()).points || 0;
    ok("积分到账 +50", after - before === 50, before + " → " + after);
    // 重复兑换应失败
    r = await fetch(BASE + "/api/otp/redeem", {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ code: code })
    });
    ok("重复兑换被拒", r.status >= 400, "status=" + r.status);
  }

  // --- 4) 撤销（用掩码）---
  r = await fetch(BASE + "/api/admin/create-otp", {
    method: "POST", headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ amount: 20, days: 3 })
  });
  const c2 = await r.json();
  ok("第二个兑换码生成成功", r.status === 200 && c2.ok, "status=" + r.status);
  r = await fetch(BASE + "/api/admin/otps", { headers: auth });
  const lst2 = await r.json();
  const target = (lst2.otps || []).find(o => o.amount === 20);
  if (target) {
    r = await fetch(BASE + "/api/otp/revoke", {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ code: target.code })
    });
    ok("按掩码撤销成功", r.status === 200, "status=" + r.status + " " + JSON.stringify(await r.json()).slice(0, 60));
    const lst3 = await (await fetch(BASE + "/api/admin/otps", { headers: auth })).json();
    ok("撤销后列表不再包含该码", !(lst3.otps || []).some(o => o.code === target.code));
  }

  // --- 5) 非法输入 ---
  r = await fetch(BASE + "/api/admin/create-otp", {
    method: "POST", headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ amount: 0, days: 7 })
  });
  ok("amount=0 被拒", r.status === 400, "status=" + r.status);
  r = await fetch(BASE + "/api/admin/create-otp", {
    method: "POST", headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ amount: 50, days: 99 })
  });
  ok("days=99 被拒", r.status === 400, "status=" + r.status);

  console.log("\n========== OTP 生成修复验证 ==========");
  R.forEach(l => console.log(l));
  console.log("=========================================");
  console.log(R.every(x => x.startsWith("PASS")) ? "ALL PASS (" + R.length + ")" : R.filter(x => x.startsWith("FAIL")).length + " FAILED / " + R.length);
})().catch(e => { console.error("ERR", e.message); process.exit(2); });

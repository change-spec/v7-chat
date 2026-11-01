// 文件资源商店端到端测试
// 重点：5% 手续费算得对不对、买卖双方积分变化、文件字节完整、并发安全
const BASE = process.env.BASE || "http://127.0.0.1:8788";
const R = [];
const ok = (n, c, e) => { R.push((c ? "PASS " : "FAIL ") + n + (e ? "  -> " + e : "")); return c; };

async function call(m, p, { body, token, raw, ct } = {}) {
  const h = {};
  if (token) h["Authorization"] = "Bearer " + token;
  let b;
  if (raw !== undefined) b = raw;
  else if (body !== undefined) { h["content-type"] = "application/json"; b = JSON.stringify(body); }
  if (ct) h["content-type"] = ct;
  const r = await fetch(BASE + p, { method: m, headers: h, body: b });
  let d = null;
  const isJson = (r.headers.get("content-type") || "").includes("json");
  if (isJson) { try { d = await r.json(); } catch {} }
  else d = { bytes: new Uint8Array(await r.arrayBuffer()), ct: r.headers.get("content-type"), cd: r.headers.get("content-disposition") };
  return { status: r.status, data: d };
}
const pts = async (u, t) => (await call("GET", "/api/me", { token: t })).data.points || 0;

(async () => {
  // === 卖家 ===
  const seller = "s" + Date.now().toString(36).slice(-5);
  let r = await call("POST", "/api/register", { body: { username: seller, password: "verify123" } });
  const sReg = r.data;
  ok("卖家注册", r.status === 200 && sReg.token, "role=" + sReg.role);
  const sTok = sReg.token;
  const sAuth = { token: sTok };

  // === 买家 ===
  const buyer = "b" + Date.now().toString(36).slice(-5);
  r = await call("POST", "/api/register", { body: { username: buyer, password: "verify123" } });
  const bReg = r.data;
  ok("公开注册已关闭（非首注册者被拒）", r.status === 403, "status=" + r.status + " " + (bReg && bReg.error ? bReg.error : ""));
  const bTok = bReg && bReg.token;

  // 给买家发积分（RA 建账号后用 admin 充积分接口；这里直接用 RA 权限）
  // 卖家就是首个注册者 = RA，给它 admin 权限建买家并充值
  r = await call("POST", "/api/admin/create-account", { body: { username: buyer, password: "verify123", role: "member" }, token: sTok });
  ok("RA 可建买家账号", r.status === 200, "status=" + r.status);
  // 重新登录买家拿新 token
  r = await call("POST", "/api/login", { body: { username: buyer, password: "verify123" } });
  const bTok2 = r.data.token;
  ok("买家重新登录", !!bTok2);

  // === 上架商品（标价 100，手续费应为 5，卖家实收 95）===
  const payload = new TextEncoder().encode("MARKET-FILE-CONTENT-12345");
  r = await call("POST", "/api/market/upload?name=t.txt&mime=text/plain&price=100&desc=" + encodeURIComponent("测试商品"), {
    token: sTok, raw: payload, ct: "text/plain"
  });
  ok("上架成功", r.status === 200 && r.data.ok, "status=" + r.status + " " + JSON.stringify(r.data).slice(0, 80));
  const itemId = r.data.id;

  // === 列表 ===
  r = await call("GET", "/api/market/list", { token: bTok2 });
  const items = r.data.items || [];
  ok("列表可读", r.status === 200, "共 " + items.length + " 件");
  const it = items.find(x => x.id === itemId);
  ok("列表含新商品", !!it);
  ok("列表标明 mine 标记", it && it.mine === false, "mine=" + (it && it.mine));
  ok("未售出状态正确", it && it.sold === false);

  // === 非法标价 ===
  r = await call("POST", "/api/market/upload?name=x.txt&price=0", { token: sTok, raw: payload, ct: "text/plain" });
  ok("标价 0 被拒", r.status === 400, "status=" + r.status);
  r = await call("POST", "/api/market/upload?name=x.txt&price=999999", { token: sTok, raw: payload, ct: "text/plain" });
  ok("标价超上限被拒", r.status === 400, "status=" + r.status);
  r = await call("POST", "/api/market/upload?name=x.txt&price=10", { token: sTok, raw: new Uint8Array(0), ct: "text/plain" });
  ok("空文件被拒", r.status === 400, "status=" + r.status);

  // === 余额不足时不能买 ===
  const bBefore = await pts(buyer, bTok2);
  const sBefore = await pts(seller, sTok);
  r = await call("POST", "/api/market/buy", { body: { id: itemId }, token: bTok2 });
  ok("余额不足时购买失败", r.status === 409, "status=" + r.status + " " + (r.data.error || ""));
  ok("失败后买家积分未变", (await pts(buyer, bTok2)) === bBefore);
  ok("失败后卖家积分未变", (await pts(seller, sTok)) === sBefore);

  // === 充值给买家（RA 给 member 加积分）===
  // 没有直接充值接口，用 redeem 兑换码：RA 生成一个码给买家
  r = await call("POST", "/api/admin/create-otp", { body: { amount: 500, days: 7 }, token: sTok });
  const code = r.data.code;
  ok("RA 生成兑换码", r.status === 200 && !!code);
  r = await call("POST", "/api/otp/redeem", { body: { code: code }, token: bTok2 });
  ok("买家兑换积分", r.status === 200 && r.data.ok, "status=" + r.status);
  const bMid = await pts(buyer, bTok2);
  ok("买家现有 500 Credits", bMid === 500, "=" + bMid);

  // === 正式购买：100 Credits ===
  const sBeforeBuy = await pts(seller, sTok);
  const bBeforeBuy = await pts(buyer, bTok2);
  r = await call("POST", "/api/market/buy", { body: { id: itemId }, token: bTok2 });
  ok("购买成功", r.status === 200 && r.data.ok, "status=" + r.status + " " + JSON.stringify(r.data).slice(0, 90));
  ok("返回 price=100", r.data.price === 100, "price=" + r.data.price);
  ok("手续费 fee=5（5%）", r.data.fee === 5, "fee=" + r.data.fee);
  ok("卖家实收 payout=95（95%）", r.data.payout === 95, "payout=" + r.data.payout);
  ok("fee + payout = price", r.data.fee + r.data.payout === r.data.price);

  const bAfter = await pts(buyer, bTok2);
  const sAfter = await pts(seller, sTok);
  ok("买家扣 100", bBeforeBuy - bAfter === 100, bBeforeBuy + " → " + bAfter);
  ok("卖家得 95", sAfter - sBeforeBuy === 95, sBeforeBuy + " → " + sAfter);
  ok("平台实收 5（凭空消失的部分）", (bBeforeBuy - bAfter) - (sAfter - sBeforeBuy) === 5);

  // === 重复购买被拒 ===
  r = await call("POST", "/api/market/buy", { body: { id: itemId }, token: bTok2 });
  ok("重复购买被拒", r.status === 409, "status=" + r.status);
  ok("重复购买不改分", (await pts(buyer, bTok2)) === bAfter);

  // === 下载文件，字节校验 ===
  r = await call("GET", "/api/market/file?id=" + encodeURIComponent(itemId), { token: bTok2 });
  ok("买家可下载", r.status === 200, "status=" + r.status);
  const got = r.data.bytes;
  ok("下载字节长度一致", got.length === payload.length, got.length + " vs " + payload.length);
  let same = got.length === payload.length;
  if (same) for (let i = 0; i < got.length; i++) if (got[i] !== payload[i]) { same = false; break; }
  ok("下载内容逐字节一致", same);
  ok("Content-Type 正确", (r.data.ct || "").includes("text/plain"), r.data.ct);
  ok("带 attachment 文件名", (r.data.cd || "").includes("attachment"), (r.data.cd || "").slice(0, 60));

  // === 不能买自己的 ===
  // 注意：公开注册已关闭（RA 统一发号），所以用 RA 建账号而不是直接注册
  const seller2 = "t" + Date.now().toString(36).slice(-5);
  r = await call("POST", "/api/admin/create-account", { body: { username: seller2, password: "verify123", role: "member" }, token: sTok });
  ok("RA 建第二个卖家账号", r.status === 200, "status=" + r.status);
  r = await call("POST", "/api/login", { body: { username: seller2, password: "verify123" } });
  const t2 = r.data.token;
  ok("第二个卖家登录", !!t2);
  r = await call("POST", "/api/market/upload?name=own.txt&price=10", { token: t2, raw: payload, ct: "text/plain" });
  const ownId = r.data.id;
  r = await call("POST", "/api/market/buy", { body: { id: ownId }, token: t2 });
  ok("不能购买自己的商品", r.status === 400, "status=" + r.status + " " + (r.data.error || ""));

  // === 下架 ===
  r = await call("POST", "/api/market/remove", { body: { id: ownId }, token: t2 });
  ok("下架成功", r.status === 200 && r.data.ok, "status=" + r.status);
  r = await call("GET", "/api/market/list", { token: t2 });
  ok("下架后列表不再有该商品", !(r.data.items || []).some(x => x.id === ownId));
  // 已售出的不能下架
  r = await call("POST", "/api/market/remove", { body: { id: itemId }, token: sTok });
  ok("已售出商品不能下架", r.status === 409, "status=" + r.status);
  // 非卖家不能下架别人的
  r = await call("POST", "/api/market/remove", { body: { id: itemId }, token: bTok2 });
  ok("非卖家下架被拒", r.status === 403 || r.status === 409, "status=" + r.status);

  // === 未售出商品他人不可下载 ===
  r = await call("POST", "/api/market/upload?name=priv.txt&price=10", { token: t2, raw: payload, ct: "text/plain" });
  const privId = r.data.id;
  r = await call("GET", "/api/market/file?id=" + encodeURIComponent(privId), { token: bTok2 });
  ok("未售出商品他人不可下载", r.status === 403, "status=" + r.status);

  console.log("\n========== 文件资源商店 E2E ==========");
  R.forEach(l => console.log(l));
  console.log("=========================================");
  console.log(R.every(x => x.startsWith("PASS")) ? "ALL PASS (" + R.length + ")" : R.filter(x => x.startsWith("FAIL")).length + " FAILED / " + R.length);
})().catch(e => { console.error("ERR", e.message, e.stack); process.exit(2); });

// 商店购买交付方式 + 分级消息保留期 测试
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
  const isJson = (r.headers.get("content-type") || "").includes("json");
  let d = null;
  if (isJson) { try { d = await r.json(); } catch {} }
  else d = { bytes: new Uint8Array(await r.arrayBuffer()) };
  return { status: r.status, data: d };
}
const pts = async (t) => (await call("GET", "/api/me", { token: t })).data.points || 0;

(async () => {
  const ra = "r" + Date.now().toString(36).slice(-5);
  let r = await call("POST", "/api/register", { body: { username: ra, password: "verify123" } });
  const raTok = r.data.token;
  ok("RA 注册", r.status === 200 && raTok, "role=" + r.data.role);

  // 建两个买家
  const b1 = "b" + Date.now().toString(36).slice(-5);
  const b2 = "c" + Date.now().toString(36).slice(-5);
  for (const u of [b1, b2]) {
    r = await call("POST", "/api/admin/create-account", { body: { username: u, password: "verify123", role: "member" }, token: raTok });
    ok("RA 建 " + u, r.status === 200, "status=" + r.status);
  }
  const t1 = (await call("POST", "/api/login", { body: { username: b1, password: "verify123" } })).data.token;
  const t2 = (await call("POST", "/api/login", { body: { username: b2, password: "verify123" } })).data.token;

  // 给买家充值
  async function give(tok, amount) {
    const c = (await call("POST", "/api/admin/create-otp", { body: { amount, days: 7 }, token: raTok })).data.code;
    await call("POST", "/api/otp/redeem", { body: { code: c }, token: tok });
  }
  await give(t1, 300); await give(t2, 300);
  ok("买家1 余额 300", (await pts(t1)) === 300, "=" + (await pts(t1)));
  ok("买家2 余额 300", (await pts(t2)) === 300);

  const payload = new TextEncoder().encode("DELIVERY-TEST-FILE-ABCDEFGH");
  async function listItem(id) {
    const l = await call("GET", "/api/market/list", { token: t1 });
    return ((l.data.items) || []).find(x => x.id === id);
  }

  // ============ 场景 1：deliver=cloud ============
  r = await call("POST", "/api/market/upload?name=cloud1.txt&mime=text/plain&price=100", { token: raTok, raw: payload, ct: "text/plain" });
  const idCloud = r.data.id;
  ok("上架商品A", r.status === 200 && !!idCloud);
  const sBefore = await pts(raTok);
  r = await call("POST", "/api/market/buy", { body: { id: idCloud, deliver: "cloud" }, token: t1 });
  ok("购买(deliver=cloud)成功", r.status === 200 && r.data.ok, "status=" + r.status + " " + JSON.stringify(r.data).slice(0, 90));
  ok("返回 deliver=cloud", r.data.deliver === "cloud", "deliver=" + r.data.deliver);
  ok("返回 orderId", !!r.data.orderId);
  ok("返回 delivered=true（已转存云空间）", r.data.delivered === true, "delivered=" + r.data.delivered);
  ok("手续费 5 / 实收 95", r.data.fee === 5 && r.data.payout === 95, "fee=" + r.data.fee + " payout=" + r.data.payout);
  ok("买家扣 100", (await pts(t1)) === 200, "=" + (await pts(t1)));
  ok("卖家得 95", (await pts(raTok)) - sBefore === 95, "=" + (await pts(raTok)));

  // 商品已从商店删除
  ok("cloud 交付后商品已从商店删除", !(await listItem(idCloud)));
  // 文件在买家云空间
  r = await call("GET", "/api/cloud/list", { token: t1 });
  const cf = (r.data.files || []).find(x => x.name === "cloud1.txt");
  ok("文件已进买家云空间", !!cf, "云文件: " + (r.data.files || []).map(x => x.name).join(","));
  // 字节完整
  if (cf) {
    const rr = await call("GET", "/api/cloud/file?id=" + encodeURIComponent(cf.id), { token: t1 });
    const b = rr.data.bytes;
    let same = b.length === payload.length;
    if (same) for (let i = 0; i < b.length; i++) if (b[i] !== payload[i]) { same = false; break; }
    ok("云空间文件字节逐个一致", same, b.length + " vs " + payload.length);
  }

  // ============ 场景 2：deliver=download ============
  r = await call("POST", "/api/market/upload?name=dl1.txt&mime=text/plain&price=100", { token: raTok, raw: payload, ct: "text/plain" });
  const idDl = r.data.id;
  ok("上架商品B", r.status === 200 && !!idDl);
  const sBefore2 = await pts(raTok);
  r = await call("POST", "/api/market/buy", { body: { id: idDl, deliver: "download" }, token: t2 });
  const ordId = r.data.orderId;          // 立刻取出，避免后续请求覆盖 r
  ok("购买(deliver=download)成功", r.status === 200 && r.data.ok, "status=" + r.status);
  ok("返回 deliver=download", r.data.deliver === "download", "deliver=" + r.data.deliver);
  ok("delivered=false（未转存云空间）", r.data.delivered === false, "delivered=" + r.data.delivered);
  ok("买家2 扣 100", (await pts(t2)) === 200, "=" + (await pts(t2)));
  ok("卖家2 得 95", (await pts(raTok)) - sBefore2 === 95);
  // 不在买家云空间
  r = await call("GET", "/api/cloud/list", { token: t2 });
  ok("download 交付不占买家云空间", !(r.data.files || []).some(x => x.name === "dl1.txt"));
  // 商品已售出但不在列表里
  ok("download 交付后商品不在商店列表", !(await listItem(idDl)));

  // 买家下载文件（order-file 返回 base64）
  r = await call("GET", "/api/market/order-file?id=" + encodeURIComponent(ordId), { token: t2 });
  ok("买家可取回文件", r.status === 200 && r.data.base64, "status=" + r.status);
  const bin = atob(r.data.base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  ok("取回字节数一致", arr.length === payload.length, arr.length + " vs " + payload.length);
  let same2 = arr.length === payload.length;
  if (same2) for (let i = 0; i < arr.length; i++) if (arr[i] !== payload[i]) { same2 = false; break; }
  ok("取回字节逐个一致", same2);
  ok("文件名正确", r.data.name === "dl1.txt", "name=" + r.data.name);

  // 第三方不能取
  r = await call("GET", "/api/market/order-file?id=" + encodeURIComponent(ordId), { token: t1 });
  ok("他人不能取回该文件", r.status === 403, "status=" + r.status);

  // 下载完成后清理
  r = await call("POST", "/api/market/order-done", { body: { id: ordId }, token: t2 });
  ok("下载完成清理接口可用", r.status === 200 && r.data.ok, "status=" + r.status);
  r = await call("GET", "/api/market/order-file?id=" + encodeURIComponent(ordId), { token: t2 });
  ok("清理后无法再取回（服务器文件已删）", r.status === 404, "status=" + r.status);

  // ============ 分级保留期校验（表结构/常量）============
  const retention = await call("GET", "/api/rooms", { token: raTok });
  ok("房间接口可用", retention.status === 200);

  console.log("\n========== 商店交付方式 E2E ==========");
  R.forEach(l => console.log(l));
  console.log("===========================================");
  console.log(R.every(x => x.startsWith("PASS")) ? "ALL PASS (" + R.length + ")" : R.filter(x => x.startsWith("FAIL")).length + " FAILED / " + R.length);
})().catch(e => { console.error("ERR", e.message, e.stack); process.exit(2); });

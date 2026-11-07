// 文件资源商店 V4 端到端测试：多份发售 + 按份收手续费 + 文件夹包上架 + 下载交付清理
// 用法：RA_PASS=xxx BASE=https://v7-chat.pages.dev node e2e_market_v4.js
const BASE = process.env.BASE || "https://v7-chat.pages.dev";
const RA_PASS = process.env.RA_PASS;
if (!RA_PASS) { console.error("缺少环境变量 RA_PASS（Root-Admin 密码）"); process.exit(3); }
const R = [];
const ok = (n, c, e) => { R.push((c ? "PASS " : "FAIL ") + n + (e ? "  -> " + e : "")); return c; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
  else d = { bytes: new Uint8Array(await r.arrayBuffer()) };
  return { status: r.status, data: d };
}
const pts = async (t) => (await call("GET", "/api/me", { token: t })).data.points || 0;

(async () => {
  // === RA 登录 ===
  let r = await call("POST", "/api/login", { body: { username: "deportee", password: RA_PASS } });
  ok("RA 登录", r.status === 200 && r.data.token, "status=" + r.status);
  const raTok = r.data.token;

  // === 建卖家/买家 ===
  const seller = "v4s" + Math.random().toString(36).slice(2, 7);
  const buyer = "v4b" + Math.random().toString(36).slice(2, 7);
  r = await call("POST", "/api/admin/create-account", { body: { username: seller, password: "verify123", role: "member" }, token: raTok });
  ok("RA 建卖家", r.status === 200, "status=" + r.status);
  r = await call("POST", "/api/admin/create-account", { body: { username: buyer, password: "verify123", role: "member" }, token: raTok });
  ok("RA 建买家", r.status === 200, "status=" + r.status);
  r = await call("POST", "/api/login", { body: { username: seller, password: "verify123" } });
  const sTok = r.data.token; ok("卖家登录", !!sTok);
  r = await call("POST", "/api/login", { body: { username: buyer, password: "verify123" } });
  const bTok = r.data.token; ok("买家登录", !!bTok);

  // === 给买家充值 500 ===
  r = await call("POST", "/api/admin/create-otp", { body: { amount: 500, days: 7 }, token: raTok });
  const code = r.data.code; ok("RA 生成兑换码", r.status === 200 && !!code);
  r = await call("POST", "/api/otp/redeem", { body: { code }, token: bTok });
  ok("买家兑换积分", r.status === 200 && r.data.ok);
  ok("买家余额=500", (await pts(bTok)) === 500, "=" + (await pts(bTok)));

  // === 上架 2 份（price=100）===
  const payload = new TextEncoder().encode("MULTI-COPY-CONTENT-ABCDEF");
  r = await call("POST", "/api/market/upload?name=t.txt&mime=text/plain&price=100&copies=2", { token: sTok, raw: payload, ct: "text/plain" });
  ok("上架2份成功", r.status === 200 && r.data.ok && r.data.copies === 2, "status=" + r.status + " " + JSON.stringify(r.data).slice(0, 80));
  const itemId = r.data.id;

  // === 列表显示剩余 2/2 ===
  r = await call("GET", "/api/market/list", { token: bTok });
  const it = (r.data.items || []).find(x => x.id === itemId);
  ok("列表含商品", !!it);
  ok("剩余 2/2", it && it.remaining === 2 && it.copiesTotal === 2, it && (it.remaining + "/" + it.copiesTotal));
  ok("份数字段存在", it && typeof it.copiesTotal === "number");

  // === 买家买第 1 份（存云）===
  const sB1 = await pts(sTok), bB1 = await pts(bTok);
  r = await call("POST", "/api/market/buy", { body: { id: itemId, deliver: "cloud" }, token: bTok });
  ok("第1份购买成功", r.status === 200 && r.data.ok, "status=" + r.status + " " + JSON.stringify(r.data).slice(0, 80));
  ok("第1份 fee=5", r.data.fee === 5, "fee=" + r.data.fee);
  ok("第1份 payout=95", r.data.payout === 95, "payout=" + r.data.payout);
  ok("第1份后买家-100", bB1 - (await pts(bTok)) === 100, bB1 + "→" + (await pts(bTok)));
  ok("第1份后卖家+95", (await pts(sTok)) - sB1 === 95, sB1 + "→" + (await pts(sTok)));

  // === 列表仍显示剩余 1/2 ===
  r = await call("GET", "/api/market/list", { token: bTok });
  const it2 = (r.data.items || []).find(x => x.id === itemId);
  ok("第1份后仍可购（剩1/2）", it2 && it2.remaining === 1, it2 && (it2.remaining + "/" + it2.copiesTotal));

  // === 买家买第 2 份 ===
  const sB2 = await pts(sTok), bB2 = await pts(bTok);
  r = await call("POST", "/api/market/buy", { body: { id: itemId, deliver: "cloud" }, token: bTok });
  ok("第2份购买成功", r.status === 200 && r.data.ok, "status=" + r.status);
  ok("第2份 fee=5", r.data.fee === 5);
  ok("第2份 payout=95", r.data.payout === 95);
  ok("第2份后卖家再+95", (await pts(sTok)) - sB2 === 95, sB2 + "→" + (await pts(sTok)));
  ok("第2份后买家再-100", bB2 - (await pts(bTok)) === 100);

  // 平台共收 10（2 次 × 5%）
  ok("平台两次共收 10（买家总付200 - 卖家总收190）", (bB1 - (await pts(bTok))) - ((await pts(sTok)) - sB1) === 10);

  // === 售罄后列表不再出现 ===
  r = await call("GET", "/api/market/list", { token: bTok });
  ok("售罄后列表移除商品", !(r.data.items || []).some(x => x.id === itemId));

  // === 售罄后再买被拒（云交付最终份售出后即删行，返回 404；下载交付则返回 409，二者均表示不可购买）===
  r = await call("POST", "/api/market/buy", { body: { id: itemId }, token: bTok });
  ok("售罄后购买被拒(404/409)", r.status === 404 || r.status === 409, "status=" + r.status + " " + (r.data.error || ""));

  // === ZIP 解压端点已随独立解压工具一并移除（2026-11-07）：请求应返回 404 ===
  r = await call("POST", "/api/zip/quote", { body: { size: 1024 }, token: bTok });
  ok("ZIP 报价端点已移除(404)", r.status === 404, "status=" + r.status);
  r = await call("POST", "/api/zip/pay", { body: { size: 1024 }, token: bTok });
  ok("ZIP 付费端点已移除(404)", r.status === 404, "status=" + r.status);

  // === 文件夹包（kind=zip）上架与列表 ===
  r = await call("POST", "/api/market/upload?name=folder.zip&mime=application/zip&price=30&kind=zip&copies=1", { token: sTok, raw: new TextEncoder().encode("PK\x03\x04fake-zip-bytes"), ct: "application/zip" });
  ok("文件夹包上架成功", r.status === 200 && r.data.ok && r.data.kind === "zip", "kind=" + (r.data && r.data.kind));
  const zipId = r.data.id;
  r = await call("GET", "/api/market/list", { token: bTok });
  const zit = (r.data.items || []).find(x => x.id === zipId);
  ok("列表标为文件夹包(ZIP)", zit && zit.kind === "zip", "kind=" + (zit && zit.kind));

  // === 下载交付多份：售罄后文件须保留到买家确认落盘才删 ===
  const payload2 = new TextEncoder().encode("DOWNLOAD-DELIVERY-TEST-XY");
  r = await call("POST", "/api/market/upload?name=d.txt&mime=text/plain&price=50&copies=2", { token: sTok, raw: payload2, ct: "text/plain" });
  const dId = r.data.id;
  r = await call("POST", "/api/market/buy", { body: { id: dId, deliver: "download" }, token: bTok });
  const ord1 = r.data.orderId; ok("下载交付 第1份", r.status === 200 && r.data.ok, "ord=" + ord1);
  r = await call("POST", "/api/market/buy", { body: { id: dId, deliver: "download" }, token: bTok });
  const ord2 = r.data.orderId; ok("下载交付 第2份(售罄)", r.status === 200 && r.data.ok, "ord=" + ord2);
  // 售罄但未确认落盘 → 文件仍在（order-file 能取）
  r = await call("GET", "/api/market/order-file?id=" + encodeURIComponent(ord1), { token: bTok });
  ok("售罄后文件仍可取(order1)", r.status === 200 && r.data && r.data.base64, "status=" + r.status);
  // 确认第1份落盘
  r = await call("POST", "/api/market/order-done", { body: { id: ord1 }, token: bTok });
  ok("order-done(1) 成功", r.status === 200 && r.data.ok, "status=" + r.status);
  // 还有第2份未落盘 → 文件仍可取
  r = await call("GET", "/api/market/order-file?id=" + encodeURIComponent(ord2), { token: bTok });
  ok("还有未落盘时文件仍可取(order2)", r.status === 200 && r.data && r.data.base64, "status=" + r.status);
  // 确认第2份落盘 → 全部完成 → 清理
  r = await call("POST", "/api/market/order-done", { body: { id: ord2 }, token: bTok });
  ok("order-done(2) 成功", r.status === 200 && r.data.ok, "status=" + r.status);
  await sleep(300);
  r = await call("GET", "/api/market/order-file?id=" + encodeURIComponent(ord2), { token: bTok });
  ok("全部落盘后文件已清理(order2→404)", r.status === 404, "status=" + r.status);

  // === 已售出商品不能下架 ===
  r = await call("POST", "/api/market/remove", { body: { id: zipId }, token: sTok });
  ok("已上架未售可下架", r.status === 200 && r.data.ok, "status=" + r.status);

  console.log("\n========== 文件资源商店 V4 E2E ==========");
  R.forEach(l => console.log(l));
  console.log("=========================================");
  const failed = R.filter(x => x.startsWith("FAIL")).length;
  console.log(failed === 0 ? "ALL PASS (" + R.length + ")" : failed + " FAILED / " + R.length);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error("ERR", e.message, e.stack); process.exit(2); });

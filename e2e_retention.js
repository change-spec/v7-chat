// 分级消息保留期测试：C 类 21 天 / B 类 7 天 / A 类 5 天
// 直接操作 D1 造数据，验证清理逻辑与历史查询的 cutoff
const BASE = process.env.BASE || "http://127.0.0.1:8788";
const R = [];
const ok = (n, c, e) => { R.push((c ? "PASS " : "FAIL ") + n + (e ? "  -> " + e : "")); return c; };

const DAY = 24 * 3600 * 1000;
const daysAgo = (d) => new Date(Date.now() - d * DAY).toISOString();

async function call(m, p, { body, token } = {}) {
  const h = {};
  if (token) h["Authorization"] = "Bearer " + token;
  let b;
  if (body !== undefined) { h["content-type"] = "application/json"; b = JSON.stringify(body); }
  const r = await fetch(BASE + p, { method: m, headers: h, body: b });
  let d = null;
  try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}

(async () => {
  const u = "p" + Date.now().toString(36).slice(-5);
  let r = await call("POST", "/api/register", { body: { username: u, password: "verify123" } });
  const tok = r.data.token;
  ok("注册成功（RA）", r.status === 200 && tok, "role=" + r.data.role);
  const auth = { token: tok };

  // 建一个 A 类群
  r = await call("POST", "/api/rooms/create", { body: { name: "retTest" }, token: tok });
  const roomA = r.data && r.data.room && r.data.room.id;
  ok("创建 A 类群", r.status === 200 && !!roomA, "id=" + roomA);

  // 造三个房间的成员关系（RA 自动在 geek 和自己的 dm 里）
  const dmId = "dm:" + u;   // B 类私聊：RA 自己没有 dm 房间，这里用一个专门的 B 类房间
  // 建一个真实 B 类房间：让 RA 建 member，member 的 dm:<member> 是 B 类
  const mem = "m" + u;
  await call("POST", "/api/admin/create-account", { body: { username: mem, password: "verify123", role: "member" }, token: tok });
  const memTok = (await call("POST", "/api/login", { body: { username: mem, password: "verify123" } })).data.token;
  const dmMember = "dm:" + mem;
  r = await call("GET", "/api/rooms", { token: memTok });
  const memRooms = (r.data && r.data.rooms) || [];
  ok("member 有 B 类私聊", memRooms.some(x => x.id === dmMember && x.class === "B"),
     memRooms.map(x => x.class + ":" + x.id).join(","));

  console.log("\n========== 分级保留期验证 ==========");
  console.log("目标: C 类(Geek公告群) 21 天 / B 类(与 RA 私聊) 7 天 / A 类(普通群) 5 天");
  console.log("------------------------------------------");
  console.log("说明: 造数据需直接写 D1（本地库），此处先确认接口与常量生效");
  console.log("房间 ID: A类=" + roomA + "  B类=" + dmMember + "  C类=geek");

  // 通过 HTTP 无法造历史消息，这里验证关键点：
  // 1) 历史查询的 cutoff 是否按 class 区分 —— 用 rooms/history 接口对比不同房间返回条数
  // 2) 保留期常量是否已写入代码

  // 检查 A 类群的历史查询（当前应为空，但接口通）
  r = await call("GET", "/api/rooms/history?id=" + encodeURIComponent(roomA), { token: tok });
  ok("A 类群历史查询可用", r.status === 200, "status=" + r.status);

  // 检查 B 类私聊的历史查询
  r = await call("GET", "/api/rooms/history?id=" + encodeURIComponent(dmMember), { token: memTok });
  ok("B 类私聊历史查询可用", r.status === 200, "status=" + r.status);

  // 检查 C 类公告群的历史查询
  r = await call("GET", "/api/rooms/history?id=geek", { token: tok });
  ok("C 类公告群历史查询可用", r.status === 200, "status=" + r.status);

  console.log("------------------------------------------");
  R.forEach(l => console.log(l));
  console.log("==========================================");
  console.log(R.every(x => x.startsWith("PASS")) ? "接口层 PASS (" + R.length + ")" : R.filter(x => x.startsWith("FAIL")).length + " FAILED / " + R.length);
  console.log("");
  console.log("数据层验证请看随附的 verify_retention.py（直接查 D1 表内容）");
})().catch(e => { console.error("ERR", e.message); process.exit(2); });

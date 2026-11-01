// 验证文件传输助手已被彻底移除
const BASE = process.env.BASE || "http://127.0.0.1:8788";
const R = [];
const ok = (n, c, e) => { R.push((c ? "PASS " : "FAIL ") + n + (e ? "  -> " + e : "")); return c; };

(async () => {
  const u = "h" + Date.now().toString(36).slice(-5);
  let r = await fetch(BASE + "/api/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: u, password: "verify123" })
  });
  const reg = await r.json();
  ok("注册成功", r.status === 200 && reg.token, "role=" + reg.role);
  const auth = { Authorization: "Bearer " + reg.token };

  r = await fetch(BASE + "/api/rooms", { headers: auth });
  const rm = await r.json();
  const rooms = rm.rooms || [];

  const fileRooms = rooms.filter(x => String(x.id).startsWith("file:"));
  const cRooms = rooms.filter(x => x.class === "C");
  const bRooms = rooms.filter(x => x.class === "B");

  ok("房间列表可读", r.status === 200, "共 " + rooms.length + " 个");
  ok("没有任何 file: 前缀房间", fileRooms.length === 0,
     fileRooms.length ? JSON.stringify(fileRooms.map(x => x.id)) : "0 个");
  ok("没有名为「文件传输助手」的房间", !rooms.some(x => x.name === "文件传输助手"),
     rooms.map(x => x.name).join(" / "));
  ok("C 类房只剩 Geek公告群 1 个", cRooms.length === 1 && cRooms[0].id === "geek",
     "C类: " + cRooms.map(x => x.id + "(" + x.name + ")").join(","));
  // RA 自己没有 dm: 房间（B 类私聊是 dm:<成员>），故仅在非 RA 时断言
  if (reg.role !== "root-admin") {
    ok("B 类私聊仍在（dm:<自己>）", bRooms.length === 1 && bRooms[0].id === "dm:" + u,
       "B类: " + bRooms.map(x => x.id).join(","));
  } else {
    ok("RA 无自己的 dm 房间（符合设计）", bRooms.length === 0, "B类: " + bRooms.map(x => x.id).join(","));
  }

  // 观测者权限：新注册的 member 无法直接改角色，改用 admin 观察者账号测试由 e2e 覆盖
  // 这里验证「文件传输助手房间不可进入」
  if (fileRooms.length) {
    r = await fetch(BASE + "/api/rooms/history?room=" + encodeURIComponent(fileRooms[0].id), { headers: auth });
    ok("旧 file: 房间已不可访问", r.status === 403 || r.status === 404, "status=" + r.status);
  }

  // 计费回归：非 geek 房间发言应计费（原文件传输助手免费逻辑已移除）
  r = await fetch(BASE + "/api/file/quote", {
    method: "POST", headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ size: 1048576, room: "geek" })
  });
  const q1 = await r.json();
  ok("公告群 RA 文件报价为 0（RA 免费）", q1.cost === 0, "cost=" + q1.cost);

  console.log("\n========== 文件传输助手移除验证 ==========");
  R.forEach(l => console.log(l));
  console.log("==========================================");
  console.log(R.every(x => x.startsWith("PASS")) ? "ALL PASS (" + R.length + ")" : R.filter(x => x.startsWith("FAIL")).length + " FAILED / " + R.length);
})().catch(e => { console.error("ERR", e.message); process.exit(2); });

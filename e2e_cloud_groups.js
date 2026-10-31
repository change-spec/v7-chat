// e2e: A/B/C groups + 10-cap, B-DM on register, cloud buy/upload/repost/delete, RA 1GB
const BASE = "http://127.0.0.1:8787";
const results = [];
let failed = 0;

function ok(name, cond, extra) {
  const pass = !!cond;
  if (!pass) failed++;
  results.push((pass ? "PASS " : "FAIL ") + name + (extra ? "  -> " + extra : ""));
}

async function call(method, path, { body, token, raw } = {}) {
  const headers = {};
  if (token) headers["Authorization"] = "Bearer " + token;
  let payload;
  if (raw !== undefined) {
    payload = raw;
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const r = await fetch(BASE + path, { method, headers, body: payload });
  let data = null;
  try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}

const rand = Math.random().toString(36).slice(2, 7);
const raName = "ra_" + rand;
const m1Name = "m1_" + rand;
const PW = "e2epass1";

(async () => {
  // 1) Bootstrap Root-Admin
  let r = await call("POST", "/api/register", { body: { username: raName, password: PW } });
  ok("RA 注册成为 Root-Admin (bootstrap)", r.status === 200 && r.data.role === "root-admin" && r.data.token, "status=" + r.status + " role=" + (r.data && r.data.role));
  const raTok = r.data.token;

  // 2) RA cloud gift = 1024MB
  r = await call("GET", "/api/cloud/status", { token: raTok });
  ok("RA 云空间 = 1GB(1024MB) 永久免费", r.data && r.data.isRA === true && r.data.totalMb === 1024, "totalMb=" + (r.data && r.data.totalMb));

  // 3) RA rooms: B-DM + C builtins
  r = await call("GET", "/api/rooms", { token: raTok });
  const raRooms = (r.data && r.data.rooms) || [];
  const raGeek = raRooms.find(x => x.id === "geek");
  const raFile = raRooms.find(x => x.id === "file:" + raName);
  // 说明：B 类私聊建为 dm:<成员>（创建者=成员，Root-Admin 为对方），RA 自身无 dm:<ra> 自房；
  // RA 会在成员注册后于自己的会话列表里看到对方的 dm:<成员> 房（class B）。该断言放到 m1 注册之后。
  ok("RA 拥有 C 类 Geek公告群", raGeek && raGeek.class === "C");
  ok("RA 拥有 C 类 文件传输助手", raFile && raFile.class === "C");

  // 4) RA mints OTP to fund a member
  r = await call("POST", "/api/admin/create-otp", { body: { amount: 100000, days: 7 }, token: raTok });
  ok("RA 生成兑换码成功", r.status === 200 && r.data.code, "status=" + r.status);
  const otp = r.data.code;

  // 5) RA creates a member
  r = await call("POST", "/api/admin/create-account", { body: { username: m1Name, password: PW, role: "member" }, token: raTok });
  ok("RA 创建成员 m1 成功", r.status === 200 && r.data.ok, "status=" + r.status);

  // 6) Login as m1 (triggers ensureBuiltins -> B-DM + C builtins)
  r = await call("POST", "/api/login", { body: { username: m1Name, password: PW } });
  ok("m1 登录成功并取得 token", r.status === 200 && r.data.token, "status=" + r.status);
  const m1Tok = r.data.token;

  // 7) m1 rooms include B-DM + C builtins
  r = await call("GET", "/api/rooms", { token: m1Tok });
  const m1Rooms = (r.data && r.data.rooms) || [];
  const m1DM = m1Rooms.find(x => x.id === "dm:" + m1Name);
  const m1Geek = m1Rooms.find(x => x.id === "geek");
  ok("m1 注册即有 B 类私聊(与 Root-Admin)", m1DM && m1DM.class === "B");
  ok("m1 拥有 C 类 Geek公告群", m1Geek && m1Geek.class === "C");

  // RA 视角：成员注册后，RA 的会话列表应能看到对方的 B 类私聊 dm:<m1>
  r = await call("GET", "/api/rooms", { token: raTok });
  const raSeesDM = ((r.data && r.data.rooms) || []).find(x => x.id === "dm:" + m1Name);
  ok("RA 能看到成员 m1 的 B 类私聊", raSeesDM && raSeesDM.class === "B", "class=" + (raSeesDM && raSeesDM.class));

  // 8) m1 redeems OTP -> credits
  r = await call("POST", "/api/otp/redeem", { body: { code: otp }, token: m1Tok });
  ok("m1 兑换 Credits 成功", r.status === 200 && r.data.ok, "status=" + r.status);
  r = await call("GET", "/api/me", { token: m1Tok });
  const m1Points0 = (r.data && r.data.points) || 0;
  ok("m1 余额 >= 100000", m1Points0 >= 100000, "points=" + m1Points0);

  // 9) A-class cap: create 10 succeed, 11th blocked
  let created = 0;
  for (let i = 1; i <= 10; i++) {
    const rr = await call("POST", "/api/rooms/create", { body: { name: "grp" + i }, token: m1Tok });
    if (rr.status === 200) created++;
  }
  ok("m1 成功创建 10 个 A 类群", created === 10, "created=" + created);
  const capRes = await call("POST", "/api/rooms/create", { body: { name: "grpOver" }, token: m1Tok });
  ok("第 11 个 A 类群被上限拦截(409)", capRes.status === 409 && /上限/.test(capRes.data && capRes.data.error || ""), "status=" + capRes.status + " err=" + (capRes.data && capRes.data.error));
  r = await call("GET", "/api/rooms", { token: m1Tok });
  const aCount = ((r.data && r.data.rooms) || []).filter(x => x.class === "A").length;
  ok("m1 实际 A 类群数量 = 10", aCount === 10, "aCount=" + aCount);

  // 10) m1 upload before buying cloud -> rejected (no quota)
  const small = Buffer.from("hello cloud e2e test bytes");
  let up = await call("POST", "/api/cloud/upload?name=pre.txt&mime=text/plain", { raw: small, token: m1Tok });
  ok("无云空间时上传被拒(409)", up.status === 409, "status=" + up.status);

  // 11) m1 buy 5MB cloud
  r = await call("POST", "/api/cloud/buy", { body: { mb: 5, autoRenew: false }, token: m1Tok });
  ok("m1 购买 5MB 云空间成功", r.status === 200 && r.data.kind === "paid" && r.data.totalMb === 5, "kind=" + (r.data && r.data.kind) + " totalMb=" + (r.data && r.data.totalMb));
  const m1Points1 = (await call("GET", "/api/me", { token: m1Tok })).data.points;
  ok("购买扣费 = 5*1190=5950", m1Points0 - m1Points1 === 5950, "delta=" + (m1Points0 - m1Points1));

  // 12) m1 upload a file (free)
  up = await call("POST", "/api/cloud/upload?name=note.txt&mime=text/plain", { raw: small, token: m1Tok });
  ok("m1 上传文件成功", up.status === 200 && up.data.ok, "status=" + up.status);
  r = await call("GET", "/api/cloud/list", { token: m1Tok });
  const files = (r.data && r.data.files) || [];
  ok("云文件列表有 1 个文件", files.length === 1, "len=" + files.length);
  const fileId = files[0] && files[0].id;
  const usedMb = (await call("GET", "/api/cloud/status", { token: m1Tok })).data.usedMb;
  ok("已用云空间 > 0", usedMb > 0, "usedMb=" + usedMb);

  // 13) m1 repost to an A group (charges fileFee)
  const aRoom = ((await call("GET", "/api/rooms", { token: m1Tok })).data.rooms || []).find(x => x.class === "A");
  r = await call("POST", "/api/cloud/repost", { body: { fileId, room: aRoom.id }, token: m1Tok });
  ok("m1 转载到 A 群成功", r.status === 200 && r.data.ok, "status=" + r.status + " err=" + (r.data && r.data.error));
  ok("转载扣费 = fileFee(20B)=20", r.data && r.data.cost === 20, "cost=" + (r.data && r.data.cost));
  const m1Points2 = (await call("GET", "/api/me", { token: m1Tok })).data.points;
  ok("转载后余额再减 20", m1Points1 - m1Points2 === 20, "delta=" + (m1Points1 - m1Points2));

  // 14) m1 delete cloud file
  r = await call("POST", "/api/cloud/delete", { body: { id: fileId }, token: m1Tok });
  ok("m1 删除云文件成功", r.status === 200 && r.data.ok, "status=" + r.status);
  r = await call("GET", "/api/cloud/list", { token: m1Tok });
  ok("删除后云文件列表为空", ((r.data && r.data.files) || []).length === 0);

  // 15) RA upload (free 1GB) + delete
  r = await call("POST", "/api/cloud/upload?name=ra.txt&mime=text/plain", { raw: small, token: raTok });
  ok("RA 上传文件成功(免费 1GB)", r.status === 200 && r.data.ok, "status=" + r.status);
  const raFiles = (await call("GET", "/api/cloud/list", { token: raTok })).data.files || [];
  ok("RA 云文件列表有 1 个", raFiles.length === 1);
  r = await call("POST", "/api/cloud/delete", { body: { id: raFiles[0].id }, token: raTok });
  ok("RA 删除云文件成功", r.status === 200 && r.data.ok);

  // 16) RA cannot buy cloud (already free 1GB)
  r = await call("POST", "/api/cloud/buy", { body: { mb: 5 }, token: raTok });
  ok("RA 购买云空间被拒(已免费 1GB)", r.status === 400 && /1GB/.test(r.data && r.data.error || ""), "status=" + r.status + " err=" + (r.data && r.data.error));

  // ---- summary ----
  console.log("\n================ E2E RESULTS ================");
  results.forEach(l => console.log(l));
  console.log("============================================");
  console.log(failed === 0 ? "ALL PASS (" + results.length + ")" : (failed + " FAILED / " + results.length));
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error("SCRIPT ERROR:", e); process.exit(2); });

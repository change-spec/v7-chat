// 对弈端到端真机验证：两个账号走完 买房间 → 加入 → 开局 → 走子 → 对方收到 → 轮次校验
const DB_ID = "ca1f7479-5c41-4a1e-8ae4-836617d277d5";
const ACCOUNT = "7d498c9f067a2db08dfbae9950bee688";
const CFTOKEN = process.env.V7_CF_TOKEN || "";
const BASE = "https://v7-chat.pages.dev";

async function q(sql) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, {
    method: "POST", headers: { Authorization: "Bearer " + CFTOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  const j = await r.json();
  if (!j.success) throw new Error("D1 查询失败 " + JSON.stringify(j.errors || j).slice(0, 200));
  return j.result[0].results;
}
// 取两个内置账号的现成 token（只读，不新建会话）
async function pickTokens() {
  const rows = await q("SELECT s.username, s.token FROM sessions s GROUP BY s.username ORDER BY s.rowid DESC LIMIT 8");
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.username)) seen.set(r.username, r.token);
  const list = [...seen.entries()].slice(0, 2);
  if (list.length < 2) throw new Error("可用账号不足 2 个");
  return list;
}

function api(token) {
  return async function (path, body) {
    const r = await fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, data: j };
  };
}
function wsFor(token, label, sink) {
  const ws = new WebSocket(BASE.replace(/^https/, "wss") + "/room?token=" + encodeURIComponent(token));
  ws.binaryType = "arraybuffer";
  ws.onopen = () => ws.send(JSON.stringify({ type: "join-room", room: "admin-council" }));
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) return;
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    sink.push(d);
  };
  return ws;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra !== undefined ? " → " + JSON.stringify(extra) : "")); } };

(async () => {
  const [A, B] = await pickTokens();
  console.log("账号A =", A[0], " 账号B =", B[0]);
  const aA = api(A[1]), aB = api(B[1]);
  const sinkA = [], sinkB = [];
  const wsA = wsFor(A[1], "A", sinkA);
  const wsB = wsFor(B[1], "B", sinkB);
  await sleep(1200);

  console.log("===== 1. 购买房间号 =====");
  const buy = await aA("/api/shop/buy", { type: "chess" });
  ok(buy.ok && buy.data.roomId, "房主购买国际象棋房间成功", buy.data);
  const roomId = buy.data.roomId;
  ok(buy.data.fee === 5, "扣费 5 Credits", buy.data.fee);

  const buy3 = await aB("/api/shop/buy", { type: "match3" });
  ok(buy3.ok && buy3.data.roomId, "购买消消乐（单人局）成功", buy3.data);
  const m3Room = buy3.data.roomId;
  ok(buy3.data.fee === 10, "消消乐扣费 10 Credits", buy3.data.fee);

  const bad = await aA("/api/shop/buy", { type: "poker" });
  ok(!bad.ok && bad.status === 400, "未知游戏类型被拒绝", bad.data);

  console.log("===== 2. 加入房间 =====");
  const join = await aB("/api/game/join", { roomId });
  ok(join.ok && !join.data.self, "对手查询房间成功（需付费）", join.data);
  const pay = await aB("/api/game/pay-self", { roomId });
  ok(pay.ok, "对手支付并加入", pay.data);
  await sleep(600);
  ok(sinkA.some(d => d.type === "game-join"), "房主收到 game-join 通知（定向推送）", sinkA.map(d => d.type));

  console.log("===== 3. 开局 =====");
  const start = await aA("/api/game/start", { roomId });
  ok(start.ok && !!start.data.board, "房主开局成功并写入初始局面", start.data);
  await sleep(600);
  ok(sinkB.some(d => d.type === "game-start" && d.board), "对手收到 game-start + 初始局面", sinkB.filter(d => d.type === "game-start"));
  ok(sinkA.some(d => d.type === "game-start"), "房主也收到 game-start");

  const st = await fetch(BASE + "/api/game/state?roomId=" + roomId, { headers: { Authorization: "Bearer " + A[1] } });
  const stj = await st.json();
  ok(stj.game && stj.game.status === "playing" && stj.game.board, "局面已落库 status=playing", stj.game);
  ok(stj.game.turn === A[0], "轮到房主走棋（房主执白）", stj.game.turn);

  console.log("===== 4. 走子 =====");
  // 房主走 e2-e4：FEN 索引 row6 col4 = 52，row4 col4 = 36
  const FEN_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
  const mv1 = await aA("/api/game/move", { roomId, board: FEN_E4 });
  ok(mv1.ok, "房主走子成功", mv1.data);
  await sleep(600);
  const gm = sinkB.find(d => d.type === "game-move");
  ok(!!gm && gm.board === FEN_E4, "对手收到 game-move 且局面一致", gm && gm.board);
  ok(gm && gm.by === A[0], "game-move 标注走子方", gm && gm.by);

  // 轮次校验：房主不该能连续走
  const mv2 = await aA("/api/game/move", { roomId, board: FEN_E4 });
  ok(!mv2.ok && mv2.status === 409, "非轮次方走子被拒（409）", mv2.data);

  // 对手走 e7-e5
  const FEN_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2";
  const mv3 = await aB("/api/game/move", { roomId, board: FEN_E5 });
  ok(mv3.ok, "对手走子成功", mv3.data);
  await sleep(500);
  ok(sinkA.some(d => d.type === "game-move" && d.board === FEN_E5), "房主收到对手走子");

  console.log("===== 5. 非法走子 / 越权 =====");
  const bad1 = await aB("/api/game/move", { roomId, board: "x".repeat(10) });
  ok(!bad1.ok, "非法局面被拒", bad1.data);
  const st2 = await fetch(BASE + "/api/game/state?roomId=" + roomId, { headers: { Authorization: "Bearer " + A[1] } });
  const stj2 = await st2.json();
  ok(stj2.game.board === FEN_E5, "非法走子未污染已存局面", stj2.game.board);

  console.log("===== 6. 结算 =====");
  const end = await aA("/api/game/end", { roomId, winner: "a", result: "白方胜" });
  ok(end.ok, "房主上报结算", end.data);
  await sleep(600);
  ok(sinkB.some(d => d.type === "game-end"), "对手收到 game-end", sinkB.filter(d => d.type === "game-end"));

  console.log("===== 7. 清理 =====");
  await q(`DELETE FROM games WHERE id='${roomId}'; DELETE FROM games WHERE id='${m3Room}'; DELETE FROM messages WHERE text LIKE '%${roomId}%';`);
  const left = await q(`SELECT count(*) c FROM games WHERE id='${roomId}' OR id='${m3Room}'`);
  ok(Number(left[0].c) === 0, "测试房间已清理");

  console.log(`\n===== 结果：${pass} 通过 / ${pass + fail} 项，${fail} 失败 =====`);
  try { wsA.close(); wsB.close(); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试异常:", e.message); process.exit(1); });

// 休眠存活测试：连接 → 进房 → 静置（等 DO 回收/休眠）→ 再发消息，必须仍有回执
const TOKEN = process.env.V7_TOKEN || "";
const DB_ID = "ca1f7479-5c41-4a1e-8ae4-836617d277d5";
const ACCOUNT = "7d498c9f067a2db08dfbae9950bee688";
const CFTOKEN = process.env.V7_CF_TOKEN || "";
const BASE = "https://v7-chat.pages.dev";
const IDLE_MS = Number(process.argv[2] || 90000);

async function diag() {
  const r = await fetch(BASE + "/diag", { headers: CFTOKEN ? { Authorization: "Bearer " + CFTOKEN } : {} });
  try { return await r.json(); } catch { return {}; }
}

const ws = new WebSocket(BASE.replace(/^https/, "wss") + "/room?token=" + encodeURIComponent(TOKEN));
ws.binaryType = "arraybuffer";
let gotHistory = false, gotAfterIdle = false, fatal = false;
const t0 = Date.now();
const el = () => Math.round((Date.now() - t0) / 1000);

ws.onopen = () => { console.log(`[${el()}s] OPEN`); ws.send(JSON.stringify({ type: "join-room", room: "admin-council" })); };
ws.onmessage = (e) => {
  if (e.data instanceof ArrayBuffer) return;
  let d; try { d = JSON.parse(e.data); } catch { return; }
  if (d.type === "sys" && d.fatal) { fatal = true; console.log(`[${el()}s] FATAL sys: ${d.text}`); }
  if (d.type === "history") {
    console.log(`[${el()}s] 收到 history`);
    if (!gotHistory) {
      gotHistory = true;
      console.log(`[${el()}s] 进入静置 ${Math.round(IDLE_MS / 1000)}s（等 DO 回收/休眠）…`);
      setTimeout(async () => {
        console.log(`[${el()}s] 静置结束 → /diag:`, JSON.stringify(await diag()));
        console.log(`[${el()}s] 发送 join-room（复用同一条 socket）`);
        ws.send(JSON.stringify({ type: "join-room", room: "admin-council" }));
      }, IDLE_MS);
    } else {
      gotAfterIdle = true;
      console.log(`[${el()}s] ✅ 静置后仍收到 history —— 连接未失效`);
      finish();
    }
  }
};
ws.onerror = () => console.log(`[${el()}s] ERROR`);
ws.onclose = (e) => console.log(`[${el()}s] CLOSE ${e.code} ${e.reason || ""}`);

function finish() {
  const pass = gotHistory && gotAfterIdle && !fatal;
  console.log(`\n===== 结果：${pass ? "PASS" : "FAIL"}（history=${gotHistory} 静置后回执=${gotAfterIdle} fatal=${fatal}）=====`);
  setTimeout(() => process.exit(pass ? 0 : 1), 500);
}
setTimeout(() => { console.log("[timeout] 未拿到静置后的回执"); process.exit(1); }, IDLE_MS + 40000);

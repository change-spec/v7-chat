// 聊天文件上传端到端验证（真机 WS，不依赖浏览器）
//
// 用法：
//   V7_TOKEN=<session token> node verify_file_upload.mjs
//   V7_TOKEN=... V7_ROOM=admin-council node verify_file_upload.mjs
//
// 可选环境变量：
//   V7_ROOM     目标房间（默认 admin-council，需为该账号的成员房间）
//   V7_CF_TOKEN Cloudflare API Token（用于校验落库字节；缺省则跳过落库校验）
//   V7_CF_ACCOUNT / V7_CF_DB_ID（缺省用内置值）
//
// 覆盖场景：多大小 / 多分片数 / 不同分片间隔，逐字节比对落库内容。
// 这是「文件发不出去」类问题的回归闸门 —— 曾因 DO 内 fileBuf 竞态导致分片全丢。
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const TOKEN = process.env.V7_TOKEN || "";
const ROOM = process.env.V7_ROOM || "admin-council";
const CF_TOKEN = process.env.V7_CF_TOKEN || "";
const CF_ACCOUNT = process.env.V7_CF_ACCOUNT || "7d498c9f067a2db08dfbae9950bee688";
const CF_DB_ID = process.env.V7_CF_DB_ID || "ca1f7479-5c41-4a1e-8ae4-836617d277d5";
const CHUNK = 64 * 1024;

if (!TOKEN) {
  console.error("缺少 V7_TOKEN 环境变量");
  process.exit(2);
}

async function q(sql) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${CF_DB_ID}/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + CF_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  const j = await r.json();
  if (!j.success) throw new Error("D1 查询失败: " + JSON.stringify(j.errors || j).slice(0, 200));
  return j.result;
}

// 场景：[字节数, 分片间隔ms]
const CASES = [
  [100, 0],
  [200 * 1024, 0],
  [200 * 1024, 3],
  [1024 * 1024, 0],
  [0, 0],
];

function mkData(size) {
  const a = new Uint8Array(size);
  for (let i = 0; i < size; i++) a[i] = (i * 31 + 7) % 251;
  return a;
}

const ws = new WebSocket("wss://v7-chat.pages.dev/room?token=" + encodeURIComponent(TOKEN));
ws.binaryType = "arraybuffer";
let ci = 0;
let pending = null;
const results = [];

function framedChunk(fileId, arr) {
  const idb = new TextEncoder().encode(fileId);
  const out = new Uint8Array(4 + idb.length + arr.length);
  out[0] = (idb.length >>> 24) & 255;
  out[1] = (idb.length >>> 16) & 255;
  out[2] = (idb.length >>> 8) & 255;
  out[3] = idb.length & 255;
  out.set(idb, 4);
  out.set(arr, 4 + idb.length);
  return out.buffer;
}

function startCase(size, delay) {
  const fileId = "fVERIFY" + Date.now().toString(36) + ci;
  const data = mkData(size);
  ws.send(JSON.stringify({ type: "file-start", id: fileId, name: "verify" + ci + ".bin", size, mime: "application/octet-stream" }));
  let off = 0;
  function next() {
    if (off < size) {
      const end = Math.min(off + CHUNK, size);
      ws.send(framedChunk(fileId, data.subarray(off, end)));
      off = end;
      if (delay > 0) setTimeout(next, delay); else next();
    } else {
      ws.send(JSON.stringify({ type: "file-end", id: fileId }));
    }
  }
  next();
  return { fileId, data };
}

async function cleanup(fileId) {
  try {
    await q(`DELETE FROM chat_files WHERE id='${fileId}'; DELETE FROM messages WHERE text LIKE '%${fileId}%'; DELETE FROM chat_file_chunks WHERE file_id='${fileId}'; DELETE FROM chat_uploads WHERE file_id='${fileId}';`);
  } catch {}
}

ws.onopen = () => ws.send(JSON.stringify({ type: "join-room", room: ROOM }));

ws.onmessage = async (ev) => {
  if (ev.data instanceof ArrayBuffer) return;
  let d;
  try { d = JSON.parse(ev.data); } catch { return; }

  if (d.type === "history" && d.room === ROOM && ci < CASES.length && !pending) {
    const [size, delay] = CASES[ci];
    pending = startCase(size, delay);
    console.log(`[case ${ci + 1}] size=${size} delay=${delay}ms`);
  }

  if (d.type === "file-done" && pending) {
    const cur = pending;
    pending = null;
    let verdict, detail;
    if (CF_TOKEN) {
      const r = await q(`SELECT data, size FROM chat_files WHERE id='${cur.fileId}'`);
      const row = r[0].results[0];
      if (!row) {
        verdict = "FAIL";
        detail = `chat_files 无记录（ok=${d.ok} err=${d.error || "-"}）`;
      } else {
        const bytes = Buffer.from(row.data, "base64");
        let bad = -1;
        for (let i = 0; i < cur.data.length; i++) if (bytes[i] !== cur.data[i]) { bad = i; break; }
        const identical = bytes.length === cur.data.length && bad === -1;
        verdict = (d.ok && identical) ? "PASS" : "FAIL";
        detail = `ok=${d.ok} 落库=${bytes.length}B/期望=${cur.data.length}B 首个错位=${bad}` + (d.cost !== undefined ? ` 扣费=${d.cost}` : "");
      }
      await cleanup(cur.fileId);
    } else {
      verdict = d.ok ? "PASS" : "FAIL";
      detail = `ok=${d.ok}` + (d.error ? ` err=${d.error}` : "") + "（未提供 V7_CF_TOKEN，跳过落库字节校验）";
    }
    console.log(`  → ${verdict}: ${detail}`);
    results.push({ n: ci + 1, size: CASES[ci][0], delay: CASES[ci][1], verdict });
    ci++;
    if (ci < CASES.length) setTimeout(() => { pending = startCase(CASES[ci][0], CASES[ci][1]); }, 400);
    else {
      const pass = results.filter(r => r.verdict === "PASS").length;
      console.log(`\n===== ${pass}/${results.length} 通过 =====`);
      results.forEach(r => console.log(`  case${r.n} size=${r.size} delay=${r.delay}ms → ${r.verdict}`));
      process.exit(pass === results.length ? 0 : 1);
    }
  }
};

ws.onerror = (e) => console.log("[error]", e.message);
setTimeout(() => { console.log(`[timeout] 只完成 ${results.length}/${CASES.length}`); process.exit(1); }, 40000);

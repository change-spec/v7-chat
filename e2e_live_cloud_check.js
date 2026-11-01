// 线上云文件下载验证：登录 → 列出云文件 → 逐个下载 → 校验字节与魔数
// 用法：node e2e_live_cloud_check.js <用户名> <密码> [baseUrl]
const BASE = process.argv[3] || "https://v7-chat.pages.dev";
const USER = process.argv[1];
const PASS = process.argv[2];
const R = [];
const ok = (n, c, e) => { R.push((c ? "PASS " : "FAIL ") + n + (e ? "  -> " + e : "")); return c; };

const MAGIC = {
  "image/png": "PNG 图像", "image/jpeg": "JPEG 图像", "image/gif": "GIF 图像",
  "image/webp": "WebP 图像", "image/bmp": "BMP 图像",
  "video/mp4": "MP4 视频", "video/webm": "WebM 视频", "video/quicktime": "MOV 视频",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word (docx)",
  "application/vnd.ms-word": "Word (doc)", "application/pdf": "PDF",
  "application/zip": "ZIP", "text/plain": "纯文本"
};

function sniff(bytes) {
  const b = bytes;
  const eq = (a) => b.length >= a.length && a.every((v, i) => b[i] === v);
  if (eq([0x89, 0x50, 0x4E, 0x47])) return "PNG 图像";
  if (eq([0xFF, 0xD8, 0xFF])) return "JPEG 图像";
  if (eq([0x47, 0x49, 0x46])) return "GIF 图像";
  if (b.length > 12 && String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
      String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP") return "WebP 图像";
  if (eq([0x42, 0x4D])) return "BMP 图像";
  if (b.length > 12 && String.fromCharCode(b[4], b[5], b[6], b[7]) === "ftyp") return "MP4/MOV 视频";
  if (b.length > 4 && b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return "WebM 视频";
  if (eq([0x50, 0x4B, 0x03, 0x04]) || eq([0x50, 0x4B, 0x05, 0x06])) return "ZIP 容器（docx/xlsx/pptx 属于此类）";
  if (eq([0xD0, 0xCF, 0x11, 0xE0])) return "OLE2 容器（旧版 doc/xls 属于此类）";
  if (eq([0x25, 0x50, 0x44, 0x46])) return "PDF";
  if (b.length >= 4 && b[0] === 0x7B) return "JSON 文本（不是二进制文件！）";
  return "未知格式";
}

(async () => {
  let r = await fetch(BASE + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS })
  });
  const login = await r.json();
  if (!ok("登录 " + USER, r.status === 200 && login.token, JSON.stringify(login).slice(0, 120))) {
    console.log(R.join("\n")); process.exit(1);
  }
  const auth = { Authorization: "Bearer " + login.token };
  ok("角色 = " + login.role, !!login.role);

  r = await fetch(BASE + "/api/cloud/status", { headers: auth });
  const st = await r.json();
  ok("云空间状态可读", r.status === 200, "totalMb=" + st.totalMb + " usedMb=" + st.usedMb);

  r = await fetch(BASE + "/api/cloud/list", { headers: auth });
  const lst = await r.json();
  const files = lst.files || [];
  ok("云文件列表可读", r.status === 200, "共 " + files.length + " 个");
  if (!files.length) { console.log(R.join("\n")); console.log("（没有文件可测）"); process.exit(0); }

  for (const f of files) {
    console.log("\n--- " + f.name + " (" + f.size + " 字节, mime=" + f.mime + ") ---");
    const resp = await fetch(BASE + "/api/cloud/file?id=" + encodeURIComponent(f.id), { headers: auth });
    const ct = resp.headers.get("content-type");
    const cd = resp.headers.get("content-disposition") || "";
    const got = new Uint8Array(await (await resp.blob()).arrayBuffer());

    ok("HTTP 200", resp.ok, "status=" + resp.status);
    ok("长度与记录一致", got.length === f.size, got.length + " vs " + f.size);
    ok("不是 JSON（首字节非 '{'）", got[0] !== 0x7b, "首字节=0x" + got[0].toString(16));
    ok("Content-Type = " + f.mime, (ct || "").split(";")[0] === f.mime, "ct=" + ct);
    ok("带 attachment 文件名", cd.includes("attachment"), cd.slice(0, 70));
    const s = sniff(got);
    ok("格式识别 = " + s, true);
    if (f.mime && MAGIC[f.mime]) ok("魔数与声明的格式一致（" + MAGIC[f.mime] + "）", s === MAGIC[f.mime], "实际=" + s);
    ok("前 16 字节 = " + Array.from(got.slice(0, 16)).map(x => x.toString(16).padStart(2, "0")).join(" "), true);
  }

  console.log("\n========== 线上云文件下载验证 ==========");
  R.forEach(l => console.log(l));
  console.log("==========================================");
  console.log(R.every(x => x.startsWith("PASS")) ? "ALL PASS (" + R.length + ")" : R.filter(x => x.startsWith("FAIL")).length + " FAILED / " + R.length);
})().catch(e => { console.error("ERR", e.message); process.exit(2); });

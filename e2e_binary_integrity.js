// 字节级验证：上传二进制 → 按前端现有逻辑下载 → 比对字节是否一致
const BASE = process.env.BASE || "http://127.0.0.1:8788";
const R = [];
const ok = (n, c, e) => { R.push((c ? "PASS " : "FAIL ") + n + (e ? "  -> " + e : "")); return c; };

// 造一个真实 PNG（1x1 红点，标准 PNG 魔数 + IHDR + IDAT + IEND）
function makePng() {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00];
  const idat = [0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00,
               0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
               0xae, 0x42, 0x60, 0x82];
  const raw = sig.concat(ihdr, idat);
  return new Uint8Array(raw);
}

(async () => {
  const u = "b" + Date.now().toString(36).slice(-5);
  let r = await fetch(BASE + "/api/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: u, password: "verify123" })
  });
  const reg = await r.json();
  ok("注册成功", r.status === 200 && reg.token, "role=" + reg.role);
  const token = reg.token;
  const auth = { Authorization: "Bearer " + token };

  const png = makePng();
  ok("测试 PNG 有正确魔数", png[0] === 0x89 && png[1] === 0x50);

  // 上传
  r = await fetch(BASE + "/api/cloud/upload?name=t.png&mime=image/png", {
    method: "POST", headers: { ...auth, "content-type": "image/png" }, body: png
  });
  const up = await r.json();
  ok("上传成功", r.status === 200 && up.ok, JSON.stringify(up).slice(0, 80));

  // 取文件 id
  r = await fetch(BASE + "/api/cloud/list", { headers: auth });
  const lst = await r.json();
  const files = lst.files || [];
  ok("云列表有 1 个文件", files.length === 1, "len=" + files.length);
  const id = files[0] && files[0].id;

  // === 关键：模拟前端现有下载逻辑（r.blob() 直接用）===
  r = await fetch(BASE + "/api/cloud/file?id=" + encodeURIComponent(id), { headers: auth });
  const ct = r.headers.get("content-type");
  const rawBlob = await r.blob();
  const rawBytes = new Uint8Array(await rawBlob.arrayBuffer());
  const rawText = new TextDecoder().decode(rawBytes.slice(0, 40));

  ok("响应 Content-Type 是 JSON（=前端 blob() 会把 JSON 当文件）",
     (ct || "").includes("application/json"), "ct=" + ct);
  ok("直接 blob() 下载的内容不是原始 PNG 字节（复现 bug）",
     !(rawBytes[0] === 0x89 && rawBytes[1] === 0x50),
     "首字节=0x" + rawBytes[0].toString(16) + " 内容开头=" + JSON.stringify(rawText.slice(0, 24)));

  // === 正确逻辑：解析 JSON，取 data(base64) → 解码成字节 ===
  const j = await (await fetch(BASE + "/api/cloud/file?id=" + encodeURIComponent(id), { headers: auth })).json();
  ok("JSON 里含 data 字段", typeof j.data === "string" && j.data.length > 0, "len=" + (j.data || "").length);
  const bin = atob(j.data);
  const good = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) good[i] = bin.charCodeAt(i);
  ok("base64 解码后字节数一致", good.length === png.length, good.length + " vs " + png.length);
  let same = good.length === png.length;
  if (same) for (let i = 0; i < good.length; i++) if (good[i] !== png[i]) { same = false; break; }
  ok("字节逐个一致（内容完全无损）", same);
  ok("解码结果仍是合法 PNG", good[0] === 0x89 && good[1] === 0x50 && good[2] === 0x4e && good[3] === 0x47);

  console.log("\n========== 二进制完整性诊断 ==========");
  R.forEach(l => console.log(l));
  console.log("========================================");
  console.log(R.every(x => x.startsWith("PASS")) ? "ALL PASS" : R.filter(x => x.startsWith("FAIL")).length + " FAILED");
})().catch(e => { console.error("ERR", e.message); process.exit(2); });

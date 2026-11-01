// 云存储下载完整性测试：多种真实格式（PNG/JPEG/GIF/ZIP-DOCX/MP4-ish）
// 上传后按前端方式下载（r.blob()），逐字节比对是否与原文件完全一致
const BASE = process.env.BASE || "http://127.0.0.1:8788";
const R = [];
const ok = (n, c, e) => { R.push((c ? "PASS " : "FAIL ") + n + (e ? "  -> " + e : "")); return c; };

// 造真实 JPEG：FFD8FFE0 + APP0(JFIF) + 压缩数据 + FFD9
function makeJpeg() {
  const head = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
                0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const body = [];
  for (let i = 0; i < 64; i++) body.push(0xAB, 0xCD, 0xEF, (i & 0xFF));
  const tail = [0xFF, 0xD9];
  return new Uint8Array(head.concat(body, tail));
}
// 造真实 GIF：GIF89a + 逻辑屏描述 + 图像描述 + 数据 + 结束符
function makeGif() {
  const b = [];
  b.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);       // GIF89a
  b.push(0x01, 0x00, 0x01, 0x00);                    // 1x1
  b.push(0x80, 0x00, 0x00);                          // GCT flag
  b.push(0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF);       // 2色 GCT
  b.push(0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);
  b.push(0x02, 0x02, 0x44, 0x01, 0x00);             // LZW data
  b.push(0x3B);                                       // trailer
  return new Uint8Array(b);
}
// 造真实 DOCX（ZIP）：PK\x03\x04 + local header + 一个 entry + central dir + EOCD
function makeDocx() {
  const b = [];
  b.push(0x50, 0x4B, 0x03, 0x04);                   // local file header
  b.push(0x14, 0x00, 0x00, 0x00);                   // version
  b.push(0x08, 0x00);                               // flags: data descriptor
  b.push(0x00, 0x00);                               // method: store
  b.push(0x00, 0x00, 0x00, 0x00);                   // time/date
  b.push(0x00, 0x00, 0x00, 0x00);                   // crc32
  b.push(0x04, 0x00, 0x00, 0x00);                   // compressed size
  b.push(0x04, 0x00, 0x00, 0x00);                   // uncompressed size
  b.push(0x08, 0x00, 0x00, 0x00);                   // name len
  b.push(0x00, 0x00);                               // extra len
  const name = [0x5B, 0x43, 0x6F, 0x6E, 0x74, 0x65, 0x6E, 0x74, 0x73, 0x2E, 0x78, 0x6D, 0x6C]; // [Content_Types].xml
  name.forEach(x => b.push(x));
  b.push(0x50, 0x4B, 0x05, 0x06);                   // EOCD
  b.push(0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
  return new Uint8Array(b);
}
// 造 MP4 头（ftyp box）
function makeMp4() {
  const b = [];
  const ftyp = [0x66, 0x74, 0x79, 0x70, 0x6D, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x20];
  b.push(0x00, 0x00, 0x00, 0x18);                   // box size
  ftyp.forEach(x => b.push(x));
  for (let i = 0; i < 256; i++) b.push(i & 0xFF);  // 假 mdat
  return new Uint8Array(b);
}

const CASES = [
  { name: "photo.png", mime: "image/png", bytes: null, magic: [0x89, 0x50, 0x4E, 0x47] },
  { name: "photo.jpg", mime: "image/jpeg", bytes: makeJpeg(), magic: [0xFF, 0xD8, 0xFF] },
  { name: "anim.gif", mime: "image/gif", bytes: makeGif(), magic: [0x47, 0x49, 0x46] },
  { name: "doc.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: makeDocx(), magic: [0x50, 0x4B] },
  { name: "clip.mp4", mime: "video/mp4", bytes: makeMp4(), magic: [0x00, 0x00, 0x00, 0x18] }
];

(async () => {
  const u = "c" + Date.now().toString(36).slice(-5);
  let r = await fetch(BASE + "/api/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: u, password: "verify123" })
  });
  const reg = await r.json();
  ok("注册成功", r.status === 200 && reg.token, "role=" + reg.role);
  const auth = { Authorization: "Bearer " + reg.token };

  // PNG 用真 PNG 字节
  CASES[0].bytes = makePngBytes();
  function makePngBytes() {
    const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    const ihdr = [0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00];
    const idat = [0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00,
                 0x18, 0xDD, 0x8D, 0xB0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
                 0xAE, 0x42, 0x60, 0x82];
    return new Uint8Array(sig.concat(ihdr, idat));
  }

  for (const c of CASES) {
    // 上传
    r = await fetch(BASE + "/api/cloud/upload?name=" + encodeURIComponent(c.name) + "&mime=" + encodeURIComponent(c.mime), {
      method: "POST", headers: { ...auth, "content-type": c.mime }, body: c.bytes
    });
    const up = await r.json();
    if (!ok("上传 " + c.name, r.status === 200 && up.ok, "status=" + r.status + " " + (up.error || ""))) continue;

    // 按前端方式下载：r.blob()
    r = await fetch(BASE + "/api/cloud/file?id=" + encodeURIComponent("x"), { headers: auth });
    const lst = await (await fetch(BASE + "/api/cloud/list", { headers: auth })).json();
    const files = lst.files || [];
    const mine = files.find(f => f.name === c.name);
    if (!ok("云列表找到 " + c.name, !!mine, "files=" + files.map(f => f.name).join(","))) continue;

    const resp = await fetch(BASE + "/api/cloud/file?id=" + encodeURIComponent(mine.id), { headers: auth });
    const ct = resp.headers.get("content-type");
    const cd = resp.headers.get("content-disposition") || "";
    const got = new Uint8Array(await (await resp.blob()).arrayBuffer());

    ok(c.name + " 长度一致", got.length === c.bytes.length, got.length + " vs " + c.bytes.length);
    let same = got.length === c.bytes.length;
    if (same) for (let i = 0; i < got.length; i++) if (got[i] !== c.bytes[i]) { same = false; break; }
    ok(c.name + " 字节逐个一致", same);
    let magicOk = true;
    for (let i = 0; i < c.magic.length; i++) if (got[i] !== c.magic[i]) { magicOk = false; break; }
    ok(c.name + " 魔数正确（是真实格式，非 JSON）", magicOk,
       "首4字节=" + Array.from(got.slice(0, 4)).map(x => x.toString(16)).join(" "));
    ok(c.name + " Content-Type 正确", (ct || "").split(";")[0] === c.mime, "ct=" + ct);
    ok(c.name + " 带 attachment 文件名", cd.includes("attachment") && cd.includes("filename"), cd.slice(0, 60));
    ok(c.name + " 不是 JSON（首字节不是 '{' = 0x7b）", got[0] !== 0x7b, "0x" + got[0].toString(16));
  }

  console.log("\n========== 多格式下载完整性 ==========");
  R.forEach(l => console.log(l));
  console.log("========================================");
  console.log(R.every(x => x.startsWith("PASS")) ? "ALL PASS (" + R.length + ")" : R.filter(x => x.startsWith("FAIL")).length + " FAILED / " + R.length);
})().catch(e => { console.error("ERR", e.message); process.exit(2); });

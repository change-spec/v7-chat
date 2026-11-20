import { html } from "./html";

export interface Env {
  ROOM: DurableObjectNamespace;
  DB: D1Database;
  // 云存储外部后端（Supabase Storage）。走 Worker secret 注入，绝不下发到前端。
  // 未配置时自动降级为 D1 分片存储（行为不变）。
  SUPABASE_URL?: string;
  SUPABASE_SECRET?: string;
  SUPABASE_BUCKET?: string;
  // 9 个 D1 分片库（v7-chat-db-02..10）：云文件 D1 分片存储（RA 超 1GB 溢出层 / Supabase 失败兜底）
  SHARD0?: D1Database;
  SHARD1?: D1Database;
  SHARD2?: D1Database;
  SHARD3?: D1Database;
  SHARD4?: D1Database;
  SHARD5?: D1Database;
  SHARD6?: D1Database;
  SHARD7?: D1Database;
  SHARD8?: D1Database;
}

const PBKDF2_ITERATIONS = 100000;
const VALID_ROLES = ["observer", "member", "admin"];
// ===== 内置账号（时刻保证存在，丢失自动重建）=====
// 只存 PBKDF2 的固定 salt / pass_hash，不存明文口令（本仓库是 public）。
// 与 createAccount() 完全同一套算法：PBKDF2-HMAC-SHA256 / 100000 次 / 32 字节 / hex。
// 「重建一模一样」= 用同一 salt+hash 插回，原密码即可直接登录。
const BUILTIN_ACCOUNTS = [
  { username: "deportee", role: "root-admin", salt: "0f20f220483b8059ac94911e00c0e39a", passHash: "05e26260cdb6f42f0f017d3a3e35e261d424eea816a00b9059a5ba74025cb997" },
  { username: "change-spec", role: "admin", salt: "353eec00386c2b4f11637bd3731e444d", passHash: "9273c57d582ca461b63aad23592aa66cde84412e0d34bf9074fec31a9f31a255" },
  { username: "git-k", role: "admin", salt: "80d354e353a980327a3ceb1ad1fd3e87", passHash: "449a30fc867c52bca76d36800b29a835302626024b18eb33a448b627dcb3065d" },
  { username: "kenkin", role: "admin", salt: "31d83ee7ed88a919eae46974fcb87b78", passHash: "387a930b1809e0d3b821455712a381fc124adc832a29ac058d48dda1f7e29a36" },
  { username: "big-energy", role: "admin", salt: "29ee9511cb83d4a050c19cee73065b42", passHash: "d1aa85344b95c396ae23ff26e0934811bcbc4b857577defdd7b23010b47e75b6" },
  { username: "teacher-student", role: "admin", salt: "058e48363e05e268ae6748ba01b06a13", passHash: "a2e5ac34d5167addffeb04c2cf3249a115a2210a9a5667bc65a00053ec770dab" }
];
// belongs_to 只能从这 5 位管理员里选；新建账号不能再用 admin 身份
const ADMIN_NAMES = ["change-spec", "git-k", "kenkin", "big-energy", "teacher-student"];
const BUILTIN_USERNAMES = BUILTIN_ACCOUNTS.map((a) => a.username);
const INVITE_IDENTITIES = ["observer", "member"];
// ===== 内置 C 类群（系统自动维护，不可解散）=====
const COUNCIL_ROOM = "admin-council";                 // 管理员交流群，RA 群主
const ADMIN_GROUP_PREFIX = "group:";                   // group:<admin> = xxx的小群
const RECOVER_TTL_MS = 35 * 60 * 1000;               // 找回代码固定 35 分钟
const LOG_RETENTION_MS = 35 * 24 * 3600 * 1000;      // 系统日志保留 35 天
function isBuiltinRoom(id: string): boolean {
  if (id === "geek" || id === COUNCIL_ROOM) return true;
  if (id.indexOf(ADMIN_GROUP_PREFIX) === 0 &&
      ADMIN_NAMES.indexOf(id.slice(ADMIN_GROUP_PREFIX.length)) !== -1) return true;
  return false;
}



function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password: string, salt: ArrayBuffer): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return toHex(bits);
}

function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

async function newToken(): Promise<string> {
  return toHex(crypto.getRandomValues(new Uint8Array(24)).buffer as ArrayBuffer);
}

// 文件字节拼接 / base64 编解码（用于把聊天文件落盘进 D1，作为聊天记录保留 7 天）
function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ===== 群收费倍率 =====
// 默认：文件 1MB / 20 Credits、发言 20 字 / 10 Credits（向上取整，至少 1 个计费单位）。
// 群主可自定义倍率的范围：A 类普通群、管理员交流群、各管理员小群（这些群都有明确群主）。
//   · Geek公告群(geek)：全免费（别人不能发言、RA 发言/上传免费、成员下载 RA 文件免费）
//   · B 类私聊(dm:*，成员与 Root-Admin 的私聊)：固定走默认倍率，按现有规则扣费
// 倍率存 rooms.file_rate_per_mb / rooms.msg_rate_per20，NULL 表示使用默认值。
const DEFAULT_FILE_RATE = 20;   // Credits / MB
const DEFAULT_MSG_RATE = 10;    // Credits / 20 字
async function roomRates(env: Env, room: string): Promise<{ fileRate: number; msgRate: number }> {
  if (room === "geek") return { fileRate: 0, msgRate: 0 }; // 公告群：全员免费
  try {
    const row = await env.DB.prepare("SELECT class, file_rate_per_mb, msg_rate_per20 FROM rooms WHERE id = ?").bind(room)
      .first<{ class: string | null; file_rate_per_mb: number | null; msg_rate_per20: number | null }>();
    // B 类私聊固定默认倍率（与 Root-Admin 的私聊按现有正常倍率扣费，不参与自定义）
    if (!row || row.class === "B") return { fileRate: DEFAULT_FILE_RATE, msgRate: DEFAULT_MSG_RATE };
    return {
      fileRate: row.file_rate_per_mb == null ? DEFAULT_FILE_RATE : Math.max(0, Number(row.file_rate_per_mb) || 0),
      msgRate: row.msg_rate_per20 == null ? DEFAULT_MSG_RATE : Math.max(0, Number(row.msg_rate_per20) || 0)
    };
  } catch { return { fileRate: DEFAULT_FILE_RATE, msgRate: DEFAULT_MSG_RATE }; }
}
function fileFeeFor(size: number, rate: number): number {
  if (rate <= 0) return 0;
  return Math.max(rate, Math.ceil(Math.max(0, size) / (1024 * 1024)) * rate);
}
function textFeeFor(text: string, rate: number): number {
  if (rate <= 0) return 0;
  return Math.max(rate, Math.ceil(text.length / 20) * rate);
}

const OTP_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
const OTP_LENGTH = 32;

function newOtpCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(OTP_LENGTH));
  let s = "";
  for (let i = 0; i < OTP_LENGTH; i++) s += OTP_CHARS[bytes[i] % OTP_CHARS.length];
  return s;
}

function validateCredentials(username: string, password: string): string | null {
  if (!/^[A-Za-z0-9_-]{2,16}$/.test(username)) return "用户名限 2-16 位字母数字-_";
  if (password.length < 6) return "密码至少 6 位";
  if (password.length > 64) return "密码最长 64 位";
  return null;
}

async function authUser(request: Request, env: Env): Promise<{ username: string; role: string } | null> {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const row = await env.DB.prepare("SELECT username FROM sessions WHERE token = ?").bind(token).first<{ username: string }>();
  if (!row) return null;
  const acc = await env.DB.prepare("SELECT role FROM accounts WHERE username = ?").bind(row.username).first<{ role: string }>();
  return acc ? { username: row.username, role: acc.role } : null;
}

async function issueSession(env: Env, username: string): Promise<string> {
  const token = await newToken();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)")
    .bind(token, username, now).run();
  return token;
}

async function writeAdminLog(env: Env, admin: string, action: string, detail: string): Promise<void> {
  try {
    await env.DB.prepare("INSERT INTO admin_logs (admin, action, detail, created_at) VALUES (?, ?, ?, ?)")
      .bind(admin, action, detail, new Date().toISOString()).run();
  } catch {}
}

// ===== 房间 / 成员体系 =====
async function ensureRoomSchema(env: Env): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT, type TEXT, creator TEXT, created_at TEXT)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS memberships (room TEXT, username TEXT, joined_at TEXT, PRIMARY KEY(room, username))")
    ]);
  } catch {}
  // 旧库补列：rooms.passcode（加群密码）
  try {
    await env.DB.prepare("ALTER TABLE rooms ADD COLUMN passcode TEXT").run();
  } catch {}
  // 群聊分类列 class：A=普通群（默认）/ B=与 Root-Admin 的私聊 / C=内置（公告群）
  try {
    await env.DB.prepare("ALTER TABLE rooms ADD COLUMN class TEXT").run();
    await env.DB.prepare("UPDATE rooms SET class = 'C' WHERE class IS NULL AND (type = 'builtin' OR type = 'file')").run();
    await env.DB.prepare("UPDATE rooms SET class = 'A' WHERE class IS NULL").run();
  } catch {}
  // 群收费倍率：每 MB Credits / 每 20 字 Credits（NULL = 使用默认 20 / 10）
  try { await env.DB.prepare("ALTER TABLE rooms ADD COLUMN file_rate_per_mb REAL").run(); } catch {}
  try { await env.DB.prepare("ALTER TABLE rooms ADD COLUMN msg_rate_per20 REAL").run(); } catch {}
  // 禁言表：room + username 唯一，until 为禁言结束时间（结束后 12 小时内不可再次禁言）
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS room_mutes (
      room TEXT NOT NULL,
      username TEXT NOT NULL,
      until TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (room, username)
    )`).run();
  } catch {}
}

// 消息与聊天文件按房间分级保留，过期自动清除，避免挤占云存储
//   C 类（Geek公告群等内置房）：21 天
//   B 类（与 Root-Admin 的私聊）：7 天
//   A 类（普通群）：5 天
const RETENTION_C_MS = 21 * 24 * 3600 * 1000;
const RETENTION_B_MS = 7 * 24 * 3600 * 1000;
const RETENTION_A_MS = 5 * 24 * 3600 * 1000;
const MSG_RETENTION_MS = RETENTION_B_MS; // 默认保留期（B 类），用于历史查询兜底
const CHAT_FILE_CAP = 20 * 1024 * 1024; // 单文件落地上限 20MB（更大文件仅实时转发，不入库）
let lastPurgeAt = 0;

// 按房间 class 计算该房间的保留截止时间
async function roomRetentionCutoff(env: Env, room: string): Promise<string> {
  const row = await env.DB.prepare("SELECT class FROM rooms WHERE id = ?").bind(room)
    .first<{ class: string | null }>();
  const cls = row && row.class ? row.class : "A";
  const ms = cls === "C" ? RETENTION_C_MS : cls === "B" ? RETENTION_B_MS : RETENTION_A_MS;
  return new Date(Date.now() - ms).toISOString();
}

// 分级清理：按 rooms.class 分别用不同 cutoff 删除
async function purgeOldMessages(env: Env, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastPurgeAt < 20 * 1000) return; // 节流：20 秒最多一次（force 可绕过）
  lastPurgeAt = now;
  const nowIso = new Date(now).toISOString();
  const cutC = new Date(now - RETENTION_C_MS).toISOString();
  const cutB = new Date(now - RETENTION_B_MS).toISOString();
  const cutA = new Date(now - RETENTION_A_MS).toISOString();
  try {
    // 消息：按房间 class 用不同 cutoff
    await env.DB.prepare(
      "DELETE FROM messages WHERE ts < CASE " +
      "WHEN (SELECT class FROM rooms WHERE id = messages.room) = 'C' THEN ? " +
      "WHEN (SELECT class FROM rooms WHERE id = messages.room) = 'B' THEN ? " +
      "ELSE ? END"
    ).bind(cutC, cutB, cutA).run();
    // 聊天文件：同规则
    await env.DB.prepare(
      "DELETE FROM chat_files WHERE created_at < CASE " +
      "WHEN (SELECT class FROM rooms WHERE id = chat_files.room) = 'C' THEN ? " +
      "WHEN (SELECT class FROM rooms WHERE id = chat_files.room) = 'B' THEN ? " +
      "ELSE ? END"
    ).bind(cutC, cutB, cutA).run();
    // 分片表：清理已无对应 chat_files 的孤儿分片
    await env.DB.prepare(
      "DELETE FROM chat_file_chunks WHERE file_id NOT IN (SELECT id FROM chat_files)"
    ).run();
    // 上传会话表：已完成（已生成 chat_files）或超过 1 小时的残留会话一并清理
    await env.DB.prepare(
      "DELETE FROM chat_uploads WHERE file_id IN (SELECT id FROM chat_files) OR created_at < ?"
    ).bind(new Date(now - 3600 * 1000).toISOString()).run().catch(() => {});
    // 系统日志最多保留 35 天
    await env.DB.prepare("DELETE FROM admin_logs WHERE created_at < ?")
      .bind(new Date(now - LOG_RETENTION_MS).toISOString()).run();
    // 过期找回代码：用完或过期即删除，仅在日志留痕
    await env.DB.prepare("DELETE FROM recover_codes WHERE expires_at < ?").bind(nowIso).run();
  } catch {}
  void nowIso;
}

// 内置 C 类群自愈：管理员交流群（RA 群主，含所有管理员）+ 每位管理员的小群
// （该管理员群主，含所有 belongs_to = 该管理员的用户）。60 秒节流，注册时 force。
let lastRoomsEnsureAt = 0;
async function ensureBuiltinRooms(env: Env, force = false): Promise<void> {
  const nowMs = Date.now();
  if (!force && nowMs - lastRoomsEnsureAt < 60 * 1000) return;
  lastRoomsEnsureAt = nowMs;
  try {
    await ensureRoomSchema(env);
    try { await env.DB.prepare("ALTER TABLE accounts ADD COLUMN belongs_to TEXT").run(); } catch {}
    const now = new Date().toISOString();
    const stmts: any[] = [
      env.DB.prepare("INSERT OR IGNORE INTO rooms (id,name,type,creator,created_at,class) VALUES (?,?,'builtin',?,?,'C')")
        .bind(COUNCIL_ROOM, "管理员交流群", "deportee", now),
      env.DB.prepare("UPDATE rooms SET name='管理员交流群', creator='deportee', class='C' WHERE id=?").bind(COUNCIL_ROOM),
      env.DB.prepare("INSERT OR IGNORE INTO memberships (room,username,joined_at) SELECT ?, username, ? FROM accounts WHERE role IN ('root-admin','admin')")
        .bind(COUNCIL_ROOM, now)
    ];
    for (const a of ADMIN_NAMES) {
      const id = ADMIN_GROUP_PREFIX + a;
      stmts.push(env.DB.prepare("INSERT OR IGNORE INTO rooms (id,name,type,creator,created_at,class) VALUES (?,?,'builtin',?,?,'C')")
        .bind(id, a + "的小群", a, now));
      stmts.push(env.DB.prepare("UPDATE rooms SET name=?, creator=?, class='C' WHERE id=?").bind(a + "的小群", a, id));
      stmts.push(env.DB.prepare("INSERT OR IGNORE INTO memberships (room,username,joined_at) VALUES (?,?,?)").bind(id, a, now));
      stmts.push(env.DB.prepare("INSERT OR IGNORE INTO memberships (room,username,joined_at) SELECT ?, username, ? FROM accounts WHERE belongs_to = ?")
        .bind(id, now, a));
    }
    await env.DB.batch(stmts);
  } catch (e) {
    lastRoomsEnsureAt = 0;
    console.error("内置群自愈失败：", e);
  }
}

// 确保每个账号都拥有 Geek公告群 内置会话
async function ensureBuiltins(env: Env, username: string): Promise<void> {
  const now = new Date().toISOString();
  await ensureRoomSchema(env);
  // B 类私聊：每个账号注册即与 Root-Admin 建立一条私聊（房主=该用户，名称=其用户名；用户视角显示 Root-Admin）
  const ra = await getRootAdmin(env);
  const dmId = "dm:" + username;
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO rooms (id, name, type, creator, created_at, class) VALUES ('geek', 'Geek公告群', 'builtin', 'system', ?, 'C')").bind(now),
      // 兼容旧库：把历史名称统一改成 Geek公告群
      env.DB.prepare("UPDATE rooms SET name = 'Geek公告群' WHERE id = 'geek' AND name != 'Geek公告群'"),
      // 把当前所有账号都拉进 Geek公告群（全员可见，含观测者）
      env.DB.prepare("INSERT OR IGNORE INTO memberships (room, username, joined_at) SELECT 'geek', username, ? FROM accounts").bind(now),
      env.DB.prepare("INSERT OR IGNORE INTO memberships (room, username, joined_at) VALUES ('geek', ?, ?)").bind(username, now),
      env.DB.prepare("UPDATE messages SET room = 'geek' WHERE room = 'main'")
    ]);
  } catch {}
  if (ra && ra !== username) {
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO rooms (id, name, type, creator, created_at, class) VALUES (?, ?, 'dm', ?, ?, 'B')").bind(dmId, username, username, now),
        env.DB.prepare("INSERT OR IGNORE INTO memberships (room, username, joined_at) VALUES (?, ?, ?)").bind(dmId, username, now),
        env.DB.prepare("INSERT OR IGNORE INTO memberships (room, username, joined_at) VALUES (?, ?, ?)").bind(dmId, ra, now)
      ]);
    } catch {}
  }
}

async function isMember(db: D1Database, room: string, username: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 FROM memberships WHERE room = ? AND username = ?").bind(room, username).first();
  return !!row;
}

// 取当前唯一 Root-Admin（用于 B 类私聊自动建立）
async function getRootAdmin(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT username FROM accounts WHERE role = 'root-admin' LIMIT 1").first<{ username: string }>();
  return row ? row.username : null;
}

// 某账号当前参与的 A 类群聊数量（创建 + 加入合计）
async function countAClass(env: Env, username: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM memberships m JOIN rooms r ON r.id = m.room " +
    "WHERE m.username = ? AND COALESCE(r.class, 'A') = 'A'"
  ).bind(username).first<{ n: number }>();
  return row ? row.n : 0;
}

const A_CLASS_LIMIT = 10; // 每个账号 A 类群聊（创建+加入）上限，Root-Admin 也限

async function listRoomsFor(env: Env, username: string): Promise<{ id: string; name: string; type: string; creator: string; members: number; class: string }[]> {
  const { results } = await env.DB.prepare(
    "SELECT r.id, r.name, r.type, r.creator, r.class, (SELECT COUNT(*) FROM memberships m2 WHERE m2.room = r.id) AS members " +
    "FROM rooms r WHERE r.id IN (SELECT room FROM memberships WHERE username = ?) " +
    "ORDER BY CASE r.type WHEN 'builtin' THEN 0 WHEN 'file' THEN 1 ELSE 2 END, r.created_at"
  ).bind(username).all<{ id: string; name: string; type: string; creator: string; members: number; class: string }>();
  const list = results || [];
  // B 类私聊：房主视角显示「Root-Admin」，Root-Admin 视角显示对方用户名
  return list.map((r) => {
    if (r.class === "B") {
      return { ...r, name: r.creator === username ? "Root-Admin" : r.creator };
    }
    return r;
  });
}

async function handleRoomsList(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  await ensureBuiltinRooms(env);
  await ensureBuiltins(env, user.username);
  const rooms = await listRoomsFor(env, user.username);
  return json({ rooms });
}

async function handleRoomCreate(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  if (user.role === "observer") return json({ error: "观测者不能建群" }, 403);
  let body: { name?: string; members?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const name = (body.name || "").trim();
  if (!name || name.length > 24) return json({ error: "群名限 1-24 字" }, 400);
  const wanted = Array.isArray(body.members) ? body.members.map(String).filter(Boolean) : [];
  let chosen: string[] = [];
  if (wanted.length) {
    const placeholders = wanted.map(() => "?").join(",");
    const { results } = await env.DB.prepare("SELECT username FROM accounts WHERE username IN (" + placeholders + ")")
      .bind(...wanted).all<{ username: string }>();
    chosen = (results || []).map((r) => r.username);
  }
  const id = "g" + genRoomId();
  const now = new Date().toISOString();
  // A 类群聊上限：创建者自己 + 每位被邀请者，加入后 A 类总数不得超过 A_CLASS_LIMIT（Root-Admin 也限）
  const creatorA = await countAClass(env, user.username);
  if (creatorA + 1 > A_CLASS_LIMIT) {
    return json({ error: "你已达到 A 类群聊上限（" + A_CLASS_LIMIT + " 个），无法再创建" }, 409);
  }
  for (const m of chosen) {
    const a = await countAClass(env, m);
    if (a + 1 > A_CLASS_LIMIT) {
      return json({ error: "「" + m + "」已达到 A 类群聊上限（" + A_CLASS_LIMIT + " 个），无法邀请其加入" }, 409);
    }
  }
  const inserts = [
    env.DB.prepare("INSERT INTO rooms (id, name, type, creator, created_at, class) VALUES (?, ?, 'group', ?, ?, 'A')").bind(id, name, user.username, now),
    env.DB.prepare("INSERT OR IGNORE INTO memberships (room, username, joined_at) VALUES (?, ?, ?)").bind(id, user.username, now)
  ];
  chosen.forEach((m) => inserts.push(
    env.DB.prepare("INSERT OR IGNORE INTO memberships (room, username, joined_at) VALUES (?, ?, ?)").bind(id, m, now)
  ));
  await env.DB.batch(inserts);
  await writeAdminLog(env, user.username, "create_room", "创建群聊 " + name + "（" + (chosen.length + 1) + " 人）");
  await notifyRoom(env, { type: "room-added" });
  return json({ ok: true, room: { id, name, type: "group", creator: user.username } });
}

async function handleRoomHistory(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const id = (new URL(request.url).searchParams.get("id") || "").trim();
  if (!id) return json({ error: "缺少房间" }, 400);
  if (!(await isMember(env.DB, id, user.username))) return json({ error: "你不是该房间成员" }, 403);
  // 按房间 class 用对应保留期：C 类 21 天 / B 类 7 天 / A 类 5 天
  const cut = await roomRetentionCutoff(env, id);
  const { results } = await env.DB.prepare(
    "SELECT sender, role, text, ts FROM messages WHERE room = ? AND ts >= ? ORDER BY id DESC LIMIT 200"
  ).bind(id, cut).all<{ sender: string; role: string; text: string; ts: string }>();
  return json({ messages: (results || []).reverse() });
}

async function handleAccountsList(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const { results } = await env.DB.prepare(
    "SELECT username, role FROM accounts ORDER BY created_at"
  ).all<{ username: string; role: string }>();
  return json({ accounts: results || [] });
}

async function logCredits(env: Env, username: string, delta: number, reason: string): Promise<void> {
  try {
    await env.DB.prepare("INSERT INTO credits_logs (username, delta, reason, created_at) VALUES (?, ?, ?, ?)")
      .bind(username, delta, reason, new Date().toISOString()).run();
  } catch {}
}

const DAILY_SALARY = 50;
const MAX_ADMINS = 5;

function beijingDate(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

async function ensureDailySalary(env: Env, user: { username: string; role: string }): Promise<number> {
  if (user.role !== "admin") return 0;
  const row = await env.DB.prepare("SELECT last_daily_at FROM accounts WHERE username = ?").bind(user.username).first<{ last_daily_at: string | null }>();
  const today = beijingDate();
  if (row && row.last_daily_at === today) return 0;
  await env.DB.prepare("UPDATE accounts SET points = points + ?, last_daily_at = ? WHERE username = ?")
    .bind(DAILY_SALARY, today, user.username).run();
  await writeAdminLog(env, user.username, "daily_salary", "每日工资 +" + DAILY_SALARY + " Credits");
  await logCredits(env, user.username, DAILY_SALARY, "每日工资");
  return DAILY_SALARY;
}

async function hasActiveApiKey(env: Env, username: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT apikey FROM accounts WHERE username = ?").bind(username).first<{ apikey: string | null }>();
  if (!row || !row.apikey) return false;
  const k = await env.DB.prepare("SELECT revoked FROM api_keys WHERE key = ?").bind(row.apikey).first<{ revoked: number }>();
  return !!(k && !k.revoked);
}

async function verifyAccountPassword(env: Env, username: string, password: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT pass_hash, salt FROM accounts WHERE username = ?")
    .bind(username).first<{ pass_hash: string; salt: string }>();
  if (!row || !row.salt) return false;
  const parts = row.salt.match(/.{2}/g);
  if (!parts) return false;
  const saltBytes = Uint8Array.from(parts.map((h) => parseInt(h, 16)));
  const hash = await hashPassword(password, saltBytes.buffer as ArrayBuffer);
  return hash === row.pass_hash;
}

async function createAccount(env: Env, username: string, password: string, role: string): Promise<void> {
  const salt = randomSalt();
  const passHash = await hashPassword(password, salt.buffer as ArrayBuffer);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO accounts (username, pass_hash, salt, role, points, created_at) VALUES (?, ?, ?, ?, 0, ?)"
  ).bind(username, passHash, toHex(salt.buffer as ArrayBuffer), role, now).run();
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  let body: { username?: string; password?: string; belongs_to?: string; identity?: string; account_code?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  await ensureSchema(env);
  await ensureBuiltinAccounts(env);

  const code = (body.account_code || "").trim();
  if (code) {
    // ===== 新流程：凭据验证通过后，用户自设用户名/密码，这才算真正建号 =====
    const belongsTo = (body.belongs_to || "").trim();
    const identity = (body.identity || "").trim().toLowerCase();
    if (!belongsTo || !identity) return json({ error: "缺少 belongs_to / identity" }, 400);
    const inv = await env.DB.prepare("SELECT * FROM account_invites WHERE code = ?").bind(code).first<any>();
    if (!inv) return json({ error: "account_code 无效" }, 404);
    if (inv.used) return json({ error: "该 account_code 已被使用" }, 409);
    if (inv.belongs_to !== belongsTo) return json({ error: "belongs_to 与该凭据不匹配" }, 403);
    if (inv.identity !== identity) return json({ error: "identity 与该凭据不匹配" }, 403);
    if (ADMIN_NAMES.indexOf(inv.belongs_to) === -1) return json({ error: "凭据归属无效" }, 400);
    if (INVITE_IDENTITIES.indexOf(inv.identity) === -1) return json({ error: "凭据身份无效" }, 400);
    const username = (body.username || "").trim();
    const password = body.password || "";
    const invalid = validateCredentials(username, password);
    if (invalid) return json({ error: invalid }, 400);
    const exists = await env.DB.prepare("SELECT username FROM accounts WHERE username = ?").bind(username).first();
    if (exists) return json({ error: "用户名已被占用" }, 409);
    // 条件更新先占坑，防止同一凭据并发激活两次
    const now = new Date().toISOString();
    const upd = await env.DB.prepare("UPDATE account_invites SET used = 1, used_by = ?, used_at = ? WHERE code = ? AND used = 0")
      .bind(username, now, code).run();
    const changed = (upd as any).meta && (upd as any).meta.changes;
    if (changed === 0) return json({ error: "该 account_code 刚被使用" }, 409);
    try {
      await createAccount(env, username, password, inv.identity);
      await env.DB.prepare("UPDATE accounts SET belongs_to = ? WHERE username = ?").bind(inv.belongs_to, username).run();
    } catch (e) {
      await env.DB.prepare("UPDATE account_invites SET used = 0, used_by = NULL, used_at = NULL WHERE code = ?").bind(code).run();
      return json({ error: "创建账号失败，请重试" }, 409);
    }
    // 凭据使用后删除记录，仅在日志留痕
    await env.DB.prepare("DELETE FROM account_invites WHERE code = ?").bind(code).run();
    await ensureBuiltinRooms(env, true);   // 新用户自动加入归属管理员的 C 类小群
    await ensureBuiltins(env, username);
    const token = await issueSession(env, username);
    await writeAdminLog(env, inv.belongs_to, "activate_account", username + " 通过凭据注册（" + inv.identity + "，归属 " + inv.belongs_to + "）");
    return json({ token, username, role: inv.identity, belongsTo: inv.belongs_to });
  }

  // ===== 旧通道：管理员手动建号（保留兼容）=====
  const username = (body.username || "").trim();
  const password = body.password || "";
  const invalid = validateCredentials(username, password);
  if (invalid) return json({ error: invalid }, 400);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first<{ n: number }>();
  const isBootstrap = count && count.n === 0;
  if (!isBootstrap) {
    const user = await authUser(request, env);
    if (!user || (user.role !== "admin" && user.role !== "root-admin")) {
      return json({ error: "公开注册已关闭，请在注册页用 belongs_to / identity / account_code 激活" }, 403);
    }
  }
  const exists = await env.DB.prepare("SELECT username FROM accounts WHERE username = ?").bind(username).first();
  if (exists) return json({ error: "用户名已被占用" }, 409);
  const role = isBootstrap ? "root-admin" : "member";
  await createAccount(env, username, password, role);
  await ensureBuiltins(env, username);
  const token = await issueSession(env, username);
  return json({ token, username, role });
}

// 注册页第一步：只校验三项凭据，不创建账号、不发放任何会话
async function handleRegisterVerify(request: Request, env: Env): Promise<Response> {
  let body: { belongs_to?: string; identity?: string; account_code?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  await ensureSchema(env);
  await ensureBuiltinAccounts(env);
  const code = (body.account_code || "").trim();
  const belongsTo = (body.belongs_to || "").trim();
  const identity = (body.identity || "").trim().toLowerCase();
  if (!code || !belongsTo || !identity) return json({ error: "belongs_to / identity / account_code 三项都要填" }, 400);
  const inv = await env.DB.prepare("SELECT * FROM account_invites WHERE code = ?").bind(code).first<any>();
  if (!inv) return json({ error: "account_code 无效" }, 404);
  if (inv.used) return json({ error: "该凭据已被使用" }, 409);
  if (inv.belongs_to !== belongsTo || inv.identity !== identity) {
    return json({ error: "belongs_to / identity / account_code 三项不匹配" }, 403);
  }
  return json({ ok: true, belongsTo: inv.belongs_to, identity: inv.identity });
}

// RA：发放邀请凭据，只落一条待激活记录，绝不创建账号
async function handleAdminCreateInvite(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user || user.role !== "root-admin") return json({ error: "仅 Root-Admin 可发放凭据" }, 403);
  let body: { belongs_to?: string; identity?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  await ensureSchema(env);
  const belongsTo = (body.belongs_to || "").trim();
  const identity = (body.identity || "").trim().toLowerCase();
  if (ADMIN_NAMES.indexOf(belongsTo) === -1) return json({ error: "belongs_to 必须是五位管理员之一" }, 400);
  if (INVITE_IDENTITIES.indexOf(identity) === -1) return json({ error: "identity 只能是 observer 或 member" }, 400);
  // 16 字节随机 → 32 位十六进制字符串
  const code = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer);
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO account_invites (code, belongs_to, identity, revealed, used, created_at) VALUES (?, ?, ?, 0, 0, ?)")
    .bind(code, belongsTo, identity, now).run();
  await writeAdminLog(env, user.username, "create_invite", "发放凭据：归属 " + belongsTo + "，身份 " + identity);
  // 完整信息只在这一次响应里返回
  return json({ ok: true, belongs_to: belongsTo, identity: identity, account_code: code, createdAt: now });
}

// RA 点「我记完了」：之后任何接口都不再完整显示该凭据
async function handleAdminInviteSeen(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user || user.role !== "root-admin") return json({ error: "无权操作" }, 403);
  let body: { code?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const code = (body.code || "").trim();
  if (!code) return json({ error: "缺少凭据" }, 400);
  await ensureSchema(env);
  await env.DB.prepare("UPDATE account_invites SET revealed = 1 WHERE code = ?").bind(code).run();
  return json({ ok: true });
}

// 凭据列表永远脱敏（前 4 后 4），服务端不再下发完整 code
async function handleAdminInvites(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user || user.role !== "root-admin") return json({ error: "无权查看" }, 403);
  await ensureSchema(env);
  const { results } = await env.DB.prepare(
    "SELECT code, belongs_to, identity, revealed, used, used_by, created_at, used_at FROM account_invites WHERE used = 0 ORDER BY created_at DESC LIMIT 100"
  ).all<any>();
  const invites = (results || []).map((r) => ({
    codeMask: String(r.code).slice(0, 4) + "********" + String(r.code).slice(-4),
    belongsTo: r.belongs_to, identity: r.identity,
    revealed: !!r.revealed, used: !!r.used, usedBy: r.used_by,
    createdAt: r.created_at, usedAt: r.used_at
  }));
  return json({ invites: invites });
}

async function handleAdminCreate(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user || user.role !== "root-admin") {
    return json({ error: "账号仅可由 Root-Admin 创建" }, 403);
  }
  let body: { username?: string; password?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const username = (body.username || "").trim();
  const password = body.password || "";
  const invalid = validateCredentials(username, password);
  if (invalid) return json({ error: invalid }, 400);
  const role = body.role || "member";
  if (!VALID_ROLES.includes(role)) {
    return json({ error: "身份限：Observer/User/Admin" }, 400);
  }
  if (role === "admin") return json({ error: "管理员账号不可额外创建" }, 403);
  const exists = await env.DB.prepare("SELECT username FROM accounts WHERE username = ?").bind(username).first();
  if (exists) {
    return json({ error: "用户名已被占用" }, 409);
  }
  await createAccount(env, username, password, role);
  await writeAdminLog(env, user.username, "create_account", "创建账号 " + username + "（" + role + "）");
  return json({ ok: true, username, role });
}

// ===== 注销成员（仅 Root-Admin，需 RA 密码验证）=====
async function handleDeactivate(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  if (user.role !== "root-admin") {
    return json({ error: "注销成员仅可由 Root-Admin 操作" }, 403);
  }
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const target = (body.username || "").trim();
  const password = body.password || "";
  if (!target) return json({ error: "缺少目标成员" }, 400);
  if (!password) return json({ error: "请输入 Root-Admin 密码验证身份" }, 400);
  // 验证操作者自己的密码
  const self = await env.DB.prepare("SELECT pass_hash, salt FROM accounts WHERE username = ?")
    .bind(user.username).first<{ pass_hash: string; salt: string }>();
  if (!self) return json({ error: "账号不存在" }, 404);
  const saltBytes = Uint8Array.from(self.salt.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const hash = await hashPassword(password, saltBytes.buffer as ArrayBuffer);
  if (hash !== self.pass_hash) return json({ error: "Root-Admin 密码验证失败" }, 401);
  if (target === user.username) return json({ error: "不能注销自己" }, 400);
  const row = await env.DB.prepare("SELECT role FROM accounts WHERE username = ?").bind(target).first<{ role: string }>();
  if (!row) return json({ error: "成员 " + target + " 不存在" }, 404);
  if (row.role === "root-admin") return json({ error: "Root-Admin 账号不可注销" }, 403);
  if (BUILTIN_USERNAMES.indexOf(target) !== -1) return json({ error: "内置账号（Root-Admin 与五位管理员）不可注销" }, 403);
  await ensureBuiltins(env, user.username);
  // 注销时级联删除该成员「与 Root-Admin 的 B 类私聊」（dm:<user>）：房间、成员、消息、禁言、文件一律清空
  const dmRoom = "dm:" + target;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE username = ?").bind(target),
    env.DB.prepare("DELETE FROM memberships WHERE username = ?").bind(target),
    env.DB.prepare("DELETE FROM accounts WHERE username = ?").bind(target),
    env.DB.prepare("DELETE FROM chat_file_chunks WHERE file_id IN (SELECT id FROM chat_files WHERE room = ?)").bind(dmRoom),
    env.DB.prepare("DELETE FROM chat_files WHERE room = ?").bind(dmRoom),
    env.DB.prepare("DELETE FROM messages WHERE room = ?").bind(dmRoom),
    env.DB.prepare("DELETE FROM room_mutes WHERE room = ?").bind(dmRoom),
    env.DB.prepare("DELETE FROM memberships WHERE room = ?").bind(dmRoom),
    env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(dmRoom)
  ]);
  await writeAdminLog(env, user.username, "deactivate", "注销成员 " + target);
  await notifyRoom(env, { type: "sys", text: "成员 " + target + " 已被 Root-Admin 注销" });
  return json({ ok: true, username: target });
}

// ===== 基础表自愈：首次请求时若表缺失则自动建表（防止本地 D1 状态被清后 500）=====
// 时刻保证内置账号存在：60 秒节流 + 一条 COUNT 批量检查，常态每 60 秒最多 1 次读。
// 只有发现缺失才写（INSERT OR IGNORE，已存在的账号一律不动，绝不覆盖用户改过的密码）。
let lastBuiltinEnsureAt = 0;
async function ensureBuiltinAccounts(env: Env): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - lastBuiltinEnsureAt < 60 * 1000) return;
  lastBuiltinEnsureAt = nowMs;
  try {
    // 全新库可能连 accounts 表都还没有 —— 先补上，否则下面的 COUNT 抛
    // "no such table"，被 catch 吞掉后节流又锁 60 秒，自愈会永久失效。
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS accounts (
      username TEXT PRIMARY KEY,
      pass_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      points INTEGER NOT NULL DEFAULT 0,
      last_daily_at TEXT,
      apikey TEXT,
      belongs_to TEXT,
      created_at TEXT NOT NULL
    )`).run();
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM accounts WHERE username IN ('deportee','change-spec','git-k','kenkin','big-energy','teacher-student')"
    ).first<{ n: number }>();
    if (row && row.n >= BUILTIN_ACCOUNTS.length) return;
    const now = new Date().toISOString();
    const stmts = BUILTIN_ACCOUNTS.map((a) =>
      env.DB.prepare("INSERT OR IGNORE INTO accounts (username, pass_hash, salt, role, points, created_at) VALUES (?, ?, ?, ?, 0, ?)")
        .bind(a.username, a.passHash, a.salt, a.role, now)
    );
    await env.DB.batch(stmts);
  } catch (e) {
    lastBuiltinEnsureAt = 0; // 失败时允许下一次立即重试，别被节流锁死
    console.error("内置账号自愈失败：", e);
  }
}

async function ensureSchema(env: Env): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS accounts (
        username TEXT PRIMARY KEY,
        pass_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        points INTEGER NOT NULL DEFAULT 0,
        last_daily_at TEXT,
        apikey TEXT,
        belongs_to TEXT,
        created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS otps (
        code TEXT PRIMARY KEY,
        amount INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        used_by TEXT,
        used_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room TEXT NOT NULL,
        sender TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        text TEXT NOT NULL,
        ts TEXT NOT NULL
      )`),
      // 文件资源商店：任何人可上架文件并自由标价，买家付款后卖家收（扣 5% 手续费）
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_items (
        id TEXT PRIMARY KEY,
        seller TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        mime TEXT,
        desc TEXT,
        price INTEGER NOT NULL,
        storage TEXT,
        sold INTEGER NOT NULL DEFAULT 0,
        buyer TEXT,
        sold_at TEXT,
        created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_files (
        file_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (file_id, seq)
      )`),
      // 商店成交记录：商品本身成交即删除，这里留档供买卖双方查询历史
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_orders (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        seller TEXT NOT NULL,
        buyer TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        mime TEXT,
        price INTEGER NOT NULL,
        fee INTEGER NOT NULL,
        payout INTEGER NOT NULL,
        delivered_id TEXT,
        deliver TEXT,
        created_at TEXT NOT NULL
      )`),
      // 云空间试用（独立于主空间，不动 cloud_files）
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS cloud_trials (
        username TEXT PRIMARY KEY,
        total_mb INTEGER NOT NULL DEFAULT 5,
        used_mb REAL NOT NULL DEFAULT 0,
        starts_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        reclaim_pending INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS cloud_trial_files (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        mime TEXT,
        data TEXT NOT NULL,
        storage TEXT,
        created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS cloud_trial_chunks (
        file_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (file_id, seq)
      )`),
      // 找回代码：派发后仅显示一次，使用后删除本行，只在 admin_logs 留痕
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS recover_codes (
        code TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        issued_by TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`),
      // 账号邀请凭据：RA 只发放凭据，注册页验证后由用户自设用户名密码才算真正建号
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS account_invites (
        code TEXT PRIMARY KEY,
        belongs_to TEXT NOT NULL,
        identity TEXT NOT NULL,
        revealed INTEGER NOT NULL DEFAULT 0,
        used INTEGER NOT NULL DEFAULT 0,
        used_by TEXT,
        created_at TEXT NOT NULL,
        used_at TEXT
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        creator TEXT NOT NULL,
        opponent TEXT,
        status TEXT NOT NULL DEFAULT 'waiting',
        payer TEXT,
        board TEXT,
        turn TEXT,
        winner TEXT,
        result TEXT,
        round_fee_paid INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`),
      // 房间座位表：支持「一个房间多个玩家、空位可随时补人 / 换对手」
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_seats (
        room_id TEXT NOT NULL,
        username TEXT NOT NULL,
        seat INTEGER NOT NULL DEFAULT 0,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (room_id, username)
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        from_user TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'pay_for_me',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS api_keys (
        key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        name TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS credits_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS cloud_subs (
        username TEXT PRIMARY KEY,
        total_mb INTEGER NOT NULL DEFAULT 0,
        used_mb REAL NOT NULL DEFAULT 0,
        expires_at TEXT,
        auto_renew INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL DEFAULT 'paid',
        created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS cloud_files (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        mime TEXT,
        data TEXT NOT NULL,
        storage TEXT NOT NULL DEFAULT 'd1',
        created_at TEXT NOT NULL
      )`),
      // 云文件分块存储：单文件可能很大，避免整段塞进单个单元格超出 D1 上限；下载时按 seq 拼回
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS cloud_file_chunks (
        file_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (file_id, seq)
      )`),
      // 聊天文件落地存储：作为聊天记录的一部分，统一保留 7 天（与 messages 同步清理）
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_files (
        id TEXT PRIMARY KEY,
        room TEXT NOT NULL,
        sender TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        mime TEXT,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`),
      // 分块暂存：每收到一块二进制立即落库（按 file_id+seq），避免内存缓冲在帧乱序/DO 重置时丢失
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_file_chunks (
        file_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (file_id, seq)
      )`),
      // 上传会话元数据：file-start 时写入，作为二进制分片不携带元信息、仅靠内存 fileBuf 归属的兜底。
      // DO 实例在分片之间被回收时内存 fileBuf 会丢失，file-end/分片处理按 file_id 从此表还原归属。
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_uploads (
        file_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        mime TEXT,
        room TEXT NOT NULL,
        sender TEXT NOT NULL,
        role TEXT,
        seq INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`)
    ]);
    // 旧库补列：单独执行，避免 ALTER 失败导致整个 batch 回滚（导致表建不出来）
    // storage（supabase = 二进制在 Supabase Storage；d1 = 在 cloud_file_chunks 分片里）
    try { await env.DB.prepare("ALTER TABLE cloud_files ADD COLUMN storage TEXT").run(); } catch {}
    try { await env.DB.prepare("UPDATE cloud_files SET storage = 'd1' WHERE storage IS NULL").run(); } catch {}
    // otps.expires_at：兑换码有效期。旧库建表时没有这列，
    // 而 handleCreateOtp 要写入它 → Workers 抛未捕获异常 → 接口返回 "error code: 1101"。
    try { await env.DB.prepare("ALTER TABLE otps ADD COLUMN expires_at TEXT").run(); } catch {}
    // market_orders.deliver：成交后买家的接收方式（cloud / download），旧库补列
    try { await env.DB.prepare("ALTER TABLE market_orders ADD COLUMN deliver TEXT").run(); } catch {}
    // cloud_subs.reclaim_pending：到期未续费、等待把文件下载到本机后收回空间
    try { await env.DB.prepare("ALTER TABLE cloud_subs ADD COLUMN reclaim_pending INTEGER NOT NULL DEFAULT 0").run(); } catch {}
    // accounts.belongs_to：新用户归属的管理员（用于管理员小群与「成员信息」页）
    try { await env.DB.prepare("ALTER TABLE accounts ADD COLUMN belongs_to TEXT").run(); } catch {}
    // market_items.kind：file=普通文件；zip=整个文件夹打包成的 ZIP（上架时由浏览器压缩）
    try { await env.DB.prepare("ALTER TABLE market_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'file'").run(); } catch {}
    // market_items.copies_total / copies_sold：同一文件可上架多份（1~500），每卖出一份平台收一次手续费
    try { await env.DB.prepare("ALTER TABLE market_items ADD COLUMN copies_total INTEGER NOT NULL DEFAULT 1").run(); } catch {}
    try { await env.DB.prepare("ALTER TABLE market_items ADD COLUMN copies_sold INTEGER NOT NULL DEFAULT 0").run(); } catch {}
    // market_orders.done：下载交付的买家确认落盘后置 1，用于多份售卖时统一清理后端文件
    try { await env.DB.prepare("ALTER TABLE market_orders ADD COLUMN done INTEGER NOT NULL DEFAULT 0").run(); } catch {}
  } catch {}
}

// 轻量补列：只补 otps 表缺的 expires_at 列。
// 兑换码相关接口（生成/列表/兑换/撤销）在调用前先跑这个，
// 避免旧库缺列时 SELECT/INSERT 直接抛未捕获异常（Workers 返回 "error code: 1101"）。
async function ensureOtpColumns(env: Env): Promise<void> {
  try { await env.DB.prepare("ALTER TABLE otps ADD COLUMN expires_at TEXT").run(); } catch {}
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const username = (body.username || "").trim();
  const password = body.password || "";
  await ensureSchema(env);
  await ensureBuiltinAccounts(env);
  const row = await env.DB.prepare("SELECT pass_hash, salt, role FROM accounts WHERE username = ?")
    .bind(username).first<{ pass_hash: string; salt: string; role: string }>();
  if (!row) {
    return json({ error: "用户名或密码错误" }, 401);
  }
  const saltBytes = Uint8Array.from(row.salt.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const hash = await hashPassword(password, saltBytes.buffer as ArrayBuffer);
  if (hash !== row.pass_hash) {
    return json({ error: "用户名或密码错误" }, 401);
  }
  const token = await issueSession(env, username);
  await ensureBuiltins(env, username);
  if (row.role === "admin" || row.role === "root-admin") {
    await writeAdminLog(env, username, "login", "登录系统");
  }
  return json({ token, username, role: row.role });
}

async function handlePasswordChange(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { oldPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const oldP = body.oldPassword || "";
  const newP = body.newPassword || "";
  if (!oldP) return json({ error: "请输入旧密码" }, 400);
  if (newP.length < 6) return json({ error: "新密码至少 6 位" }, 400);
  if (newP.length > 64) return json({ error: "新密码过长（最多 64 位）" }, 400);
  await ensureSchema(env);
  const row = await env.DB.prepare("SELECT pass_hash, salt FROM accounts WHERE username = ?")
    .bind(user.username).first<{ pass_hash: string; salt: string }>();
  if (!row) return json({ error: "账号不存在" }, 404);
  const saltBytes = Uint8Array.from(row.salt.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const oldHash = await hashPassword(oldP, saltBytes.buffer as ArrayBuffer);
  if (oldHash !== row.pass_hash) return json({ error: "旧密码错误" }, 401);
  const salt = randomSalt();
  const newHash = await hashPassword(newP, salt.buffer as ArrayBuffer);
  await env.DB.prepare("UPDATE accounts SET pass_hash = ?, salt = ? WHERE username = ?")
    .bind(newHash, toHex(salt.buffer as ArrayBuffer), user.username).run();
  return json({ ok: true });
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  await ensureBuiltinAccounts(env);
  await ensureBuiltinRooms(env);
  const salary = await ensureDailySalary(env, user);
  // 分级保留期清理：C 类 21 天 / B 类 7 天 / A 类 5 天
  // /api/me 是前端登录后必调的接口，用作主动清理触发点（不活跃房间的过期消息也能被清）
  void purgeOldMessages(env);
  const row = await env.DB.prepare("SELECT points FROM accounts WHERE username = ?").bind(user.username).first<{ points: number }>();
  return json({ username: user.username, role: user.role, points: row ? row.points : 0, salary: salary });
}

// 聊天历史：必须登录（历史上未鉴权，任何人都能读取全部聊天记录）
async function handleHistory(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const { results } = await env.DB.prepare(
    "SELECT sender, role, text, ts FROM messages WHERE room = ? ORDER BY id DESC LIMIT 100"
  ).bind("main").all<{ sender: string; role: string; text: string; ts: string }>();
  return json({ messages: (results || []).reverse() });
}

// 管理后台账号列表：仅 Root-Admin 可访问
// （历史上此接口未鉴权，导致任何人都能拉取全部账号的用户名/角色/积分/注册时间）
async function handleAccounts(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  if (user.role !== "root-admin") return json({ error: "仅 Root-Admin 可查看账号列表" }, 403);
  const { results } = await env.DB.prepare(
    "SELECT username, role, points, created_at FROM accounts ORDER BY created_at"
  ).all<{ username: string; role: string; points: number; created_at: string }>();
  return json({ accounts: results || [] });
}

async function handleCreateOtp(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user || user.role !== "root-admin") {
    return json({ error: "兑换码仅可由 Root-Admin 生成" }, 403);
  }
  // 自愈：确保 otps.expires_at 列存在（老库缺列会让 INSERT 抛未捕获异常 → error code 1101）
  await ensureOtpColumns(env);
  let body: { amount?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const amount = Math.floor(Number(body.amount));
  if (!isFinite(amount) || amount < 1 || amount > 100000) {
    return json({ error: "Credits 数量限 1-100000" }, 400);
  }
  const code = newOtpCode();
  const now = new Date().toISOString();
  const days = Math.floor(Number((body as { days?: number }).days));
  if (!isFinite(days) || days < 1 || days > 14) {
    return json({ error: "有效期限限 1-14 天" }, 400);
  }
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO otps (code, amount, created_by, used_by, used_at, expires_at, created_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)"
    ).bind(code, amount, user.username, expiresAt, now).run();
  } catch (e) {
    // 旧库可能缺列（例如 otps.expires_at），补一次列再重试
    try { await env.DB.prepare("ALTER TABLE otps ADD COLUMN expires_at TEXT").run(); } catch {}
    try {
      await env.DB.prepare(
        "INSERT INTO otps (code, amount, created_by, used_by, used_at, expires_at, created_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)"
      ).bind(code, amount, user.username, expiresAt, now).run();
    } catch (e2) {
      return json({ error: "生成失败：数据库写入异常（" + String(e2).slice(0, 120) + "）" }, 500);
    }
  }
  await writeAdminLog(env, user.username, "create_otp", "生成 " + amount + " Credits 兑换码 " + code.slice(0, 4) + "****（" + days + " 天有效）");
  return json({ ok: true, code, amount, days });
}

// 兑换码列表：仅 Root-Admin 可访问，且不下发完整兑换码明文
// （历史上此接口未鉴权且返回 fullCode，任何人都能拿到未使用的兑换码直接兑换 Credits）
async function handleListOtps(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  if (user.role !== "root-admin") return json({ error: "仅 Root-Admin 可查看兑换码" }, 403);
  await ensureOtpColumns(env);
  const { results } = await env.DB.prepare(
    "SELECT code, amount, created_by, expires_at, created_at FROM otps WHERE used_by IS NULL ORDER BY created_at DESC LIMIT 50"
  ).all<{ code: string; amount: number; created_by: string; expires_at: string | null; created_at: string }>();
  const now = Date.now();
  const masked = (results || []).map((r) => ({
    code: r.code.slice(0, 4) + "••••••••••••••••••••••••" + r.code.slice(-4),
    amount: r.amount,
    created_by: r.created_by,
    expired: !!r.expires_at && new Date(r.expires_at).getTime() < now,
    created_at: r.created_at
  }));
  return json({ otps: masked });
}

async function handleRevokeOtp(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user || user.role !== "root-admin") {
    return json({ error: "撤销仅可由 Root-Admin 操作" }, 403);
  }
  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  await ensureOtpColumns(env);
  const raw = (body.code || "").trim();
  if (!raw) return json({ error: "缺少兑换码" }, 400);

  // 支持两种形式：
  // 1) 完整兑换码（兼容旧调用）
  // 2) 掩码形式（前 4 位 + 掩码串 + 后 4 位）—— 服务端反查匹配项，
  //    前端因此永远拿不到兑换码明文（避免管理端把明文暴露在浏览器里）
  let code = raw;
  if (raw.indexOf("•") >= 0) {
    const { results } = await env.DB.prepare("SELECT code FROM otps WHERE used_by IS NULL").all<{ code: string }>();
    const maskOf = (c: string) => c.slice(0, 4) + "••••••••••••••••••••••••" + c.slice(-4);
    const hit = (results || []).find((r) => maskOf(r.code) === raw);
    if (!hit) return json({ error: "兑换码不存在或已失效" }, 404);
    code = hit.code;
  }

  const row = await env.DB.prepare("SELECT used_by FROM otps WHERE code = ?").bind(code).first<{ used_by: string | null }>();
  if (!row) return json({ error: "兑换码不存在" }, 404);
  if (row.used_by) return json({ error: "已使用的兑换码不可撤销" }, 409);
  await env.DB.prepare("DELETE FROM otps WHERE code = ?").bind(code).run();
  await writeAdminLog(env, user.username, "revoke_otp", "撤销兑换码 " + code.slice(0, 4) + "****");
  return json({ ok: true });
}

async function redeemOtp(env: Env, username: string, code: string): Promise<Response> {
  const trimmed = (code || "").trim();
  if (!trimmed) return json({ error: "兑换码不能为空" }, 400);
  await ensureOtpColumns(env);
  const row = await env.DB.prepare("SELECT amount, used_by, expires_at FROM otps WHERE code = ?").bind(trimmed).first<{ amount: number; used_by: string | null; expires_at: string | null }>();
  if (!row) return json({ error: "兑换码不存在" }, 404);
  if (row.used_by) return json({ error: "该兑换码已被使用" }, 409);
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return json({ error: "兑换码已过期" }, 410);
  }
  const now = new Date().toISOString();
  const batch = await env.DB.batch([
    env.DB.prepare("UPDATE otps SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL")
      .bind(username, now, trimmed),
    env.DB.prepare("UPDATE accounts SET points = points + ? WHERE username = ?")
      .bind(row.amount, username)
  ]);
  if (batch[0].meta.rows_written === 0) {
    return json({ error: "该兑换码已被使用" }, 409);
  }
  await logCredits(env, username, row.amount, "OTP 兑换");
  const acc = await env.DB.prepare("SELECT points FROM accounts WHERE username = ?").bind(username).first<{ points: number }>();
  return json({ ok: true, amount: row.amount, points: acc ? acc.points : 0 });
}

async function handleRedeemOtp(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  return redeemOtp(env, user.username, body.code || "");
}

function newApiKey(): string {
  return "ak-" + toHex(crypto.getRandomValues(new Uint8Array(24)).buffer as ArrayBuffer);
}

async function handleApiKeyBind(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { key?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const key = (body.key || "").trim();
  const row = await env.DB.prepare("SELECT key, owner, name, revoked FROM api_keys WHERE key = ?").bind(key).first<{ owner: string; name: string | null; revoked: number }>();
  if (!row || row.revoked) return json({ error: "API Key 无效或已被删除" }, 404);
  await env.DB.prepare("UPDATE accounts SET apikey = ? WHERE username = ?").bind(key, user.username).run();
  return json({ ok: true, name: row.name || "未命名", owner: row.owner });
}

async function handleApiKeyUnbind(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  await env.DB.prepare("UPDATE accounts SET apikey = NULL WHERE username = ?").bind(user.username).run();
  return json({ ok: true });
}

async function handleApiKeyStatus(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const active = await hasActiveApiKey(env, user.username);
  const row = await env.DB.prepare("SELECT apikey FROM accounts WHERE username = ?").bind(user.username).first<{ apikey: string | null }>();
  return json({ active: active, bound: !!row && !!row.apikey });
}

// ===== API Key 管理（原命令行功能迁入系统控制面板）=====
async function handleApiKeyCreate(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user || user.role !== "root-admin") return json({ error: "仅 Root-Admin 可创建 API Key" }, 403);
  let body: { owner?: string; name?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const owner = (body.owner || "").trim();
  const name = (body.name || "").trim() || "未命名";
  if (!owner) return json({ error: "缺少归属用户" }, 400);
  const exists = await env.DB.prepare("SELECT username FROM accounts WHERE username = ?").bind(owner).first();
  if (!exists) return json({ error: "用户 " + owner + " 不存在" }, 404);
  const key = newApiKey();
  await env.DB.prepare("INSERT INTO api_keys (key, owner, name, created_by, created_at, revoked) VALUES (?, ?, ?, ?, ?, 0)")
    .bind(key, owner, name, user.username, new Date().toISOString()).run();
  await writeAdminLog(env, user.username, "create_apikey", "创建 API Key 给 " + owner + "（" + name + "）");
  return json({ ok: true, key: key, owner: owner, name: name });
}

async function handleApiKeyList(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user || user.role !== "root-admin") return json({ error: "仅 Root-Admin 可查看" }, 403);
  const { results } = await env.DB.prepare(
    "SELECT key, owner, name, revoked, created_at FROM api_keys ORDER BY created_at DESC LIMIT 100"
  ).all<{ key: string; owner: string; name: string | null; revoked: number; created_at: string }>();
  return json({ keys: results || [] });
}

async function handleApiKeyDelete(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user || user.role !== "root-admin") return json({ error: "仅 Root-Admin 可删除" }, 403);
  let body: { key?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const key = (body.key || "").trim();
  if (!key) return json({ error: "缺少 API Key" }, 400);
  const row = await env.DB.prepare("SELECT owner FROM api_keys WHERE key = ?").bind(key).first<{ owner: string }>();
  if (!row) return json({ error: "API Key 不存在" }, 404);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM api_keys WHERE key = ?").bind(key),
    env.DB.prepare("UPDATE accounts SET apikey = NULL WHERE apikey = ?").bind(key)
  ]);
  await writeAdminLog(env, user.username, "del_apikey", "删除 API Key（原属 " + row.owner + "）");
  return json({ ok: true });
}

async function handleCreditsLogs(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  if (user.role !== "admin" && user.role !== "root-admin") {
    return json({ error: "需要管理员权限" }, 403);
  }
  const { results } = await env.DB.prepare(
    "SELECT username, delta, reason, created_at FROM credits_logs ORDER BY id DESC LIMIT 100"
  ).all<{ username: string; delta: number; reason: string; created_at: string }>();
  return json({ logs: results || [] });
}

async function handleLogs(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  if (user.role !== "admin" && user.role !== "root-admin") {
    return json({ error: "需要管理员权限" }, 403);
  }
  await purgeOldMessages(env);   // 打开日志页即清理超过 35 天的日志（内部 20 秒节流）
  const { results } = await env.DB.prepare(
    "SELECT admin, action, detail, created_at FROM admin_logs ORDER BY id DESC LIMIT 100"
  ).all<{ admin: string; action: string; detail: string; created_at: string }>();
  return json({ logs: results || [] });
}

// ===== 对弈房间系统 =====
// ---------------------------------------------------------------------------
// ⚠️ 自愈建表：游戏相关接口原本不调用 ensureSchema，导致线上缺 game_seats 表
//    （与之前 chat_uploads 同一个坑）。这里做幂等自愈，成功才置标志。
// ---------------------------------------------------------------------------
let gameSchemaReady = false;
async function ensureGameSchema(env: Env): Promise<void> {
  if (gameSchemaReady) return;
  try {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        creator TEXT NOT NULL,
        opponent TEXT,
        status TEXT NOT NULL DEFAULT 'waiting',
        payer TEXT,
        board TEXT,
        turn TEXT,
        winner TEXT,
        result TEXT,
        round_fee_paid INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_seats (
        room_id TEXT NOT NULL,
        username TEXT NOT NULL,
        seat INTEGER NOT NULL DEFAULT 0,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (room_id, username)
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        from_user TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'pay_for_me',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      )`)
    ]);
    // ⚠️ 已存在的旧表不会因 CREATE TABLE IF NOT EXISTS 而加新列 → 必须显式迁移
    for (const ddl of [
      "ALTER TABLE games ADD COLUMN result TEXT",
      "ALTER TABLE games ADD COLUMN round_fee_paid INTEGER NOT NULL DEFAULT 0"
    ]) {
      try { await env.DB.prepare(ddl).run(); } catch {}
    }
    gameSchemaReady = true;
  } catch {}
}

// ===== 飞行棋房间系统（4 人，独立于 2 人对弈系统）=====
// 房间参数：真人 1-4 / AI 0-3（AI 只占位，真人必须凑齐才能开局）；速率固定 1.00。
let flightSchemaReady = false;
async function ensureFlightSchema(env: Env): Promise<void> {
  if (flightSchemaReady) return;
  try {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS flight_rooms (
        id TEXT PRIMARY KEY,
        creator TEXT NOT NULL,
        human INTEGER NOT NULL,
        ai INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        state TEXT,
        winner TEXT,
        created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS flight_seats (
        room_id TEXT NOT NULL,
        username TEXT NOT NULL,
        seat INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'human',
        joined_at TEXT NOT NULL,
        PRIMARY KEY (room_id, username)
      )`)
    ]);
    flightSchemaReady = true;
  } catch {}
}

const FLIGHT_RATE = 1.0; // 速率固定 1.00，不可调
const FLIGHT_FEE = 40;   // 飞行棋每局房号费用（Credits），速率 1.00 固定


// ---------------------------------------------------------------------------
// 座位模型（game_seats 表）
//   一个房间最多 2 个座位（seat 0 = 房主，seat 1 = 对手席）。
//   「有空位即可加入」：即使已经开局（status=playing），只要对手席空着，
//   别人也能加入 —— 这样打完一局可以直接换对手，不用重开房间。
//   games.opponent 保留为「当前对手」的快查字段，game_seats 才是座位真相源。
// ---------------------------------------------------------------------------
const GAME_SEATS_MAX = 2;

async function gameSeats(env: Env, roomId: string): Promise<Array<{ username: string; seat: number }>> {
  try {
    const r = await env.DB.prepare(
      "SELECT username, seat FROM game_seats WHERE room_id = ? ORDER BY seat ASC"
    ).bind(roomId).all<{ username: string; seat: number }>();
    return (r.results || []) as Array<{ username: string; seat: number }>;
  } catch {
    return [];
  }
}

// 房间里的玩家列表（含房主），座位号：0=房主，其余按加入顺序
async function gamePlayers(env: Env, roomId: string): Promise<Array<{ username: string; seat: number }>> {
  const row = await env.DB.prepare("SELECT creator FROM games WHERE id = ?").bind(roomId).first<{ creator: string }>();
  if (!row) return [];
  const seats = await gameSeats(env, roomId);
  const list = [{ username: row.creator, seat: 0 }];
  for (const s of seats) if (s.username !== row.creator) list.push(s);
  return list;
}

// 当前对手（seat 1 的占用者）；没有则 null
async function currentOpponent(env: Env, roomId: string, creator: string): Promise<string | null> {
  const seats = await gameSeats(env, roomId);
  const other = seats.find((s) => s.username !== creator);
  return other ? other.username : null;
}

// 空着的座位号；没有空位返回 -1
function freeSeat(players: Array<{ username: string; seat: number }>): number {
  const used = new Set(players.map((p) => p.seat));
  for (let i = 0; i < GAME_SEATS_MAX; i++) if (!used.has(i)) return i;
  return -1;
}

// 游戏费率（单位 Credits）：消消乐单人局 50；国际象棋 / 中国象棋 每局 28。
// ⚠️ 这是**唯一真相源**：前端展示价格通过 GET /api/game/fees 拉取同一份数据，
//    不要再在前端硬编码价格文案（曾因硬编码导致「文案 5 实际扣 5」两处漂移）。
const GAME_FEES: Record<string, number> = { match3: 50, chess: 28, xiangqi: 28, gomoku: 42, go: 42, flight: 40 };
const GAME_FEE_DEFAULT = 28;

// 按游戏类型取费率（消消乐 / 国际象棋 / 中国象棋）
function gameFeeFor(type: string): number {
  const f = GAME_FEES[type];
  return typeof f === "number" ? f : GAME_FEE_DEFAULT;
}

function genRoomId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[crypto.getRandomValues(new Uint8Array(1))[0] % chars.length];
  return s;
}

async function spendCredits(env: Env, username: string, amount: number): Promise<boolean> {
  const row = await env.DB.prepare("SELECT points FROM accounts WHERE username = ?").bind(username).first<{ points: number }>();
  if (!row || row.points < amount) return false;
  await env.DB.prepare("UPDATE accounts SET points = points - ? WHERE username = ?").bind(amount, username).run();
  return true;
}

async function notifyRoom(env: Env, obj: unknown): Promise<void> {
  try {
    const roomId = env.ROOM.idFromName("main");
    const room = env.ROOM.get(roomId);
    await room.fetch(new Request("http://do/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(obj)
    }));
  } catch {}
}

// 定向通知指定用户（对弈走子/结算只发给对局双方）
async function notifyUsers(env: Env, users: string[], payload: unknown): Promise<void> {
  try {
    const roomId = env.ROOM.idFromName("main");
    const room = env.ROOM.get(roomId);
    await room.fetch(new Request("http://do/notify-users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ users, payload })
    }));
  } catch {}
}

// ===== 群设置：成员列表 / 加群密码 / 转让 / 踢人 / 禁言 / 解散 =====
async function getRoomRow(env: Env, id: string): Promise<{ id: string; name: string; type: string; creator: string; passcode: string | null } | null> {
  return await env.DB.prepare("SELECT id, name, type, creator, passcode FROM rooms WHERE id = ?").bind(id)
    .first<{ id: string; name: string; type: string; creator: string; passcode: string | null }>();
}

function isGeek(room: { id: string }): boolean {
  return room.id === "geek";
}

// 倍率可编辑范围：geek 公告群（全免费）与 B 类私聊（成员↔Root-Admin，固定默认）不可编辑；
// 其余群（A 类普通群、管理员交流群、各管理员小群）由各自群主设定。
function ratesEditable(roomId: string, cls: string | null): boolean {
  if (roomId === "geek") return false;
  if (cls === "B") return false;
  return true;
}
async function roomRatesDetail(env: Env, roomId: string): Promise<{ class: string | null; fileRate: number; msgRate: number; editable: boolean }> {
  // 公告群全免费：展示值与实际计费（roomRates）保持一致
  if (roomId === "geek") return { class: "C", fileRate: 0, msgRate: 0, editable: false };
  let cls: string | null = null, fileRate = DEFAULT_FILE_RATE, msgRate = DEFAULT_MSG_RATE;
  try {
    const row = await env.DB.prepare("SELECT class, file_rate_per_mb, msg_rate_per20 FROM rooms WHERE id = ?").bind(roomId)
      .first<{ class: string | null; file_rate_per_mb: number | null; msg_rate_per20: number | null }>();
    if (row) {
      cls = row.class;
      fileRate = row.file_rate_per_mb == null ? DEFAULT_FILE_RATE : Math.max(0, Number(row.file_rate_per_mb) || 0);
      msgRate = row.msg_rate_per20 == null ? DEFAULT_MSG_RATE : Math.max(0, Number(row.msg_rate_per20) || 0);
    }
  } catch { /* 新列尚未迁移：退回默认倍率，不影响群设置其它功能 */ }
  return { class: cls, fileRate, msgRate, editable: ratesEditable(roomId, cls) };
}

async function handleRoomMembers(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const id = (new URL(request.url).searchParams.get("id") || "").trim();
  if (!id) return json({ error: "缺少房间" }, 400);
  if (!(await isMember(env.DB, id, user.username))) return json({ error: "你不是该房间成员" }, 403);
  const room = await getRoomRow(env, id);
  if (!room) return json({ error: "房间不存在" }, 404);
  const { results } = await env.DB.prepare(
    "SELECT m.username, a.role FROM memberships m JOIN accounts a ON a.username = m.username WHERE m.room = ? ORDER BY m.joined_at"
  ).bind(id).all<{ username: string; role: string }>();
  const now = Date.now();
  const members = await Promise.all((results || []).map(async (m) => {
    const mute = await env.DB.prepare("SELECT until FROM room_mutes WHERE room = ? AND username = ?").bind(id, m.username).first<{ until: string }>();
    const mutedUntil = mute ? mute.until : null;
    return {
      username: m.username,
      role: m.role,
      isOwner: m.username === room.creator,
      muted: !!mutedUntil && new Date(mutedUntil).getTime() > now,
      mutedUntil: mutedUntil
    };
  }));
  const rates = await roomRatesDetail(env, id);
  return json({
    id: room.id, name: room.name, type: room.type, creator: room.creator,
    passcode: isGeek(room) ? null : (room.passcode || ""),
    members,
    class: rates.class,
    fileRate: rates.fileRate, msgRate: rates.msgRate,
    defaultFileRate: DEFAULT_FILE_RATE, defaultMsgRate: DEFAULT_MSG_RATE,
    ratesEditable: rates.editable && room.creator === user.username
  });
}

// 群主设置本群收费倍率：仅可编辑群（A 类 / 管理员交流群 / 各管理员小群）的群主
async function handleRoomRatesSet(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { id?: string; fileRate?: number; msgRate?: number };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.id || "").trim();
  if (!id) return json({ error: "缺少房间" }, 400);
  const room = await getRoomRow(env, id);
  if (!room) return json({ error: "房间不存在" }, 404);
  if (room.creator !== user.username) return json({ error: "只有群主可以设置本群收费倍率" }, 403);
  const cur = await roomRatesDetail(env, id);
  if (!cur.editable) return json({ error: "该群聊为内置固定倍率（公告群全免费 / 私聊固定默认），不可修改" }, 403);
  const fr = Number(body.fileRate);
  const mr = Number(body.msgRate);
  if (!isFinite(fr) || !isFinite(mr) || fr < 0 || mr < 0 || fr > 100000 || mr > 100000) {
    return json({ error: "倍率须为 0 - 100000 的数字（0 = 免费）" }, 400);
  }
  await env.DB.prepare("UPDATE rooms SET file_rate_per_mb = ?, msg_rate_per20 = ? WHERE id = ?")
    .bind(Math.round(fr * 100) / 100, Math.round(mr * 100) / 100, id).run();
  return json({ ok: true, fileRate: Math.round(fr * 100) / 100, msgRate: Math.round(mr * 100) / 100 });
}

async function handleRoomPasscode(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { id?: string; passcode?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.id || "").trim();
  const passcode = (body.passcode || "").trim();
  const room = await getRoomRow(env, id);
  if (!room) return json({ error: "房间不存在" }, 404);
  if (isGeek(room)) return json({ error: "Geek公告群是内置群聊，不需要加群密码" }, 400);
  if (room.creator !== user.username) return json({ error: "只有群主可以设置加群密码" }, 403);
  if (passcode && (passcode.length < 1 || passcode.length > 32)) return json({ error: "密码限 1-32 位" }, 400);
  await env.DB.prepare("UPDATE rooms SET passcode = ? WHERE id = ?").bind(passcode || null, id).run();
  return json({ ok: true, passcode: passcode });
}

async function handleRoomTransfer(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { id?: string; to?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.id || "").trim();
  const to = (body.to || "").trim();
  if (isBuiltinRoom(id)) return json({ error: "内置群聊不可转让" }, 403);
  const room = await getRoomRow(env, id);
  if (!room) return json({ error: "房间不存在" }, 404);
  if (isGeek(room)) return json({ error: "Geek公告群群主是 Root-Admin，管理权不可变更" }, 403);
  if (room.creator !== user.username) return json({ error: "只有群主可以转让群主管理权" }, 403);
  if (to === user.username) return json({ error: "你已经是群主" }, 400);
  if (!(await isMember(env.DB, id, to))) return json({ error: "转让对象必须是群成员" }, 400);
  await env.DB.prepare("UPDATE rooms SET creator = ? WHERE id = ?").bind(to, id).run();
  await writeAdminLog(env, user.username, "room_transfer", "群 " + room.name + " 群主已转让给 " + to);
  await notifyRoom(env, { type: "room-added" });
  return json({ ok: true, newOwner: to });
}

async function handleRoomKick(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { id?: string; username?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.id || "").trim();
  const target = (body.username || "").trim();
  const room = await getRoomRow(env, id);
  if (!room) return json({ error: "房间不存在" }, 404);
  if (isGeek(room)) return json({ error: "Geek公告群不可踢人" }, 403);
  if (room.creator !== user.username) return json({ error: "只有群主可以踢人" }, 403);
  if (target === user.username) return json({ error: "群主不能踢自己，可以解散群聊" }, 400);
  const tRow = await env.DB.prepare("SELECT role FROM accounts WHERE username = ?").bind(target).first<{ role: string }>();
  if (!tRow) return json({ error: "用户不存在" }, 404);
  if (tRow.role === "root-admin") return json({ error: "不能踢 Root-Admin" }, 403);
  if (!(await isMember(env.DB, id, target))) return json({ error: "对方不是群成员" }, 400);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM memberships WHERE room = ? AND username = ?").bind(id, target),
    env.DB.prepare("DELETE FROM room_mutes WHERE room = ? AND username = ?").bind(id, target)
  ]);
  await writeAdminLog(env, user.username, "room_kick", "群 " + room.name + " 群主踢出 " + target);
  await notifyRoom(env, { type: "room-added", room: id });
  return json({ ok: true });
}

const MUTE_COOLDOWN_MS = 12 * 3600 * 1000;

async function handleRoomMute(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { id?: string; username?: string; hours?: number };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.id || "").trim();
  const target = (body.username || "").trim();
  const hours = Math.floor(Number(body.hours));
  const room = await getRoomRow(env, id);
  if (!room) return json({ error: "房间不存在" }, 404);
  if (isGeek(room)) return json({ error: "Geek公告群无需禁言（非群主本就不能发言）" }, 400);
  // 操作权限：群主 或 账号权限为 Admin（含 Root-Admin）的人，且必须是该群成员
  if (room.creator !== user.username && user.role !== "admin" && user.role !== "root-admin") {
    return json({ error: "只有群主或 Admin 可以禁言" }, 403);
  }
  if (!(await isMember(env.DB, id, user.username))) return json({ error: "你不是该房间成员" }, 403);
  if (!target) return json({ error: "缺少目标成员" }, 400);
  if (!isFinite(hours) || hours < 1 || hours > 24) return json({ error: "禁言时长限 1-24 小时" }, 400);
  if (target === user.username) return json({ error: "不能禁言自己" }, 400);
  if (target === room.creator) return json({ error: "不能禁言群主" }, 403);
  const tRow = await env.DB.prepare("SELECT role FROM accounts WHERE username = ?").bind(target).first<{ role: string }>();
  if (!tRow) return json({ error: "用户不存在" }, 404);
  if (tRow.role === "admin" || tRow.role === "root-admin") return json({ error: "不能禁言 Admin" }, 403);
  if (!(await isMember(env.DB, id, target))) return json({ error: "对方不是群成员" }, 400);
  const existing = await env.DB.prepare("SELECT until FROM room_mutes WHERE room = ? AND username = ?").bind(id, target).first<{ until: string }>();
  const now = Date.now();
  if (existing) {
    const until = new Date(existing.until).getTime();
    if (until > now) {
      return json({ error: "对方已被禁言中（至 " + existing.until.slice(0, 16).replace("T", " ") + "），中途不能结束" }, 409);
    }
    if (now < until + MUTE_COOLDOWN_MS) {
      const cdEnd = new Date(until + MUTE_COOLDOWN_MS).toISOString().slice(0, 16).replace("T", " ");
      return json({ error: "禁言结束后 12 小时内不可再次禁言（冷却至 " + cdEnd + "）" }, 409);
    }
  }
  const untilIso = new Date(now + hours * 3600 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO room_mutes (room, username, until, created_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT (room, username) DO UPDATE SET until = excluded.until, created_at = excluded.created_at"
  ).bind(id, target, untilIso, new Date(now).toISOString()).run();
  await writeAdminLog(env, user.username, "room_mute", "群 " + room.name + " 禁言 " + target + " " + hours + " 小时");
  await notifyRoom(env, { type: "room-added", room: id });
  return json({ ok: true, until: untilIso, hours: hours });
}

async function handleRoomDisband(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { id?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.id || "").trim();
  const room = await getRoomRow(env, id);
  if (!room) return json({ error: "房间不存在" }, 404);
  if (isBuiltinRoom(id)) return json({ error: "内置群聊不可解散（管理员交流群 / 管理员小群）" }, 403);
  if (isGeek(room)) return json({ error: "Geek公告群不可解散" }, 403);
  if (room.creator !== user.username) return json({ error: "只有群主可以解散群聊" }, 403);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM memberships WHERE room = ?").bind(id),
    env.DB.prepare("DELETE FROM messages WHERE room = ?").bind(id),
    env.DB.prepare("DELETE FROM room_mutes WHERE room = ?").bind(id),
    env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(id)
  ]);
  await writeAdminLog(env, user.username, "room_disband", "解散群聊 " + room.name);
  await notifyRoom(env, { type: "room-deleted", roomId: id, room: id });
  await notifyRoom(env, { type: "room-added" });
  return json({ ok: true });
}

async function handleRoomJoinByPassword(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { name?: string; password?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const name = (body.name || "").trim();
  const password = (body.password || "").trim();
  if (!name || !password) return json({ error: "群名和密码都要填" }, 400);
  const room = await env.DB.prepare("SELECT id, name, creator, passcode FROM rooms WHERE name = ? AND type = 'group' ORDER BY created_at DESC")
    .bind(name).first<{ id: string; name: string; creator: string; passcode: string | null }>();
  if (!room) return json({ error: "群聊不存在，检查群名" }, 404);
  if (!room.passcode) return json({ error: "该群未设置加群密码，请联系群主拉人" }, 400);
  if (room.passcode !== password) return json({ error: "加群密码错误" }, 403);
  if (await isMember(env.DB, room.id, user.username)) return json({ error: "你已经在该群聊里" }, 409);
  // A 类群聊上限（Root-Admin 也限）
  const a = await countAClass(env, user.username);
  if (a + 1 > A_CLASS_LIMIT) {
    return json({ error: "你已达到 A 类群聊上限（" + A_CLASS_LIMIT + " 个），无法加入" }, 409);
  }
  await env.DB.prepare("INSERT INTO memberships (room, username, joined_at) VALUES (?, ?, ?)")
    .bind(room.id, user.username, new Date().toISOString()).run();
  await notifyRoom(env, { type: "room-added" });
  return json({ ok: true, room: { id: room.id, name: room.name, creator: room.creator } });
}

// 文件费用报价：发送/下载前弹窗确认用（与实际扣费同一套规则）
async function handleFileQuote(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { size?: number; room?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const size = Math.max(0, Number(body.size) || 0);
  const room = (body.room || "").trim();
  const rates = await roomRates(env, room);
  const cost = fileFeeFor(size, rates.fileRate);
  const free = cost === 0;
  const row = await env.DB.prepare("SELECT points FROM accounts WHERE username = ?").bind(user.username).first<{ points: number }>();
  const balance = row ? row.points : 0;
  return json({ cost: cost, free: free, balance: balance, enough: free || balance >= cost, fileRate: rates.fileRate });
}

function gameTypeName(type: string): string {
  if (type === "xiangqi") return "中国象棋";
  if (type === "gomoku") return "五子棋";
  if (type === "go") return "围棋（中国规则）";
  if (type === "match3") return "消消乐";
  return "国际象棋";
}

function fmtBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

async function handleFilePay(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { size?: number; name?: string; room?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const size = Math.max(0, Number(body.size) || 0);
  const room = (body.room || "").trim();
  const rates = await roomRates(env, room);
  const cost = fileFeeFor(size, rates.fileRate);
  if (cost === 0) return json({ ok: true, cost: 0, free: true });
  if (!(await spendCredits(env, user.username, cost))) {
    return json({ error: "Credits 不足：下载该文件需 " + cost + " Credits（每MB " + rates.fileRate + "Credits，" + fmtBytes(size) + "）" }, 402);
  }
  await logCredits(env, user.username, -cost, "文件下载");
  return json({ ok: true, cost: cost });
}

// 聊天文件下载：从 chat_files 取回字节（与文件消息历史一一对应，保留 7 天）
// 免费：公告群 Root-Admin、文件发送者本人；其余成员需已通过 /api/file/pay 扣费
async function handleFileGet(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const id = new URL(request.url).searchParams.get("id") || "";
  const f = await env.DB.prepare("SELECT * FROM chat_files WHERE id = ?").bind(id).first<{
    id: string; room: string; sender: string; name: string; size: number; mime: string; data: string;
  }>();
  if (!f) return json({ error: "文件不存在或已过期（聊天文件仅保留 7 天）" }, 404);
  const room = f.room;
  const free = (room === "geek" && user.role === "root-admin") || f.sender === user.username;
  const member = free || (await isMember(env.DB, room, user.username));
  if (!member) return json({ error: "你不是该房间成员，无权下载此文件" }, 403);
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(f.data); } catch { return json({ error: "文件数据损坏" }, 500); }
  return new Response(bytes, {
    headers: {
      "content-type": f.mime || "application/octet-stream",
      "content-disposition": 'attachment; filename="' + encodeURIComponent(f.name) + '"',
      "content-length": String(bytes.length)
    }
  });
}

// ===== 云存储 =====
const CLOUD_COST_PER_MB = 1190;
const RA_CLOUD_MB = 2048; // Root-Admin 免费永久云空间：2GB
const CLOUD_MONTH_MS = 30 * 24 * 3600 * 1000;
const AUTO_RENEW_WINDOW_MS = 20 * 60 * 1000; // 到期前 20 分钟按原价自动续费

// 按角色的可购买上限（MB）：Admin 125 / member 60 / 观测者 10
function cloudCapForRole(role: string): number {
  if (role === "admin") return 125;
  if (role === "observer") return 10;
  return 60;
}

// ===== 云空间 7 天试用活动（北京时间 UTC+8）=====
// 与主空间完全隔离：独立表 + 独立接口，绝不碰 cloud_files（RA 的重要文件在那）
const TRIAL_MB = 5;
const TRIAL_DAYS = 7;
const TRIAL_START_MS = Date.parse("2026-11-07T08:00:00Z"); // 北京 2026/11/07 16:00
const TRIAL_END_MS = Date.parse("2026-12-14T08:00:00Z");   // 北京 2026/12/14 16:00
// Supabase Storage 接入参数
const SB_BUCKET = "cloud-files";
const SB_PATH_PREFIX = "cloud/";

async function pointsOf(env: Env, username: string): Promise<number> {
  const r = await env.DB.prepare("SELECT points FROM accounts WHERE username = ?").bind(username).first<{ points: number }>();
  return r ? r.points : 0;
}
async function getCloudSub(env: Env, username: string): Promise<any> {
  return env.DB.prepare("SELECT * FROM cloud_subs WHERE username = ?").bind(username).first();
}
async function sumCloudUsed(env: Env, username: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COALESCE(SUM(size),0) AS s FROM cloud_files WHERE owner = ?").bind(username).first<{ s: number }>();
  return r ? r.s : 0;
}
async function countCloudFiles(env: Env, username: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM cloud_files WHERE owner = ?").bind(username).first<{ n: number }>();
  return r ? r.n : 0;
}
async function ensureRASub(env: Env, user: { username: string; role: string }): Promise<void> {
  if (user.role !== "root-admin") return;
  const existing = await getCloudSub(env, user.username);
  if (!existing) {
    await env.DB.prepare("INSERT INTO cloud_subs (username, total_mb, used_mb, expires_at, auto_renew, kind, created_at) VALUES (?, ?, 0, '2099-12-31T00:00:00Z', 0, 'free', ?)")
      .bind(user.username, RA_CLOUD_MB, new Date().toISOString()).run();
    return;
  }
  // 存量升级：RA 的免费额度随 RA_CLOUD_MB 提升（如 512MB → 1GB），只升不降
  if (existing.kind === "free" && existing.total_mb < RA_CLOUD_MB) {
    await env.DB.prepare("UPDATE cloud_subs SET total_mb = ? WHERE username = ? AND kind = 'free'")
      .bind(RA_CLOUD_MB, user.username).run();
  }
}
async function cloudStatus(env: Env, user: { username: string; role: string }): Promise<any> {
  await ensureRASub(env, user);
  const isRA = user.role === "root-admin";
  let balance = await pointsOf(env, user.username);
  const used = await sumCloudUsed(env, user.username);
  const files = await countCloudFiles(env, user.username);
  const capMb = cloudCapForRole(user.role);
  if (isRA) {
    return {
      isRA: true, kind: "free", totalMb: RA_CLOUD_MB, usedMb: used / (1024 * 1024),
      expiresAt: "永久", autoRenew: true, expired: false, hasFiles: files > 0, fileCount: files,
      costPerMb: CLOUD_COST_PER_MB, capMb: RA_CLOUD_MB, balance,
      reclaimPending: false, reclaimFiles: []
    };
  }
  const sub = await getCloudSub(env, user.username);
  let expired = false;
  let expiresAt: string | null = null;
  let reclaimPending = false;
  let renewed = false;
  let renewCost = sub ? sub.total_mb * CLOUD_COST_PER_MB : 0; // 原价，按订阅总 MB 算
  if (sub) {
    expiresAt = sub.expires_at;
    const expMs = sub.expires_at ? new Date(sub.expires_at).getTime() : 0;
    const nowMs = Date.now();
    // 自动续费强制开启、不可关闭：到期前 20 分钟窗口内，Credits 足够则按原价直接扣费续期
    if (sub.kind !== "free" && expMs > nowMs && expMs - nowMs <= AUTO_RENEW_WINDOW_MS) {
      if (balance >= renewCost) {
        await spendCredits(env, user.username, renewCost);
        await logCredits(env, user.username, -renewCost, "云空间自动续费（原价 " + renewCost + " Credits）");
        const next = new Date(expMs + CLOUD_MONTH_MS).toISOString();
        await env.DB.prepare("UPDATE cloud_subs SET expires_at = ?, auto_renew = 1, used_mb = ? WHERE username = ?")
          .bind(next, used / (1024 * 1024), user.username).run();
        expiresAt = next; renewed = true; balance -= renewCost;
      }
      // 余额不足：什么都不做，等到期后走收回流程
    } else if (sub.kind !== "free" && expMs <= nowMs) {
      // 已到期且没续上（说明余额不足以原价续费）→ 待收回
      expired = true;
      reclaimPending = true;
      await env.DB.prepare("UPDATE cloud_subs SET reclaim_pending = 1 WHERE username = ?").bind(user.username).run().catch(() => {});
    }
  }
  // 待收回时把文件清单一起下发，前端先全部下载到本机，再回来确认删除
  let reclaimFiles: any[] = [];
  if (reclaimPending) {
    const { results } = await env.DB.prepare(
      "SELECT id, name, size, mime FROM cloud_files WHERE owner = ? ORDER BY created_at ASC"
    ).bind(user.username).all<any>();
    reclaimFiles = (results || []).map((r) => ({ id: r.id, name: r.name, size: r.size, mime: r.mime }));
  }
  return {
    isRA: false, kind: sub ? sub.kind : "none", totalMb: sub ? sub.total_mb : 0,
    usedMb: used / (1024 * 1024), expiresAt, autoRenew: true,
    expired, hasFiles: files > 0, fileCount: files,
    costPerMb: CLOUD_COST_PER_MB, capMb, balance,
    renewCost, renewed, autoRenewWindowMin: AUTO_RENEW_WINDOW_MS / 60000,
    reclaimPending, reclaimFiles
  };
}

async function handleCloudStatus(request: Request, env: Env): Promise<Response> {
  await ensureSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  return json(await cloudStatus(env, user));
}

async function handleCloudBuy(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  if (user.role === "root-admin") return json({ error: "Root-Admin 已免费拥有永久云空间，无需购买" }, 400);
  let body: { mb?: number; autoRenew?: boolean };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const mb = Math.floor(Number(body.mb) || 0);
  if (mb < 1) return json({ error: "至少购买 1MB" }, 400);
  const sub = await getCloudSub(env, user.username);
  const cur = sub ? sub.total_mb : 0;
  const capMb = cloudCapForRole(user.role);
  if (cur + mb > capMb) return json({ error: "超出上限：当前已购 " + cur + "MB，" + user.role + " 每账号最多 " + capMb + "MB" }, 409);
  const cost = mb * CLOUD_COST_PER_MB;
  const bal = await pointsOf(env, user.username);
  if (bal < cost) return json({ error: "Credits 不足：购买 " + mb + "MB 需 " + cost + " Credits（" + mb + " × " + CLOUD_COST_PER_MB + "）" }, 402);
  await spendCredits(env, user.username, cost);
  await logCredits(env, user.username, -cost, "购买云空间 " + mb + "MB");
  const now = new Date();
  if (!sub) {
    await env.DB.prepare("INSERT INTO cloud_subs (username, total_mb, used_mb, expires_at, auto_renew, kind, created_at) VALUES (?, ?, 0, ?, ?, 'paid', ?)")
      .bind(user.username, mb, new Date(now.getTime() + CLOUD_MONTH_MS).toISOString(), 1, now.toISOString()).run();
  } else {
    const curExpired = sub.expires_at && new Date(sub.expires_at).getTime() < Date.now();
    const nextExp = curExpired ? new Date(now.getTime() + CLOUD_MONTH_MS).toISOString() : sub.expires_at;
    await env.DB.prepare("UPDATE cloud_subs SET total_mb = total_mb + ?, auto_renew = ?, expires_at = ? WHERE username = ?")
      .bind(mb, body.autoRenew ? 1 : 0, nextExp, user.username).run();
  }
  return json({ ok: true, ...(await cloudStatus(env, user)) });
}

async function handleCloudList(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  // 展示型读优先走 PG 只读副本，减轻 D1 主库读压力；副本滞后/暂停时自动回退 D1
  const mirror = await pgList(env, user.username);
  if (mirror) {
    // 一致性护栏：用 D1 的 COUNT（极轻）比对副本条数，不一致说明副本滞后 → 回退 D1 并后台自愈
    const n = await countCloudFiles(env, user.username);
    if (mirror.length === n) return json({ files: mirror, source: "pg" });
    pgFire(pgResync(env, user.username));
  }
  const { results } = await env.DB.prepare("SELECT id, name, size, mime, created_at FROM cloud_files WHERE owner = ? ORDER BY created_at DESC")
    .bind(user.username).all<{ id: string; name: string; size: number; mime: string | null; created_at: string }>();
  return json({ files: results || [], source: "d1" });
}

// 只读统计 Supabase Storage 桶内 cloud/ 前缀下的真实对象数与字节数（分页遍历）
async function sbStorageUsage(env: Env): Promise<any> {
  if (!sbEnabled(env)) return { enabled: false };
  const bucket = sbBucket(env);
  const limit = 1000;
  let offset = 0, bytes = 0;
  const names: string[] = [];
  for (let page = 0; page < 10; page++) {
    const r = await fetch(env.SUPABASE_URL + "/storage/v1/object/list/" + bucket, {
      method: "POST",
      headers: sbHeaders(env, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix: SB_PATH_PREFIX, limit, offset, sortBy: { column: "name", order: "asc" } }),
      signal: AbortSignal.timeout(4000)
    });
    if (!r.ok) return { enabled: true, bucket, error: "list HTTP " + r.status };
    const arr: any[] = await r.json();
    for (const o of arr) {
      const sz = Number((o && (o.metadata?.size ?? o.size)) || 0);
      bytes += sz; names.push(String(o.name));
    }
    if (arr.length < limit) break;
    offset += limit;
  }
  // 与 D1 元数据比对，找出「孤儿对象」（元数据已删但对象还在）与「缺失对象」
  const { results } = await env.DB.prepare("SELECT id FROM cloud_files WHERE storage = 'supabase'").all<{ id: string }>();
  const meta = new Set((results || []).map((r) => r.id));
  const objs = new Set(names);
  const orphanObjects = names.filter((n) => !meta.has(n)).slice(0, 20);
  const missingObjects = [...meta].filter((id) => !objs.has(id)).slice(0, 20);
  return {
    enabled: true, bucket, objects: names.length, bytes, mb: +(bytes / 1048576).toFixed(2),
    metaSupabase: meta.size, orphanObjects, missingObjects, sample: names.slice(0, 3)
  };
}

// 运维自检：副本层状态 + 可选 Storage 用量（不含任何密钥 / 用户数据）
// ?bootstrap=1 尝试一次性自动建表；?storage=1 统计 Supabase 实际占用。仅登录用户可见细节。
async function handleCloudPgHealth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const user = await authUser(request, env);
  // 诊断细节（表结构 / 端点状态 / 用量）仅登录用户可见，避免对外泄露内部信息
  const ready = await pgEnsure(env, !!user && url.searchParams.get("bootstrap") === "1");
  const base = { enabled: sbEnabled(env), ready, truth: "d1", mode: "read-replica+disaster-recovery" };
  if (!user) return json(base);
  const out: any = { ...base, table: PG_TABLE, probe: pgDiag.probe, bootstrap: pgDiag.bootstrap, tables: pgDiag.tables };
  if (url.searchParams.get("storage") === "1") out.storage = await sbStorageUsage(env);
  return json(out);
}

// ===== 云存储二进制后端（Supabase Storage 优先，D1 分片降级）=====
// Supabase key 只存在于 Worker secret（env.SUPABASE_SECRET），绝不下发到前端。
// 未配置 secret 时自动降级为 D1 分片存储（cloud_file_chunks），行为与旧版完全一致。
function sbEnabled(env: Env): boolean {
  return !!(env.SUPABASE_URL && env.SUPABASE_SECRET);
}
function sbBucket(env: Env): string {
  return env.SUPABASE_BUCKET || SB_BUCKET;
}
function sbObjectPath(fileId: string): string {
  return SB_PATH_PREFIX + fileId;
}
function sbHeaders(env: Env, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    "apikey": env.SUPABASE_SECRET as string,
    "Authorization": "Bearer " + (env.SUPABASE_SECRET as string)
  };
  if (extra) for (const k in extra) h[k] = extra[k];
  return h;
}

// ===== Supabase Postgres 元数据副本（只读加速 + 跨云灾备）=====
// 架构定位：D1 = 唯一真相源（truth），PG = 尽力而为的只读副本。
//  · 正确性路径（配额强制 / 扣费 / 续费 / 到期收回）永远只查 D1，绝不受副本延迟影响
//  · 展示型高频读（文件列表）优先 PG；未就绪 / 项目暂停 / 超时 / 条数不一致 → 自动回退 D1
//  · 免费项目会自动暂停，故 PG 不可用属常态预期而非故障：请求失败即熔断 5 分钟，期间用户路径零网络开销
//  · 副本允许短暂滞后：列表读用 D1 的 COUNT 做一致性护栏，不一致即回退并后台全量重同步（自愈/首次回填）
//  · 用户路径直接发业务请求（成功即启用、失败即熔断），不额外探测；探测/建表仅由运维端点触发
const PG_TABLE = "cloud_files_mirror";
const PG_RECHECK_MS = 5 * 60 * 1000;
let pgState = { ok: false, checkedAt: 0 };
let pgDiag = { probe: "", bootstrap: "", tables: "" };

function pgBase(env: Env): string { return (env.SUPABASE_URL || "").replace(/\/$/, ""); }
function pgRef(env: Env): string {
  const m = pgBase(env).match(/https?:\/\/([^.]+)\./);
  return m ? m[1] : "";
}
async function pgFetch(
  env: Env,
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
  timeoutMs = 900
): Promise<Response | null> {
  if (!sbEnabled(env)) return null;
  try {
    return await fetch(pgBase(env) + "/rest/v1/" + path, {
      method: init.method,
      headers: sbHeaders(env, init.headers),
      body: init.body,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch { return null; }
}

// 仅由运维自检端点调用：探测副本表是否可用，可选尝试一次性自动建表。
// 正常用户请求不经过此函数，避免 Management API 的 2.5s 拖慢在线接口。
async function pgEnsure(env: Env, allowBootstrap = false): Promise<boolean> {
  if (!sbEnabled(env)) return false;
  if (pgState.ok) return true;
  const now = Date.now();
  // 运维端点（allowBootstrap）强制重新探测，绕过熔断以便诊断/首次启用
  if (!allowBootstrap && now - pgState.checkedAt < PG_RECHECK_MS) return false;
  pgState.checkedAt = now;
  // 探测失败（表不存在 / 项目暂停）时 checkedAt 已记录 → 5 分钟熔断期内用户路径零额外开销
  const probe = await pgFetch(env, PG_TABLE + "?select=id&limit=1", { method: "GET" }, 1200);
  pgDiag.probe = probe ? "HTTP " + probe.status : "network-error";
  if (probe && probe.ok) { pgState.ok = true; return true; }
  if (!allowBootstrap) return false;
  // 表不存在时，运维端点尝试多个可用的 SQL 执行通道做一次性自动建表（幂等）
  const ref = pgRef(env);
  if (!ref) return false;
  const ddl = "CREATE TABLE IF NOT EXISTS public." + PG_TABLE + " ("
    + "id text PRIMARY KEY, owner text NOT NULL, name text NOT NULL, "
    + "size bigint NOT NULL DEFAULT 0, mime text, storage text, "
    + "created_at timestamptz NOT NULL DEFAULT now(), synced_at timestamptz NOT NULL DEFAULT now());"
    + "CREATE INDEX IF NOT EXISTS " + PG_TABLE + "_owner_idx ON public." + PG_TABLE + " (owner);";
  const endpoints = [
    pgBase(env) + "/pg/query",                                               // pg-meta（Studio SQL Editor 通道）
    "https://api.supabase.com/v1/projects/" + ref + "/database/query",       // Management API（通常需 PAT）
    pgBase(env) + "/rest/v1/rpc/exec_sql"                                    // 若项目预置了 exec_sql 函数
  ];
  const statuses: string[] = [];
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, {
        method: "POST",
        headers: sbHeaders(env, { "Content-Type": "application/json", "Accept": "application/json" }),
        body: JSON.stringify({ query: ddl }),
        signal: AbortSignal.timeout(2500)
      });
      statuses.push(ep.includes("/pg/") ? "pgmeta:" + r.status
        : ep.includes("api.supabase.com") ? "mgmt:" + r.status : "rpc:" + r.status);
      if (r.ok) {
        const probe2 = await pgFetch(env, PG_TABLE + "?select=id&limit=1", { method: "GET" }, 2000);
        if (probe2 && probe2.ok) { pgState.ok = true; pgDiag.bootstrap = statuses.join(","); return true; }
      }
    } catch { statuses.push("network-error"); }
  }
  pgDiag.bootstrap = statuses.join(",");
  // 附带探测 PostgREST 已暴露的表名（仅名称，不含数据），便于判断是否已有可复用的表
  try {
    const sw = await fetch(pgBase(env) + "/rest/v1/", {
      headers: sbHeaders(env, { "Accept": "application/openapi+json" }),
      signal: AbortSignal.timeout(2500)
    });
    if (sw.ok) {
      const spec: any = await sw.json();
      const defs = spec?.definitions || spec?.components?.schemas || {};
      pgDiag.tables = Object.keys(defs).slice(0, 40).join(",");
    } else pgDiag.tables = "swagger:HTTP " + sw.status;
  } catch { pgDiag.tables = "swagger:network-error"; }
  return false;
}

type PGRow = { id: string; owner: string; name: string; size: number; mime: string | null; storage: string | null; created_at: string };
// 后台任务：有 ExecutionContext.waitUntil 时交给它（保证响应返回后仍执行完），否则静默 fire-and-forget
let pgCtx: { waitUntil?: (p: Promise<unknown>) => void } | null = null;
function pgFire(p: Promise<unknown>): void {
  const safe = p.catch(() => {});
  try { if (pgCtx && typeof pgCtx.waitUntil === "function") pgCtx.waitUntil(safe); } catch {}
}
// 熔断判定：已确认可用 → 放行；失败后 5 分钟内直接短路（用户路径零网络开销）
function pgUsable(): boolean {
  return pgState.ok || Date.now() - pgState.checkedAt >= PG_RECHECK_MS;
}
function pgFail(): void { pgState = { ok: false, checkedAt: Date.now() }; }
function pgOk(): void { pgState = { ok: true, checkedAt: Date.now() }; }

async function pgUpsert(env: Env, row: PGRow): Promise<void> {
  if (!sbEnabled(env) || !pgUsable()) return;
  const r = await pgFetch(env, PG_TABLE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ ...row, synced_at: new Date().toISOString() }])
  });
  if (r && r.ok) pgOk(); else pgFail();
}
async function pgDelete(env: Env, fileId: string): Promise<void> {
  if (!sbEnabled(env) || !pgUsable()) return;
  const r = await pgFetch(env, PG_TABLE + "?id=eq." + encodeURIComponent(fileId), { method: "DELETE" });
  if (r && r.ok) pgOk(); else pgFail();
}
async function pgDeleteOwner(env: Env, owner: string): Promise<void> {
  if (!sbEnabled(env) || !pgUsable()) return;
  const r = await pgFetch(env, PG_TABLE + "?owner=eq." + encodeURIComponent(owner), { method: "DELETE" });
  if (r && r.ok) pgOk(); else pgFail();
}
async function pgList(env: Env, owner: string): Promise<any[] | null> {
  if (!sbEnabled(env) || !pgUsable()) return null;
  const r = await pgFetch(env,
    PG_TABLE + "?owner=eq." + encodeURIComponent(owner) + "&select=id,name,size,mime,created_at&order=created_at.desc",
    { method: "GET" }, 1200);
  if (!r || !r.ok) { pgFail(); return null; }
  pgOk();
  try { return await r.json<any[]>(); } catch { return null; }
}
// 从 D1 全量重同步某用户的副本（自愈 / 首次启用时回填）
async function pgResync(env: Env, owner: string): Promise<void> {
  if (!pgState.ok) return;
  const { results } = await env.DB.prepare(
    "SELECT id, owner, name, size, mime, storage, created_at FROM cloud_files WHERE owner = ?"
  ).bind(owner).all<PGRow>();
  const rows = (results || []).map((r) => ({ ...r, synced_at: new Date().toISOString() }));
  // 先清掉该用户残留的旧行（避免「副本多出已删文件」导致护栏永远不一致），再全量写入
  const cleared = await pgFetch(env, PG_TABLE + "?owner=eq." + encodeURIComponent(owner), { method: "DELETE" }, 2000);
  if (!cleared || !cleared.ok) { pgFail(); return; }
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 200) {
    const r = await pgFetch(env, PG_TABLE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(i, i + 200))
    }, 2000);
    if (!r || !r.ok) { pgFail(); return; }
  }
}

// 9 个 D1 分片库，按文件 id 哈希分散；未绑定时回退主库（保证兼容）
const SHARD_COUNT = 9;
function pickShard(fileId: string): number {
  let h = 2166136261;
  for (let i = 0; i < fileId.length; i++) { h ^= fileId.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % SHARD_COUNT;
}
function shardDB(env: Env, idx: number): D1Database {
  const map = [env.SHARD0, env.SHARD1, env.SHARD2, env.SHARD3, env.SHARD4, env.SHARD5, env.SHARD6, env.SHARD7, env.SHARD8];
  return (idx >= 0 && idx < map.length && map[idx]) ? map[idx]! : env.DB;
}

// 分片库表结构自愈：首次写入某分片前确保 cloud_file_chunks 存在（幂等，按 isolate 缓存）
const ensuredShards = new Set<number>();
async function ensureShardSchema(env: Env, idx: number): Promise<void> {
  if (ensuredShards.has(idx)) return;
  const db = shardDB(env, idx);
  if (db === env.DB) { ensuredShards.add(idx); return; } // 主库由 ensureSchema 维护
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS cloud_file_chunks (file_id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (file_id, seq))"
  ).run();
  ensuredShards.add(idx);
}

// chat_uploads 表结构自愈：DO 的 WebSocket 路径不走 ensureSchema（那里只覆盖 Pages 的 API 端点），
// 而 chat_uploads 仅在 DO 路径使用 → 必须在 DO 侧自行建表，否则 D1 兜底会因缺表而静默失效。
let ensuredUploadsTable = false;
async function ensureChatUploadsTable(env: Env): Promise<void> {
  if (ensuredUploadsTable) return;
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_uploads (
      file_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime TEXT,
      room TEXT NOT NULL,
      sender TEXT NOT NULL,
      role TEXT,
      seq INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`).run();
    ensuredUploadsTable = true; // 仅成功后置位，失败则下次重试
  } catch {}
}

// 写入云文件二进制：优先 Supabase，失败或强制(forceD1)时降级为 D1 分片（散到 9 个分片库）
// 返回实际使用的后端标识："supabase" | "d1:N"（N=分片库序号）；历史格式 "d1" 表示主库兜底（兼容旧数据）
async function storeCloudBytes(env: Env, fileId: string, bytes: Uint8Array, mime: string, forceD1?: boolean): Promise<string> {
  if (!forceD1 && sbEnabled(env)) {
    try {
      const url = env.SUPABASE_URL + "/storage/v1/object/" + sbBucket(env) + "/" + sbObjectPath(fileId);
      const res = await fetch(url, {
        method: "POST",
        headers: sbHeaders(env, { "Content-Type": mime || "application/octet-stream", "x-upsert": "true" }),
        body: bytes as unknown as BodyInit
      });
      if (res.ok) return "supabase";
      console.error("Supabase 上传失败，降级到 D1 分片：", res.status, (await res.text()).slice(0, 200));
    } catch (e) {
      console.error("Supabase 上传异常，降级到 D1 分片：", e);
    }
  }
  // D1 分片存储（每片 ~60KB base64，避免单格超限）；按文件 id 哈希分散到 9 个分片库
  const shard = pickShard(fileId);
  await ensureShardSchema(env, shard);
  const db = shardDB(env, shard);
  const b64 = bytesToBase64(bytes);
  const CH = 60000;
  const inserts: any[] = [];
  for (let i = 0, seq = 1; i < b64.length; i += CH, seq++) {
    inserts.push(db.prepare("INSERT INTO cloud_file_chunks (file_id, seq, data) VALUES (?, ?, ?)").bind(fileId, seq, b64.slice(i, i + CH)));
    if (inserts.length >= 50) { await db.batch(inserts); inserts.length = 0; }
  }
  if (inserts.length) await db.batch(inserts);
  return "d1:" + shard;
}

// 读取云文件二进制（返回原始字节），按 storage 字段路由
async function loadCloudBytes(env: Env, fileId: string, storage: string | null): Promise<Uint8Array | null> {
  if (storage === "supabase" && sbEnabled(env)) {
    try {
      const url = env.SUPABASE_URL + "/storage/v1/object/" + sbBucket(env) + "/" + sbObjectPath(fileId);
      const res = await fetch(url, { headers: sbHeaders(env) });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      console.error("Supabase 读取失败：", e);
      return null;
    }
  }
  // D1 分片：storage 形如 "d1:N" 表示从第 N 个分片库读；历史 "d1" 走主库（兼容旧数据）
  let db = env.DB;
  if (storage && storage.startsWith("d1:")) {
    const s = parseInt(storage.split(":")[1], 10);
    if (!isNaN(s)) db = shardDB(env, s);
  }
  const { results } = await db.prepare("SELECT data FROM cloud_file_chunks WHERE file_id = ? ORDER BY seq ASC").bind(fileId).all<{ data: string }>();
  const b64 = (results || []).map((r) => r.data).join("");
  if (!b64) return null;
  return base64ToBytes(b64);
}

// 删除云文件二进制
// 删除云文件二进制（按 storage 路由到正确的后端 / 分片库）
async function deleteCloudBytes(env: Env, fileId: string, storage: string | null): Promise<void> {
  if (storage === "supabase" && sbEnabled(env)) {
    try {
      const url = env.SUPABASE_URL + "/storage/v1/object/" + sbBucket(env) + "/" + sbObjectPath(fileId);
      await fetch(url, { method: "DELETE", headers: sbHeaders(env) });
    } catch (e) {
      console.error("Supabase 删除失败：", e);
    }
  }
  // D1 分片：storage 形如 "d1:N" 表示从第 N 个分片库删；历史 "d1" 走主库（兼容旧数据）
  let db = env.DB;
  if (storage && storage.startsWith("d1:")) {
    const s = parseInt(storage.split(":")[1], 10);
    if (!isNaN(s)) db = shardDB(env, s);
  }
  await db.prepare("DELETE FROM cloud_file_chunks WHERE file_id = ?").bind(fileId).run();
}

async function handleCloudFile(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const id = (new URL(request.url).searchParams.get("id") || "").trim();
  if (!id) return json({ error: "缺少文件" }, 400);
  const f = await env.DB.prepare("SELECT id, name, size, mime, storage FROM cloud_files WHERE id = ? AND owner = ?")
    .bind(id, user.username).first<{ id: string; name: string; size: number; mime: string | null; storage: string | null }>();
  if (!f) return json({ error: "文件不存在或不属于你" }, 404);
  const bytes = await loadCloudBytes(env, id, f.storage);
  if (!bytes) return json({ error: "文件数据已丢失" }, 410);
  // 直接返回原始二进制。
  // 早期版本这里返回 JSON {id,name,size,mime,data(base64)}，而前端下载用的是
  // r.blob() —— 浏览器会把整段 JSON 当成文件内容保存，于是图片/视频/Word 全部损坏。
  const safeName = (f.name || "file").replace(/[\r\n"]/g, "_");
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": f.mime || "application/octet-stream",
      "content-disposition": "attachment; filename=\"" + encodeURIComponent(safeName) + "\"; filename*=UTF-8''" + encodeURIComponent(safeName),
      "content-length": String(bytes.length),
      "cache-control": "no-store"
    }
  });
}

// 取云文件全部字节（base64）：供「转载到群」等场景复用
async function assembleCloudFile(env: Env, owner: string, fileId: string): Promise<string | null> {
  const f = await env.DB.prepare("SELECT id, storage FROM cloud_files WHERE id = ? AND owner = ?")
    .bind(fileId, owner).first<{ id: string; storage: string | null }>();
  if (!f) return null;
  const bytes = await loadCloudBytes(env, fileId, f.storage);
  return bytes ? bytesToBase64(bytes) : null;
}

async function handleCloudDelete(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { id?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.id || "").trim();
  const f = await env.DB.prepare("SELECT id, storage FROM cloud_files WHERE id = ? AND owner = ?")
    .bind(id, user.username).first<{ id: string; storage: string | null }>();
  if (!f) return json({ error: "文件不存在" }, 404);
  await deleteCloudBytes(env, id, f.storage);
  await env.DB.prepare("DELETE FROM cloud_files WHERE id = ? AND owner = ?").bind(id, user.username).run();
  pgFire(pgDelete(env, id));
  const used = await sumCloudUsed(env, user.username);
  await env.DB.prepare("UPDATE cloud_subs SET used_mb = ? WHERE username = ?").bind(used / (1024 * 1024), user.username).run();
  return json({ ok: true, ...(await cloudStatus(env, user)) });
}

async function handleCloudUnsub(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  if (user.role === "root-admin") return json({ error: "Root-Admin 云空间为免费永久，不可退订" }, 400);
  let body: { mb?: number };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const sub = await getCloudSub(env, user.username);
  if (!sub) return json({ error: "你还没有云空间" }, 400);
  const removeMb = Math.floor(Number(body.mb) || 0);
  const fullUnsub = removeMb <= 0 || removeMb >= sub.total_mb;
  if (fullUnsub) {
    const { results: all } = await env.DB.prepare("SELECT id, storage FROM cloud_files WHERE owner = ?").bind(user.username).all<{ id: string; storage: string | null }>();
    for (const f of (all || [])) await deleteCloudBytes(env, f.id, f.storage);
    await env.DB.prepare("DELETE FROM cloud_files WHERE owner = ?").bind(user.username).run();
    pgFire(pgDeleteOwner(env, user.username));
    await env.DB.prepare("DELETE FROM cloud_subs WHERE username = ?").bind(user.username).run();
    return json({ ok: true, unsubbed: "all", ...(await cloudStatus(env, user)) });
  }
  // 按 MB 退订：从最旧文件开始删，释放 >= removeMb MB
  let toFree = removeMb * 1024 * 1024;
  const { results } = await env.DB.prepare("SELECT id, size, storage FROM cloud_files WHERE owner = ? ORDER BY created_at ASC")
    .bind(user.username).all<{ id: string; size: number; storage: string | null }>();
  const removedIds: string[] = [];
  for (const f of (results || [])) {
    if (toFree <= 0) break;
    await deleteCloudBytes(env, f.id, f.storage);
    await env.DB.prepare("DELETE FROM cloud_files WHERE id = ? AND owner = ?").bind(f.id, user.username).run();
    removedIds.push(f.id);
    toFree -= f.size;
  }
  if (removedIds.length) pgFire(Promise.all(removedIds.map((fid) => pgDelete(env, fid))));
  const newTotal = Math.max(0, sub.total_mb - removeMb);
  await env.DB.prepare("UPDATE cloud_subs SET total_mb = ?, used_mb = (SELECT COALESCE(SUM(size),0)/(1024*1024) FROM cloud_files WHERE owner = ?) WHERE username = ?")
    .bind(newTotal, user.username, user.username).run();
  return json({ ok: true, unsubbedMb: removeMb, ...(await cloudStatus(env, user)) });
}

async function handleCloudPurge(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  if (user.role === "root-admin") return json({ error: "Root-Admin 云空间为免费永久，不可清除" }, 400);
  // 逐个删除后端对象（Supabase / D1），再清元数据
  const { results } = await env.DB.prepare("SELECT id, storage FROM cloud_files WHERE owner = ?").bind(user.username).all<{ id: string; storage: string | null }>();
  for (const row of (results || [])) {
    await deleteCloudBytes(env, row.id, row.storage);
  }
  await env.DB.prepare("DELETE FROM cloud_files WHERE owner = ?").bind(user.username).run();
  pgFire(pgDeleteOwner(env, user.username));
  await env.DB.prepare("DELETE FROM cloud_subs WHERE username = ?").bind(user.username).run();
  return json({ ok: true });
}

// ===== 云存储：上传（免费） / 转载（按正常发送价扣费） / 自动续费开关 =====
function fmtMB(n: number): string { return (n / (1024 * 1024)).toFixed(1); }

async function handleCloudUpload(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const url = new URL(request.url);
  const name = (url.searchParams.get("name") || "file").slice(0, 200);
  const mime = (url.searchParams.get("mime") || "application/octet-stream").slice(0, 200);
  let buf: ArrayBuffer;
  try { buf = await request.arrayBuffer(); } catch { return json({ error: "读取文件失败" }, 400); }
  const size = buf.byteLength;
  if (size <= 0) return json({ error: "空文件" }, 400);
  const isRA = user.role === "root-admin";
  let quotaMb = 0;
  if (isRA) quotaMb = RA_CLOUD_MB;
  else { const sub = await getCloudSub(env, user.username); quotaMb = sub ? sub.total_mb : 0; }
  if (quotaMb <= 0) return json({ error: "你还没有云空间，请先购买" }, 409);
  const used = await sumCloudUsed(env, user.username);
  const quotaBytes = quotaMb * 1024 * 1024;
  if (used + size > quotaBytes) {
    return json({ error: "云空间不足：已用 " + fmtMB(used) + "MB / 总额 " + quotaMb + "MB，本文件 " + fmtMB(size) + "MB 放不下" }, 409);
  }
  // 二进制优先落 Supabase Storage（不占 D1）；失败则降级为 D1 分片
  const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = new Date().toISOString();
  const forceD1 = isRA && used >= 1024 * 1024 * 1024; // RA 已用超 1GB → 溢出到 D1 分片
  const storage = await storeCloudBytes(env, id, new Uint8Array(buf), mime, forceD1);
  await env.DB.prepare("INSERT INTO cloud_files (id, owner, name, size, mime, data, storage, created_at) VALUES (?, ?, ?, ?, ?, '', ?, ?)")
    .bind(id, user.username, name, size, mime, storage, now).run();
  pgFire(pgUpsert(env, { id, owner: user.username, name, size, mime, storage, created_at: now }));
  await env.DB.prepare("UPDATE cloud_subs SET used_mb = ? WHERE username = ?").bind((used + size) / (1024 * 1024), user.username).run();
  return json({ ok: true, ...(await cloudStatus(env, user)) });
}

async function handleCloudRepost(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { fileId?: string; room?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const fileId = (body.fileId || "").trim();
  const room = (body.room || "").trim();
  if (!fileId || !room) return json({ error: "缺少文件或目标群聊" }, 400);
  if (!(await isMember(env.DB, room, user.username))) return json({ error: "你不是该房间成员" }, 403);
  const f = await env.DB.prepare("SELECT id, name, size, mime FROM cloud_files WHERE id = ? AND owner = ?")
    .bind(fileId, user.username).first<{ id: string; name: string; size: number; mime: string | null }>();
  if (!f) return json({ error: "云文件不存在或不属于你" }, 404);
  if (f.size > CHAT_FILE_CAP) {
    return json({ error: "该文件 " + fmtMB(f.size) + "MB 超过聊天文件单文件上限 " + (CHAT_FILE_CAP / (1024 * 1024)) + "MB，无法转载" }, 413);
  }
  // 转载按目标群的文件发送/下载计费标准扣费（群主可自定义倍率）
  const rates = await roomRates(env, room);
  const cost = fileFeeFor(f.size, rates.fileRate);
  const bal = await pointsOf(env, user.username);
  if (bal < cost) return json({ error: "Credits 不足：转载需 " + cost + " Credits（每MB " + rates.fileRate + "Credits）", balance: bal }, 402);
  if (cost > 0) {
    await spendCredits(env, user.username, cost);
    await logCredits(env, user.username, -cost, "云文件转载");
  }
  const b64 = await assembleCloudFile(env, user.username, fileId);
  if (b64 === null) return json({ error: "云文件数据缺失" }, 404);
  const newId = "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO chat_files (id, room, sender, name, size, mime, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(newId, room, user.username, f.name, f.size, f.mime, b64, now).run();
  const marker = JSON.stringify({ __file: 1, id: newId, name: f.name, size: f.size, mime: f.mime });
  await env.DB.prepare("INSERT INTO messages (room, sender, role, text, ts) VALUES (?, ?, ?, ?, ?)")
    .bind(room, user.username, user.role, marker, now).run();
  await purgeOldMessages(env);
  // 实时广播给房间成员（客户端 appendMsg 会把它渲染成文件卡片）
  try {
    const roomId = env.ROOM.idFromName("main");
    const dobj = env.ROOM.get(roomId);
    await dobj.fetch(new Request("http://do/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "msg", sender: user.username, role: user.role, text: marker, ts: now, room })
    }));
  } catch {}
  return json({ ok: true, cost, ...(await cloudStatus(env, user)) });
}

// ===== ZIP 工具：把内存中的文件字节（压缩结果 / 解压缓存区单文件）转载到某个可发言群聊 =====
// 计费按目标群的文件发送/下载标准（群主可自定义倍率）；二进制 body 避免 base64 JSON 膨胀。
async function handleZipRepost(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const url = new URL(request.url);
  const room = (url.searchParams.get("room") || "").trim();
  const name = (url.searchParams.get("name") || "file.zip").slice(0, 200);
  const mime = (url.searchParams.get("mime") || "application/octet-stream").slice(0, 200);
  if (!room) return json({ error: "缺少目标群聊" }, 400);
  if (!(await isMember(env.DB, room, user.username))) return json({ error: "你不是该房间成员" }, 403);
  // 与群聊发言/上传同一套可发言权限
  if (room === "geek" && user.role !== "root-admin") return json({ error: "Geek公告群仅 Root-Admin 可发布内容" }, 403);
  if (user.role === "observer" && room !== "dm:" + user.username) return json({ error: "观测者只能在「与 Root-Admin 的私聊」里发送" }, 403);
  let buf: ArrayBuffer;
  try { buf = await request.arrayBuffer(); } catch { return json({ error: "读取文件失败" }, 400); }
  const size = buf.byteLength;
  if (size <= 0) return json({ error: "空文件" }, 400);
  if (size > CHAT_FILE_CAP) {
    return json({ error: "该文件 " + fmtMB(size) + "MB 超过聊天文件单文件上限 " + (CHAT_FILE_CAP / (1024 * 1024)) + "MB，无法转载到群聊" }, 413);
  }
  const rates = await roomRates(env, room);
  const cost = fileFeeFor(size, rates.fileRate);
  const bal = await pointsOf(env, user.username);
  if (bal < cost) return json({ error: "Credits 不足：转载需 " + cost + " Credits（每MB " + rates.fileRate + "Credits）", balance: bal }, 402);
  const b64 = bytesToBase64(new Uint8Array(buf));
  const newId = "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = new Date().toISOString();
  if (cost > 0) {
    await spendCredits(env, user.username, cost);
    await logCredits(env, user.username, -cost, "ZIP工具文件转载到群聊");
  }
  await env.DB.prepare("INSERT INTO chat_files (id, room, sender, name, size, mime, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(newId, room, user.username, name, size, mime, b64, now).run();
  const marker = JSON.stringify({ __file: 1, id: newId, name: name, size: size, mime: mime });
  await env.DB.prepare("INSERT INTO messages (room, sender, role, text, ts) VALUES (?, ?, ?, ?, ?)")
    .bind(room, user.username, user.role, marker, now).run();
  await purgeOldMessages(env);
  try {
    const roomId = env.ROOM.idFromName("main");
    const dobj = env.ROOM.get(roomId);
    await dobj.fetch(new Request("http://do/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "msg", sender: user.username, role: user.role, text: marker, ts: now, room })
    }));
  } catch {}
  return json({ ok: true, cost, fileRate: rates.fileRate });
}

async function handleCloudRenew(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  if (user.role === "root-admin") return json({ error: "Root-Admin 云空间为免费永久" }, 400);
  // 自动续费为强制开启项，用户不可调整；本接口只做状态同步（始终写回 1）
  try { await request.json(); } catch {}
  const sub = await getCloudSub(env, user.username);
  if (!sub) return json({ error: "你还没有云空间" }, 400);
  await env.DB.prepare("UPDATE cloud_subs SET auto_renew = 1 WHERE username = ?").bind(user.username).run();
  return json({ ok: true, autoRenew: true, ...(await cloudStatus(env, user)) });
}

// ========== 成员信息（仅 Admin：查看归属于自己的用户）==========
async function handleAdminMembers(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  if (user.role !== "admin") return json({ error: "仅管理员可查看成员信息" }, 403);
  await ensureSchema(env);
  const { results } = await env.DB.prepare(
    "SELECT username, role, points, created_at FROM accounts WHERE belongs_to = ? ORDER BY created_at"
  ).bind(user.username).all<{ username: string; role: string; points: number; created_at: string }>();
  return json({ members: results || [], admin: user.username });
}

// ========== 找回密码代码 ==========
// 派发：Admin 需「需要者用户名 + 自己的账户密码」且目标必须归属自己；RA 只需用户名。
// 代码只在本次响应里完整出现一次，之后任何接口都不再返回；使用后删除记录，仅日志留痕。
async function handleRecoverIssue(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  if (user.role !== "admin" && user.role !== "root-admin") return json({ error: "仅 Admin / Root-Admin 可派发" }, 403);
  let body: { username?: string; password?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const target = (body.username || "").trim();
  if (!target) return json({ error: "请填写需要者的用户名" }, 400);
  await ensureSchema(env);
  const row = await env.DB.prepare("SELECT username, belongs_to FROM accounts WHERE username = ?").bind(target).first<any>();
  if (!row) return json({ error: "该用户名不存在" }, 404);
  if (user.role === "admin") {
    const pwd = body.password || "";
    if (!pwd) return json({ error: "请输入管理员账户密码" }, 400);
    if (!(await verifyAccountPassword(env, user.username, pwd))) return json({ error: "管理员密码错误" }, 401);
    if (row.belongs_to !== user.username) return json({ error: "该用户不归属于你，无法派发" }, 403);
  }
  const code = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RECOVER_TTL_MS).toISOString();
  await env.DB.prepare("INSERT INTO recover_codes (code, username, issued_by, expires_at, created_at) VALUES (?,?,?,?,?)")
    .bind(code, target, user.username, expiresAt, now.toISOString()).run();
  await writeAdminLog(env, user.username, "recover_issue", "为 " + target + " 派发找回代码（35 分钟有效）");
  return json({ ok: true, code, username: target, expiresAt });
}

// 使用：免登录（用户可能已忘记密码），代码 + 用户名 + 新密码 + 确认新密码
async function handleRecoverReset(request: Request, env: Env): Promise<Response> {
  let body: { code?: string; username?: string; newPassword?: string; confirmPassword?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const code = (body.code || "").trim();
  const username = (body.username || "").trim();
  const np = body.newPassword || "";
  const cp = body.confirmPassword || "";
  if (!code || !username) return json({ error: "找回代码和用户名都要填" }, 400);
  if (np !== cp) return json({ error: "两次输入的新密码不一致" }, 400);
  const invalid = validateCredentials(username, np);
  if (invalid) return json({ error: invalid }, 400);
  await ensureSchema(env);
  const row = await env.DB.prepare("SELECT * FROM recover_codes WHERE code = ?").bind(code).first<any>();
  if (!row) return json({ error: "找回代码无效或已被使用" }, 404);
  if (row.username !== username) return json({ error: "找回代码与用户名不匹配" }, 403);
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare("DELETE FROM recover_codes WHERE code = ?").bind(code).run();
    return json({ error: "找回代码已过期（固定 35 分钟）" }, 410);
  }
  const salt = randomSalt();
  const newHash = await hashPassword(np, salt.buffer as ArrayBuffer);
  const upd = await env.DB.prepare("UPDATE accounts SET pass_hash = ?, salt = ? WHERE username = ?")
    .bind(newHash, toHex(salt.buffer as ArrayBuffer), username).run();
  const changed = (upd as any).meta && (upd as any).meta.changes;
  if (changed === 0) return json({ error: "账号不存在" }, 404);
  // 用后只删除这一条：其余地方不留痕，只在日志留痕（不影响同用户的其它有效代码）
  await env.DB.prepare("DELETE FROM recover_codes WHERE code = ?").bind(code).run();
  await writeAdminLog(env, row.issued_by, "recover_used", username + " 使用找回代码重置了密码");
  return json({ ok: true, username });
}

// ========== 云空间 7 天试用活动 ==========
// 与主空间彻底隔离：独立的表 + 独立的 Storage 路径前缀，绝不碰 cloud_files。
const TRIAL_SB_PREFIX = "trial/";

async function storeTrialBytes(env: Env, fileId: string, bytes: Uint8Array, mime: string): Promise<string> {
  if (sbEnabled(env)) {
    try {
      const url = env.SUPABASE_URL + "/storage/v1/object/" + sbBucket(env) + "/" + TRIAL_SB_PREFIX + fileId;
      const res = await fetch(url, { method: "POST",
        headers: sbHeaders(env, { "Content-Type": mime || "application/octet-stream", "x-upsert": "true" }),
        body: bytes as unknown as BodyInit });
      if (res.ok) return "supabase";
    } catch (e) { console.error("试用文件写 Supabase 失败，降级 D1：", e); }
  }
  const b64 = bytesToBase64(bytes);
  const CH = 60000; const inserts: any[] = [];
  for (let i = 0, seq = 1; i < b64.length; i += CH, seq++) {
    inserts.push(env.DB.prepare("INSERT INTO cloud_trial_chunks (file_id, seq, data) VALUES (?, ?, ?)").bind(fileId, seq, b64.slice(i, i + CH)));
    if (inserts.length >= 100) { await env.DB.batch(inserts); inserts.length = 0; }
  }
  if (inserts.length) await env.DB.batch(inserts);
  return "d1";
}

async function loadTrialBytes(env: Env, fileId: string, storage: string | null): Promise<Uint8Array | null> {
  if (storage === "supabase" && sbEnabled(env)) {
    try {
      const url = env.SUPABASE_URL + "/storage/v1/object/" + sbBucket(env) + "/" + TRIAL_SB_PREFIX + fileId;
      const res = await fetch(url, { headers: sbHeaders(env) });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) { return null; }
  }
  const { results } = await env.DB.prepare("SELECT data FROM cloud_trial_chunks WHERE file_id = ? ORDER BY seq ASC")
    .bind(fileId).all<{ data: string }>();
  const b64 = (results || []).map((r) => r.data).join("");
  return b64 ? base64ToBytes(b64) : null;
}

async function deleteTrialFile(env: Env, id: string, storage: string | null): Promise<void> {
  if (storage === "supabase" && sbEnabled(env)) {
    try {
      const url = env.SUPABASE_URL + "/storage/v1/object/" + sbBucket(env) + "/" + TRIAL_SB_PREFIX + id;
      await fetch(url, { method: "DELETE", headers: sbHeaders(env) });
    } catch (e) { console.error("试用文件删除失败：", e); }
  }
  await env.DB.prepare("DELETE FROM cloud_trial_chunks WHERE file_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM cloud_trial_files WHERE id = ?").bind(id).run();
}

function trialWindowOpen(): boolean {
  const n = Date.now();
  return n >= TRIAL_START_MS && n < TRIAL_END_MS;
}

async function trialStatus(env: Env, username: string): Promise<any> {
  const now = Date.now();
  const open = trialWindowOpen();
  const row = await env.DB.prepare("SELECT * FROM cloud_trials WHERE username = ?").bind(username).first<any>();
  let files: any[] = [];
  if (row) {
    const { results } = await env.DB.prepare(
      "SELECT id, name, size, mime, created_at FROM cloud_trial_files WHERE owner = ? ORDER BY created_at ASC"
    ).bind(username).all<any>();
    files = (results || []).map((r) => ({ id: r.id, name: r.name, size: r.size, mime: r.mime, createdAt: r.created_at }));
  }
  const expMs = row && row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const expired = !!row && expMs <= now;
  return {
    open, now, startMs: TRIAL_START_MS, endMs: TRIAL_END_MS,
    trialMb: TRIAL_MB, trialDays: TRIAL_DAYS,
    beijingTime: new Date(now + 8 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19),
    trial: row ? {
      totalMb: row.total_mb, usedMb: row.used_mb,
      startsAt: row.starts_at, expiresAt: row.expires_at,
      expired, reclaimPending: expired && files.length > 0
    } : null,
    files, reclaimPending: !!row && expired && files.length > 0
  };
}

async function handleTrialStatus(request: Request, env: Env): Promise<Response> {
  await ensureSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  return json(await trialStatus(env, user.username));
}

async function handleTrialClaim(request: Request, env: Env): Promise<Response> {
  await ensureSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  if (!trialWindowOpen()) return json({ error: "活动未开始或已结束（北京时间 2026/11/07 16:00 ~ 2026/12/14 16:00）" }, 409);
  // 必须手动申请且输入本账号密码确认是本人操作
  let claimBody: { password?: string };
  try { claimBody = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const pwd = claimBody.password || "";
  if (!pwd) return json({ error: "请输入本账号密码以确认是本人操作" }, 400);
  if (!(await verifyAccountPassword(env, user.username, pwd))) return json({ error: "密码错误，申请未生效" }, 401);
  const exists = await env.DB.prepare("SELECT username FROM cloud_trials WHERE username = ?").bind(user.username).first();
  if (exists) return json({ error: "每账号限申请一次 5MB 试用空间" }, 409);
  const now = new Date();
  const exp = new Date(now.getTime() + TRIAL_DAYS * 24 * 3600 * 1000);
  await env.DB.prepare(
    "INSERT INTO cloud_trials (username, total_mb, used_mb, starts_at, expires_at, reclaim_pending, created_at) VALUES (?, ?, 0, ?, ?, 0, ?)"
  ).bind(user.username, TRIAL_MB, now.toISOString(), exp.toISOString(), now.toISOString()).run();
  await logCredits(env, user.username, 0, "申请 5MB 云空间 7 天试用");
  return json({ ok: true, ...(await trialStatus(env, user.username)) });
}

async function handleTrialUpload(request: Request, env: Env): Promise<Response> {
  await ensureSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const t = await env.DB.prepare("SELECT * FROM cloud_trials WHERE username = ?").bind(user.username).first<any>();
  if (!t) return json({ error: "你还没有申请试用空间" }, 409);
  if (new Date(t.expires_at).getTime() <= Date.now()) return json({ error: "试用期已结束" }, 409);
  const url = new URL(request.url);
  const name = (url.searchParams.get("name") || "file").slice(0, 200);
  const mime = (url.searchParams.get("mime") || "application/octet-stream").slice(0, 200);
  let buf: ArrayBuffer;
  try { buf = await request.arrayBuffer(); } catch { return json({ error: "读取文件失败" }, 400); }
  const size = buf.byteLength;
  if (size <= 0) return json({ error: "空文件" }, 400);
  const used = await env.DB.prepare("SELECT COALESCE(SUM(size),0) AS n FROM cloud_trial_files WHERE owner = ?")
    .bind(user.username).first<{ n: number }>();
  const usedBytes = used ? used.n : 0;
  if (usedBytes + size > TRIAL_MB * 1024 * 1024) {
    return json({ error: "试用空间不足：已用 " + fmtMB(usedBytes) + "MB / 共 " + TRIAL_MB + "MB" }, 409);
  }
  const id = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const storage = await storeTrialBytes(env, id, new Uint8Array(buf), mime);
  await env.DB.prepare("INSERT INTO cloud_trial_files (id, owner, name, size, mime, data, storage, created_at) VALUES (?, ?, ?, ?, ?, '', ?, ?)")
    .bind(id, user.username, name, size, mime, storage, new Date().toISOString()).run();
  await env.DB.prepare("UPDATE cloud_trials SET used_mb = ? WHERE username = ?")
    .bind((usedBytes + size) / (1024 * 1024), user.username).run();
  return json({ ok: true, id, ...(await trialStatus(env, user.username)) });
}

async function handleTrialFile(request: Request, env: Env): Promise<Response> {
  await ensureSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const id = (new URL(request.url).searchParams.get("id") || "").trim();
  if (!id) return json({ error: "缺少文件" }, 400);
  const f = await env.DB.prepare("SELECT id, name, size, mime, storage FROM cloud_trial_files WHERE id = ? AND owner = ?")
    .bind(id, user.username).first<any>();
  if (!f) return json({ error: "文件不存在或不属于你" }, 404);
  const bytes = await loadTrialBytes(env, id, f.storage);
  if (!bytes) return json({ error: "文件数据已丢失" }, 410);
  const safeName = (f.name || "file").replace(/[\r\n"]/g, "_");
  return new Response(bytes as unknown as BodyInit, { headers: {
    "content-type": f.mime || "application/octet-stream",
    "content-disposition": "attachment; filename=\"" + encodeURIComponent(safeName) + "\"; filename*=UTF-8''" + encodeURIComponent(safeName),
    "content-length": String(bytes.length), "cache-control": "no-store"
  } });
}

async function handleTrialDelete(request: Request, env: Env): Promise<Response> {
  await ensureSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { id?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.id || "").trim();
  const f = await env.DB.prepare("SELECT id, storage FROM cloud_trial_files WHERE id = ? AND owner = ?").bind(id, user.username).first<any>();
  if (!f) return json({ error: "文件不存在" }, 404);
  await deleteTrialFile(env, id, f.storage);
  const used = await env.DB.prepare("SELECT COALESCE(SUM(size),0) AS n FROM cloud_trial_files WHERE owner = ?").bind(user.username).first<{ n: number }>();
  await env.DB.prepare("UPDATE cloud_trials SET used_mb = ? WHERE username = ?").bind((used ? used.n : 0) / (1024 * 1024), user.username).run();
  return json({ ok: true, ...(await trialStatus(env, user.username)) });
}

// 试用期结束：前端把所有文件下载到本机并确认落盘后，才调用本接口收回空间。
// 只删「确认已下载」的文件；还有没下载成功的就留着，等前端重试，绝不丢文件。
async function handleTrialFinish(request: Request, env: Env): Promise<Response> {
  await ensureSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { downloadedIds?: string[] };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const ids = Array.isArray(body.downloadedIds) ? body.downloadedIds.slice(0, 200) : [];
  for (const id of ids) {
    const f = await env.DB.prepare("SELECT id, storage FROM cloud_trial_files WHERE id = ? AND owner = ?").bind(id, user.username).first<any>();
    if (f) await deleteTrialFile(env, f.id, f.storage);
  }
  const rest = await env.DB.prepare("SELECT COUNT(*) AS n FROM cloud_trial_files WHERE owner = ?").bind(user.username).first<{ n: number }>();
  const remaining = rest ? rest.n : 0;
  if (remaining === 0) {
    await env.DB.prepare("DELETE FROM cloud_trials WHERE username = ?").bind(user.username).run();
    await logCredits(env, user.username, 0, "试用期结束，文件已下载本机，收回 5MB 试用空间");
  }
  return json({ ok: true, remaining, reclaimed: remaining === 0, ...(await trialStatus(env, user.username)) });
}

// 主空间到期未续费：前端把文件全部下载到本机确认落盘后，才收回空间（只删已下载的）
async function handleCloudReclaimDone(request: Request, env: Env): Promise<Response> {
  await ensureSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { downloadedIds?: string[] };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const ids = Array.isArray(body.downloadedIds) ? body.downloadedIds.slice(0, 500) : [];
  const reclaimedIds: string[] = [];
  for (const id of ids) {
    const f = await env.DB.prepare("SELECT id, storage FROM cloud_files WHERE id = ? AND owner = ?").bind(id, user.username).first<any>();
    if (f) {
      await deleteCloudBytes(env, f.id, f.storage);
      await env.DB.prepare("DELETE FROM cloud_files WHERE id = ?").bind(f.id).run();
      reclaimedIds.push(f.id);
    }
  }
  if (reclaimedIds.length) pgFire(Promise.all(reclaimedIds.map((fid) => pgDelete(env, fid))));
  const rest = await env.DB.prepare("SELECT COUNT(*) AS n FROM cloud_files WHERE owner = ?").bind(user.username).first<{ n: number }>();
  const remaining = rest ? rest.n : 0;
  if (remaining === 0) {
    await env.DB.prepare("DELETE FROM cloud_subs WHERE username = ?").bind(user.username).run();
    await logCredits(env, user.username, 0, "到期未续费，文件已下载本机，收回云空间");
  }
  return json({ ok: true, remaining, reclaimed: remaining === 0 });
}

// ========== 文件资源商店 ==========
// 规则：任何人可上架文件并自由标价；买家付款时从买家积分扣除总价，
// 其中 5% 作为平台手续费（不进入卖家口袋），其余 95% 进入卖家积分。
const MARKET_FEE_RATE = 0.05;          // 平台手续费 5%
const MARKET_MAX_PRICE = 100000;       // 单件最高标价（Credits）
const MARKET_FILE_CAP = 20 * 1024 * 1024; // 单文件上限 20MB（与云存储一致）

// 商品文件二进制：优先 Supabase（与云存储同桶，路径前缀 market/），失败降级 D1 分片
const MARKET_SB_PREFIX = "market/";

async function storeMarketBytes(env: Env, itemId: string, bytes: Uint8Array, mime: string): Promise<string> {
  if (sbEnabled(env)) {
    try {
      const url = env.SUPABASE_URL + "/storage/v1/object/" + sbBucket(env) + "/" + MARKET_SB_PREFIX + itemId;
      const res = await fetch(url, {
        method: "POST",
        headers: sbHeaders(env, { "Content-Type": mime || "application/octet-stream", "x-upsert": "true" }),
        body: bytes as unknown as BodyInit
      });
      if (res.ok) return "supabase";
    } catch (e) {
      console.error("市场文件上传 Supabase 失败，降级 D1：", e);
    }
  }
  const b64 = bytesToBase64(bytes);
  const CH = 60000;
  const inserts: any[] = [];
  for (let i = 0, seq = 1; i < b64.length; i += CH, seq++) {
    inserts.push(env.DB.prepare("INSERT INTO market_files (file_id, seq, data) VALUES (?, ?, ?)").bind(itemId, seq, b64.slice(i, i + CH)));
    if (inserts.length >= 100) { await env.DB.batch(inserts); inserts.length = 0; }
  }
  if (inserts.length) await env.DB.batch(inserts);
  return "d1";
}

async function loadMarketBytes(env: Env, itemId: string, storage: string | null): Promise<Uint8Array | null> {
  if (storage === "supabase" && sbEnabled(env)) {
    try {
      const url = env.SUPABASE_URL + "/storage/v1/object/" + sbBucket(env) + "/" + MARKET_SB_PREFIX + itemId;
      const res = await fetch(url, { headers: sbHeaders(env) });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      console.error("市场文件读取 Supabase 失败：", e);
      return null;
    }
  }
  const { results } = await env.DB.prepare("SELECT data FROM market_files WHERE file_id = ? ORDER BY seq ASC")
    .bind(itemId).all<{ data: string }>();
  const b64 = (results || []).map((r) => r.data).join("");
  if (!b64) return null;
  return base64ToBytes(b64);
}

async function deleteMarketBytes(env: Env, itemId: string, storage: string | null): Promise<void> {
  if (storage === "supabase" && sbEnabled(env)) {
    try {
      const url = env.SUPABASE_URL + "/storage/v1/object/" + sbBucket(env) + "/" + MARKET_SB_PREFIX + itemId;
      await fetch(url, { method: "DELETE", headers: sbHeaders(env) });
    } catch (e) {
      console.error("市场文件删除失败：", e);
    }
  }
  await env.DB.prepare("DELETE FROM market_files WHERE file_id = ?").bind(itemId).run();
}

// 多份售卖清理：仅当「已售罄 且 没有尚未确认落盘的下载交付订单」时才删除后端文件与商品行。
// 否则必须保留文件——可能还有份数未售出，或别的买家的下载交付还没完成。
async function cleanupMarketItemIfDone(env: Env, id: string, storage: string | null): Promise<void> {
  const after = await env.DB.prepare("SELECT copies_sold, copies_total FROM market_items WHERE id = ?").bind(id).first<{ copies_sold: number; copies_total: number }>();
  if (!after) return;                                  // 已删除
  if (after.copies_sold < after.copies_total) return;   // 还有份数未售
  const pend = await env.DB.prepare("SELECT COUNT(*) AS n FROM market_orders WHERE item_id = ? AND deliver = 'download' AND done = 0").bind(id).first<{ n: number }>();
  if (pend && pend.n > 0) return;                      // 下载交付尚未确认落盘
  await deleteMarketBytes(env, id, storage);
  await env.DB.prepare("DELETE FROM market_items WHERE id = ?").bind(id).run();
}

// 商品列表：在售 + 我卖出的
async function handleMarketList(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  // 只返回在售商品（copies_sold < copies_total 即在售；全部卖完且后端文件清理后才删除）
  const { results } = await env.DB.prepare(
    "SELECT id, seller, name, size, mime, desc, price, kind, copies_total, copies_sold, created_at FROM market_items WHERE copies_sold < copies_total ORDER BY created_at DESC LIMIT 100"
  ).all<any>();
  const items = (results || []).map((r) => {
    const total = r.copies_total || 1;
    const sold = r.copies_sold || 0;
    return {
      id: r.id, seller: r.seller, name: r.name, size: r.size, mime: r.mime,
      desc: r.desc, price: r.price, kind: r.kind || "file",
      copiesTotal: total, copiesSold: sold, remaining: total - sold,
      sold: false, mine: r.seller === user.username
    };
  });
  // 我买过的 / 我卖出的（成交记录）
  let orders: any[] = [];
  try {
    const { results: or } = await env.DB.prepare(
      "SELECT id, item_id, seller, buyer, name, size, price, fee, payout, delivered_id, created_at FROM market_orders WHERE buyer = ? OR seller = ? ORDER BY created_at DESC LIMIT 50"
    ).bind(user.username, user.username).all<any>();
    orders = (or || []).map((r) => ({
      id: r.id, itemId: r.item_id, seller: r.seller, buyer: r.buyer,
      name: r.name, size: r.size, price: r.price, fee: r.fee, payout: r.payout,
      deliveredId: r.delivered_id, createdAt: r.created_at,
      iBought: r.buyer === user.username, iSold: r.seller === user.username
    }));
  } catch {}
  return json({ items, orders, balance: await pointsOf(env, user.username) });
}

// 上架商品：文件 + 名称 + 描述 + 价格
async function handleMarketUpload(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const url = new URL(request.url);
  const desc = (url.searchParams.get("desc") || "").slice(0, 500);
  const price = Math.floor(Number(url.searchParams.get("price")));
  if (!isFinite(price) || price < 1 || price > MARKET_MAX_PRICE) {
    return json({ error: "标价限 1-" + MARKET_MAX_PRICE + " Credits" }, 400);
  }
  // copies：同一文件上架份数，1~500；每份独立成交、独立收一次手续费
  let copies = Math.floor(Number(url.searchParams.get("copies")));
  if (!isFinite(copies) || copies < 1) copies = 1;
  if (copies > 500) copies = 500;

  // 两种来源：① 直接上传 body（普通文件或浏览器打包好的 ZIP）；② 从本人云存储转载（cloudId，免去重复上传）
  const cloudId = (url.searchParams.get("cloudId") || "").trim();
  let name: string, mime: string, bytes: Uint8Array, kind = "file";
  if (cloudId) {
    const cf = await env.DB.prepare("SELECT id, name, size, mime, storage FROM cloud_files WHERE id = ? AND owner = ?")
      .bind(cloudId, user.username).first<{ id: string; name: string; size: number; mime: string | null; storage: string | null }>();
    if (!cf) return json({ error: "云文件不存在或不属于你" }, 404);
    const cbytes = await loadCloudBytes(env, cloudId, cf.storage);
    if (!cbytes) return json({ error: "云文件数据已丢失" }, 404);
    if (cbytes.length > MARKET_FILE_CAP) {
      return json({ error: "云文件 " + fmtMB(cbytes.length) + "MB 超过商品上限 " + (MARKET_FILE_CAP / (1024 * 1024)) + "MB" }, 413);
    }
    bytes = cbytes;
    name = (cf.name || "file").slice(0, 200);
    mime = (cf.mime || "application/octet-stream").slice(0, 200);
    // 从云转载一律按普通文件上架（文件夹需先在云里打包或逐个上架）
    kind = "file";
  } else {
    name = (url.searchParams.get("name") || "file").slice(0, 200);
    mime = (url.searchParams.get("mime") || "application/octet-stream").slice(0, 200);
    // kind：file=普通文件；zip=整个文件夹打包（由卖家浏览器压缩成 ZIP 后上传）
    kind = url.searchParams.get("kind") === "zip" ? "zip" : "file";
    let buf: ArrayBuffer;
    try { buf = await request.arrayBuffer(); } catch { return json({ error: "读取文件失败" }, 400); }
    if (buf.byteLength <= 0) return json({ error: "空文件" }, 400);
    if (buf.byteLength > MARKET_FILE_CAP) {
      return json({ error: "文件 " + fmtMB(buf.byteLength) + "MB 超过上限 " + (MARKET_FILE_CAP / (1024 * 1024)) + "MB" }, 413);
    }
    bytes = new Uint8Array(buf);
  }
  const size = bytes.length;
  const id = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const storage = await storeMarketBytes(env, id, bytes, mime);
  await env.DB.prepare(
    "INSERT INTO market_items (id, seller, name, size, mime, desc, price, storage, kind, copies_total, copies_sold, sold, buyer, sold_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, ?)"
  ).bind(id, user.username, name, size, mime, desc, price, storage, kind, copies, new Date().toISOString()).run();
  await logCredits(env, user.username, 0, "上架商品 " + name + "（标价 " + price + " Credits · 份数 " + copies + (cloudId ? " · 云转载" : "") + "）");
  return json({ ok: true, id, price, size, kind, copies, balance: await pointsOf(env, user.username) });
}

// 购买：扣买家总价 → 5% 手续费 → 95% 给卖家
async function handleMarketBuy(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { id?: string; deliver?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.id || "").trim();
  if (!id) return json({ error: "缺少商品" }, 400);
  // deliver: cloud = 存入买家云空间；download = 直接下载到本机（文件暂留服务器）
  const deliver = body.deliver === "cloud" ? "cloud" : "download";
  const item = await env.DB.prepare("SELECT * FROM market_items WHERE id = ?").bind(id).first<any>();
  if (!item) return json({ error: "商品不存在" }, 404);
  if (item.copies_sold >= item.copies_total) return json({ error: "该商品已售罄" }, 409);
  if (item.seller === user.username) return json({ error: "不能购买自己上架的商品" }, 400);

  const price = item.price;
  const fee = Math.floor(price * MARKET_FEE_RATE);   // 平台手续费
  const payout = price - fee;                          // 卖家实收

  // 先扣买家（余额不足直接拒绝，不动数据）
  const buyerRow = await env.DB.prepare("SELECT points FROM accounts WHERE username = ?").bind(user.username).first<{ points: number }>();
  if (!buyerRow || buyerRow.points < price) {
    return json({ error: "Credits 不足：需要 " + price + "，当前 " + (buyerRow ? buyerRow.points : 0) }, 409);
  }
  await env.DB.prepare("UPDATE accounts SET points = points - ? WHERE username = ?").bind(price, user.username).run();
  await logCredits(env, user.username, -price, "购买商品 " + item.name);

  // 卖家入账（payout 可能为 0：标价 1-19 Credits 时 5% 舍入后为 0）
  if (payout > 0) {
    await env.DB.prepare("UPDATE accounts SET points = points + ? WHERE username = ?").bind(payout, item.seller).run();
    await logCredits(env, item.seller, payout, "售出商品 " + item.name + "（标价 " + price + "，平台手续费 " + fee + "）");
  } else {
    await logCredits(env, item.seller, 0, "售出商品 " + item.name + "（标价 " + price + "，手续费 " + fee + "，实收 0）");
  }

  // 标记已售（原子自增 + 条件更新防止并发重复售出同一份）
  const upd = await env.DB.prepare(
    "UPDATE market_items SET copies_sold = copies_sold + 1, sold = (CASE WHEN copies_sold + 1 >= copies_total THEN 1 ELSE sold END), buyer = ?, sold_at = ? WHERE id = ? AND copies_sold < copies_total"
  ).bind(user.username, new Date().toISOString(), id).run();
  const changed = (upd as any).meta && (upd as any).meta.changes;
  if (changed === 0) {
    // 并发下被别的买家抢先 —— 回滚本次扣款
    await env.DB.prepare("UPDATE accounts SET points = points + ? WHERE username = ?").bind(price, user.username).run();
    if (payout > 0) await env.DB.prepare("UPDATE accounts SET points = points - ? WHERE username = ?").bind(payout, item.seller).run();
    return json({ error: "该商品刚被其他人买走" }, 409);
  }

  // 成交后按 deliver 处理：
  //   cloud   → 转存到买家的云空间，随即删除商品与后端文件
  //   download → 文件暂留服务器供买家下载（下载完成后再清理）
  let deliveredId = "";
  let bytes: Uint8Array | null = null;
  try {
    bytes = await loadMarketBytes(env, id, item.storage);
  } catch (e) {
    console.error("读取商品文件失败：", e);
  }
  if (deliver === "cloud" && bytes) {
    try {
      deliveredId = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const buyerIsRA = user.role === "root-admin";
      const buyerUsed = await sumCloudUsed(env, user.username);
      const buyerForceD1 = buyerIsRA && buyerUsed >= 1024 * 1024 * 1024;
      const cStorage = await storeCloudBytes(env, deliveredId, bytes, item.mime || "application/octet-stream", buyerForceD1);
      const deliveredAt = new Date().toISOString();
      await env.DB.prepare("INSERT INTO cloud_files (id, owner, name, size, mime, data, storage, created_at) VALUES (?, ?, ?, ?, ?, '', ?, ?)")
        .bind(deliveredId, user.username, item.name, item.size, item.mime, cStorage, deliveredAt).run();
      pgFire(pgUpsert(env, { id: deliveredId, owner: user.username, name: item.name, size: item.size, mime: item.mime, storage: cStorage, created_at: deliveredAt }));
      await env.DB.prepare("UPDATE cloud_subs SET used_mb = used_mb + ? WHERE username = ?")
        .bind(item.size / (1024 * 1024), user.username).run();
    } catch (e) {
      console.error("商品转存到买家云存储失败：", e);
      deliveredId = "";
    }
  }
  // 留档成交记录
  const orderId = "mo" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    await env.DB.prepare(
      "INSERT INTO market_orders (id, item_id, seller, buyer, name, size, mime, price, fee, payout, delivered_id, deliver, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(orderId, id, item.seller, user.username, item.name, item.size, item.mime,
      price, fee, payout, deliveredId || null, deliver, new Date().toISOString()).run();
  } catch {}

  // 成交后统一清理：已售罄且所有下载交付都已落盘，才删除后端文件与商品行；
  // 否则保留（可能还有份数未售，或别的买家的下载交付还没完成）
  await cleanupMarketItemIfDone(env, id, item.storage);

  return json({
    ok: true, price, fee, payout, deliver, orderId,
    delivered: !!deliveredId, deliveredId,
    balance: await pointsOf(env, user.username)
  });
}

// 下架自己的商品（未售出才能下架，退款不涉及——上架不收费）
async function handleMarketRemove(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { id?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.id || "").trim();
  const item = await env.DB.prepare("SELECT * FROM market_items WHERE id = ?").bind(id).first<any>();
  if (!item) return json({ error: "商品不存在" }, 404);
  if (item.seller !== user.username && user.role !== "root-admin") {
    return json({ error: "只能下架自己上架的商品" }, 403);
  }
  if (item.copies_sold > 0) {
    return json({ error: "已有 " + item.copies_sold + " 份售出，无法下架（需等买家全部收齐）" }, 409);
  }
  await deleteMarketBytes(env, id, item.storage);
  await env.DB.prepare("DELETE FROM market_items WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// 下载商品文件：已售出后买家可下载；未售出时任何人可试读（避免买了才发现是坏文件）
async function handleMarketFile(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const id = (new URL(request.url).searchParams.get("id") || "").trim();
  if (!id) return json({ error: "缺少商品" }, 400);
  const item = await env.DB.prepare("SELECT * FROM market_items WHERE id = ?").bind(id).first<any>();
  if (!item) return json({ error: "商品不存在（可能已售出并下架）" }, 404);
  if (item.copies_sold > 0 && item.seller !== user.username) {
    return json({ error: "该商品已售出，暂不能试读" }, 403);
  }
  const bytes = await loadMarketBytes(env, id, item.storage);
  if (!bytes) return json({ error: "文件数据已丢失" }, 410);
  const safeName = (item.name || "file").replace(/[\r\n"]/g, "_");
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": item.mime || "application/octet-stream",
      "content-disposition": "attachment; filename=\"" + encodeURIComponent(safeName) + "\"; filename*=UTF-8''" + encodeURIComponent(safeName),
      "content-length": String(bytes.length),
      "cache-control": "no-store"
    }
  });
}

// 买家确认下载完成 → 清理服务器上的商品文件（deliver=download 场景）
async function handleMarketOrderDone(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { id?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.id || "").trim();
  if (!id) return json({ error: "缺少记录" }, 400);
  const ord = await env.DB.prepare("SELECT * FROM market_orders WHERE id = ?").bind(id).first<any>();
  if (!ord) return json({ ok: true, cleaned: false });
  if (ord.buyer !== user.username) return json({ error: "无权操作" }, 403);
  // 只有 deliver=download 且文件仍在服务器上时才清理：先标记该订单已落盘，再统一判断能否删
  if (!ord.delivered_id && ord.deliver === "download") {
    await env.DB.prepare("UPDATE market_orders SET done = 1 WHERE id = ?").bind(id).run();
    const it = await env.DB.prepare("SELECT id, storage FROM market_items WHERE id = ?").bind(ord.item_id).first<any>();
    if (it) await cleanupMarketItemIfDone(env, it.id, it.storage);
  }
  return json({ ok: true, cleaned: true });
}

// 成交记录里的商品文件：成交时已转存到买家云存储，这里按转存后的 cloud_files 下载
async function handleMarketOrderFile(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const id = (new URL(request.url).searchParams.get("id") || "").trim();
  if (!id) return json({ error: "缺少记录" }, 400);
  const ord = await env.DB.prepare("SELECT * FROM market_orders WHERE id = ?").bind(id).first<any>();
  if (!ord) return json({ error: "记录不存在" }, 404);
  if (ord.buyer !== user.username && ord.seller !== user.username) {
    return json({ error: "无权下载该文件" }, 403);
  }
  // deliver=cloud：文件已在买家云空间里，从 cloud_files 取
  let fileId = ord.delivered_id;
  let storage: string | null = null;
  let name = ord.name;
  let mime = ord.mime;
  if (fileId) {
    const cf = await env.DB.prepare("SELECT id, name, mime, storage FROM cloud_files WHERE id = ? AND owner = ?")
      .bind(ord.delivered_id, ord.buyer).first<any>();
    if (cf) { storage = cf.storage; name = cf.name; mime = cf.mime; }
    else fileId = "";
  }
  // deliver=download：文件仍在商品记录里，从市场后端取
  if (!fileId) {
    const it = await env.DB.prepare("SELECT id, name, mime, storage FROM market_items WHERE id = ?").bind(ord.item_id).first<any>();
    if (!it) return json({ error: "文件已不存在（可能已完成下载并清理）" }, 404);
    fileId = it.id; name = it.name; mime = it.mime; storage = it.storage;
  }
  // 从市场后端取（deliver=download，文件仍在 market_* 里）
  let bytes: Uint8Array | null = null;
  if (fileId && !ord.delivered_id) {
    bytes = await loadMarketBytes(env, fileId, storage);
  } else if (fileId) {
    bytes = await loadCloudBytes(env, fileId, storage);
  }
  if (!bytes) return json({ error: "文件数据已丢失" }, 410);
  return json({ name, mime, size: bytes.length, base64: bytesToBase64(bytes) });
}

async function handleGameCreate(request: Request, env: Env): Promise<Response> {
  // 建房入口已统一收敛到 SHOP（/api/shop/buy），此处不再开放直接创建
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  return json({ error: "房间号请通过 SHOP 购买（支持代购）" }, 403);
}


// ===== SHOP：购买房间号（唯一建房入口）=====
// 游戏引擎已修复并重新开放：消消乐为单人局（直接开房即玩），
// 国际象棋 / 中国象棋为真人对战（开房后把房间号发给好友，人齐了开局）。
async function handleShopBuy(request: Request, env: Env): Promise<Response> {
  await ensureGameSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { type?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const type = (body.type || "").trim();
  if (type !== "match3" && type !== "chess" && type !== "xiangqi" && type !== "gomoku" && type !== "go") {
    return json({ error: "未知的游戏类型" }, 400);
  }
  const fee = gameFeeFor(type);
  // 绑定有效 API Key → 付费对局全免（与界面「付费对局等费用全免」口径一致）
  const keyActive = await hasActiveApiKey(env, user.username);
  const charge = keyActive ? 0 : fee;

  // 🔴 余额预检：余额不足直接拒绝，不进入写库（免费用户跳过）
  if (!keyActive) {
    const acc = await env.DB.prepare("SELECT points FROM accounts WHERE username = ?")
      .bind(user.username).first<{ points: number }>();
    if (!acc || acc.points < fee) {
      return json({ error: "Credits 不足，开局需要 " + fee + " Credits（或绑定有效 API Key 免费）" }, 402);
    }
  }

  // 房间号：6 位大写字母数字（去掉易混的 I/O/0/1）
  let id = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const cand = genRoomId();
    const exists = await env.DB.prepare("SELECT id FROM games WHERE id = ?").bind(cand).first();
    if (!exists) { id = cand; break; }
  }
  if (!id) return json({ error: "房间号生成失败，请重试" }, 500);
  const now = new Date().toISOString();
  const reason = type === "match3" ? "消消乐开局" : "对弈开局";
  // 消消乐是单人局：直接进入 playing；棋类等对手加入后再由房主开局
  const status = type === "match3" ? "playing" : "waiting";
  const payer = keyActive ? "apikey" : "self";

  // 🔴 原子事务：扣费 + 流水 + 建房 要么全部成功，要么全部回滚。
  //    D1 batch 是原子的；UPDATE 加 points >= charge 并发双保险；免费用户 charge=0 不扣费。
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE accounts SET points = points - ? WHERE username = ? AND points >= ?")
        .bind(charge, user.username, charge),
      env.DB.prepare("INSERT INTO credits_logs (username, delta, reason, created_at) VALUES (?, ?, ?, ?)")
        .bind(user.username, -charge, reason + (keyActive ? "（API Key 全免）" : ""), now),
      env.DB.prepare(
        "INSERT INTO games (id, type, creator, opponent, status, payer, board, turn, winner, created_at) VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?)"
      ).bind(id, type, user.username, status, payer, now),
    ]);
  } catch {
    return json({ error: "创建房间失败，未扣费，请重试" }, 500);
  }
  return json({ ok: true, roomId: id, type: type, fee: charge, creator: user.username });
}

async function handleGameJoin(request: Request, env: Env): Promise<Response> {
  await ensureGameSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const id = (body.roomId || "").trim().toUpperCase();
  const row = await env.DB.prepare("SELECT id, type, creator, opponent, status FROM games WHERE id = ?").bind(id).first<{ id: string; type: string; creator: string; opponent: string | null; status: string }>();
  if (!row) return json({ error: "房间不存在，检查房间号" }, 404);
  if (row.type === "match3") return json({ error: "消消乐是单人游戏，无需加入" }, 400);
  // 房主本人（含被代购的房主）可以进自己买的房间：免费，直接进入等待界面
  if (row.creator === user.username) {
    return json({ ok: true, roomId: id, type: row.type, creator: row.creator, self: true, creatorName: row.creator });
  }
  // 座位模型：只要还有空位就能加入 —— 包括「已经开局」的房间（打完一局直接换对手）
  const players = await gamePlayers(env, id);
  const seat = freeSeat(players);
  if (seat < 0) return json({ error: "房间已满（2 人已满）" }, 409);
  // 已经在这个房间里 → 直接回房间
  if (players.some((p) => p.username === user.username)) {
    return json({ ok: true, roomId: id, type: row.type, creator: row.creator, already: true });
  }
  const oppNow = await currentOpponent(env, id, row.creator);
  return json({ ok: true, roomId: id, type: row.type, creator: row.creator, seat: seat, creatorName: row.creator, opponentName: oppNow });
}

async function handleGamePaySelf(request: Request, env: Env): Promise<Response> {
  await ensureGameSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const id = (body.roomId || "").trim().toUpperCase();
  const row = await env.DB.prepare("SELECT id, type, creator, opponent, status FROM games WHERE id = ?").bind(id).first<{ id: string; type: string; creator: string; opponent: string | null; status: string }>();
  if (!row) return json({ error: "房间不存在" }, 404);
  if (row.type === "match3") return json({ error: "消消乐是单人游戏，无需加入" }, 400);
  if (row.creator === user.username) return json({ error: "不能加入自己创建的房间" }, 400);
  // 座位模型：只要有空位就能加入（已开局的房间也能补人 / 换对手）
  const players = await gamePlayers(env, id);
  const alreadyIn = players.some((p) => p.username === user.username);
  const seat = freeSeat(players);
  // ⚠️ 已经在房里的对手可以「续费下一局」（不占新座位，只是为本局付费）
  //    否则「再来一局」时对手已在房 → 被误判「你已经在房间里了」→ 永远付不了款。
  if (!alreadyIn && seat < 0) return json({ error: "房间已满（2 人已满）" }, 409);
  if (alreadyIn && row.creator === user.username) {
    return json({ error: "不能加入自己创建的房间" }, 400);
  }
  const keyActive = await hasActiveApiKey(env, user.username);
  const fee = gameFeeFor(row.type);
  if (!keyActive && !(await spendCredits(env, user.username, fee))) {
    return json({ error: "Credits 不足，进入需要 " + fee + " Credits（或绑定有效 API Key 免费）" }, 402);
  }
  if (!keyActive) {
    await logCredits(env, user.username, -fee, alreadyIn ? "续费下一局对弈" : "加入对弈房间");
  }
  // 占座（已在房的续费者不重复占座，保留原座位号）
  if (!alreadyIn) {
    await env.DB.prepare("INSERT OR REPLACE INTO game_seats (room_id, username, seat, joined_at) VALUES (?, ?, ?, ?)")
      .bind(id, user.username, seat, new Date().toISOString()).run();
  }
  // 房间进入 ready；若是已开局的房间换人，局面重置为初始（由房主再点开始）
  const opponent = await currentOpponent(env, id, row.creator);
  // ⚠️ round_fee_paid = 1：本局对手已付费，房主才能开局。
  //    「再来一局」会把它清零 → 对手必须重新付费，否则就是白嫖无限局。
  await env.DB.prepare("UPDATE games SET opponent = ?, payer = ?, status = 'ready', round_fee_paid = 1 WHERE id = ?")
    .bind(opponent, keyActive ? "apikey" : "self", id).run();
  await notifyUsers(env, [row.creator, user.username], {
    type: "game-join", roomId: id, opponent: user.username, payer: keyActive ? "apikey" : "self"
  });
  return json({ ok: true, roomId: id, seat: seat, creatorName: row.creator, opponentName: user.username });
}

async function handleGamePayRequest(request: Request, env: Env): Promise<Response> {
  await ensureGameSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const id = (body.roomId || "").trim().toUpperCase();
  const row = await env.DB.prepare("SELECT id, type, creator, opponent, status FROM games WHERE id = ?").bind(id).first<{ id: string; type: string; creator: string; opponent: string | null; status: string }>();
  if (!row) return json({ error: "房间不存在" }, 404);
  if (row.type === "match3") return json({ error: "消消乐是单人游戏，无需加入" }, 400);
  if (row.creator === user.username) return json({ error: "不能加入自己创建的房间" }, 400);
  // 座位模型：只要有空位就能申请加入（已开局的房间也能换对手）
  const players = await gamePlayers(env, id);
  if (freeSeat(players) < 0) return json({ error: "房间已满（2 人已满）" }, 409);
  if (players.some((p) => p.username === user.username)) {
    return json({ error: "你已经在房间里了" }, 409);
  }
  const pending = await env.DB.prepare(
    "SELECT id FROM game_requests WHERE room_id = ? AND from_user = ? AND status = 'pending'"
  ).bind(id, user.username).first();
  if (pending) return json({ error: "已发送过代付请求，等对方回应" }, 409);
  const now = new Date().toISOString();
  const ins = await env.DB.prepare(
    "INSERT INTO game_requests (room_id, from_user, kind, status, created_at) VALUES (?, ?, 'pay_for_me', 'pending', ?)"
  ).bind(id, user.username, now).run();
  const requestId = ins.meta.last_row_id;
  await notifyUsers(env, [row.creator], { type: "game-invite", requestId: requestId, roomId: id, from: user.username, gameType: row.type });
  return json({ ok: true, requestId: requestId });
}

async function handleGamePayRespond(request: Request, env: Env): Promise<Response> {
  await ensureGameSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { requestId?: number; accept?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const reqId = Number(body.requestId);
  const req = await env.DB.prepare(
    "SELECT id, room_id, from_user, status FROM game_requests WHERE id = ?"
  ).bind(reqId).first<{ id: number; room_id: string; from_user: string; status: string }>();
  if (!req || req.status !== "pending") return json({ error: "请求不存在或已处理" }, 404);
  const game = await env.DB.prepare("SELECT id, type, creator, opponent, status FROM games WHERE id = ?").bind(req.room_id).first<{ id: string; type: string; creator: string; opponent: string | null; status: string }>();
  if (!game || game.creator !== user.username) return json({ error: "只有房主可以回应代付请求" }, 403);

  if (!body.accept) {
    await env.DB.prepare("UPDATE game_requests SET status = 'rejected' WHERE id = ?").bind(reqId).run();
    await notifyUsers(env, [game.creator, req.from_user], { type: "game-respond", requestId: reqId, roomId: req.room_id, accepted: false });
    return json({ ok: true, rejected: true });
  }
  // 接受时代付方占座（可能座位刚被别人抢走，再校验一次）
  const seatsNow = await gamePlayers(env, req.room_id);
  if (freeSeat(seatsNow) < 0) {
    await env.DB.prepare("UPDATE game_requests SET status = 'rejected' WHERE id = ?").bind(reqId).run();
    return json({ error: "房间已满（2 人已满）" }, 409);
  }
  const fee = gameFeeFor(game.type);
  if (!(await spendCredits(env, user.username, fee))) {
    return json({ error: "你的 Credits 不足，代付需要 " + fee + " Credits" }, 402);
  }
  await logCredits(env, user.username, -fee, "代付好友对弈费");
  await env.DB.prepare("UPDATE game_requests SET status = 'accepted' WHERE id = ?").bind(reqId).run();
  // 被代付者占座
  const seatNo = freeSeat(seatsNow);
  await env.DB.prepare("INSERT OR REPLACE INTO game_seats (room_id, username, seat, joined_at) VALUES (?, ?, ?, ?)")
    .bind(req.room_id, req.from_user, seatNo, new Date().toISOString()).run();
  await env.DB.prepare("UPDATE games SET opponent = ?, payer = ?, status = 'ready', round_fee_paid = 1 WHERE id = ?").bind(req.from_user, user.username, req.room_id).run();
  await notifyUsers(env, [game.creator, req.from_user], { type: "game-join", roomId: req.room_id, opponent: req.from_user, payer: user.username });
  await notifyUsers(env, [game.creator, req.from_user], { type: "game-respond", requestId: reqId, roomId: req.room_id, accepted: true });
  return json({ ok: true });
}

async function handleGameStart(request: Request, env: Env): Promise<Response> {
  await ensureGameSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const id = (body.roomId || "").trim().toUpperCase();
  const row = await env.DB.prepare("SELECT id, type, creator, opponent, status FROM games WHERE id = ?").bind(id).first<{ id: string; type: string; creator: string; opponent: string | null; status: string }>();
  if (!row) return json({ error: "房间不存在" }, 404);
  if (row.creator !== user.username) return json({ error: "只有房主可以开始棋局" }, 403);
  const opponent = await currentOpponent(env, id, row.creator);
  if (!opponent || row.status !== "ready") return json({ error: "等待对手加入并完成支付" }, 409);
  // ⚠️ 本局对手必须已付费（防止「再来一局」不收费 → 无限白嫖）
  const feeRow = await env.DB.prepare("SELECT round_fee_paid FROM games WHERE id = ?").bind(id).first<{ round_fee_paid: number | null }>();
  if (!feeRow || !feeRow.round_fee_paid) {
    return json({ error: "对手尚未支付本局费用，请先让对手付款" }, 409);
  }
  // 写入初始局面：房主执白（国际象棋）/ 红（中国象棋）
  const startFen = row.type === "gomoku" || row.type === "go"
    ? ""   // 五子棋/围棋：空盘（引擎 parse('') 即空盘）
    : (row.type === "xiangqi"
      ? "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r"
      : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  await env.DB.prepare("UPDATE games SET status = 'playing', board = ?, turn = ?, winner = NULL, result = NULL WHERE id = ?")
    .bind(startFen, row.creator, id).run();
  const players = await gamePlayers(env, id);
  await notifyUsers(env, players.map((p) => p.username),
    { type: "game-start", roomId: id, gameType: row.type, board: startFen, turn: row.creator, players: players.map((p) => p.username) });
  return json({ ok: true, board: startFen });
}

// 走子：服务端负责「轮次 / 身份 / 状态」校验与广播，规则判定由前端棋类引擎完成
async function handleGameMove(request: Request, env: Env): Promise<Response> {
  await ensureGameSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string; board?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const id = (body.roomId || "").trim().toUpperCase();
  const row = await env.DB.prepare("SELECT id, type, creator, opponent, status, board, turn FROM games WHERE id = ?")
    .bind(id).first<{ id: string; type: string; creator: string; opponent: string | null; status: string; board: string | null; turn: string | null }>();
  if (!row) return json({ error: "房间不存在" }, 404);
  if (row.status !== "playing") return json({ error: "棋局尚未开始或已结束" }, 409);
  const players = await gamePlayers(env, id);
  if (!players.some((p) => p.username === user.username)) {
    return json({ error: "你不是这局棋的参与者" }, 403);
  }
  const opponent = await currentOpponent(env, id, row.creator);
  // 轮次校验：只有轮到自己才能走
  if (row.turn && row.turn !== user.username) {
    return json({ error: "还没轮到你走" }, 409);
  }
  const board = String(body.board || "").trim();
  if (!board || board.length > 4000) return json({ error: "局面数据无效" }, 400);
  const nextTurn = row.creator === user.username ? (opponent || "") : row.creator;
  await env.DB.prepare("UPDATE games SET board = ?, turn = ? WHERE id = ?").bind(board, nextTurn, id).run();
  await notifyUsers(env, players.map((p) => p.username),
    { type: "game-move", roomId: id, board: board, by: user.username, turn: nextTurn });
  return json({ ok: true, board: board, turn: nextTurn });
}

async function handleGameEnd(request: Request, env: Env): Promise<Response> {
  await ensureGameSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string; winner?: string; result?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const id = (body.roomId || "").trim().toUpperCase();
  const row = await env.DB.prepare("SELECT id, type, creator, opponent, status FROM games WHERE id = ?").bind(id).first<{ id: string; type: string; creator: string; opponent: string | null; status: string }>();
  if (!row) return json({ error: "房间不存在" }, 404);
  // 房主与对手都可以结束本局（对手不想继续时可主动结束）
  if (row.creator !== user.username && row.opponent !== user.username) {
    return json({ error: "只有房间内的玩家可以结束本局" }, 403);
  }
  if (row.status === "ended") return json({ ok: true });
  // winner：'a' = 房主胜、'b' = 对手胜、'draw' = 和棋；缺省视为房主认输结束
  const w = String(body.winner || "");
  const winner = w === "b" ? (row.opponent || "") : (w === "a" ? row.creator : (w === "draw" ? "draw" : null));
  const resultText = String(body.result || "");
  await env.DB.prepare("UPDATE games SET status = 'ended', winner = ?, result = ? WHERE id = ?")
    .bind(winner, resultText, id).run();
  const players = await gamePlayers(env, id);
  const names = players.map((p) => p.username);
  await notifyUsers(env, names,
    { type: "game-end", roomId: id, winner: winner, result: resultText, players: names });
  return json({ ok: true, winner: winner, result: resultText });
}

// 「再来一局」已彻底关闭（用户明确要求：棋类结束后不能再开下一局）。
// 想继续下棋必须回聊天页到 SHOP 重新购买房间号（每局重新计费），堵死任何同房间续局/白嫖入口。
async function handleGameRestart(_request: Request, _env: Env): Promise<Response> {
  return json({ error: "棋类结束后不能再开下一局，请到 SHOP 重新购买房间号" }, 403);
}

// ---------------------------------------------------------------------------
// 飞行棋 helpers
// ---------------------------------------------------------------------------
type FlightRoom = { id: string; creator: string; human: number; ai: number; status: string; state: string | null; winner: string | null; created_at: string };
type FlightSeat = { room_id: string; username: string; seat: number; kind: string; joined_at: string };

async function flightRoom(env: Env, id: string): Promise<FlightRoom | null> {
  return env.DB.prepare("SELECT * FROM flight_rooms WHERE id = ?").bind(id).first<FlightRoom>();
}
async function flightSeats(env: Env, id: string): Promise<FlightSeat[]> {
  const r = await env.DB.prepare("SELECT * FROM flight_seats WHERE room_id = ? ORDER BY seat ASC").bind(id).all<FlightSeat>();
  return (r.results || []) as FlightSeat[];
}
// 座位 → 显示名（真人=用户名；AI 用「AI·颜色」占位，颜色按 seat 0红1黄2绿3蓝）
const FLIGHT_COLORS = ["红", "黄", "绿", "蓝"];
function flightSeatName(s: FlightSeat): string {
  return s.kind === "ai" ? ("AI·" + FLIGHT_COLORS[s.seat]) : s.username;
}
// 房间里的玩家（真人 + AI），按 seat 排
async function flightPlayers(env: Env, id: string): Promise<Array<{ seat: number; kind: string; name: string; username: string }>> {
  const seats = await flightSeats(env, id);
  return seats.map((s) => ({ seat: s.seat, kind: s.kind, name: flightSeatName(s), username: s.username }));
}
async function flightNotify(env: Env, id: string, payload: unknown): Promise<void> {
  // 按座位表里的真人用户名定向推送（玩家未必在同一聊天室，不能用房间广播）
  const seats = await flightSeats(env, id);
  const humans = seats.filter((s) => s.kind === "human").map((s) => s.username);
  if (!humans.length) return;
  await notifyUsers(env, humans, Object.assign({ game: "flight", roomId: id }, payload));
}

// 建房：房主设 真人1-4 / AI 0-3，真人+AI<=4；扣费后原子建房间+座位
async function handleFlightCreate(request: Request, env: Env): Promise<Response> {
  await ensureFlightSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { human?: number; ai?: number };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const human = Math.round(Number(body.human));
  const ai = Math.round(Number(body.ai || 0));
  if (!(human >= 1 && human <= 4)) return json({ error: "真人人数必须是 1-4" }, 400);
  if (!(ai >= 0 && ai <= 3)) return json({ error: "AI 个数必须是 0-3" }, 400);
  if (human + ai > 4) return json({ error: "真人与 AI 合计不能超过 4 人" }, 400);

  // 绑定有效 API Key → 付费对局全免
  const keyActive = await hasActiveApiKey(env, user.username);
  const charge = keyActive ? 0 : FLIGHT_FEE;
  if (!keyActive) {
    const acc = await env.DB.prepare("SELECT points FROM accounts WHERE username = ?").bind(user.username).first<{ points: number }>();
    if (!acc || acc.points < FLIGHT_FEE) return json({ error: "Credits 不足，飞行棋开局需要 " + FLIGHT_FEE + " Credits（或绑定有效 API Key 免费）" }, 402);
  }

  let id = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const cand = genRoomId();
    const exists = await env.DB.prepare("SELECT id FROM flight_rooms WHERE id = ?").bind(cand).first();
    if (!exists) { id = cand; break; }
  }
  if (!id) return json({ error: "房间号生成失败，请重试" }, 500);
  const now = new Date().toISOString();
  try {
    const stmts: any[] = [
      env.DB.prepare("UPDATE accounts SET points = points - ? WHERE username = ? AND points >= ?").bind(charge, user.username, charge),
      env.DB.prepare("INSERT INTO credits_logs (username, delta, reason, created_at) VALUES (?, ?, ?, ?)").bind(user.username, -charge, "飞行棋开局" + (keyActive ? "(API Key 全免)" : ""), now),
      env.DB.prepare("INSERT INTO flight_rooms (id, creator, human, ai, status, state, winner, created_at) VALUES (?, ?, ?, ?, 'waiting', NULL, NULL, ?)")
        .bind(id, user.username, human, ai, now),
      env.DB.prepare("INSERT INTO flight_seats (room_id, username, seat, kind, joined_at) VALUES (?, ?, ?, 'human', ?)")
        .bind(id, user.username, 0, now)
    ];
    // AI 席位预先占位（seat = human .. human+ai-1），保证 brew 后真人填 human-1 个席位
    for (let k = 0; k < ai; k++) {
      const seat = human + k;
      const aiName = "AI" + id + seat;
      stmts.push(env.DB.prepare("INSERT INTO flight_seats (room_id, username, seat, kind, joined_at) VALUES (?, ?, ?, 'ai', ?)")
        .bind(id, aiName, seat, now));
    }
    await env.DB.batch(stmts);
  } catch {
    return json({ error: "创建房间失败，未扣费，请重试" }, 500);
  }
  const players = await flightPlayers(env, id);
  return json({ ok: true, roomId: id, human, ai, rate: FLIGHT_RATE, fee: charge, creator: user.username, seat: 0, players, ready: human === 1 && ai === 0 });
}

// 加入房间：真人占剩余 human 席位之一；扣费原子占座；真人凑齐后 ready=true
async function handleFlightJoin(request: Request, env: Env): Promise<Response> {
  await ensureFlightSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.roomId || "").trim().toUpperCase();
  const room = await flightRoom(env, id);
  if (!room) return json({ error: "房间不存在，检查房间号" }, 404);
  if (room.status !== "waiting") return json({ error: "该房间已开局或已结束" }, 409);
  const seats = await flightSeats(env, id);
  // 房主本人进自己的房间：免费，直接回
  if (room.creator === user.username) {
    return json({ ok: true, roomId: id, self: true, seat: 0, creator: room.creator, human: room.human, ai: room.ai, rate: FLIGHT_RATE, players: await flightPlayers(env, id), ready: false });
  }
  if (seats.some((s) => s.username === user.username && s.kind === "human")) {
    return json({ ok: true, roomId: id, already: true, creator: room.creator, human: room.human, ai: room.ai, rate: FLIGHT_RATE, players: await flightPlayers(env, id), ready: false });
  }
  const humanSeats = seats.filter((s) => s.kind === "human").length;
  if (humanSeats >= room.human) return json({ error: "真人席位已满" }, 409);
  // 找一个空 human 席位：真人席位是 0..human-1；已占 humanSeats 个
  let seat = -1;
  for (let s = 0; s < room.human; s++) if (!seats.some((x) => x.seat === s)) { seat = s; break; }
  if (seat < 0) return json({ error: "真人席位已满" }, 409);
  const keyActive = await hasActiveApiKey(env, user.username);
  const charge = keyActive ? 0 : FLIGHT_FEE;
  if (!keyActive) {
    const acc = await env.DB.prepare("SELECT points FROM accounts WHERE username = ?").bind(user.username).first<{ points: number }>();
    if (!acc || acc.points < FLIGHT_FEE) return json({ error: "Credits 不足，加入需要 " + FLIGHT_FEE + " Credits（或绑定有效 API Key 免费）" }, 402);
  }
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE accounts SET points = points - ? WHERE username = ? AND points >= ?").bind(charge, user.username, charge),
      env.DB.prepare("INSERT INTO credits_logs (username, delta, reason, created_at) VALUES (?, ?, ?, ?)").bind(user.username, -charge, "飞行棋加入" + (keyActive ? "(API Key 全免)" : ""), now),
      env.DB.prepare("INSERT INTO flight_seats (room_id, username, seat, kind, joined_at) VALUES (?, ?, ?, 'human', ?)").bind(id, user.username, seat, now)
    ]);
  } catch { return json({ error: "加入失败，未扣费，请重试" }, 500); }
  const players = await flightPlayers(env, id);
  const ready = players.filter((p) => p.kind === "human").length >= room.human;
  await flightNotify(env, id, { type: "flight-join", seat, name: user.username, players, ready });
  return json({ ok: true, roomId: id, seat, creator: room.creator, human: room.human, ai: room.ai, rate: FLIGHT_RATE, players, ready });
}

// 查询房间状态（前端轮询兜底）
async function handleFlightState(request: Request, env: Env): Promise<Response> {
  await ensureFlightSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const id = (new URL(request.url).searchParams.get("roomId") || "").trim().toUpperCase();
  const room = await flightRoom(env, id);
  if (!room) return json({ error: "房间不存在" }, 404);
  const players = await flightPlayers(env, id);
  const ready = players.filter((p) => p.kind === "human").length >= room.human;
  const iAm = players.find((p) => p.username === user.username);
  return json({ ok: true, room: { id: room.id, creator: room.creator, human: room.human, ai: room.ai, status: room.status, state: room.state, winner: room.winner, rate: FLIGHT_RATE },
    players, ready, seat: iAm ? iAm.seat : -1, iAmCreator: room.creator === user.username });
}

// 开局：仅房主；真人必须凑齐；服务端生成初始 state，写库并广播
async function handleFlightStart(request: Request, env: Env): Promise<Response> {
  await ensureFlightSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.roomId || "").trim().toUpperCase();
  const room = await flightRoom(env, id);
  if (!room) return json({ error: "房间不存在" }, 404);
  if (room.creator !== user.username) return json({ error: "只有房主可以开局" }, 403);
  if (room.status !== "waiting") return json({ error: "房间已开局" }, 409);
  const players = await flightPlayers(env, id);
  const humanCount = players.filter((p) => p.kind === "human").length;
  if (humanCount < room.human) return json({ error: "真人未凑齐（" + humanCount + "/" + room.human + "），不能开局" }, 409);
  // 初始 state：n|turn|dice|six|winner|finished|pieces
  const n = room.human + room.ai;
  const rows: string[] = [];
  for (let p = 0; p < 4; p++) rows.push(p < n ? "-1,-1,-1,-1" : "x");
  const state = [n, 0, 0, 0, "x", "", rows.join(";")].join("|");
  await env.DB.prepare("UPDATE flight_rooms SET status = 'playing', state = ? WHERE id = ?").bind(state, id).run();
  await flightNotify(env, id, { type: "flight-start", state });
  return json({ ok: true, state, players });
}

// 掷骰：仅当前行动方（真人）；服务端随机 1-6，写入 state 的 dice 字段并广播
async function handleFlightRoll(request: Request, env: Env): Promise<Response> {
  await ensureFlightSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.roomId || "").trim().toUpperCase();
  const room = await flightRoom(env, id);
  if (!room) return json({ error: "房间不存在" }, 404);
  if (room.status !== "playing" || !room.state) return json({ error: "房间未开局" }, 409);
  const players = await flightPlayers(env, id);
  const f = room.state.split("|");
  const turnSeat = Number(f[1]);
  const actor = players.find((p) => p.seat === turnSeat);
  if (!actor || actor.kind !== "human" || actor.username !== user.username) return json({ error: "还没轮到你掷骰" }, 403);
  const dice = 1 + crypto.getRandomValues(new Uint8Array(1))[0] % 6;
  f[2] = String(dice);
  const state = f.join("|");
  await env.DB.prepare("UPDATE flight_rooms SET state = ? WHERE id = ?").bind(state, id).run();
  await flightNotify(env, id, { type: "flight-roll", seat: turnSeat, by: user.username, dice });
  return json({ ok: true, dice, state });
}

// 走子：前端按引擎算好新 state 提交；服务端校验行动方后写库；含 winner 则结算
async function handleFlightMove(request: Request, env: Env): Promise<Response> {
  await ensureFlightSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string; state?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.roomId || "").trim().toUpperCase();
  const state = (body.state || "").trim();
  if (!state || state.length > 4000) return json({ error: "局面数据无效" }, 400);
  const room = await flightRoom(env, id);
  if (!room) return json({ error: "房间不存在" }, 404);
  if (room.status !== "playing") return json({ error: "房间未开局" }, 409);
  const players = await flightPlayers(env, id);
  const oldF = (room.state || "").split("|");
  const turnSeat = Number(oldF[1]);
  const actor = players.find((p) => p.seat === turnSeat);
  // 真人走子必须校验行动方；AI 走子由当前真人的客户端代提交，放行但要带 aiAct 标记
  const isAiTurn = actor && actor.kind === "ai";
  if (!isAiTurn && (!actor || actor.username !== user.username)) return json({ error: "还没轮到你走子" }, 403);
  const f = state.split("|");
  const winnerSeat = f[4] === "x" ? -1 : Number(f[4]);
  const winner = winnerSeat >= 0 ? (players.find((p) => p.seat === winnerSeat)?.name || "") : null;
  await env.DB.prepare("UPDATE flight_rooms SET state = ?, winner = ? WHERE id = ?").bind(state, winner, id).run();
  if (winner) await env.DB.prepare("UPDATE flight_rooms SET status = 'ended' WHERE id = ?").bind(id).run();
  await flightNotify(env, id, { type: "flight-move", state, by: user.username, winner });
  return json({ ok: true, state, winner });
}

// 离开房间：房主离开=删房；真人离开释放座位（开局后不释放，提示）
async function handleFlightLeave(request: Request, env: Env): Promise<Response> {
  await ensureFlightSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.roomId || "").trim().toUpperCase();
  const room = await flightRoom(env, id);
  if (!room) return json({ error: "房间不存在" }, 404);
  if (room.creator === user.username) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM flight_seats WHERE room_id = ?").bind(id),
      env.DB.prepare("DELETE FROM flight_rooms WHERE id = ?").bind(id)
    ]);
    await flightNotify(env, id, { type: "flight-deleted", by: user.username });
    return json({ ok: true, deleted: true });
  }
  if (room.status !== "waiting") return json({ error: "对局进行中，不能离开（请等本局结束）" }, 409);
  await env.DB.prepare("DELETE FROM flight_seats WHERE room_id = ? AND username = ?").bind(id, user.username).run();
  const players = await flightPlayers(env, id);
  await flightNotify(env, id, { type: "flight-leave", by: user.username, players });
  return json({ ok: true, deleted: false, players });
}

// 删除房间（仅房主）
async function handleFlightDelete(request: Request, env: Env): Promise<Response> {
  await ensureFlightSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.roomId || "").trim().toUpperCase();
  const room = await flightRoom(env, id);
  if (!room) return json({ error: "房间不存在" }, 404);
  if (room.creator !== user.username) return json({ error: "只有房主可以删除房间" }, 403);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM flight_seats WHERE room_id = ?").bind(id),
    env.DB.prepare("DELETE FROM flight_rooms WHERE id = ?").bind(id)
  ]);
  await flightNotify(env, id, { type: "flight-deleted", by: user.username });
  return json({ ok: true });
}

// 费率查询里带上 flight
// 删除房间：房主可删除自己的房间（任意状态，含已结束）
// 作用：房间打完后能把房间号释放掉，避免「这局早就结束了却一直显示已满、还删不掉」。
async function handleGameDelete(request: Request, env: Env): Promise<Response> {
  await ensureGameSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const id = (body.roomId || "").trim().toUpperCase();
  const row = await env.DB.prepare("SELECT id, type, creator, opponent, status FROM games WHERE id = ?").bind(id).first<{ id: string; type: string; creator: string; opponent: string | null; status: string }>();
  if (!row) return json({ error: "房间不存在" }, 404);
  if (row.creator !== user.username) return json({ error: "只有房主可以删除房间" }, 403);
  // 消消乐是单人局，房主就是唯一玩家，直接删
  // 棋类：对手仍在房 → 先把本局结束（通知对手），再删房间。
  //       房主主动删房 = 终止当前对局，这是房主的权限，不做阻拦。
  if (row.opponent && row.status !== "ended") {
    await env.DB.prepare("UPDATE games SET status = 'ended', result = ? WHERE id = ?")
      .bind("房主删除了房间", id).run();
  }
  // ⚠️ 先取玩家名单再删表：gamePlayers 依赖 games 行的 creator
  const players = await gamePlayers(env, id);
  const notifyList = players.map((p) => p.username)
    .concat([row.opponent].filter(Boolean) as string[])
    .filter((u, i, arr) => u && arr.indexOf(u) === i);
  await env.DB.prepare("DELETE FROM games WHERE id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM game_seats WHERE room_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM game_requests WHERE room_id = ?").bind(id).run();
  await notifyUsers(env, notifyList, { type: "game-deleted", roomId: id });
  return json({ ok: true });
}

// 离开房间：对局尚未开始时，退出即释放座位（否则房间号一直显示「已满」）
async function handleGameLeave(request: Request, env: Env): Promise<Response> {
  await ensureGameSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const id = (body.roomId || "").trim().toUpperCase();
  const row = await env.DB.prepare("SELECT id, creator, opponent, status FROM games WHERE id = ?").bind(id).first<{ id: string; creator: string; opponent: string | null; status: string }>();
  if (!row) return json({ error: "房间不存在" }, 404);
  // 对手离开：释放座位 → 房间回到「等待加入」，别人可随时补位 / 换对手
  // ⚠️ 状态不再做限制：对局中（playing）离开同样释放座位，
  //    这样「打完一局 → 换个人接着下」不用重开房间。
  if (row.opponent === user.username || (await hasSeat(env, id, user.username))) {
    await env.DB.prepare("DELETE FROM game_seats WHERE room_id = ? AND username = ?").bind(id, user.username).run();
    const opp = await currentOpponent(env, id, row.creator);
    await env.DB.prepare("UPDATE games SET opponent = ?, payer = NULL, status = 'waiting' WHERE id = ?").bind(opp, id).run();
    await notifyUsers(env, [row.creator], { type: "game-leave", roomId: id, opponent: user.username });
    return json({ ok: true, released: true });
  }
  // 房主离开：房间直接删掉（对手会被通知退出）
  if (row.creator === user.username) {
    await env.DB.prepare("DELETE FROM games WHERE id = ?").bind(id).run();
    await env.DB.prepare("DELETE FROM game_seats WHERE room_id = ?").bind(id).run();
    await env.DB.prepare("DELETE FROM game_requests WHERE room_id = ?").bind(id).run();
    await notifyUsers(env, [row.opponent].filter(Boolean) as string[], { type: "game-deleted", roomId: id });
    return json({ ok: true });
  }
  return json({ ok: true, released: false });
}

// 该用户名是否占用房间座位
async function hasSeat(env: Env, roomId: string, username: string): Promise<boolean> {
  try {
    const r = await env.DB.prepare("SELECT 1 AS x FROM game_seats WHERE room_id = ? AND username = ?")
      .bind(roomId, username).first<{ x: number }>();
    return !!r;
  } catch {
    return false;
  }
}

// 游戏费率查询：前端用它渲染价格文案，保证「看到的价」=「实际扣的价」
async function handleGameFees(request: Request, env: Env): Promise<Response> {
  await ensureGameSchema(env);
  return json({ ok: true, fees: GAME_FEES });
}

async function handleGameState(request: Request, env: Env): Promise<Response> {
  await ensureGameSchema(env);
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const url = new URL(request.url);
  const id = (url.searchParams.get("roomId") || "").trim().toUpperCase();
  const row = await env.DB.prepare(
    "SELECT id, type, creator, opponent, status, payer, turn, winner, board, result, round_fee_paid FROM games WHERE id = ?"
  ).bind(id).first<{ id: string; type: string; creator: string; opponent: string | null; status: string; payer: string | null; turn: string | null; winner: string | null; board: string | null; result: string | null; round_fee_paid: number | null }>();
  if (!row) return json({ error: "房间不存在" }, 404);
  const players = await gamePlayers(env, id);
  return json({
    game: row,
    players: players.map((p) => p.username),
    seats: players.map((p) => ({ username: p.username, seat: p.seat })),
    freeSeat: freeSeat(players),
    iAm: user.username,
    iAmCreator: row.creator === user.username
  });
}

export default {
  async fetch(request: Request, env: Env, ctx?: { waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> {
    pgCtx = ctx || null;
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      await ensureBuiltinAccounts(env); // 打开网站即兜底一次（内部 60 秒节流，节流命中时零开销）
      await ensureBuiltinRooms(env);
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
    if (url.pathname === "/api/register" && request.method === "POST") return handleRegister(request, env);
    if (url.pathname === "/api/register/verify" && request.method === "POST") return handleRegisterVerify(request, env);
    if (url.pathname === "/api/admin/create-invite" && request.method === "POST") return handleAdminCreateInvite(request, env);
    if (url.pathname === "/api/admin/invite-seen" && request.method === "POST") return handleAdminInviteSeen(request, env);
    if (url.pathname === "/api/admin/invites" && request.method === "GET") return handleAdminInvites(request, env);
    if (url.pathname === "/api/admin/members" && request.method === "GET") return handleAdminMembers(request, env);
    if (url.pathname === "/api/recover/issue" && request.method === "POST") return handleRecoverIssue(request, env);
    if (url.pathname === "/api/recover/reset" && request.method === "POST") return handleRecoverReset(request, env);
    if (url.pathname === "/api/login" && request.method === "POST") return handleLogin(request, env);
    if (url.pathname === "/api/password" && request.method === "POST") return handlePasswordChange(request, env);
    if (url.pathname === "/api/me" && request.method === "GET") return handleMe(request, env);
    if (url.pathname === "/api/history" && request.method === "GET") return handleHistory(request, env);
    if (url.pathname === "/api/admin/create-account" && request.method === "POST") return handleAdminCreate(request, env);
    if (url.pathname === "/api/admin/deactivate" && request.method === "POST") return handleDeactivate(request, env);
    if (url.pathname === "/api/admin/accounts" && request.method === "GET") return handleAccounts(request, env);
    if (url.pathname === "/api/admin/create-otp" && request.method === "POST") return handleCreateOtp(request, env);
    if (url.pathname === "/api/admin/otps" && request.method === "GET") return handleListOtps(request, env);
    if (url.pathname === "/api/otp/redeem" && request.method === "POST") return handleRedeemOtp(request, env);
    if (url.pathname === "/api/otp/revoke" && request.method === "POST") return handleRevokeOtp(request, env);
    if (url.pathname === "/api/apikey/bind" && request.method === "POST") return handleApiKeyBind(request, env);
    if (url.pathname === "/api/apikey/unbind" && request.method === "POST") return handleApiKeyUnbind(request, env);
    if (url.pathname === "/api/apikey/status" && request.method === "GET") return handleApiKeyStatus(request, env);
    if (url.pathname === "/api/apikey/create" && request.method === "POST") return handleApiKeyCreate(request, env);
    if (url.pathname === "/api/apikey/list" && request.method === "GET") return handleApiKeyList(request, env);
    if (url.pathname === "/api/apikey/delete" && request.method === "POST") return handleApiKeyDelete(request, env);
    if (url.pathname === "/api/credits-logs" && request.method === "GET") return handleCreditsLogs(request, env);
    if (url.pathname === "/api/logs" && request.method === "GET") return handleLogs(request, env);
    if (url.pathname === "/api/game/create" && request.method === "POST") return handleGameCreate(request, env);
    if (url.pathname === "/api/shop/buy" && request.method === "POST") return handleShopBuy(request, env);
    if (url.pathname === "/api/file/get" && request.method === "GET") return handleFileGet(request, env);
    if (url.pathname === "/api/file/pay" && request.method === "POST") return handleFilePay(request, env);
    if (url.pathname === "/api/game/join" && request.method === "POST") return handleGameJoin(request, env);
    if (url.pathname === "/api/game/pay-self" && request.method === "POST") return handleGamePaySelf(request, env);
    if (url.pathname === "/api/game/pay-request" && request.method === "POST") return handleGamePayRequest(request, env);
    if (url.pathname === "/api/game/pay-respond" && request.method === "POST") return handleGamePayRespond(request, env);
    if (url.pathname === "/api/game/start" && request.method === "POST") return handleGameStart(request, env);
    if (url.pathname === "/api/game/move" && request.method === "POST") return handleGameMove(request, env);
    if (url.pathname === "/api/game/end" && request.method === "POST") return handleGameEnd(request, env);
    if (url.pathname === "/api/game/state" && request.method === "GET") return handleGameState(request, env);
    if (url.pathname === "/api/game/fees" && request.method === "GET") return handleGameFees(request, env);
    if (url.pathname === "/api/game/delete" && request.method === "POST") return handleGameDelete(request, env);
    if (url.pathname === "/api/game/leave" && request.method === "POST") return handleGameLeave(request, env);
    if (url.pathname === "/api/game/restart" && request.method === "POST") return handleGameRestart(request, env);
    // 飞行棋（4 人，独立房间系统，速率固定 1.00）
    if (url.pathname === "/api/flight/create" && request.method === "POST") return handleFlightCreate(request, env);
    if (url.pathname === "/api/flight/join" && request.method === "POST") return handleFlightJoin(request, env);
    if (url.pathname === "/api/flight/state" && request.method === "GET") return handleFlightState(request, env);
    if (url.pathname === "/api/flight/start" && request.method === "POST") return handleFlightStart(request, env);
    if (url.pathname === "/api/flight/roll" && request.method === "POST") return handleFlightRoll(request, env);
    if (url.pathname === "/api/flight/move" && request.method === "POST") return handleFlightMove(request, env);
    if (url.pathname === "/api/flight/leave" && request.method === "POST") return handleFlightLeave(request, env);
    if (url.pathname === "/api/flight/delete" && request.method === "POST") return handleFlightDelete(request, env);
    if (url.pathname === "/api/rooms" && request.method === "GET") return handleRoomsList(request, env);
    if (url.pathname === "/api/rooms/create" && request.method === "POST") return handleRoomCreate(request, env);
    if (url.pathname === "/api/rooms/history" && request.method === "GET") return handleRoomHistory(request, env);
    if (url.pathname === "/api/rooms/members" && request.method === "GET") return handleRoomMembers(request, env);
    if (url.pathname === "/api/rooms/passcode" && request.method === "POST") return handleRoomPasscode(request, env);
    if (url.pathname === "/api/rooms/transfer" && request.method === "POST") return handleRoomTransfer(request, env);
    if (url.pathname === "/api/rooms/kick" && request.method === "POST") return handleRoomKick(request, env);
    if (url.pathname === "/api/rooms/mute" && request.method === "POST") return handleRoomMute(request, env);
    if (url.pathname === "/api/rooms/disband" && request.method === "POST") return handleRoomDisband(request, env);
    if (url.pathname === "/api/rooms/join-pw" && request.method === "POST") return handleRoomJoinByPassword(request, env);
    if (url.pathname === "/api/rooms/rates" && request.method === "POST") return handleRoomRatesSet(request, env);
    if (url.pathname === "/api/zip/repost" && request.method === "POST") return handleZipRepost(request, env);
    if (url.pathname === "/api/file/quote" && request.method === "POST") return handleFileQuote(request, env);
    if (url.pathname === "/api/accounts/list" && request.method === "GET") return handleAccountsList(request, env);
    if (url.pathname === "/api/cloud/status" && request.method === "GET") return handleCloudStatus(request, env);
    if (url.pathname === "/api/cloud/buy" && request.method === "POST") return handleCloudBuy(request, env);
    if (url.pathname === "/api/cloud/unsub" && request.method === "POST") return handleCloudUnsub(request, env);
    if (url.pathname === "/api/cloud/purge" && request.method === "POST") return handleCloudPurge(request, env);
    if (url.pathname === "/api/cloud/list" && request.method === "GET") return handleCloudList(request, env);
    if (url.pathname === "/api/cloud/file" && request.method === "GET") return handleCloudFile(request, env);
    if (url.pathname === "/api/cloud/delete" && request.method === "POST") return handleCloudDelete(request, env);
    if (url.pathname === "/api/cloud/upload" && request.method === "POST") return handleCloudUpload(request, env);
    if (url.pathname === "/api/cloud/repost" && request.method === "POST") return handleCloudRepost(request, env);
    if (url.pathname === "/api/cloud/renew" && request.method === "POST") return handleCloudRenew(request, env);
    if (url.pathname === "/api/cloud/reclaim-done" && request.method === "POST") return handleCloudReclaimDone(request, env);
    if (url.pathname === "/api/cloud/pg-health" && request.method === "GET") return handleCloudPgHealth(request, env);
    // 云空间 7 天试用活动（独立空间）
    if (url.pathname === "/api/cloud/trial/status" && request.method === "GET") return handleTrialStatus(request, env);
    if (url.pathname === "/api/cloud/trial/claim" && request.method === "POST") return handleTrialClaim(request, env);
    if (url.pathname === "/api/cloud/trial/upload" && request.method === "POST") return handleTrialUpload(request, env);
    if (url.pathname === "/api/cloud/trial/file" && request.method === "GET") return handleTrialFile(request, env);
    if (url.pathname === "/api/cloud/trial/delete" && request.method === "POST") return handleTrialDelete(request, env);
    if (url.pathname === "/api/cloud/trial/finish" && request.method === "POST") return handleTrialFinish(request, env);
    // 文件资源商店
    if (url.pathname === "/api/market/list" && request.method === "GET") return handleMarketList(request, env);
    if (url.pathname === "/api/market/upload" && request.method === "POST") return handleMarketUpload(request, env);
    if (url.pathname === "/api/market/buy" && request.method === "POST") return handleMarketBuy(request, env);
    if (url.pathname === "/api/market/remove" && request.method === "POST") return handleMarketRemove(request, env);
    if (url.pathname === "/api/market/file" && request.method === "GET") return handleMarketFile(request, env);
    if (url.pathname === "/api/market/order-file" && request.method === "GET") return handleMarketOrderFile(request, env);
    if (url.pathname === "/api/market/order-done" && request.method === "POST") return handleMarketOrderDone(request, env);

    if (url.pathname === "/room") {
      const token = url.searchParams.get("token") || "";
      const row = await env.DB.prepare(
        "SELECT a.username AS username, a.role AS role FROM sessions s JOIN accounts a ON a.username = s.username WHERE s.token = ?"
      ).bind(token).first<{ username: string; role: string }>();
      if (!row) return json({ error: "未登录" }, 401);
      const roomId = env.ROOM.idFromName("main");
      const room = env.ROOM.get(roomId);
      return room.fetch(request);
    }

    return json({ error: "Not Found" }, 404);
  }
};

// socket 附件：{ id: connId, username, role }（serializeAttachment 写入，≤2048 字节，跨休眠保留）
interface WsAttach { id?: string; username?: string; role?: string }

interface RoomUser {
  username: string;
  role: string;
}

interface FileAcq {
  id: string;
  name: string;
  size: number;
  mime: string;
  seq: number;
  room: string;
  sender: string;
  role: string;
}

export class Room {
  private state: DurableObjectState;
  private env: Env;
  private users = new Map<WebSocket, RoomUser>();
  private roomOf = new Map<WebSocket, string>();
  private byUser = new Map<string, Set<WebSocket>>();
  // 上传中的文件缓冲：用于把聊天文件落地进 chat_files（保留 7 天）
  private fileBuf = new Map<WebSocket, FileAcq>();
  // 已提示过「页面版本过旧」的连接（每个连接只提示一次，避免刷屏）
  private oldProtoWarned = new Set<WebSocket>();


  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // 实例可能刚从休眠/回收醒来：内存 Map 为空 → 先重建，否则
    // 广播与定向推送都会发给「零个 socket」（对局方收不到 game-join / game-move）。
    await this.hydrate();

    if (url.pathname === "/notify" && request.method === "POST") {
      try {
        const body = await request.json() as { room?: string };
        this.broadcastToRoom(body, (body && body.room) || "geek");
      } catch {}
      return new Response("ok");
    }

    // 定向推送：只发给指定用户（走棋广播只给对局双方，避免整局棋盘泄露给旁观者）
    if (url.pathname === "/notify-users" && request.method === "POST") {
      try {
        const body = await request.json() as { users?: string[]; payload?: unknown };
        const users = Array.isArray(body.users) ? body.users : [];
        for (const u of users) {
          const set = this.byUser.get(u);
          if (!set) continue;
          for (const sock of set) this.sendTo(sock, body.payload);
        }
      } catch {}
      return new Response("ok");
    }

    if (request.headers.get("Upgrade") === "websocket") {
      const url = new URL(request.url);
      const token = url.searchParams.get("token") || "";
      const row = await this.env.DB.prepare(
        "SELECT a.username AS username, a.role AS role FROM sessions s JOIN accounts a ON a.username = s.username WHERE s.token = ?"
      ).bind(token).first<{ username: string; role: string }>();
      if (!row) return json({ error: "未登录" }, 401);

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      // Hibernation 兼容：把身份写进 socket 附件（跨实例回收/休眠保留）。
      // 实例内存被回收后，内存 Map 会清空，必须靠附件 + storage 才能还原会话。
      // ⚠️ acceptWebSocket 的 tags 必须是**字符串数组**（传对象会存不进去 → 附件变 null），
      //    且运行时返回的 WebSocketRequest 上 id 未必可用 → 这里自带 connId 作稳定键。
      const connId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      // ⚠️ 关键：跨休眠保留状态要用 **ws.serializeAttachment()**（≤2048 字节），
      //    acceptWebSocket 的第二个参数 tags 只是「查找标签」，不是附件，写那里读不回来。
      //    附件里放 connId + 身份；房间归属（可变）放 DO storage 的 ws_meta 表。
      this.state.acceptWebSocket(server, [connId]);
      try { server.serializeAttachment({ id: connId, username: row.username, role: row.role }); } catch {}
      this.users.set(server, { username: row.username, role: row.role });
      if (!this.byUser.has(row.username)) this.byUser.set(row.username, new Set());
      this.byUser.get(row.username)!.add(server);
      // 房间归属存 DO storage（可变状态，附件不可变）
      void this.persistWsMeta(server, connId, row.username, row.role, "");
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: "请通过 WebSocket 连接" }, 400);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      await this.handleMessage(ws, message);
    } catch (err) {
      // 任何异常都不允许拖垮 DO（否则后续命令/消息全部无响应）
      try { this.sendTo(ws, { type: "sys", text: "服务器处理该消息时出错，请稍后重试" }); } catch {}
    }
  }

  private async handleMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // 实例可能已从休眠/回收中醒来：内存 Map 被清空 → 先重建，再解析身份
    await this.hydrate();
    let user = this.resolveUser(ws);
    if (!user) {
      // 内存与附件都没拿到：再按 connId 从 storage 兜底（附件存的是 connId）
      const cid = this.socketIdOf(ws);
      if (cid) {
        const u = await this.userByConnId(cid);
        if (u) { user = u; this.users.set(ws, u); }
      }
    }
    if (!user) {
      // 实在认不出身份：明确告知并断开，客户端会自动重连并重新进房
      // （原来此处是静默 return —— 客户端只看到「进入会话中…」直到强刷）
      try { this.sendTo(ws, { type: "sys", text: "连接状态已重置，正在重新连接…", fatal: true }); } catch {}
      try { ws.close(1012, "state-reset"); } catch {}
      return;
    }
    if (typeof message !== "string") {
      if (message instanceof ArrayBuffer) {
        // 分片前缀：[4字节 file_id 长度(uint32 BE)][file_id UTF-8][分片数据]
        // 二进制分片本身不携带任何元信息，仅靠内存 fileBuf 归属。为能在 DO 实例被回收后
        // 仍按 file_id 还原归属，前缀里带上 file_id，file-start 时已把会话持久化进 chat_uploads。
        const buf = new Uint8Array(message);
        if (buf.length < 4) return;
        const idLen = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
        if (idLen <= 0 || buf.length < 4 + idLen) {
          // 无法解析出 file_id 前缀 → 这是旧版本客户端的裸分片（页面缓存未刷新）
          if (!this.oldProtoWarned.has(ws)) {
            this.oldProtoWarned.add(ws);
            this.sendTo(ws, { type: "sys", text: "页面版本过旧，无法发送文件，请刷新页面后重试（文件未发送、未扣费）" });
          }
          return;
        }
        const fileId = new TextDecoder().decode(buf.subarray(4, 4 + idLen));
        const chunkData = buf.subarray(4 + idLen);
        let acq = this.fileBuf.get(ws);
        if (!acq || acq.id !== fileId) {
          // fileBuf 没命中（并发竞态或实例回收）：用 file_id 从 D1 兜底还原
          acq = await this.loadUpload(fileId);
          if (acq) this.fileBuf.set(ws, acq);
        }
        if (acq) {
          acq.seq++;
          try {
            await this.env.DB.prepare("INSERT OR REPLACE INTO chat_file_chunks (file_id, seq, data) VALUES (?, ?, ?)")
              .bind(acq.id, acq.seq, bytesToBase64(chunkData)).run();
            // 同步 seq 到 chat_uploads，保证实例回收后兜底还原时序号连续（避免分片被 OR REPLACE 覆盖）
            await ensureChatUploadsTable(this.env);
            await this.env.DB.prepare("UPDATE chat_uploads SET seq = ? WHERE file_id = ?").bind(acq.seq, acq.id).run().catch(() => {});
          } catch {}
        }
        this.broadcastBinaryToRoom(chunkData, this.roomOf.get(ws) || "");
      }
      return;
    }
    let data: { text?: string; type?: string; room?: string; id?: string; name?: string; size?: number; mime?: string; cid?: string };
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    // 进入指定房间：校验成员资格，下发历史
    if (data.type === "join-room") {
      const room = (data.room || "").trim();
      if (!room || !(await isMember(this.env.DB, room, user.username))) {
        this.sendTo(ws, { type: "sys", text: "你不是该房间成员，无法进入" });
        return;
      }
      this.roomOf.set(ws, room);
      void this.persistWsMeta(ws, this.socketIdOf(ws), user.username, user.role, room);
      void purgeOldMessages(this.env);
      // 历史查询按房间 class 用对应保留期：C 类 21 天 / B 类 7 天 / A 类 5 天
      const histCut = await roomRetentionCutoff(this.env, room);
      const { results } = await this.env.DB.prepare(
        "SELECT sender, role, text, ts FROM messages WHERE room = ? AND ts >= ? ORDER BY id DESC LIMIT 200"
      ).bind(room, histCut).all<{ sender: string; role: string; text: string; ts: string }>();
      this.sendTo(ws, { type: "history", room: room, messages: (results || []).reverse() });
      this.broadcastToRoom({ type: "sys", text: user.username + " 进入了会话" }, room);
      this.broadcastPresence(room);
      return;
    }

      // 文件传输：非成员禁发；公告群仅 RA 可发；观测者仅可在与 RA 的私聊里发；仅广播给同房
      if (typeof data.type === "string" && data.type.indexOf("file-") === 0) {
        const room = this.roomOf.get(ws) || "";
        const size = Math.max(0, Number(data.size) || 0);
        // 关键修复：必须在 await 之前先把上传会话写进内存 fileBuf。
        // 否则 file-start 与紧随其后的二进制分片会被 DO 并发处理，分片可能先于 fileBuf.set 执行、
        // 找不到归属而被丢弃，导致“分片缺失、文件永远发不出去”（实测 0ms 间隔必现、1500ms 正常）。
        if (data.type === "file-start") {
          this.fileBuf.set(ws, {
            id: String(data.id),
            name: String(data.name || "file"),
            size: size,
            mime: String(data.mime || "application/octet-stream"),
            seq: 0,
            room: room,
            sender: user.username,
            role: user.role
          });
        }
        if (!room || !(await isMember(this.env.DB, room, user.username))) {
          this.sendTo(ws, { type: "sys", text: "请先进入一个房间再发送文件" });
          return;
        }
        if (room === "geek" && user.role !== "root-admin") {
          this.sendTo(ws, { type: "sys", text: "Geek公告群仅 Root-Admin 可发布内容" });
          return;
        }
        if (user.role === "observer" && room !== "dm:" + user.username) {
          this.sendTo(ws, { type: "sys", text: "观测者只能在「与 Root-Admin 的私聊」里发文件" });
          return;
        }
        // 文件上传计费：按该群自定义倍率（每 MB 单价）；geek 公告群倍率 0 → 免费
        if (data.type === "file-abort") {
          const ab = this.fileBuf.get(ws);
          const aid = ab ? ab.id : String(data.id);
          if (ab) this.fileBuf.delete(ws);
          await this.env.DB.prepare("DELETE FROM chat_file_chunks WHERE file_id = ?").bind(aid).run().catch(() => {});
          await this.env.DB.prepare("DELETE FROM chat_uploads WHERE file_id = ?").bind(aid).run().catch(() => {});
          return;
        }
        // 计费延后到 file-end 持久化成功之后：避免「已扣费却未落库」导致刷新后文件消失、积分白扣
        if (data.type === "file-start") {
          // 持久化上传会话到 D1（chat_uploads），作为 DO 实例在分片之间被回收时的兜底：
          // 二进制分片不携带额外元信息，仅靠内存 fileBuf 归属；实例一旦回收内存即丢，故落库一份。
          const acq0 = this.fileBuf.get(ws);
          if (acq0) {
            // DO 路径不走 ensureSchema，这里按需自愈建表
            await ensureChatUploadsTable(this.env);
            await this.env.DB.prepare("INSERT OR REPLACE INTO chat_uploads (file_id, name, size, mime, room, sender, role, seq, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)")
              .bind(acq0.id, acq0.name, acq0.size, acq0.mime, acq0.room, acq0.sender, acq0.role, new Date().toISOString()).run().catch(() => {});
          }
        }
        // 转发给同房其他人（不含发送者）；发送者以 file-done 回执为准
        this.broadcastToRoom({
          type: data.type,
          id: data.id,
          name: data.name,
          size: data.size,
          mime: data.mime,
          sender: user.username,
          role: user.role,
          room: room
        }, room, ws);
        if (data.type === "file-end") {
          let acq = this.fileBuf.get(ws);
          if (!acq) acq = await this.loadUpload(String(data.id)); // DO 回收兜底：fileBuf 丢失时按 file_id 还原
          this.fileBuf.delete(ws);
          if (acq) await this.env.DB.prepare("DELETE FROM chat_uploads WHERE file_id = ?").bind(acq.id).run().catch(() => {});
          if (!acq) {
            await this.env.DB.prepare("DELETE FROM chat_file_chunks WHERE file_id = ?").bind(String(data.id)).run().catch(() => {});
            this.sendTo(ws, { type: "file-done", id: String(data.id), ok: false, error: "上传会话已失效，请重试" });
            return;
          }
          // 超过聊天落地上限：明确报错，不入库、不扣费（前端已对齐 20MB，此分支为兜底）
          if (acq.size > CHAT_FILE_CAP) {
            await this.env.DB.prepare("DELETE FROM chat_file_chunks WHERE file_id = ?").bind(acq.id).run().catch(() => {});
            this.sendTo(ws, { type: "file-done", id: acq.id, ok: false, error: "文件 " + fmtBytes(acq.size) + " 超过聊天单文件上限 " + (CHAT_FILE_CAP / 1048576) + "MB，无法在聊天中保存（请用云存储）" });
            return;
          }
          try {
            const { results } = await this.env.DB.prepare(
              "SELECT data FROM chat_file_chunks WHERE file_id = ? ORDER BY seq ASC"
            ).bind(acq.id).all<{ data: string }>();
            const parts = (results || []).map((r) => base64ToBytes(r.data));
            const bytes = concatBytes(parts);
            if (bytes.length !== acq.size) throw new Error("分片缺失或长度不符（" + bytes.length + "/" + acq.size + "）");
            const b64 = bytesToBase64(bytes);
            const now = new Date().toISOString();
            await this.env.DB.prepare(
              "INSERT OR REPLACE INTO chat_files (id, room, sender, name, size, mime, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            ).bind(acq.id, acq.room, acq.sender, acq.name, acq.size, acq.mime, b64, now).run();
            await this.env.DB.prepare("DELETE FROM chat_file_chunks WHERE file_id = ?").bind(acq.id).run();
            const marker = JSON.stringify({ __file: 1, id: acq.id, name: acq.name, size: acq.size, mime: acq.mime });
            await this.env.DB.prepare("INSERT INTO messages (room, sender, role, text, ts) VALUES (?, ?, ?, ?, ?)")
              .bind(acq.room, acq.sender, acq.role, marker, now).run();
            await purgeOldMessages(this.env);
            // 持久化成功后再计费；余额不足则回滚已写入的文件与消息，保证「扣费 ⟺ 落库」
            const rates = await roomRates(this.env, acq.room);
            const cost = fileFeeFor(acq.size, rates.fileRate);
            if (cost > 0) {
              if (!(await spendCredits(this.env, acq.sender, cost))) {
                await this.env.DB.prepare("DELETE FROM chat_files WHERE id = ?").bind(acq.id).run().catch(() => {});
                await this.env.DB.prepare("DELETE FROM messages WHERE room = ? AND text = ?").bind(acq.room, marker).run().catch(() => {});
                this.sendTo(ws, { type: "file-done", id: acq.id, ok: false, error: "Credits 不足：上传需 " + cost + " Credits" });
                return;
              }
              await logCredits(this.env, acq.sender, -cost, "文件上传");
            }
            this.sendTo(ws, { type: "file-done", id: acq.id, ok: true, cost, name: acq.name, size: acq.size });
          } catch (e) {
            await this.env.DB.prepare("DELETE FROM chat_file_chunks WHERE file_id = ?").bind(acq.id).run().catch(() => {});
            this.sendTo(ws, { type: "file-done", id: acq.id, ok: false, error: "文件保存失败：" + (e && e.message ? e.message : "服务器错误") });
          }
        }
        return;
      }

    const text = (data.text || "").trim().slice(0, 1000);
    if (!text) return;

    // 命令行：无需房间即可执行（命令处理器默认房间为 geek，回复均为点对点 sendTo）
    if (text.startsWith("/")) {
      this.handleCommand(ws, user, text);
      return;
    }

    const room = this.roomOf.get(ws) || "";
    if (!room || !(await isMember(this.env.DB, room, user.username))) {
      this.sendTo(ws, { type: "sys", text: "请先进入一个房间再发言", cid: data.cid });
      return;
    }

    // 公告群：仅 Root-Admin 可发言，其他成员只能阅读
    if (room === "geek" && user.role !== "root-admin") {
      this.sendTo(ws, { type: "sys", text: "Geek公告群仅 Root-Admin 可发布消息，其他成员只能阅读", cid: data.cid });
      return;
    }

    // 观测者只能围观，例外：与 Root-Admin 的私聊（dm:<用户名>）里可以发言
    if (user.role === "observer" && room !== "dm:" + user.username) {
      this.sendTo(ws, { type: "sys", text: "观测者只能围观，仅可在「与 Root-Admin 的私聊」里发言", cid: data.cid });
      return;
    }

    // 禁言检查：群主/Admin 可对普通成员禁言 1-24 小时，中途不能结束（Geek公告群无需禁言）
    if (room !== "geek") {
      const mute = await this.env.DB.prepare("SELECT until FROM room_mutes WHERE room = ? AND username = ?")
        .bind(room, user.username).first<{ until: string }>();
      if (mute) {
        const untilMs = new Date(mute.until).getTime();
        if (untilMs > Date.now()) {
          this.sendTo(ws, { type: "sys", text: "你已被禁言（至 " + mute.until.slice(0, 16).replace("T", " ") + "），期间不能发言", cid: data.cid });
          return;
        }
      }
    }

    // 发言计费：按该群自定义倍率（每 20 字单价）；geek 公告群倍率 0 → 免费
    {
      const rates = await roomRates(this.env, room);
      const cost = textFeeFor(text, rates.msgRate);
      if (cost > 0) {
        if (!(await spendCredits(this.env, user.username, cost))) {
          this.sendTo(ws, { type: "sys", text: "Credits 不足：本房间发言需 " + cost + " Credits（每20字 " + rates.msgRate + "Credits，本条 " + text.length + " 字）" });
          return;
        }
        await logCredits(this.env, user.username, -cost, "群聊发言");
      }
    }

    const ts = new Date().toISOString();
    const curRoom = room;
    this.state.blockConcurrencyWhile(async () => {
      await this.env.DB.prepare("INSERT INTO messages (room, sender, role, text, ts) VALUES (?, ?, ?, ?, ?)")
        .bind(curRoom, user.username, user.role, text, ts).run();
      await purgeOldMessages(this.env);
    });
    this.broadcastToRoom({ type: "msg", sender: user.username, role: user.role, text, ts, room: curRoom, cid: data.cid }, curRoom);
  }

  private async handleCommand(ws: WebSocket, user: RoomUser, raw: string): Promise<void> {
    const isRA = user.role === "root-admin";
    const isAdmin = user.role === "admin";
    const reply = (text: string) => this.sendTo(ws, { type: "sys", text });
    const room = this.roomOf.get(ws) || "geek";

    if (!isRA && !isAdmin) {
      reply("命令行仅 Admin / Root-Admin 可用");
      return;
    }

    const parts = raw.slice(1).split(/\s+/);
    const cmd = (parts[0] || "").toLowerCase();
    await this.log(user.username, "cmd", raw);

    if (cmd === "help") {
      reply("── 命令行帮助 · 全部命令均记入系统日志 ──");
      reply("/help · 显示本帮助（Admin / Root-Admin 均可用）");
      reply("/give <用户名> <数量> · 把自己的 Credits 划转给对方（Admin / Root-Admin 均可用）");
      if (isRA) {
        reply("/points · 查询自己当前 Credits（仅 Root-Admin）");
        reply("/me · 查看当前账号与身份（仅 Root-Admin）");
        reply("/redeem <兑换码> · 用 OTP 兑换码给自己充 Credits（仅 Root-Admin）");
        reply("/take <用户名> <数量> · 强制扣除对方 Credits（仅 Root-Admin）");
        reply("/apikey new <用户名> <名称> · 给用户创建 API Key（仅 Root-Admin）");
        reply("/apikey list · 查看全部 API Key（仅 Root-Admin）");
        reply("/apikey del <完整key> · 删除 API Key 并解除绑定（仅 Root-Admin）");
        reply("/clearlog · 清空管理员日志（仅 Root-Admin）");
        reply("注：Credits 只能通过 OTP 兑换码获取（由 Root-Admin 在积分面板生成），/take 可强制扣除");
      } else {
        reply("注：你当前是 Admin，仅可使用 /help 和 /give；其余命令仅 Root-Admin 可用");
      }
      reply("── 帮助结束 ──");
      return;
    }

    if (isAdmin && cmd !== "give") {
      reply("Admin 仅可使用 /give 指令（划转自己的 Credits）");
      return;
    }

    if (cmd === "points") {
      const row = await this.env.DB.prepare("SELECT points FROM accounts WHERE username = ?").bind(user.username).first<{ points: number }>();
      reply("你当前有 " + (row ? row.points : 0) + " Credits");
      return;
    }
    if (cmd === "me") {
      const roleName = isRA ? "Root-Admin" : "Admin";
      reply("账号 " + user.username + " · 身份 " + roleName);
      return;
    }
    if (cmd === "take") {
      if (!isRA) { reply("该命令仅 Root-Admin 可用"); return; }
      const target = parts[1] || "";
      const amount = Math.floor(Number(parts[2]));
      if (!target || !isFinite(amount) || amount < 1) { reply("用法：/take <用户名> <数量>"); return; }
      const row = await this.env.DB.prepare("SELECT points FROM accounts WHERE username = ?").bind(target).first<{ points: number }>();
      if (!row) { reply("用户 " + target + " 不存在"); return; }
      const actual = Math.min(amount, row.points);
      if (actual <= 0) { reply(target + " 当前 0 Credits，无可扣除"); return; }
      await this.env.DB.prepare("UPDATE accounts SET points = points - ? WHERE username = ?").bind(actual, target).run();
      await this.logCredits(target, -actual, "RA 强制扣除");
      await this.log(user.username, "take", "强制扣除 " + target + " " + actual + " Credits");
      reply("已从 " + target + " 强制扣除 " + actual + " Credits · 对方剩余 " + (row.points - actual));
      return;
    }
    if (cmd === "apikey") {
      if (!isRA) { reply("该命令仅 Root-Admin 可用"); return; }
      const sub = (parts[1] || "").toLowerCase();
      if (sub === "new") {
        const owner = parts[2] || "";
        const name = parts.slice(3).join(" ") || "未命名";
        if (!owner) { reply("用法：/apikey new <用户名> <名称>"); return; }
        const exists = await this.env.DB.prepare("SELECT username FROM accounts WHERE username = ?").bind(owner).first();
        if (!exists) { reply("用户 " + owner + " 不存在"); return; }
        const key = "ak-" + toHex(crypto.getRandomValues(new Uint8Array(24)).buffer as ArrayBuffer);
        await this.env.DB.prepare(
          "INSERT INTO api_keys (key, owner, name, created_by, created_at, revoked) VALUES (?, ?, ?, ?, ?, 0)"
        ).bind(key, owner, name, user.username, new Date().toISOString()).run();
        await this.log(user.username, "create_apikey", "创建 API Key 给 " + owner + "（" + name + "）");
        reply("API Key 已创建（只显示这一次，立刻抄走）：");
        reply(key);
        reply("发给 " + owner + " · 对方在游戏大厅「API Key 长期开通」输入绑定 · 之后付费对局免费");
        return;
      }
      if (sub === "list") {
        const { results } = await this.env.DB.prepare(
          "SELECT key, owner, name, revoked, created_at FROM api_keys ORDER BY created_at DESC LIMIT 50"
        ).all<{ key: string; owner: string; name: string | null; revoked: number; created_at: string }>();
        if (!results || !results.length) { reply("暂无 API Key"); return; }
        results.forEach(function (r) {
          reply(r.key.slice(0, 9) + "……" + r.key.slice(-4) + " · " + r.owner + " · " + (r.name || "未命名") + " · " + (r.revoked ? "已删除" : "有效"));
        });
        return;
      }
      if (sub === "del") {
        const key = parts[2] || "";
        if (!key) { reply("用法：/apikey del <完整key>"); return; }
        const row = await this.env.DB.prepare("SELECT owner FROM api_keys WHERE key = ?").bind(key).first<{ owner: string }>();
        if (!row) { reply("API Key 不存在"); return; }
        await this.env.DB.prepare("DELETE FROM api_keys WHERE key = ?").bind(key).run();
        await this.env.DB.prepare("UPDATE accounts SET apikey = NULL WHERE apikey = ?").bind(key).run();
        await this.log(user.username, "del_apikey", "删除 API Key（原属 " + row.owner + "）");
        reply("API Key 已删除 · " + row.owner + " 的绑定已解除，付费功能恢复扣费");
        return;
      }
      reply("用法：/apikey new <用户名> <名称> · /apikey list · /apikey del <完整key>");
      return;
    }
    if (cmd === "clearlog") {
      if (!isRA) { reply("该命令仅 Root-Admin 可用"); return; }
      await this.env.DB.prepare("DELETE FROM admin_logs").run();
      await this.log(user.username, "clearlog", "清空管理员日志");
      reply("管理员日志已清空");
      return;
    }
    if (cmd === "redeem") {
      const code = parts[1] || "";
      if (!code) { reply("用法：/redeem <兑换码>"); return; }
      await ensureOtpColumns(this.env);
      const row = await this.env.DB.prepare("SELECT amount, used_by, expires_at FROM otps WHERE code = ?").bind(code).first<{ amount: number; used_by: string | null; expires_at: string | null }>();
      if (!row) { reply("兑换码不存在"); return; }
      if (row.used_by) { reply("该兑换码已被使用"); return; }
      if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) { reply("兑换码已过期"); return; }
      const now = new Date().toISOString();
      const batch = await this.env.DB.batch([
        this.env.DB.prepare("UPDATE otps SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL").bind(user.username, now, code),
        this.env.DB.prepare("UPDATE accounts SET points = points + ? WHERE username = ?").bind(row.amount, user.username)
      ]);
      if (batch[0].meta.rows_written === 0) { reply("该兑换码已被使用"); return; }
      await this.logCredits(user.username, row.amount, "OTP 兑换");
      this.broadcastToRoom({ type: "sys", text: user.username + " 兑换成功，Credits +" + row.amount }, room);
      const acc = await this.env.DB.prepare("SELECT points FROM accounts WHERE username = ?").bind(user.username).first<{ points: number }>();
      reply("兑换成功：+" + row.amount + " Credits · 当前共 " + (acc ? acc.points : 0) + " Credits");
      return;
    }
    if (cmd === "give") {
      const target = parts[1] || "";
      const amount = Math.floor(Number(parts[2]));
      if (!target || !isFinite(amount) || amount < 1) { reply("用法：/give <用户名> <数量>"); return; }
      const exists = await this.env.DB.prepare("SELECT username FROM accounts WHERE username = ?").bind(target).first();
      if (!exists) { reply("用户 " + target + " 不存在"); return; }
      const from = await this.env.DB.prepare("SELECT points FROM accounts WHERE username = ?").bind(user.username).first<{ points: number }>();
      if (!from || from.points < amount) { reply("你的 Credits 不足（当前 " + (from ? from.points : 0) + "）"); return; }
      await this.env.DB.batch([
        this.env.DB.prepare("UPDATE accounts SET points = points - ? WHERE username = ?").bind(amount, user.username),
        this.env.DB.prepare("UPDATE accounts SET points = points + ? WHERE username = ?").bind(amount, target)
      ]);
      await this.logCredits(user.username, -amount, "划转给 " + target);
      await this.logCredits(target, amount, "收到 " + user.username + " 划转");
      await this.log(user.username, "give", "向 " + target + " 划转 " + amount + " Credits");
      this.broadcastToRoom({ type: "sys", text: user.username + " 向 " + target + " 划转 " + amount + " Credits" }, room);
      return;
    }
    reply("未知命令：" + cmd + " · 输入 /help 查看可用命令");
  }

  private async log(admin: string, action: string, detail: string): Promise<void> {
    try {
      await this.env.DB.prepare("INSERT INTO admin_logs (admin, action, detail, created_at) VALUES (?, ?, ?, ?)")
        .bind(admin, action, detail, new Date().toISOString()).run();
    } catch {}
  }

  private async logCredits(username: string, delta: number, reason: string): Promise<void> {
    try {
      await this.env.DB.prepare("INSERT INTO credits_logs (username, delta, reason, created_at) VALUES (?, ?, ?, ?)")
        .bind(username, delta, reason, new Date().toISOString()).run();
    } catch {}
  }

  webSocketClose(ws: WebSocket): void {
    void this.deleteWsMeta(ws);
    const user = this.users.get(ws);
    this.users.delete(ws);
    this.roomOf.delete(ws);
    if (user) {
      const set = this.byUser.get(user.username);
      if (set) { set.delete(ws); if (!set.size) this.byUser.delete(user.username); }
      const room = this.roomOf.get(ws);
      if (room) {
        this.broadcastToRoom({ type: "sys", text: user.username + " 离开了会话" }, room);
        this.broadcastPresence(room);
      }
    }
  }

  webSocketError(ws: WebSocket): void {
    this.users.delete(ws);
  }

  // =========================================================================
  // WebSocket Hibernation 兼容层
  // Cloudflare 的 DO 在空闲后会被回收/休眠：socket 仍然存活（运行时持有），
  // 但实例的 JS 堆会被丢弃 → 本类的 users / roomOf / byUser 三个内存 Map 全部清空。
  // 后果：handleMessage 里 users.get(ws) 得到 undefined，若静默 return 则
  // 客户端永远收不到任何回执（表现为「进入会话中…」卡死，必须强刷才恢复）。
  //
  // 对策（官方 Hibernation 模式）：
  //   ① 身份（username/role）→ 存进 socket 附件 acceptWebSocket(ws, tags)，跨回收保留
  //   ② 房间归属（可变）      → 存进 DO storage 的 ws_meta 表
  //   ③ 实例醒来时 hydrate()：用 getWebSockets() + 附件 + storage 重建三个内存 Map
  // =========================================================================

  private wsMetaReady = false;
  private hydrated = false;

  private async ensureWsMeta(): Promise<void> {
    if (this.wsMetaReady) return;
    try {
      await this.state.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS ws_meta (id TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT, room TEXT)"
      );
      this.wsMetaReady = true;
    } catch {}
  }

  // getWebSockets() 的返回形状在不同运行时版本下不一致：
  //   ① WebSocketRequest 包装：{ id, webSocket, deserializeAttachment }
  //   ② 直接就是 WebSocket：{ send, close, deserializeAttachment }（无 webSocket 属性）
  // 本项目实测为 ② —— 早前按 ① 取 s.webSocket 会得到 undefined，
  // 导致 hydrate 重建出的 byUser 里塞进 undefined → 推送时 ws.send() 抛
  // 「Cannot read properties of undefined (reading 'send')」→ 定向推送全部丢失。
  private socketOf(req: unknown): WebSocket {
    const o = req as { webSocket?: WebSocket };
    return (o && o.webSocket ? o.webSocket : (req as WebSocket));
  }

  // 读 socket 附件（serializeAttachment 写入，跨休眠保留）
  // ⚠️ 直接用 ws.deserializeAttachment()：不要用 getWebSockets() 里 s.webSocket === ws
  //    做引用比对 —— 休眠醒来后运行时重建的是**新的 JS 包装对象**，引用不相等，
  //    比对会失配 → 身份取不到 → 消息被静默丢弃（表现为「进会话失败、需强刷」）。
  private attachOf(ws: WebSocket): WsAttach | null {
    try {
      const fn = (ws as unknown as { deserializeAttachment?: () => unknown }).deserializeAttachment;
      if (typeof fn === "function") {
        const a = fn.call(ws) as WsAttach | null;
        if (a && a.username) return a;
      }
    } catch {}
    // 兜底：按运行时 socket 列表找一遍（此时无法用引用比对，改用附件 id 比对）
    try {
      for (const req of this.state.getWebSockets()) {
        const sock = this.socketOf(req);
        const a = req.deserializeAttachment() as WsAttach | null;
        if (a && a.username && sock === ws) return a;
      }
    } catch {}
    return null;
  }

  // 取 socket 的稳定键 connId（存在附件里，跨回收不变）
  private socketIdOf(ws: WebSocket): string {
    const a = this.attachOf(ws);
    return a && a.id ? a.id : "";
  }

  private async persistWsMeta(ws: WebSocket, connId: string, username: string, role: string, room: string): Promise<void> {
    try {
      await this.ensureWsMeta();
      const id = connId || this.socketIdOf(ws);
      if (!id) return;
      await this.state.storage.sql.exec(
        "INSERT INTO ws_meta (id, username, role, room) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET username = excluded.username, role = excluded.role, room = excluded.room",
        id, username, role || "", room || ""
      );
    } catch {}
  }

  private async deleteWsMeta(ws: WebSocket): Promise<void> {
    try {
      await this.ensureWsMeta();
      const id = this.socketIdOf(ws);
      if (!id) return;
      await this.state.storage.sql.exec("DELETE FROM ws_meta WHERE id = ?", id);
    } catch {}
  }

  // 解析 socket 的用户：内存缓存优先，miss 时从 socket 附件还原（跨回收保留）
  private resolveUser(ws: WebSocket): RoomUser | null {
    const cached = this.users.get(ws);
    if (cached) return cached;
    const a = this.attachOf(ws);
    if (a && a.username) {
      const user: RoomUser = { username: a.username, role: a.role || "" };
      this.users.set(ws, user);
      return user;
    }
    return null;
  }

  // 从 ws_meta（DO storage）按 connId 读回身份；供实例醒来后还原
  private async userByConnId(connId: string): Promise<RoomUser | null> {
    if (!connId) return null;
    try {
      await this.ensureWsMeta();
      const res = await this.state.storage.sql.exec(
        "SELECT username, role FROM ws_meta WHERE id = ?", connId
      );
      const rows = (res.toArray ? res.toArray() : []) as Array<{ username: string; role: string }>;
      if (rows && rows[0] && rows[0].username) {
        return { username: rows[0].username, role: rows[0].role || "" };
      }
    } catch {}
    return null;
  }

  // 实例醒来（或首次使用）时重建内存映射
  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      await this.ensureWsMeta();
      const socks = this.state.getWebSockets();
      if (!socks.length) return;
      // 读回所有 socket 的身份与房间归属
      const metas = new Map<string, { username: string; role: string; room: string }>();
      try {
        const res = await this.state.storage.sql.exec("SELECT id, username, role, room FROM ws_meta");
        const rows = (res.toArray ? res.toArray() : []) as Array<{ id: string; username: string; role: string; room: string }>;
        for (const r of rows) metas.set(r.id, { username: r.username || "", role: r.role || "", room: r.room || "" });
      } catch {}
      // 清理孤儿行：socket 已断开但 ws_meta 行残留（实例被回收时 webSocketClose 可能不触发）
      try {
        const live = new Set<string>();
        for (const req of socks) {
          const a = req.deserializeAttachment() as WsAttach | null;
          if (a && a.id) live.add(a.id);
        }
        for (const id of metas.keys()) {
          if (!live.has(id)) {
            await this.state.storage.sql.exec("DELETE FROM ws_meta WHERE id = ?", id).catch(() => {});
          }
        }
      } catch {}
      for (const req of socks) {
        const sock = this.socketOf(req);
        const a = req.deserializeAttachment() as WsAttach | null;
        if (!a || !a.username || !sock) continue;
        const user: RoomUser = { username: a.username, role: a.role || "" };
        this.users.set(sock, user);
        if (!this.byUser.has(user.username)) this.byUser.set(user.username, new Set());
        this.byUser.get(user.username)!.add(sock);
        // 房间归属：优先用 storage 里的最新值；附件不含房间（可变状态放 storage）
        const meta = metas.get(a.id);
        const room = (meta && meta.room) || "";
        if (room) this.roomOf.set(sock, room);
      }
    } catch {}
  }

  private sendTo(ws: WebSocket, obj: unknown): void {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      this.users.delete(ws);
    }
  }

  private async loadUpload(fileId: string): Promise<FileAcq | null> {
    try {
      await ensureChatUploadsTable(this.env);
      const r = await this.env.DB.prepare(
        "SELECT file_id AS id, name, size, mime, room, sender, role, seq FROM chat_uploads WHERE file_id = ?"
      ).bind(fileId).first<{ id: string; name: string; size: number; mime: string; room: string; sender: string; role: string; seq: number }>();
      if (!r) return null;
      // seq 以 chat_file_chunks 里实际已落库的最大序号为准，而非 chat_uploads.seq：
      // 若 DO 在「分片 INSERT」与「seq UPDATE」之间被回收，后者会落后 1，
      // 还原后下一片会复用同一 seq，被 INSERT OR REPLACE 覆盖 → 丢数据。
      const mx = await this.env.DB.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM chat_file_chunks WHERE file_id = ?")
        .bind(fileId).first<{ m: number }>();
      const seq = mx && typeof mx.m === "number" ? mx.m : (r.seq || 0);
      return { id: r.id, name: r.name, size: r.size, mime: r.mime || "application/octet-stream", seq: seq, room: r.room, sender: r.sender, role: r.role || "" };
    } catch {
      return null;
    }
  }

  private broadcastBinaryToRoom(buf: ArrayBuffer | Uint8Array, room: string): void {
    if (!room) return;
    for (const [ws, r] of this.roomOf) {
      if (r !== room) continue;
      try {
        ws.send(buf);
      } catch {
        this.users.delete(ws);
      }
    }
  }

  private broadcastToRoom(obj: unknown, room: string, exclude?: WebSocket): void {
    if (!room) return;
    const json = JSON.stringify(obj);
    void json;
    for (const [ws, r] of this.roomOf) {
      if (r !== room || ws === exclude) continue;
      this.sendTo(ws, obj);
    }
  }

  private broadcastPresence(room: string): void {
    if (!room) return;
    let n = 0;
    for (const r of this.roomOf.values()) if (r === room) n++;
    this.broadcastToRoom({ type: "presence", online: n, room: room }, room);
  }
}

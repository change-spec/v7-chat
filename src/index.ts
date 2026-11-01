import { html } from "./html";

export interface Env {
  ROOM: DurableObjectNamespace;
  DB: D1Database;
  // 云存储外部后端（Supabase Storage）。走 Worker secret 注入，绝不下发到前端。
  // 未配置时自动降级为 D1 分片存储（行为不变）。
  SUPABASE_URL?: string;
  SUPABASE_SECRET?: string;
  SUPABASE_BUCKET?: string;
}

const PBKDF2_ITERATIONS = 100000;
const VALID_ROLES = ["observer", "member", "admin"];

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

// 文件计费：统一 1MB / 20 Credits（向上取整，至少 20）
function fileFee(size: number): number {
  return Math.max(20, Math.ceil(Math.max(0, size) / (1024 * 1024)) * 20);
}
// 文字计费：20 字 / 10 Credits（向上取整，至少 10）
function textFee(text: string): number {
  return Math.max(10, Math.ceil(text.length / 20) * 10);
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

// 消息与聊天文件统一保留 7 天：过期自动清除，避免挤占云存储
const MSG_RETENTION_MS = 7 * 24 * 3600 * 1000;
const CHAT_FILE_CAP = 20 * 1024 * 1024; // 单文件落地上限 20MB（更大文件仅实时转发，不入库）
let lastPurgeAt = 0;
async function purgeOldMessages(env: Env, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastPurgeAt < 60 * 1000) return; // 节流：60 秒最多一次
  lastPurgeAt = now;
  const cutoff = new Date(now - MSG_RETENTION_MS).toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM messages WHERE ts < ?").bind(cutoff),
      env.DB.prepare("DELETE FROM chat_files WHERE created_at < ?").bind(cutoff)
    ]);
  } catch {}
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
  const { results } = await env.DB.prepare(
    "SELECT sender, role, text, ts FROM messages WHERE room = ? AND ts >= ? ORDER BY id DESC LIMIT 200"
  ).bind(id, new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()).all<{ sender: string; role: string; text: string; ts: string }>();
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

async function createAccount(env: Env, username: string, password: string, role: string): Promise<void> {
  const salt = randomSalt();
  const passHash = await hashPassword(password, salt.buffer as ArrayBuffer);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO accounts (username, pass_hash, salt, role, points, created_at) VALUES (?, ?, ?, ?, 0, ?)"
  ).bind(username, passHash, toHex(salt.buffer as ArrayBuffer), role, now).run();
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const username = (body.username || "").trim();
  const password = body.password || "";
  const invalid = validateCredentials(username, password);
  if (invalid) return json({ error: invalid }, 400);

  await ensureSchema(env);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first<{ n: number }>();
  const isBootstrap = count && count.n === 0;

  if (!isBootstrap) {
    const user = await authUser(request, env);
    if (!user || (user.role !== "admin" && user.role !== "root-admin")) {
      return json({ error: "公开注册已关闭，账号由 Root-Admin 统一创建" }, 403);
    }
  }

  const exists = await env.DB.prepare("SELECT username FROM accounts WHERE username = ?").bind(username).first();
  if (exists) {
    return json({ error: "用户名已被占用" }, 409);
  }

  const role = isBootstrap ? "root-admin" : "member";
  await createAccount(env, username, password, role);
  // 注册即与 Root-Admin 建立一条 B 类私聊（dm:<user>），并确保 Geek公告群存在
  await ensureBuiltins(env, username);
  const token = await issueSession(env, username);
  return json({ token, username, role });
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
  if (role === "admin") {
    const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role = 'admin'").first<{ n: number }>();
    if (cnt && cnt.n >= MAX_ADMINS) {
      return json({ error: "管理员席位已满（" + MAX_ADMINS + "/" + MAX_ADMINS + "）" }, 409);
    }
  }
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
        created_at TEXT NOT NULL
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
      )`)
    ]);
    // 旧库补列：单独执行，避免 ALTER 失败导致整个 batch 回滚（导致表建不出来）
    // storage（supabase = 二进制在 Supabase Storage；d1 = 在 cloud_file_chunks 分片里）
    try { await env.DB.prepare("ALTER TABLE cloud_files ADD COLUMN storage TEXT").run(); } catch {}
    try { await env.DB.prepare("UPDATE cloud_files SET storage = 'd1' WHERE storage IS NULL").run(); } catch {}
    // otps.expires_at：兑换码有效期。旧库建表时没有这列，
    // 而 handleCreateOtp 要写入它 → Workers 抛未捕获异常 → 接口返回 "error code: 1101"。
    try { await env.DB.prepare("ALTER TABLE otps ADD COLUMN expires_at TEXT").run(); } catch {}
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
  const salary = await ensureDailySalary(env, user);
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
  const { results } = await env.DB.prepare(
    "SELECT admin, action, detail, created_at FROM admin_logs ORDER BY id DESC LIMIT 100"
  ).all<{ admin: string; action: string; detail: string; created_at: string }>();
  return json({ logs: results || [] });
}

// ===== 对弈房间系统 =====
const GAME_FEE = 5;

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

// ===== 群设置：成员列表 / 加群密码 / 转让 / 踢人 / 禁言 / 解散 =====
async function getRoomRow(env: Env, id: string): Promise<{ id: string; name: string; type: string; creator: string; passcode: string | null } | null> {
  return await env.DB.prepare("SELECT id, name, type, creator, passcode FROM rooms WHERE id = ?").bind(id)
    .first<{ id: string; name: string; type: string; creator: string; passcode: string | null }>();
}

function isGeek(room: { id: string }): boolean {
  return room.id === "geek";
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
  return json({
    id: room.id, name: room.name, type: room.type, creator: room.creator,
    passcode: isGeek(room) ? null : (room.passcode || ""),
    members
  });
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
  const free = room === "geek" && user.role === "root-admin";
  const cost = free ? 0 : fileFee(size);
  const row = await env.DB.prepare("SELECT points FROM accounts WHERE username = ?").bind(user.username).first<{ points: number }>();
  const balance = row ? row.points : 0;
  return json({ cost: cost, free: free, balance: balance, enough: free || balance >= cost });
}

function gameTypeName(type: string): string {
  if (type === "xiangqi") return "中国象棋";
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
  const cost = fileFee(size);
  const room = (body.room || "").trim();
  // 免费仅两处：公告群里 Root-Admin 下载、自己发送的文件
  const freeRoom = room === "geek" && user.role === "root-admin";
  if (freeRoom) return json({ ok: true, cost: 0, free: true });
  if (!(await spendCredits(env, user.username, cost))) {
    return json({ error: "Credits 不足：下载该文件需 " + cost + " Credits（1MB/20Credits，" + fmtBytes(size) + "）" }, 402);
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
const CLOUD_CAP_MB = 60;
const RA_CLOUD_MB = 1024; // Root-Admin 专属免费云空间：1GB 永久（Supabase Storage 免费额度内）
const CLOUD_MONTH_MS = 30 * 24 * 3600 * 1000;
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
  const balance = await pointsOf(env, user.username);
  const used = await sumCloudUsed(env, user.username);
  const files = await countCloudFiles(env, user.username);
  if (isRA) {
    return {
      isRA: true, kind: "free", totalMb: RA_CLOUD_MB, usedMb: used / (1024 * 1024),
      expiresAt: "永久", autoRenew: false, expired: false, hasFiles: files > 0, fileCount: files,
      costPerMb: CLOUD_COST_PER_MB, capMb: RA_CLOUD_MB, balance
    };
  }
  const sub = await getCloudSub(env, user.username);
  let expired = false;
  let expiresAt: string | null = null;
  if (sub) {
    expiresAt = sub.expires_at;
    if (sub.kind !== "free" && sub.expires_at && new Date(sub.expires_at).getTime() < Date.now()) {
      expired = true;
      if (sub.auto_renew) {
        const cost = sub.total_mb * CLOUD_COST_PER_MB;
        if (balance >= cost) {
          await spendCredits(env, user.username, cost);
          await logCredits(env, user.username, -cost, "云空间自动续费");
          const next = new Date(Date.now() + CLOUD_MONTH_MS).toISOString();
          await env.DB.prepare("UPDATE cloud_subs SET expires_at = ?, used_mb = ? WHERE username = ?")
            .bind(next, used / (1024 * 1024), user.username).run();
          expired = false; expiresAt = next;
        }
      }
    }
  }
  return {
    isRA: false, kind: sub ? sub.kind : "none", totalMb: sub ? sub.total_mb : 0,
    usedMb: used / (1024 * 1024), expiresAt, autoRenew: sub ? !!sub.auto_renew : false,
    expired, hasFiles: files > 0, fileCount: files,
    costPerMb: CLOUD_COST_PER_MB, capMb: CLOUD_CAP_MB, balance
  };
}

async function handleCloudStatus(request: Request, env: Env): Promise<Response> {
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
  if (cur + mb > CLOUD_CAP_MB) return json({ error: "超出上限：当前已购 " + cur + "MB，每账号最多 " + CLOUD_CAP_MB + "MB" }, 409);
  const cost = mb * CLOUD_COST_PER_MB;
  const bal = await pointsOf(env, user.username);
  if (bal < cost) return json({ error: "Credits 不足：购买 " + mb + "MB 需 " + cost + " Credits（" + mb + " × " + CLOUD_COST_PER_MB + "）" }, 402);
  await spendCredits(env, user.username, cost);
  await logCredits(env, user.username, -cost, "购买云空间 " + mb + "MB");
  const now = new Date();
  if (!sub) {
    await env.DB.prepare("INSERT INTO cloud_subs (username, total_mb, used_mb, expires_at, auto_renew, kind, created_at) VALUES (?, ?, 0, ?, ?, 'paid', ?)")
      .bind(user.username, mb, new Date(now.getTime() + CLOUD_MONTH_MS).toISOString(), body.autoRenew ? 1 : 0, now.toISOString()).run();
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
  const { results } = await env.DB.prepare("SELECT id, name, size, mime, created_at FROM cloud_files WHERE owner = ? ORDER BY created_at DESC")
    .bind(user.username).all<{ id: string; name: string; size: number; mime: string | null; created_at: string }>();
  return json({ files: results || [] });
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

// 写入云文件二进制：优先 Supabase，失败则降级为 D1 分片
// 返回实际使用的后端标识（"supabase" | "d1"）
async function storeCloudBytes(env: Env, fileId: string, bytes: Uint8Array, mime: string): Promise<string> {
  if (sbEnabled(env)) {
    try {
      const url = env.SUPABASE_URL + "/storage/v1/object/" + sbBucket(env) + "/" + sbObjectPath(fileId);
      const res = await fetch(url, {
        method: "POST",
        headers: sbHeaders(env, { "Content-Type": mime || "application/octet-stream", "x-upsert": "true" }),
        body: bytes as unknown as BodyInit
      });
      if (res.ok) return "supabase";
      console.error("Supabase 上传失败，降级到 D1：", res.status, (await res.text()).slice(0, 200));
    } catch (e) {
      console.error("Supabase 上传异常，降级到 D1：", e);
    }
  }
  // 降级：D1 分片存储（每片 ~60KB base64，避免单格超限）
  const b64 = bytesToBase64(bytes);
  const CH = 60000;
  const inserts: any[] = [];
  for (let i = 0, seq = 1; i < b64.length; i += CH, seq++) {
    inserts.push(env.DB.prepare("INSERT INTO cloud_file_chunks (file_id, seq, data) VALUES (?, ?, ?)").bind(fileId, seq, b64.slice(i, i + CH)));
    if (inserts.length >= 100) { await env.DB.batch(inserts); inserts.length = 0; }
  }
  if (inserts.length) await env.DB.batch(inserts);
  return "d1";
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
  const { results } = await env.DB.prepare("SELECT data FROM cloud_file_chunks WHERE file_id = ? ORDER BY seq ASC").bind(fileId).all<{ data: string }>();
  const b64 = (results || []).map((r) => r.data).join("");
  if (!b64) return null;
  return base64ToBytes(b64);
}

// 删除云文件二进制
async function deleteCloudBytes(env: Env, fileId: string, storage: string | null): Promise<void> {
  if (storage === "supabase" && sbEnabled(env)) {
    try {
      const url = env.SUPABASE_URL + "/storage/v1/object/" + sbBucket(env) + "/" + sbObjectPath(fileId);
      await fetch(url, { method: "DELETE", headers: sbHeaders(env) });
    } catch (e) {
      console.error("Supabase 删除失败：", e);
    }
  }
  await env.DB.prepare("DELETE FROM cloud_file_chunks WHERE file_id = ?").bind(fileId).run();
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
    await env.DB.prepare("DELETE FROM cloud_file_chunks WHERE file_id IN (SELECT id FROM cloud_files WHERE owner = ?)").bind(user.username).run();
    await env.DB.prepare("DELETE FROM cloud_files WHERE owner = ?").bind(user.username).run();
    await env.DB.prepare("DELETE FROM cloud_subs WHERE username = ?").bind(user.username).run();
    return json({ ok: true, unsubbed: "all", ...(await cloudStatus(env, user)) });
  }
  // 按 MB 退订：从最旧文件开始删，释放 >= removeMb MB
  let toFree = removeMb * 1024 * 1024;
  const { results } = await env.DB.prepare("SELECT id, size FROM cloud_files WHERE owner = ? ORDER BY created_at ASC")
    .bind(user.username).all<{ id: string; size: number }>();
  for (const f of (results || [])) {
    if (toFree <= 0) break;
    await env.DB.prepare("DELETE FROM cloud_file_chunks WHERE file_id = ?").bind(f.id).run();
    await env.DB.prepare("DELETE FROM cloud_files WHERE id = ? AND owner = ?").bind(f.id, user.username).run();
    toFree -= f.size;
  }
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
  const storage = await storeCloudBytes(env, id, new Uint8Array(buf), mime);
  await env.DB.prepare("INSERT INTO cloud_files (id, owner, name, size, mime, data, storage, created_at) VALUES (?, ?, ?, ?, ?, '', ?, ?)")
    .bind(id, user.username, name, size, mime, storage, now).run();
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
  // 转载按正常发送价扣费（文件 1MB/20Credits），所有人适用（含 Root-Admin）
  const cost = fileFee(f.size);
  const bal = await pointsOf(env, user.username);
  if (bal < cost) return json({ error: "Credits 不足：转载需 " + cost + " Credits（1MB/20Credits）", balance: bal }, 402);
  await spendCredits(env, user.username, cost);
  await logCredits(env, user.username, -cost, "云文件转载");
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

async function handleCloudRenew(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  if (user.role === "root-admin") return json({ error: "Root-Admin 云空间为免费永久" }, 400);
  let body: { autoRenew?: boolean };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const sub = await getCloudSub(env, user.username);
  if (!sub) return json({ error: "你还没有云空间" }, 400);
  await env.DB.prepare("UPDATE cloud_subs SET auto_renew = ? WHERE username = ?").bind(body.autoRenew ? 1 : 0, user.username).run();
  return json({ ok: true, ...(await cloudStatus(env, user)) });
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

// 商品列表：在售 + 我卖出的
async function handleMarketList(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const { results } = await env.DB.prepare(
    "SELECT id, seller, name, size, mime, desc, price, sold, buyer, sold_at, created_at FROM market_items ORDER BY created_at DESC LIMIT 100"
  ).all<any>();
  const items = (results || []).map((r) => ({
    id: r.id, seller: r.seller, name: r.name, size: r.size, mime: r.mime,
    desc: r.desc, price: r.price, sold: !!r.sold, buyer: r.buyer,
    soldAt: r.sold_at, createdAt: r.created_at,
    mine: r.seller === user.username
  }));
  return json({ items, balance: await pointsOf(env, user.username) });
}

// 上架商品：文件 + 名称 + 描述 + 价格
async function handleMarketUpload(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const url = new URL(request.url);
  const name = (url.searchParams.get("name") || "file").slice(0, 200);
  const mime = (url.searchParams.get("mime") || "application/octet-stream").slice(0, 200);
  const desc = (url.searchParams.get("desc") || "").slice(0, 500);
  const price = Math.floor(Number(url.searchParams.get("price")));
  if (!isFinite(price) || price < 1 || price > MARKET_MAX_PRICE) {
    return json({ error: "标价限 1-" + MARKET_MAX_PRICE + " Credits" }, 400);
  }
  let buf: ArrayBuffer;
  try { buf = await request.arrayBuffer(); } catch { return json({ error: "读取文件失败" }, 400); }
  const size = buf.byteLength;
  if (size <= 0) return json({ error: "空文件" }, 400);
  if (size > MARKET_FILE_CAP) {
    return json({ error: "文件 " + fmtMB(size) + "MB 超过上限 " + (MARKET_FILE_CAP / (1024 * 1024)) + "MB" }, 413);
  }
  const id = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const storage = await storeMarketBytes(env, id, new Uint8Array(buf), mime);
  await env.DB.prepare(
    "INSERT INTO market_items (id, seller, name, size, mime, desc, price, storage, sold, buyer, sold_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?)"
  ).bind(id, user.username, name, size, mime, desc, price, storage, new Date().toISOString()).run();
  await logCredits(env, user.username, 0, "上架商品 " + name + "（标价 " + price + " Credits）");
  return json({ ok: true, id, price, size, balance: await pointsOf(env, user.username) });
}

// 购买：扣买家总价 → 5% 手续费 → 95% 给卖家
async function handleMarketBuy(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { id?: string };
  try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const id = (body.id || "").trim();
  if (!id) return json({ error: "缺少商品" }, 400);
  const item = await env.DB.prepare("SELECT * FROM market_items WHERE id = ?").bind(id).first<any>();
  if (!item) return json({ error: "商品不存在" }, 404);
  if (item.sold) return json({ error: "该商品已被购买" }, 409);
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

  // 标记已售（用条件更新防止并发重复售出）
  const upd = await env.DB.prepare("UPDATE market_items SET sold = 1, buyer = ?, sold_at = ? WHERE id = ? AND sold = 0")
    .bind(user.username, new Date().toISOString(), id).run();
  const changed = (upd as any).meta && (upd as any).meta.changes;
  if (changed === 0) {
    // 并发下被别的买家抢先 —— 回滚本次扣款
    await env.DB.prepare("UPDATE accounts SET points = points + ? WHERE username = ?").bind(price, user.username).run();
    if (payout > 0) await env.DB.prepare("UPDATE accounts SET points = points - ? WHERE username = ?").bind(payout, item.seller).run();
    return json({ error: "该商品刚被其他人买走" }, 409);
  }
  return json({ ok: true, price, fee, payout, balance: await pointsOf(env, user.username) });
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
  if (item.sold) return json({ error: "已售出的商品无法下架" }, 409);
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
  if (!item) return json({ error: "商品不存在" }, 404);
  if (!item.sold && item.seller !== user.username) {
    return json({ error: "该商品未售出，暂不能下载" }, 403);
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


const MATCH3_FEE = 10;

async function handleGameCreate(request: Request, env: Env): Promise<Response> {
  // 建房入口已统一收敛到 SHOP（/api/shop/buy），此处不再开放直接创建
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  return json({ error: "房间号请通过 SHOP 购买（支持代购）" }, 403);
}


// ===== SHOP：购买房间号（唯一建房入口；消消乐暂时故障，扣费后不开局）=====
async function handleShopBuy(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  // SHOP 已关闭：所有游戏均提示故障，不售卖房间号（不扣费），游戏引擎不动
  return json({ error: "游戏故障 · SHOP 暂停售卖房间号，已购房间号仍可正常加入" }, 503);
}

async function handleGameJoin(request: Request, env: Env): Promise<Response> {
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
  if (row.opponent) return json({ error: "房间已满" }, 409);
  if (row.status !== "waiting") return json({ error: "房间已开始或已结束" }, 409);
  // 房主本人（含被代购的房主）可以进自己买的房间：免费，直接进入等待界面
  if (row.creator === user.username) {
    return json({ ok: true, roomId: id, type: row.type, creator: row.creator, self: true });
  }
  return json({ ok: true, roomId: id, type: row.type, creator: row.creator });
}

async function handleGamePaySelf(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const id = (body.roomId || "").trim().toUpperCase();
  const row = await env.DB.prepare("SELECT id, type, creator, opponent, status FROM games WHERE id = ?").bind(id).first<{ type: string; creator: string; opponent: string | null; status: string }>();
  if (!row) return json({ error: "房间不存在" }, 404);
  if (row.type === "match3") return json({ error: "消消乐是单人游戏，无需加入" }, 400);
  if (row.creator === user.username) return json({ error: "不能加入自己创建的房间" }, 400);
  if (row.opponent) return json({ error: "房间已满" }, 409);
  if (row.status !== "waiting") return json({ error: "房间已开始或已结束" }, 409);
  const keyActive = await hasActiveApiKey(env, user.username);
  if (!keyActive && !(await spendCredits(env, user.username, GAME_FEE))) {
    return json({ error: "Credits 不足，进入需要 " + GAME_FEE + " Credits（或绑定有效 API Key 免费）" }, 402);
  }
  if (!keyActive) await logCredits(env, user.username, -GAME_FEE, "加入对弈房间");
  await env.DB.prepare("UPDATE games SET opponent = ?, payer = ?, status = 'ready' WHERE id = ?").bind(user.username, keyActive ? "apikey" : "self", id).run();
  await notifyRoom(env, { type: "game-join", roomId: id, opponent: user.username, payer: keyActive ? "apikey" : "self" });
  return json({ ok: true, roomId: id });
}

async function handleGamePayRequest(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const id = (body.roomId || "").trim().toUpperCase();
  const row = await env.DB.prepare("SELECT id, type, creator, opponent, status FROM games WHERE id = ?").bind(id).first<{ type: string; creator: string; opponent: string | null; status: string }>();
  if (!row) return json({ error: "房间不存在" }, 404);
  if (row.type === "match3") return json({ error: "消消乐是单人游戏，无需加入" }, 400);
  if (row.creator === user.username) return json({ error: "不能加入自己创建的房间" }, 400);
  if (row.opponent) return json({ error: "房间已满" }, 409);
  if (row.status !== "waiting") return json({ error: "房间已开始或已结束" }, 409);
  const pending = await env.DB.prepare(
    "SELECT id FROM game_requests WHERE room_id = ? AND from_user = ? AND status = 'pending'"
  ).bind(id, user.username).first();
  if (pending) return json({ error: "已发送过代付请求，等对方回应" }, 409);
  const now = new Date().toISOString();
  const ins = await env.DB.prepare(
    "INSERT INTO game_requests (room_id, from_user, kind, status, created_at) VALUES (?, ?, 'pay_for_me', 'pending', ?)"
  ).bind(id, user.username, now).run();
  const requestId = ins.meta.last_row_id;
  await notifyRoom(env, { type: "game-invite", requestId: requestId, roomId: id, from: user.username, gameType: row.type });
  return json({ ok: true, requestId: requestId });
}

async function handleGamePayRespond(request: Request, env: Env): Promise<Response> {
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
  const game = await env.DB.prepare("SELECT id, creator, opponent, status FROM games WHERE id = ?").bind(req.room_id).first<{ creator: string; opponent: string | null; status: string }>();
  if (!game || game.creator !== user.username) return json({ error: "只有房主可以回应代付请求" }, 403);

  if (!body.accept) {
    await env.DB.prepare("UPDATE game_requests SET status = 'rejected' WHERE id = ?").bind(reqId).run();
    await notifyRoom(env, { type: "game-respond", requestId: reqId, roomId: req.room_id, accepted: false });
    return json({ ok: true, rejected: true });
  }
  if (game.opponent) {
    await env.DB.prepare("UPDATE game_requests SET status = 'rejected' WHERE id = ?").bind(reqId).run();
    return json({ error: "房间已满" }, 409);
  }
  if (!(await spendCredits(env, user.username, GAME_FEE))) {
    return json({ error: "你的 Credits 不足，代付需要 " + GAME_FEE + " Credits" }, 402);
  }
  await logCredits(env, user.username, -GAME_FEE, "代付好友对弈费");
  await env.DB.prepare("UPDATE game_requests SET status = 'accepted' WHERE id = ?").bind(reqId).run();
  await env.DB.prepare("UPDATE games SET opponent = ?, payer = ?, status = 'ready' WHERE id = ?").bind(req.from_user, user.username, req.room_id).run();
  await notifyRoom(env, { type: "game-join", roomId: req.room_id, opponent: req.from_user, payer: user.username });
  await notifyRoom(env, { type: "game-respond", requestId: reqId, roomId: req.room_id, accepted: true });
  return json({ ok: true });
}

async function handleGameStart(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const id = (body.roomId || "").trim().toUpperCase();
  const row = await env.DB.prepare("SELECT id, type, creator, opponent, status FROM games WHERE id = ?").bind(id).first<{ type: string; creator: string; opponent: string | null; status: string }>();
  if (!row) return json({ error: "房间不存在" }, 404);
  if (row.creator !== user.username) return json({ error: "只有房主可以开始棋局" }, 403);
  if (!row.opponent || row.status !== "ready") return json({ error: "等待对手加入并完成支付" }, 409);
  await env.DB.prepare("UPDATE games SET status = 'playing' WHERE id = ?").bind(id).run();
  await notifyRoom(env, { type: "game-start", roomId: id, gameType: row.type });
  return json({ ok: true });
}

async function handleGameEnd(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  let body: { roomId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式错误" }, 400);
  }
  const id = (body.roomId || "").trim().toUpperCase();
  const row = await env.DB.prepare("SELECT id, creator, status FROM games WHERE id = ?").bind(id).first<{ creator: string; status: string }>();
  if (!row) return json({ error: "房间不存在" }, 404);
  if (row.creator !== user.username) return json({ error: "只有房主可以结束房间" }, 403);
  if (row.status === "ended") return json({ ok: true });
  await env.DB.prepare("UPDATE games SET status = 'ended' WHERE id = ?").bind(id).run();
  await notifyRoom(env, { type: "game-end", roomId: id });
  return json({ ok: true });
}

async function handleGameState(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return json({ error: "未登录" }, 401);
  const url = new URL(request.url);
  const id = (url.searchParams.get("roomId") || "").trim().toUpperCase();
  const row = await env.DB.prepare(
    "SELECT id, type, creator, opponent, status, payer, turn, winner FROM games WHERE id = ?"
  ).bind(id).first<{ id: string; type: string; creator: string; opponent: string | null; status: string; payer: string | null; turn: string | null; winner: string | null }>();
  if (!row) return json({ error: "房间不存在" }, 404);
  return json({ game: row, iAm: user.username, iAmCreator: row.creator === user.username });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
    if (url.pathname === "/api/register" && request.method === "POST") return handleRegister(request, env);
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
    if (url.pathname === "/api/game/end" && request.method === "POST") return handleGameEnd(request, env);
    if (url.pathname === "/api/game/state" && request.method === "GET") return handleGameState(request, env);
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
    // 文件资源商店
    if (url.pathname === "/api/market/list" && request.method === "GET") return handleMarketList(request, env);
    if (url.pathname === "/api/market/upload" && request.method === "POST") return handleMarketUpload(request, env);
    if (url.pathname === "/api/market/buy" && request.method === "POST") return handleMarketBuy(request, env);
    if (url.pathname === "/api/market/remove" && request.method === "POST") return handleMarketRemove(request, env);
    if (url.pathname === "/api/market/file" && request.method === "GET") return handleMarketFile(request, env);

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


  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/notify" && request.method === "POST") {
      try {
        const body = await request.json() as { room?: string };
        this.broadcastToRoom(body, (body && body.room) || "geek");
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
      this.state.acceptWebSocket(server);
      this.users.set(server, { username: row.username, role: row.role });
      if (!this.byUser.has(row.username)) this.byUser.set(row.username, new Set());
      this.byUser.get(row.username)!.add(server);
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
    const user = this.users.get(ws);
    if (!user) return;
    if (typeof message !== "string") {
      if (message instanceof ArrayBuffer) {
        const acq = this.fileBuf.get(ws);
        // 每收到一块二进制立即落库（按 file_id+seq），保证帧乱序/DO 重置也不丢块
        if (acq) {
          acq.seq++;
          try {
            await this.env.DB.prepare("INSERT OR REPLACE INTO chat_file_chunks (file_id, seq, data) VALUES (?, ?, ?)")
              .bind(acq.id, acq.seq, bytesToBase64(new Uint8Array(message))).run();
          } catch {}
        }
        this.broadcastBinaryToRoom(message, this.roomOf.get(ws) || "");
      }
      return;
    }
    let data: { text?: string; type?: string; room?: string; id?: string; name?: string; size?: number; mime?: string };
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
      void purgeOldMessages(this.env);
      const { results } = await this.env.DB.prepare(
        "SELECT sender, role, text, ts FROM messages WHERE room = ? AND ts >= ? ORDER BY id DESC LIMIT 200"
      ).bind(room, new Date(Date.now() - MSG_RETENTION_MS).toISOString()).all<{ sender: string; role: string; text: string; ts: string }>();
      this.sendTo(ws, { type: "history", room: room, messages: (results || []).reverse() });
      this.broadcastToRoom({ type: "sys", text: user.username + " 进入了会话" }, room);
      this.broadcastPresence(room);
      return;
    }

      // 文件传输：非成员禁发；公告群仅 RA 可发；观测者仅可在与 RA 的私聊里发；仅广播给同房
      if (typeof data.type === "string" && data.type.indexOf("file-") === 0) {
        const room = this.roomOf.get(ws) || "";
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
        const size = Math.max(0, Number(data.size) || 0);
        const freeRoom = room === "geek" && user.role === "root-admin";
        // 文件上传计费：统一 1MB / 20 Credits（向上取整，至少 20）；
        // 唯一免费场景：公告群里 Root-Admin 发布；其余一切房间都扣费
        if (data.type === "file-start" && !freeRoom) {
          const cost = fileFee(size);
          if (!(await spendCredits(this.env, user.username, cost))) {
            this.sendTo(ws, { type: "sys", text: "Credits 不足：上传文件需 " + cost + " Credits（1MB/20Credits，当前文件 " + fmtBytes(size) + "）" });
            return;
          }
          await logCredits(this.env, user.username, -cost, "文件上传");
        }
        // 准备服务端落盘缓冲（作为聊天记录保留 7 天，与 messages 同步清理）；分块在收到时即时落库
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
        // 文件收尾：从 chat_file_chunks 按 seq 拼回字节，落地进 chat_files，并写入一条文件消息记录（历史可见，7 天后自动清除）
        if (data.type === "file-end") {
          const acq = this.fileBuf.get(ws);
          if (acq) {
            this.fileBuf.delete(ws);
            try {
              if (acq.size <= CHAT_FILE_CAP) {
                const { results } = await this.env.DB.prepare(
                  "SELECT data FROM chat_file_chunks WHERE file_id = ? ORDER BY seq ASC"
                ).bind(acq.id).all<{ data: string }>();
                const parts = (results || []).map((r) => base64ToBytes(r.data));
                const bytes = concatBytes(parts);
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
              }
            } catch {}
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
      this.sendTo(ws, { type: "sys", text: "请先进入一个房间再发言" });
      return;
    }

    // 公告群：仅 Root-Admin 可发言，其他成员只能阅读
    if (room === "geek" && user.role !== "root-admin") {
      this.sendTo(ws, { type: "sys", text: "Geek公告群仅 Root-Admin 可发布消息，其他成员只能阅读" });
      return;
    }

    // 观测者只能围观，例外：与 Root-Admin 的私聊（dm:<用户名>）里可以发言
    if (user.role === "observer" && room !== "dm:" + user.username) {
      this.sendTo(ws, { type: "sys", text: "观测者只能围观，仅可在「与 Root-Admin 的私聊」里发言" });
      return;
    }

    // 禁言检查：群主/Admin 可对普通成员禁言 1-24 小时，中途不能结束（Geek公告群无需禁言）
    if (room !== "geek") {
      const mute = await this.env.DB.prepare("SELECT until FROM room_mutes WHERE room = ? AND username = ?")
        .bind(room, user.username).first<{ until: string }>();
      if (mute) {
        const untilMs = new Date(mute.until).getTime();
        if (untilMs > Date.now()) {
          this.sendTo(ws, { type: "sys", text: "你已被禁言（至 " + mute.until.slice(0, 16).replace("T", " ") + "），期间不能发言" });
          return;
        }
      }
    }

    // 发言计费：公告群仅 Root-Admin 可发（免费）；其它群 20 字 / 10 Credits（向上取整至少 10）；
    // 所有人都扣（含 Root-Admin），唯一例外是 Geek 公告群（仅 Root-Admin 可发，免费）
    if (room !== "geek") {
      const cost = textFee(text);
      if (!(await spendCredits(this.env, user.username, cost))) {
        this.sendTo(ws, { type: "sys", text: "Credits 不足：本房间发言需 " + cost + " Credits（20 字/10Credits，本条 " + text.length + " 字）" });
        return;
      }
      await logCredits(this.env, user.username, -cost, "群聊发言");
    }

    const ts = new Date().toISOString();
    const curRoom = room;
    this.state.blockConcurrencyWhile(async () => {
      await this.env.DB.prepare("INSERT INTO messages (room, sender, role, text, ts) VALUES (?, ?, ?, ?, ?)")
        .bind(curRoom, user.username, user.role, text, ts).run();
      await purgeOldMessages(this.env);
    });
    this.broadcastToRoom({ type: "msg", sender: user.username, role: user.role, text, ts, room: curRoom }, curRoom);
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

  private sendTo(ws: WebSocket, obj: unknown): void {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      this.users.delete(ws);
    }
  }

  private broadcastBinaryToRoom(buf: ArrayBuffer, room: string): void {
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

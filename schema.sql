CREATE TABLE IF NOT EXISTS accounts (
  username TEXT PRIMARY KEY,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  points INTEGER NOT NULL DEFAULT 0,
  last_daily_at TEXT,
  apikey TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otps (
  code TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  used_by TEXT,
  used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  sender TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  text TEXT NOT NULL,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
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
);

CREATE TABLE IF NOT EXISTS game_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  from_user TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'pay_for_me',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS credits_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  creator TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  room TEXT NOT NULL,
  username TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (room, username)
);

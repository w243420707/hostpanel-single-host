import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "../data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "hostpanel.db");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS admin_user (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  result_json TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  target TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  stage TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);
`);

export function nowIso() {
  return new Date().toISOString();
}

export function setAdminUser(username, passwordHash) {
  const stmt = db.prepare(`
    INSERT INTO admin_user (id, username, password_hash, updated_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      password_hash = excluded.password_hash,
      updated_at = excluded.updated_at
  `);
  stmt.run(username, passwordHash, nowIso());
}

export function getAdminUser() {
  return db.prepare("SELECT id, username, password_hash FROM admin_user WHERE id = 1").get();
}

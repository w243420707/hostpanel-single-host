import "dotenv/config";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createInstance, ensureImageExists, runInstanceAction } from "./incus.js";

const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "../data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "hostpanel.db"));

db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  stage TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);
`);

function nowIso() {
  return new Date().toISOString();
}

function claimNextTask() {
  const row = db
    .prepare("SELECT id, type, payload_json FROM tasks WHERE status = 'waiting' ORDER BY id ASC LIMIT 1")
    .get();
  if (!row) {
    return null;
  }

  const updated = db
    .prepare("UPDATE tasks SET status='running', started_at=? WHERE id=? AND status='waiting'")
    .run(nowIso(), row.id);

  if (updated.changes === 0) {
    return null;
  }

  return {
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payload_json || "{}")
  };
}

function addTaskLog(taskId, stage, message) {
  db.prepare("INSERT INTO task_logs(task_id, stage, message, created_at) VALUES(?, ?, ?, ?)").run(
    taskId,
    stage,
    String(message || ""),
    nowIso()
  );
}

function completeTask(id, result) {
  db.prepare("UPDATE tasks SET status='success', result_json=?, ended_at=? WHERE id=?").run(
    JSON.stringify(result || {}),
    nowIso(),
    id
  );
}

function failTask(id, error) {
  db.prepare("UPDATE tasks SET status='failed', error_text=?, ended_at=? WHERE id=?").run(
    String(error?.message || error || "unknown_error"),
    nowIso(),
    id
  );
}

async function executeTask(task) {
  if (task.type === "create_instance") {
    addTaskLog(task.id, "validate", "checking image alias and resource parameters");
    await ensureImageExists(task.payload.image);
    addTaskLog(task.id, "launch", `launching instance ${task.payload.name} from ${task.payload.image}`);
    await createInstance(task.payload);
    addTaskLog(task.id, "done", "instance created");
    return { ok: true };
  }
  if (task.type === "instance_action") {
    addTaskLog(task.id, "action", `${task.payload.action} ${task.payload.name}`);
    await runInstanceAction(task.payload);
    addTaskLog(task.id, "done", "action completed");
    return { ok: true };
  }
  throw new Error("unknown_task_type");
}

async function tick() {
  const task = claimNextTask();
  if (!task) {
    return;
  }

  try {
    addTaskLog(task.id, "running", "task started");
    const result = await executeTask(task);
    completeTask(task.id, result);
  } catch (error) {
    addTaskLog(task.id, "failed", error?.message || "task failed");
    failTask(task.id, error);
  }
}

async function main() {
  console.log("[hostpanel-worker] started");
  setInterval(() => {
    tick().catch((error) => {
      console.error("[hostpanel-worker] tick failed", error);
    });
  }, 1500);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

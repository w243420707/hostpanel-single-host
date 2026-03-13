import "dotenv/config";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createInstance, runInstanceAction } from "./incus.js";

const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "../data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "hostpanel.db"));

db.pragma("journal_mode = WAL");

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
    await createInstance(task.payload);
    return { ok: true };
  }
  if (task.type === "instance_action") {
    await runInstanceAction(task.payload);
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
    const result = await executeTask(task);
    completeTask(task.id, result);
  } catch (error) {
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

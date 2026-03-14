import "dotenv/config";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  addPortRangeMappings,
  addSshPortMappings,
  createInstance,
  ensureImageExists,
  ensureInstanceNotExists,
  runInstanceAction,
  setRootPassword
} from "./incus.js";

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

CREATE TABLE IF NOT EXISTS instance_access (
  instance_name TEXT PRIMARY KEY,
  ssh_port INTEGER NOT NULL,
  ssh_password TEXT NOT NULL,
  port_start INTEGER NOT NULL,
  port_end INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPassword(length = 14) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[randomInt(0, chars.length - 1)];
  }
  return out;
}

function isSshPortUsed(port) {
  return !!db.prepare("SELECT 1 FROM instance_access WHERE ssh_port=? LIMIT 1").get(port);
}

function isRangeOverlapped(start, end) {
  return !!db
    .prepare("SELECT 1 FROM instance_access WHERE NOT(port_end < ? OR port_start > ?) LIMIT 1")
    .get(start, end);
}

function allocateAccessProfile() {
  for (let i = 0; i < 200; i += 1) {
    const portStart = randomInt(20000, 54000);
    const portEnd = portStart + 999;
    const sshPort = randomInt(10000, 19999);
    if (sshPort >= portStart && sshPort <= portEnd) {
      continue;
    }
    if (isSshPortUsed(sshPort)) {
      continue;
    }
    if (isRangeOverlapped(portStart, portEnd)) {
      continue;
    }
    return {
      sshPort,
      sshPassword: randomPassword(16),
      portStart,
      portEnd
    };
  }
  throw new Error("cannot_allocate_ports");
}

function upsertInstanceAccess(name, access) {
  db.prepare(
    `
      INSERT INTO instance_access(instance_name, ssh_port, ssh_password, port_start, port_end, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(instance_name) DO UPDATE SET
        ssh_port = excluded.ssh_port,
        ssh_password = excluded.ssh_password,
        port_start = excluded.port_start,
        port_end = excluded.port_end,
        updated_at = excluded.updated_at
    `
  ).run(name, access.sshPort, access.sshPassword, access.portStart, access.portEnd, nowIso(), nowIso());
}

function deleteInstanceAccess(name) {
  db.prepare("DELETE FROM instance_access WHERE instance_name=?").run(name);
}

function updateInstancePassword(name, password) {
  db.prepare("UPDATE instance_access SET ssh_password=?, updated_at=? WHERE instance_name=?").run(
    password,
    nowIso(),
    name
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
    const access = allocateAccessProfile();
    addTaskLog(
      task.id,
      "allocate",
      `ssh=${access.sshPort}, ports=${access.portStart}-${access.portEnd}, size=1000`
    );
    addTaskLog(task.id, "validate", "checking image alias and resource parameters");
    await ensureImageExists(task.payload.image);
    addTaskLog(task.id, "validate", `checking instance name availability: ${task.payload.name}`);
    await ensureInstanceNotExists(task.payload.name);
    addTaskLog(task.id, "launch", `launching instance ${task.payload.name} from ${task.payload.image}`);
    await createInstance(task.payload);
    addTaskLog(task.id, "init", "setting root password");
    await setRootPassword(task.payload.name, access.sshPassword);
    addTaskLog(task.id, "map", `mapping ssh port ${access.sshPort} (v4/v6 tcp)`);
    await addSshPortMappings(task.payload.name, access.sshPort);
    addTaskLog(task.id, "map", `mapping ${access.portStart}-${access.portEnd} (v4/v6 tcp+udp)`);
    await addPortRangeMappings(task.payload.name, access.portStart, access.portEnd, (msg) => {
      addTaskLog(task.id, "map", msg);
    });
    upsertInstanceAccess(task.payload.name, access);
    addTaskLog(task.id, "done", "instance created");
    return {
      ok: true,
      access: {
        sshPort: access.sshPort,
        sshPassword: access.sshPassword,
        portStart: access.portStart,
        portEnd: access.portEnd
      }
    };
  }
  if (task.type === "instance_action") {
    addTaskLog(task.id, "action", `${task.payload.action} ${task.payload.name}`);
    await runInstanceAction(task.payload);
    if (task.payload.action === "delete") {
      deleteInstanceAccess(task.payload.name);
    }
    if (task.payload.action === "reset_password" && task.payload.password) {
      updateInstancePassword(task.payload.name, task.payload.password);
    }
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

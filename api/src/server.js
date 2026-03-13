import "dotenv/config";
import cors from "cors";
import express from "express";
import morgan from "morgan";
import { z } from "zod";
import { db, nowIso } from "./db.js";
import { ensureAdminBootstrap, loginAdmin, requireAdmin, verifyAdminToken } from "./auth.js";
import { execInInstance, listInstances } from "./incus.js";

ensureAdminBootstrap();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

const PORT = Number(process.env.API_PORT || 9000);

function addOperationLog(action, actor, target, details) {
  db.prepare(
    "INSERT INTO operation_logs(action, actor, target, details_json, created_at) VALUES(?, ?, ?, ?, ?)"
  ).run(action, actor, target || null, JSON.stringify(details || {}), nowIso());
}

function queueTask(type, payload) {
  const result = db
    .prepare(
      "INSERT INTO tasks(type, status, payload_json, created_at) VALUES(?, 'waiting', ?, ?)"
    )
    .run(type, JSON.stringify(payload), nowIso());
  return result.lastInsertRowid;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, mode: "single-host-lxc" });
});

app.post("/auth/login", (req, res) => {
  const schema = z.object({ username: z.string().min(1), password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload" });
  }

  const token = loginAdmin(parsed.data.username, parsed.data.password);
  if (!token) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  return res.json({ token });
});

app.get("/config/default-images", requireAdmin, (_req, res) => {
  res.json({ images: ["alpine/3.20", "debian12"] });
});

app.get("/instances", requireAdmin, async (_req, res) => {
  try {
    const items = await listInstances();
    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ error: "list_failed", message: error.message });
  }
});

app.post("/instances", requireAdmin, (req, res) => {
  const schema = z.object({
    name: z.string().regex(/^[a-z0-9-]{2,40}$/),
    image: z.enum(["alpine/3.20", "debian12"]),
    cpu: z.string().optional(),
    memory: z.string().optional(),
    disk: z.string().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload" });
  }

  const taskId = queueTask("create_instance", parsed.data);
  addOperationLog("create_instance_queued", req.admin.username, parsed.data.name, { taskId });
  return res.status(202).json({ taskId });
});

app.post("/instances/:name/action", requireAdmin, (req, res) => {
  const paramsSchema = z.object({ name: z.string().min(2) });
  const bodySchema = z.object({
    action: z.enum(["start", "stop", "restart", "delete", "rebuild", "reset_password"]),
    image: z.enum(["alpine/3.20", "debian12"]).optional(),
    password: z.string().min(8).optional()
  });

  const paramsResult = paramsSchema.safeParse(req.params);
  const bodyResult = bodySchema.safeParse(req.body);
  if (!paramsResult.success || !bodyResult.success) {
    return res.status(400).json({ error: "invalid_payload" });
  }

  if (bodyResult.data.action === "rebuild" && !bodyResult.data.image) {
    return res.status(400).json({ error: "image_required" });
  }
  if (bodyResult.data.action === "reset_password" && !bodyResult.data.password) {
    return res.status(400).json({ error: "password_required" });
  }

  const taskId = queueTask("instance_action", {
    name: paramsResult.data.name,
    ...bodyResult.data
  });
  addOperationLog("instance_action_queued", req.admin.username, paramsResult.data.name, {
    taskId,
    action: bodyResult.data.action
  });

  return res.status(202).json({ taskId });
});

app.post("/instances/:name/exec", requireAdmin, async (req, res) => {
  const paramsSchema = z.object({ name: z.string().min(2) });
  const bodySchema = z.object({ command: z.string().min(1).max(500) });

  const paramsResult = paramsSchema.safeParse(req.params);
  const bodyResult = bodySchema.safeParse(req.body);
  if (!paramsResult.success || !bodyResult.success) {
    return res.status(400).json({ error: "invalid_payload" });
  }

  try {
    const output = await execInInstance(paramsResult.data.name, bodyResult.data.command);
    addOperationLog("instance_exec", req.admin.username, paramsResult.data.name, {
      command: bodyResult.data.command
    });
    return res.json({ output });
  } catch (error) {
    return res.status(500).json({ error: "exec_failed", message: error.message });
  }
});

app.get("/tasks", requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      "SELECT id, type, status, payload_json, result_json, error_text, created_at, started_at, ended_at FROM tasks ORDER BY id DESC LIMIT 100"
    )
    .all()
    .map((row) => ({
      ...row,
      payload: JSON.parse(row.payload_json || "{}"),
      result: row.result_json ? JSON.parse(row.result_json) : null
    }));

  return res.json({ items: rows });
});

app.get("/logs", requireAdmin, (_req, res) => {
  const rows = db
    .prepare("SELECT id, action, actor, target, details_json, created_at FROM operation_logs ORDER BY id DESC LIMIT 200")
    .all()
    .map((row) => ({
      ...row,
      details: row.details_json ? JSON.parse(row.details_json) : null
    }));
  return res.json({ items: rows });
});

app.get("/stream/tasks", (req, res) => {
  const token = String(req.query.token || "");
  const admin = verifyAdminToken(token);
  if (!admin) {
    return res.status(401).json({ error: "invalid_token" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let lastPayload = "";

  const writeSnapshot = () => {
    const tasks = db
      .prepare(
        "SELECT id, type, status, payload_json, result_json, error_text, created_at, started_at, ended_at FROM tasks ORDER BY id DESC LIMIT 100"
      )
      .all()
      .map((row) => ({
        ...row,
        payload: JSON.parse(row.payload_json || "{}"),
        result: row.result_json ? JSON.parse(row.result_json) : null
      }));

    const logs = db
      .prepare("SELECT id, action, actor, target, details_json, created_at FROM operation_logs ORDER BY id DESC LIMIT 100")
      .all()
      .map((row) => ({
        ...row,
        details: row.details_json ? JSON.parse(row.details_json) : null
      }));

    const payload = JSON.stringify({ tasks, logs, ts: nowIso() });
    if (payload === lastPayload) {
      return;
    }
    lastPayload = payload;
    res.write(`event: tasks\ndata: ${payload}\n\n`);
  };

  writeSnapshot();
  const timer = setInterval(writeSnapshot, 1500);

  req.on("close", () => {
    clearInterval(timer);
  });
});

app.listen(PORT, () => {
  console.log(`[hostpanel-api] listening on :${PORT}`);
});

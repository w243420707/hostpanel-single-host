import { execFile } from "node:child_process";

const PANEL_PROJECT = process.env.PANEL_PROJECT || "HostPanel";

function normalizeMemory(value) {
  if (!value) return value;
  return /^\d+$/.test(value) ? `${value}MiB` : value;
}

function normalizeDisk(value) {
  if (!value) return value;
  return /^\d+$/.test(value) ? `${value}GiB` : value;
}

function runIncus(args) {
  return new Promise((resolve, reject) => {
    execFile("incus", args, { timeout: 180000 }, (error, stdout, stderr) => {
      if (error) {
        const detail = [stderr, stdout, error.message]
          .map((v) => String(v || "").trim())
          .filter(Boolean)
          .join("\n");
        reject(new Error(detail));
        return;
      }
      resolve((stdout || "").trim());
    });
  });
}

function projectArgs() {
  return ["--project", PANEL_PROJECT];
}

export async function createInstance(payload) {
  const { name, image, cpu } = payload;
  const memory = normalizeMemory(payload.memory);
  const disk = normalizeDisk(payload.disk);
  const launchArgs = [...projectArgs(), "launch", image, name, "-c", "security.nesting=true"];
  if (cpu) launchArgs.push("-c", `limits.cpu=${cpu}`);
  if (memory) launchArgs.push("-c", `limits.memory=${memory}`);

  await runIncus(launchArgs);
  if (disk) {
    await runIncus([...projectArgs(), "config", "device", "set", name, "root", "size", disk]);
  }
}

export async function runInstanceAction(payload) {
  const { name, action, image, password } = payload;
  if (action === "start") {
    await runIncus([...projectArgs(), "start", name]);
    return;
  }
  if (action === "stop") {
    await runIncus([...projectArgs(), "stop", name]);
    return;
  }
  if (action === "restart") {
    await runIncus([...projectArgs(), "restart", name]);
    return;
  }
  if (action === "delete") {
    await runIncus([...projectArgs(), "delete", name, "--force"]);
    return;
  }
  if (action === "rebuild") {
    await runIncus([...projectArgs(), "rebuild", name, image, "--force"]);
    return;
  }
  if (action === "reset_password") {
    await runIncus([
      ...projectArgs(),
      "exec",
      name,
      "--",
      "sh",
      "-lc",
      `echo root:${password} | chpasswd`
    ]);
    return;
  }
  throw new Error("unsupported_action");
}

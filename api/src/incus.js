import { execFile } from "node:child_process";

const PANEL_PROJECT = process.env.PANEL_PROJECT || "HostPanel";

function runIncus(args) {
  return new Promise((resolve, reject) => {
    execFile("incus", args, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim()));
        return;
      }
      resolve((stdout || "").trim());
    });
  });
}

function projectArgs() {
  return ["--project", PANEL_PROJECT];
}

export async function listInstances() {
  const output = await runIncus([...projectArgs(), "list", "--format", "json"]);
  return JSON.parse(output || "[]").map((item) => ({
    name: item.name,
    status: item.status,
    type: item.type,
    architecture: item.architecture,
    createdAt: item.created_at
  }));
}

export async function createContainer({ name, image, cpu, memory, disk }) {
  const allowed = new Set(["alpine/3.20", "debian12"]);
  if (!allowed.has(image)) {
    throw new Error("image_not_allowed");
  }

  const launchArgs = [...projectArgs(), "launch", image, name, "-c", "security.nesting=true"];
  if (cpu) {
    launchArgs.push("-c", `limits.cpu=${cpu}`);
  }
  if (memory) {
    launchArgs.push("-c", `limits.memory=${memory}`);
  }
  await runIncus(launchArgs);

  if (disk) {
    await runIncus([...projectArgs(), "config", "device", "set", name, "root", "size", disk]);
  }
}

export async function startInstance(name) {
  await runIncus([...projectArgs(), "start", name]);
}

export async function stopInstance(name) {
  await runIncus([...projectArgs(), "stop", name]);
}

export async function restartInstance(name) {
  await runIncus([...projectArgs(), "restart", name]);
}

export async function deleteInstance(name) {
  await runIncus([...projectArgs(), "delete", name, "--force"]);
}

export async function rebuildInstance(name, image) {
  const allowed = new Set(["alpine/3.20", "debian12"]);
  if (!allowed.has(image)) {
    throw new Error("image_not_allowed");
  }
  await runIncus([...projectArgs(), "rebuild", name, image, "--force"]);
}

export async function resetRootPassword(name, password) {
  await runIncus([
    ...projectArgs(),
    "exec",
    name,
    "--",
    "sh",
    "-lc",
    `echo root:${password} | chpasswd`
  ]);
}

export async function execInInstance(name, command) {
  const output = await runIncus([
    ...projectArgs(),
    "exec",
    name,
    "--",
    "sh",
    "-lc",
    command
  ]);
  return output;
}

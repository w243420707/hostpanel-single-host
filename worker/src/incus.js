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

export async function instanceExists(name) {
  try {
    await runIncus([...projectArgs(), "info", name]);
    return true;
  } catch (_error) {
    return false;
  }
}

export async function ensureInstanceNotExists(name) {
  if (await instanceExists(name)) {
    throw new Error(`instance_already_exists: ${name}`);
  }
}

function sourceImageName(alias) {
  if (alias === "debian12") {
    return "debian/12";
  }
  return alias;
}

async function addProxyDevice(instanceName, deviceName, listen, connect) {
  await runIncus([
    ...projectArgs(),
    "config",
    "device",
    "add",
    instanceName,
    deviceName,
    "proxy",
    `listen=${listen}`,
    `connect=${connect}`,
    "bind=host"
  ]);
}

export async function ensureImageExists(alias) {
  try {
    await runIncus([...projectArgs(), "image", "show", alias]);
    return;
  } catch (_error) {
    // fall through
  }

  try {
    await runIncus(["--project", "default", "image", "show", alias]);
    return;
  } catch (_error) {
    // Try to import missing default alias automatically.
  }

  const src = sourceImageName(alias);
  await runIncus(["image", "copy", `images:${src}`, "local:", "--alias", alias]);
  await runIncus(["--project", "default", "image", "show", alias]);
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

export async function setRootPassword(name, password) {
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

export async function addSshPortMappings(name, sshPort) {
  await addProxyDevice(name, "ssh4", `tcp:0.0.0.0:${sshPort}`, "tcp:127.0.0.1:22");
  await addProxyDevice(name, "ssh6", `tcp:[::]:${sshPort}`, "tcp:127.0.0.1:22");
}

async function addRangeMappingDevices(name, start, end) {
  await addProxyDevice(name, "rng-tcp4", `tcp:0.0.0.0:${start}-${end}`, `tcp:127.0.0.1:${start}-${end}`);
  await addProxyDevice(name, "rng-tcp6", `tcp:[::]:${start}-${end}`, `tcp:127.0.0.1:${start}-${end}`);
  await addProxyDevice(name, "rng-udp4", `udp:0.0.0.0:${start}-${end}`, `udp:127.0.0.1:${start}-${end}`);
  await addProxyDevice(name, "rng-udp6", `udp:[::]:${start}-${end}`, `udp:127.0.0.1:${start}-${end}`);
}

async function addRangeMappingsFallback(name, start, end, logger) {
  for (let port = start; port <= end; port += 1) {
    if ((port - start) % 100 === 0) {
      logger(`mapping port ${port} / ${end}`);
    }
    await addProxyDevice(name, `t4-${port}`, `tcp:0.0.0.0:${port}`, `tcp:127.0.0.1:${port}`);
    await addProxyDevice(name, `t6-${port}`, `tcp:[::]:${port}`, `tcp:127.0.0.1:${port}`);
    await addProxyDevice(name, `u4-${port}`, `udp:0.0.0.0:${port}`, `udp:127.0.0.1:${port}`);
    await addProxyDevice(name, `u6-${port}`, `udp:[::]:${port}`, `udp:127.0.0.1:${port}`);
  }
}

export async function addPortRangeMappings(name, start, end, logger = () => {}) {
  try {
    await addRangeMappingDevices(name, start, end);
    logger(`range mapping applied ${start}-${end}`);
  } catch (error) {
    logger("range mapping unsupported by current Incus, falling back to per-port mapping");
    await addRangeMappingsFallback(name, start, end, logger);
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
    await setRootPassword(name, password);
    return;
  }
  throw new Error("unsupported_action");
}

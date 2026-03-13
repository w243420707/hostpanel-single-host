const API_BASE = (window.location.origin.replace(/:\d+$/, ":9000"));
let token = "";

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || "request_failed");
  }
  return data;
}

async function login() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const data = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  token = data.token;
  setText("loginMsg", "登录成功");
  document.getElementById("loginCard").classList.add("hidden");
  document.getElementById("panel").classList.remove("hidden");
  await Promise.all([loadInstances(), loadTasks()]);
}

async function createInstance() {
  const rawMemory = document.getElementById("newMemory").value.trim();
  const rawDisk = document.getElementById("newDisk").value.trim();

  const memory = /^\d+$/.test(rawMemory) ? `${rawMemory}MiB` : rawMemory;
  const disk = /^\d+$/.test(rawDisk) ? `${rawDisk}GiB` : rawDisk;

  const payload = {
    name: document.getElementById("newName").value.trim(),
    image: document.getElementById("newImage").value,
    cpu: document.getElementById("newCpu").value.trim() || undefined,
    memory: memory || undefined,
    disk: disk || undefined
  };
  await api("/instances", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  await loadTasks();
}

function actionButtons(name) {
  const actions = ["start", "stop", "restart", "delete"];
  return actions
    .map((action) => `<button data-name="${name}" data-action="${action}" class="actBtn">${action}</button>`)
    .join(" ");
}

async function runAction(name, action) {
  await api(`/instances/${name}/action`, {
    method: "POST",
    body: JSON.stringify({ action })
  });
  await loadTasks();
}

async function rebuildInstance() {
  const name = document.getElementById("rebuildName").value.trim();
  const image = document.getElementById("rebuildImage").value;
  await api(`/instances/${name}/action`, {
    method: "POST",
    body: JSON.stringify({ action: "rebuild", image })
  });
  await loadTasks();
}

async function resetPassword() {
  const name = document.getElementById("resetName").value.trim();
  const password = document.getElementById("resetPassword").value;
  await api(`/instances/${name}/action`, {
    method: "POST",
    body: JSON.stringify({ action: "reset_password", password })
  });
  await loadTasks();
}

async function execCommand() {
  const name = document.getElementById("execName").value.trim();
  const command = document.getElementById("execCommand").value.trim();
  const data = await api(`/instances/${name}/exec`, {
    method: "POST",
    body: JSON.stringify({ command })
  });
  document.getElementById("execOutput").textContent = data.output || "";
}

async function loadInstances() {
  const data = await api("/instances");
  const body = document.getElementById("instanceBody");
  body.innerHTML = data.items
    .map(
      (i) =>
        `<tr>
          <td>${i.name}</td>
          <td>${i.status}</td>
          <td>${i.type || "container"}</td>
          <td>${i.architecture || "-"}</td>
          <td>${actionButtons(i.name)}</td>
        </tr>`
    )
    .join("");

  document.querySelectorAll(".actBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await runAction(btn.dataset.name, btn.dataset.action);
    });
  });
}

async function loadTasks() {
  const data = await api("/tasks");
  const body = document.getElementById("taskBody");
  body.innerHTML = data.items
    .map(
      (t) =>
        `<tr>
          <td>${t.id}</td>
          <td>${t.type}</td>
          <td class="status-${t.status}">${t.status}</td>
          <td>${t.created_at}</td>
          <td>${t.error_text || ""}</td>
        </tr>`
    )
    .join("");
}

document.getElementById("loginBtn").addEventListener("click", async () => {
  try {
    await login();
  } catch (error) {
    setText("loginMsg", `登录失败: ${error.message}`);
  }
});

document.getElementById("createBtn").addEventListener("click", async () => {
  try {
    await createInstance();
  } catch (error) {
    alert(`创建失败: ${error.message}`);
  }
});

document.getElementById("reloadInstances").addEventListener("click", async () => {
  try {
    await loadInstances();
  } catch (error) {
    alert(`刷新失败: ${error.message}`);
  }
});

document.getElementById("reloadTasks").addEventListener("click", async () => {
  try {
    await loadTasks();
  } catch (error) {
    alert(`刷新失败: ${error.message}`);
  }
});

document.getElementById("rebuildBtn").addEventListener("click", async () => {
  try {
    await rebuildInstance();
  } catch (error) {
    alert(`重装失败: ${error.message}`);
  }
});

document.getElementById("resetPwdBtn").addEventListener("click", async () => {
  try {
    await resetPassword();
  } catch (error) {
    alert(`改密失败: ${error.message}`);
  }
});

document.getElementById("execBtn").addEventListener("click", async () => {
  try {
    await execCommand();
  } catch (error) {
    alert(`执行失败: ${error.message}`);
  }
});

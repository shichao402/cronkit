import type { Snapshot } from "../shared/types";
import { bindConfigEditor, openConfigEditor } from "./config-editor";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let currentView: "dash" | "config" = "dash";

function toast(message: string, fail = false): void {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("fail", fail);
  el.classList.remove("hidden");
}

function apiOrThrow() {
  if (!window.api) {
    throw new Error("预加载失败，窗口没有接到主进程接口");
  }
  return window.api;
}

function badge(status?: string): string {
  if (!status) {
    return `<span class="badge">未执行</span>`;
  }
  const map: Record<string, string> = {
    succeeded: "成功",
    failed: "失败",
    cancelled: "取消",
    running: "运行中",
    queued: "排队",
    skipped: "跳过",
    pending: "等待",
  };
  return `<span class="badge ${status}">${map[status] ?? status}</span>`;
}

function setView(view: "dash" | "config"): void {
  currentView = view;
  $("view-dash").classList.toggle("hidden", view !== "dash");
  $("view-config").classList.toggle("hidden", view !== "config");
  document.querySelectorAll(".tabs .tab").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-view") === view);
  });
}

async function showConfig(workspaceId?: string): Promise<void> {
  setView("config");
  await openConfigEditor(workspaceId);
}

// Mirrors the tray icon states so the panel and the tray never disagree.
function renderStatePill(snapshot: Snapshot): void {
  const paused = snapshot.appState === "idle" && !snapshot.schedulerEnabled;
  const state = paused ? "paused" : snapshot.appState;
  const labels: Record<string, string> = {
    running: "运行中",
    failed: "今日有失败",
    paused: "已停用",
    idle: "空闲",
  };
  const pill = $("app-state");
  pill.className = `status-pill ${state}`;
  pill.textContent = labels[state];
}

function render(snapshot: Snapshot): void {
  $("subtitle").textContent = snapshot.configPath;
  renderStatePill(snapshot);

  ($("scheduler") as HTMLInputElement).checked = snapshot.schedulerEnabled;
  ($("login") as HTMLInputElement).checked = snapshot.openAtLogin;
  ($("icon-theme") as HTMLSelectElement).value = snapshot.iconTheme;

  const err = $("config-error");
  if (snapshot.configError) {
    err.classList.remove("hidden");
    err.textContent = snapshot.configError;
  } else {
    err.classList.add("hidden");
  }

  const exitWarn = $("exit-warn");
  if (snapshot.exitWarnsRunning) {
    exitWarn.classList.remove("hidden");
  } else {
    exitWarn.classList.add("hidden");
  }

  $("workspaces").innerHTML = snapshot.workspaces
    .map((item) => {
      const next = item.autoScheduled
        ? `下次 ${item.nextRun ? formatTime(item.nextRun, snapshot.timezone) : "—"}`
        : "仅手动";
      const last = item.lastRun
        ? `${formatTime(item.lastRun.startedAt, snapshot.timezone)} · ${item.lastRun.trigger} / ${item.lastRun.status}`
        : "尚无记录";
      const action = item.running
        ? `<button class="small" data-cancel="${item.lastRun?.runId ?? ""}">取消</button>`
        : `<button class="small" data-run="${item.id}">运行</button>`;
      return `<article class="card">
        <div class="row">
          <h3>${escapeHtml(item.name)}</h3>
          ${badge(item.lastRun?.status)}
        </div>
        <div class="meta">${escapeHtml(item.path)}<br>${escapeHtml(item.scheduleId)} · ${escapeHtml(next)}<br>最近：${escapeHtml(last)}</div>
        <ul class="steps">${item.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul>
        <div class="row actions">${action}<button class="small" data-edit="${escapeHtml(item.id)}">编辑配置</button></div>
      </article>`;
    })
    .join("");

  $("toolsets").innerHTML = (snapshot.toolsets ?? [])
    .map((ts) => {
      const tools = ts.tools.map((t) => escapeHtml(t.displayName || t.id)).join("、") || "（无）";
      const status = ts.installed
        ? ts.depsReady
          ? `已安装 · SHA ${ts.sha ?? "?"} · schema v${ts.schemaVersion}`
          : `已安装但依赖未就绪 · ${escapeHtml(ts.error ?? "")}`
        : `未安装 · ${escapeHtml(ts.error ?? "")}`;
      const btn =
        ts.id === "builtin"
          ? ""
          : `<button class="small" data-toolset-update="${escapeHtml(ts.id)}">${ts.installed ? "更新" : "下载"}</button>`;
      return `<article class="card">
        <div class="row">
          <h3>${escapeHtml(ts.displayName)}</h3>
          <span class="badge ${ts.installed && ts.depsReady ? "succeeded" : "failed"}">${ts.id}</span>
        </div>
        <div class="meta">${escapeHtml(status)}<br>${escapeHtml(ts.root)}<br>工具：${tools}</div>
        <div class="row actions">${btn}</div>
      </article>`;
    })
    .join("");

  $("runs").innerHTML = snapshot.runs
    .slice(0, 16)
    .map((run) => {
      const steps = run.steps
        .map((step) => {
          const detail = step.error ?? step.outputTail ?? "";
          return `<div>${escapeHtml(step.summary || step.type)}:${escapeHtml(step.status)}${
            detail ? ` — ${escapeHtml(detail)}` : ""
          }</div>`;
        })
        .join("");
      return `<article class="run">
        <div class="row">
          <div class="title">${escapeHtml(run.workspaceName)}</div>
          ${badge(run.status)}
        </div>
        <div class="meta">${escapeHtml(formatTime(run.startedAt, snapshot.timezone))} · ${escapeHtml(run.trigger)} · ${escapeHtml(run.scheduleId)}<br>${steps}</div>
      </article>`;
    })
    .join("");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}

function formatTime(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/\//g, "-");
}

async function refresh(): Promise<void> {
  render(await apiOrThrow().getSnapshot());
}

async function handle(action: () => Promise<void>, doing: string): Promise<void> {
  try {
    toast(doing);
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast(message, true);
    $("config-error").classList.remove("hidden");
    $("config-error").textContent = message;
  }
}

document.querySelector(".tabs")?.addEventListener("click", (event) => {
  const view = (event.target as HTMLElement).getAttribute("data-view") as "dash" | "config" | null;
  if (view === "dash") {
    setView("dash");
  }
  if (view === "config") {
    void handle(() => showConfig(), "正在打开配置…");
  }
});

$("subtitle").addEventListener("click", () =>
  handle(async () => {
    const result = await apiOrThrow().openConfig();
    if (!result.ok) {
      throw new Error(result.error ?? "无法打开配置");
    }
    toast("已打开配置文件");
  }, "正在打开配置…"),
);

$("catchup").addEventListener("click", () =>
  handle(async () => {
    const snapshot = (await apiOrThrow().catchUp()) as Snapshot;
    render(snapshot);
    toast("已检查补跑队列");
  }, "正在检查补跑…"),
);
$("open-config").addEventListener("click", () =>
  handle(async () => {
    const result = await apiOrThrow().openConfig();
    if (!result.ok) {
      throw new Error(result.error ?? "无法打开配置");
    }
    toast("已打开配置文件");
  }, "正在打开配置…"),
);
$("open-logs").addEventListener("click", () =>
  handle(async () => {
    const result = await apiOrThrow().openLogs();
    if (!result.ok) {
      throw new Error(result.error ?? "无法打开日志目录");
    }
    toast("已打开日志目录");
  }, "正在打开日志…"),
);
$("scheduler").addEventListener("change", (event) => {
  const on = (event.target as HTMLInputElement).checked;
  void handle(() => apiOrThrow().setSchedulerEnabled(on) as Promise<void>, on ? "已启用自动调度" : "已关闭自动调度");
});
$("login").addEventListener("change", (event) => {
  const on = (event.target as HTMLInputElement).checked;
  void handle(() => apiOrThrow().setOpenAtLogin(on) as Promise<void>, on ? "已设置登录启动" : "已取消登录启动");
});
$("icon-theme").addEventListener("change", (event) => {
  const theme = (event.target as HTMLSelectElement).value === "dark" ? "dark" : "light";
  void handle(
    () => apiOrThrow().setIconTheme(theme) as Promise<void>,
    theme === "dark" ? "已切换深色图标" : "已切换浅色图标",
  );
});

$("workspaces").addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const workspaceId = target.getAttribute("data-run");
  const cancelId = target.getAttribute("data-cancel");
  const editId = target.getAttribute("data-edit");
  if (workspaceId) {
    void handle(async () => {
      const snapshot = (await apiOrThrow().runWorkspace(workspaceId)) as Snapshot;
      render(snapshot);
      toast(`已开始运行 ${workspaceId}`);
    }, `正在启动 ${workspaceId}…`);
  }
  if (cancelId) {
    void handle(async () => {
      await apiOrThrow().cancelRun(cancelId);
      await refresh();
      toast("已请求取消");
    }, "正在取消…");
  }
  if (editId) {
    void handle(() => showConfig(editId), "正在打开配置…");
  }
});

$("toolsets").addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const id = target.getAttribute("data-toolset-update");
  if (!id) {
    return;
  }
  void handle(async () => {
    const snapshot = (await apiOrThrow().updateToolset(id)) as Snapshot;
    render(snapshot);
    toast(`Toolset ${id} 已更新`);
  }, `正在下载/更新 ${id}…`);
});

try {
  const api = apiOrThrow();
  bindConfigEditor({
    api,
    toast,
    onSaved: refresh,
  });
  api.onSnapshot((snapshot) => {
    if (currentView === "dash") {
      render(snapshot);
    } else {
      renderStatePill(snapshot);
    }
  });
  void refresh();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  $("config-error").classList.remove("hidden");
  $("config-error").textContent = message;
  toast(message, true);
}

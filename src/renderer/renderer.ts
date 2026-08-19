import type { Snapshot } from "../shared/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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

function render(snapshot: Snapshot): void {
  $("subtitle").textContent = snapshot.configPath;
  const pill = $("app-state");
  pill.className = `status-pill ${snapshot.appState}`;
  pill.textContent = snapshot.appState === "running" ? "运行中" : snapshot.appState === "failed" ? "今日有失败" : "空闲";

  ($("scheduler") as HTMLInputElement).checked = snapshot.schedulerEnabled;
  ($("login") as HTMLInputElement).checked = snapshot.openAtLogin;

  const err = $("config-error");
  if (snapshot.configError) {
    err.classList.remove("hidden");
    err.textContent = snapshot.configError;
  } else {
    err.classList.add("hidden");
  }

  $("workspaces").innerHTML = snapshot.workspaces
    .map((item) => {
      const next = item.autoScheduled ? `下次 ${item.nextRun ?? "—"}` : "仅手动";
      const last = item.lastRun ? `${item.lastRun.trigger} / ${item.lastRun.status}` : "尚无记录";
      const action = item.running
        ? `<button class="small" data-cancel="${item.lastRun?.runId ?? ""}">取消</button>`
        : `<button class="small" data-run="${item.id}">运行</button>`;
      return `<article class="card">
        <div class="row">
          <h3>${item.name}</h3>
          ${badge(item.lastRun?.status)}
        </div>
        <div class="meta">${item.path}<br>${item.scheduleId} · ${next}<br>最近：${last}</div>
        <ul class="steps">${item.steps.map((step) => `<li>${step}</li>`).join("")}</ul>
        <div class="row" style="margin-top:10px">${action}</div>
      </article>`;
    })
    .join("");

  $("runs").innerHTML = snapshot.runs
    .slice(0, 16)
    .map((run) => {
      const steps = run.steps
        .map((step) => `${step.type}:${step.status}${step.error ? `(${step.error})` : ""}`)
        .join(" · ");
      return `<article class="run">
        <div class="row">
          <div class="title">${run.workspaceName}</div>
          ${badge(run.status)}
        </div>
        <div class="meta">${run.localDate} · ${run.trigger} · ${run.scheduleId}<br>${steps}</div>
      </article>`;
    })
    .join("");
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

$("catchup").addEventListener("click", () =>
  handle(async () => {
    const snapshot = (await apiOrThrow().catchUp()) as Snapshot;
    render(snapshot);
    toast("已检查补跑队列");
  }, "正在检查补跑…"),
);
$("reload").addEventListener("click", () =>
  handle(async () => {
    render(await apiOrThrow().reloadConfig());
    toast("配置已重新加载");
  }, "正在重新加载配置…"),
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

$("workspaces").addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const workspaceId = target.getAttribute("data-run");
  const cancelId = target.getAttribute("data-cancel");
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
});

try {
  apiOrThrow().onSnapshot(render);
  void refresh();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  $("config-error").classList.remove("hidden");
  $("config-error").textContent = message;
  toast(message, true);
}

import type { ResolvedTheme, RunRecord, Snapshot, ThemePref, ToolsetView, WorkspaceView } from "../shared/types";
import { bindConfigEditor, isConfigDirty, openConfigEditor } from "./config-editor";
import { icon, type IconName } from "./icons";
import {
  dayLabel,
  escapeHtml,
  formatAbsolute,
  relLabel,
  runSpan,
  spanOf,
  splitStepLabel,
  STATUS_LABELS,
  today,
  TRIGGER_LABELS,
  truncateMiddle,
} from "./format";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type View = "dash" | "config" | "settings";
type RunFilter = "all" | "failed";

let currentView: View = "dash";
let latest: Snapshot | undefined;
let runFilter: RunFilter = "all";
let dashSignature = "";
const openRuns = new Set<string>();

/* ==========================================================================
   Toasts — a bottom-right stack so notifications never shift the layout.
   ========================================================================== */
type ToastKind = "ok" | "fail" | "busy";
type ToastHandle = { dismiss: () => void };

const TOAST_ICON: Record<ToastKind, IconName> = { ok: "check", fail: "alert", busy: "refresh" };
const TOAST_LIFE: Record<ToastKind, number> = { ok: 4000, fail: 9000, busy: 0 };
const MAX_TOASTS = 4;

function toast(message: string, kind: ToastKind = "ok"): ToastHandle {
  const host = $("toasts");
  while (host.childElementCount >= MAX_TOASTS) {
    host.firstElementChild?.remove();
  }

  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.innerHTML = `${icon(TOAST_ICON[kind])}<span class="toast-text">${escapeHtml(message)}</span>`;

  let timer: number | undefined;
  const dismiss = (): void => {
    window.clearTimeout(timer);
    if (!el.isConnected || el.classList.contains("is-leaving")) {
      return;
    }
    el.classList.add("is-leaving");
    window.setTimeout(() => el.remove(), 160);
  };

  if (kind !== "busy") {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "关闭");
    close.innerHTML = icon("close");
    close.addEventListener("click", dismiss);
    el.append(close);
  }

  host.append(el);
  const life = TOAST_LIFE[kind];
  if (life) {
    timer = window.setTimeout(dismiss, life);
  }
  return { dismiss };
}

function apiOrThrow() {
  if (!window.api) {
    throw new Error("预加载失败，窗口没有接到主进程接口");
  }
  return window.api;
}

/** Keeps the progress notice and the button spinner tied to one action. */
async function handle(action: () => Promise<void>, doing: string, trigger?: HTMLElement | null): Promise<void> {
  const busy = toast(doing, "busy");
  trigger?.classList.add("is-busy");
  try {
    await action();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "fail");
  } finally {
    busy.dismiss();
    trigger?.classList.remove("is-busy");
  }
}

/* ==========================================================================
   Views
   ========================================================================== */
function setView(view: View): void {
  if (view === currentView) {
    return;
  }
  if (currentView === "config" && isConfigDirty()) {
    const leave = window.confirm("配置有未保存的修改，离开后会丢失。仍要离开吗？");
    if (!leave) {
      return;
    }
  }
  currentView = view;
  for (const name of ["dash", "config", "settings"] as View[]) {
    $(`view-${name}`).classList.toggle("hidden", name !== view);
  }
  $("nav")
    .querySelectorAll<HTMLButtonElement>(".nav-item")
    .forEach((btn) => {
      const active = btn.dataset.view === view;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });
  document.querySelector(".content")?.scrollTo({ top: 0 });
}

async function showConfig(workspaceId?: string): Promise<void> {
  setView("config");
  if (currentView !== "config") {
    return;
  }
  await openConfigEditor(workspaceId);
}

// Distinct from showConfig: this hands the file to the OS editor instead of
// opening the in-app panel, so the two must never share a progress message.
const OPENING_CONFIG_FILE = "正在用外部编辑器打开配置文件…";

async function openConfigFile(): Promise<void> {
  const result = await apiOrThrow().openConfig();
  if (!result.ok) {
    throw new Error(result.error ?? "无法打开配置文件");
  }
  toast("已用外部编辑器打开配置文件");
}

/* ==========================================================================
   Snapshot rendering
   ========================================================================== */
// The main process resolves `system` against the OS, so this only ever sees light/dark.
function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
}

// Mirrors the tray icon states so the panel and the tray never disagree.
const STATE_LABELS: Record<string, string> = {
  running: "运行中",
  failed: "今日有失败",
  paused: "已停用",
  idle: "空闲",
};

function renderState(snapshot: Snapshot): void {
  const paused = snapshot.appState === "idle" && !snapshot.schedulerEnabled;
  const state = paused ? "paused" : snapshot.appState;
  const el = $("app-state");
  el.className = `nav-state ${state}`;
  el.title = `当前状态：${STATE_LABELS[state]}`;
  const label = el.querySelector(".state-label");
  if (label) {
    label.textContent = STATE_LABELS[state];
  }
}

function renderSettings(snapshot: Snapshot): void {
  ($("scheduler") as HTMLInputElement).checked = snapshot.schedulerEnabled;
  ($("login") as HTMLInputElement).checked = snapshot.openAtLogin;
  $("theme-picker")
    .querySelectorAll<HTMLButtonElement>("button[data-theme]")
    .forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.theme === snapshot.theme));
    });
  $("path-config").textContent = snapshot.configPath;
  $("path-data").textContent = snapshot.dataDir;
}

type Banner = {
  kind: "fail" | "warn" | "info";
  glyph: IconName;
  title: string;
  body?: string;
  action?: { label: string; act: string };
};

function renderBanners(snapshot: Snapshot): void {
  const banners: Banner[] = [];
  if (snapshot.configError) {
    banners.push({
      kind: "fail",
      glyph: "alert",
      title: "配置无法加载",
      body: snapshot.configError,
      action: { label: "重新加载", act: "reload" },
    });
  }
  if (!snapshot.schedulerEnabled) {
    banners.push({
      kind: "warn",
      glyph: "clock",
      title: "自动调度已关闭",
      body: "计划任务不会触发，只能从这里手动运行。",
      action: { label: "启用", act: "enable-scheduler" },
    });
  }
  if (snapshot.exitWarnsRunning) {
    banners.push({
      kind: "info",
      glyph: "hand",
      title: "有任务正在运行",
      body: "退出程序会中断当前任务。",
    });
  }

  $("banners").innerHTML = banners
    .map(
      (banner) => `<div class="banner banner-${banner.kind}">
        ${icon(banner.glyph)}
        <div>
          <div class="banner-title">${escapeHtml(banner.title)}</div>
          ${banner.body ? `<div class="banner-body">${escapeHtml(banner.body)}</div>` : ""}
        </div>
        ${
          banner.action
            ? `<button type="button" class="btn btn-sm btn-quiet" data-act="${banner.action.act}">${escapeHtml(
                banner.action.label,
              )}</button>`
            : "<span></span>"
        }
      </div>`,
    )
    .join("");
}

// Everything that must stay in sync regardless of which tab is showing.
function applySnapshot(snapshot: Snapshot): void {
  latest = snapshot;
  applyTheme(snapshot.resolvedTheme);
  $("subtitle").textContent = snapshot.configPath;
  $("config-link").title = `用外部编辑器打开 ${snapshot.configPath}`;
  renderState(snapshot);
  renderSettings(snapshot);
  renderBanners(snapshot);
  $("dash-sub").textContent = `时区 ${snapshot.timezone} · 自动调度${
    snapshot.schedulerEnabled ? "已启用" : "已关闭"
  }`;
  renderDash(snapshot);
}

/**
 * The orchestrator pushes a snapshot on every internal change, including ones
 * the dashboard does not show. Re-rendering on those would fight the pointer,
 * so the heavy render is gated on a signature of what is actually drawn.
 */
function signatureOf(snapshot: Snapshot): string {
  return JSON.stringify([
    runFilter,
    snapshot.timezone,
    snapshot.schedulerEnabled,
    snapshot.workspaces.map((w) => [
      w.id,
      w.name,
      w.path,
      w.autoScheduled,
      w.scheduleId,
      w.cron,
      w.nextRun,
      w.running,
      w.steps.join("|"),
      w.lastRun?.runId,
      w.lastRun?.status,
    ]),
    snapshot.runs.map((r) => [r.runId, r.status, r.finishedAt, r.steps.map((s) => `${s.status}${s.summary}`).join("|")]),
    (snapshot.toolsets ?? []).map((t) => [t.id, t.installed, t.depsReady, t.sha, t.error]),
  ]);
}

function renderDash(snapshot: Snapshot, force = false): void {
  const signature = signatureOf(snapshot);
  if (!force && signature === dashSignature) {
    tickTimes();
    return;
  }
  dashSignature = signature;

  const now = Date.now();
  renderStats(snapshot, now);
  renderWorkspaces(snapshot, now);
  renderRuns(snapshot, now);
  renderToolsets(snapshot);
}

/* --- stats ---------------------------------------------------------------- */
type Stat = {
  key: string;
  glyph: IconName;
  value: string;
  sub: string;
  tone?: "ok" | "fail" | "run" | "muted";
  small?: boolean;
};

function renderStats(snapshot: Snapshot, now: number): void {
  const day = today(snapshot.timezone);
  const todays = snapshot.runs.filter((run) => run.localDate === day);
  const succeeded = todays.filter((run) => run.status === "succeeded").length;
  const failed = todays.filter((run) => run.status === "failed");
  const running = snapshot.workspaces.filter((item) => item.running);
  const upcoming = snapshot.workspaces
    .filter((item) => item.autoScheduled && item.nextRun)
    .sort((a, b) => (a.nextRun! < b.nextRun! ? -1 : 1))[0];

  const next: Stat = !snapshot.schedulerEnabled
    ? { key: "下次运行", glyph: "clock", value: "已暂停", sub: "自动调度已关闭", tone: "muted", small: true }
    : upcoming
      ? {
          key: "下次运行",
          glyph: "clock",
          value: dayLabel(upcoming.nextRun!, snapshot.timezone),
          sub: `${upcoming.name} · ${relLabel(upcoming.nextRun!, now) || formatAbsolute(upcoming.nextRun!, snapshot.timezone)}`,
          small: true,
        }
      : { key: "下次运行", glyph: "clock", value: "无计划", sub: "没有工作目录绑定计划", tone: "muted", small: true };

  const stats: Stat[] = [
    {
      key: "运行中",
      glyph: "play",
      value: String(running.length),
      sub: running.length ? running.map((item) => item.name).join("、") : `共 ${snapshot.workspaces.length} 个工作目录`,
      tone: running.length ? "run" : "muted",
    },
    {
      key: "今日成功",
      glyph: "check",
      value: String(succeeded),
      sub: `今日共 ${todays.length} 次执行`,
      tone: succeeded ? "ok" : "muted",
    },
    {
      key: "今日失败",
      glyph: "alert",
      value: String(failed.length),
      sub: failed.length ? [...new Set(failed.map((run) => run.workspaceName))].join("、") : "没有失败",
      tone: failed.length ? "fail" : "muted",
    },
    next,
  ];

  $("stats").innerHTML = stats
    .map(
      (stat) => `<article class="stat tone-${stat.tone ?? "plain"}">
        <div class="stat-key">${icon(stat.glyph)}<span>${escapeHtml(stat.key)}</span></div>
        <div class="stat-value${stat.small ? " is-small" : ""}">${escapeHtml(stat.value)}</div>
        <div class="stat-sub" title="${escapeHtml(stat.sub)}">${escapeHtml(stat.sub)}</div>
      </article>`,
    )
    .join("");
}

/* --- shared bits ---------------------------------------------------------- */
function badge(status?: string): string {
  if (!status) {
    return `<span class="badge"><span class="state-dot"></span>未执行</span>`;
  }
  return `<span class="badge ${status}"><span class="state-dot ${status}"></span>${escapeHtml(
    STATUS_LABELS[status] ?? status,
  )}</span>`;
}

/** Relative text that a timer keeps fresh; the tooltip holds the exact time. */
function timeText(iso: string, timezone: string, className: string): string {
  const absolute = formatAbsolute(iso, timezone);
  return `<span class="${className}" data-rel="${escapeHtml(iso)}" data-tz="${escapeHtml(
    timezone,
  )}" title="${escapeHtml(absolute)}">${escapeHtml(relLabel(iso) || dayLabel(iso, timezone))}</span>`;
}

function emptyState(glyph: IconName, title: string, hint: string, action?: { label: string; act: string }): string {
  return `<div class="empty">
    ${icon(glyph)}
    <div class="empty-title">${escapeHtml(title)}</div>
    <div class="empty-hint">${escapeHtml(hint)}</div>
    ${action ? `<button type="button" class="btn btn-sm" data-act="${action.act}">${escapeHtml(action.label)}</button>` : ""}
  </div>`;
}

/* --- workspaces ----------------------------------------------------------- */
function renderWorkspaces(snapshot: Snapshot, now: number): void {
  const items = [...snapshot.workspaces].sort((a, b) => {
    if (a.running !== b.running) {
      return a.running ? -1 : 1;
    }
    if (a.autoScheduled !== b.autoScheduled) {
      return a.autoScheduled ? -1 : 1;
    }
    if (a.nextRun && b.nextRun) {
      return a.nextRun < b.nextRun ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "zh-CN");
  });

  const auto = items.filter((item) => item.autoScheduled).length;
  $("ws-count").textContent = items.length ? `${items.length} 个 · ${auto} 个自动调度` : "";

  $("workspaces").innerHTML = items.length
    ? items.map((item) => workspaceRow(item, snapshot, now)).join("")
    : emptyState(
        "folder",
        snapshot.configError ? "配置未加载" : "还没有工作目录",
        snapshot.configError ? "修好配置文件后这里会列出今日计划。" : "去配置页添加一个工作目录，并把它绑定到某个计划上。",
        snapshot.configError ? undefined : { label: "打开配置", act: "goto-config" },
      );
}

function workspaceRow(item: WorkspaceView, snapshot: Snapshot, now: number): string {
  const status = item.running ? "running" : item.lastRun?.status;
  const schedule = item.autoScheduled
    ? `<span class="chip chip-mono" title="cron: ${escapeHtml(item.cron)}">${escapeHtml(item.scheduleId)}</span>`
    : `<span class="chip chip-muted">仅手动</span>`;

  const steps = item.steps
    .map((label) => {
      const { name, timeout } = splitStepLabel(label);
      return `<span class="chip chip-mono"${timeout ? ` title="超时 ${escapeHtml(timeout)}"` : ""}>${escapeHtml(
        name,
      )}</span>`;
    })
    .join("");

  const nextFact = item.autoScheduled
    ? `<div class="fact"><span class="fact-k">下次</span>${
        item.nextRun
          ? `<span class="fact-v" title="${escapeHtml(formatAbsolute(item.nextRun, snapshot.timezone))} · ${escapeHtml(
              relLabel(item.nextRun, now),
            )}">${escapeHtml(dayLabel(item.nextRun, snapshot.timezone))}</span>`
          : `<span class="fact-v">cron 无效</span>`
      }</div>`
    : "";

  const lastFact = item.running
    ? `<div class="fact"><span class="fact-k">已运行</span><span class="fact-v" data-since="${escapeHtml(
        item.lastRun?.startedAt ?? "",
      )}">${escapeHtml(spanOf(item.lastRun?.startedAt, undefined, now))}</span></div>`
    : item.lastRun
      ? `<div class="fact"><span class="fact-k">最近</span>${timeText(
          item.lastRun.startedAt,
          snapshot.timezone,
          "fact-v",
        )}<span class="fact-k">${escapeHtml(TRIGGER_LABELS[item.lastRun.trigger] ?? item.lastRun.trigger)}</span></div>`
      : `<div class="fact"><span class="fact-k">尚无执行记录</span></div>`;

  const action = item.running
    ? `<button type="button" class="btn btn-sm btn-danger" data-cancel="${escapeHtml(
        item.lastRun?.runId ?? "",
      )}">${icon("stop")}取消</button>`
    : `<button type="button" class="btn btn-sm btn-primary" data-run="${escapeHtml(item.id)}">${icon("play")}运行</button>`;

  return `<article class="row-card" data-ws="${escapeHtml(item.id)}">
    <div class="ws">
      <span class="state-dot ws-dot ${status ?? ""}"></span>
      <div class="ws-main">
        <div class="ws-line">
          <h3>${escapeHtml(item.name)}</h3>
          ${badge(status)}
          ${schedule}
        </div>
        <p class="ws-path" title="${escapeHtml(item.path)}">${escapeHtml(truncateMiddle(item.path, 78))}</p>
        <div class="ws-steps">${steps}</div>
      </div>
      <div class="ws-facts">${nextFact}${lastFact}</div>
      <div class="ws-actions">
        ${action}
        <button type="button" class="btn btn-icon btn-quiet" data-edit="${escapeHtml(
          item.id,
        )}" title="编辑此工作目录的配置" aria-label="编辑配置">${icon("pencil")}</button>
      </div>
    </div>
    ${item.running ? `<div class="ws-bar"></div>` : ""}
  </article>`;
}

/* --- runs ----------------------------------------------------------------- */
function renderRuns(snapshot: Snapshot, now: number): void {
  const runs = (runFilter === "failed" ? snapshot.runs.filter((run) => run.status === "failed") : snapshot.runs).slice(
    0,
    20,
  );

  $("run-filter")
    .querySelectorAll<HTMLButtonElement>("button[data-filter]")
    .forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.filter === runFilter)));

  $("runs").innerHTML = runs.length
    ? runs.map((run) => runRow(run, snapshot, now)).join("")
    : emptyState(
        "inbox",
        runFilter === "failed" ? "没有失败记录" : "还没有执行记录",
        runFilter === "failed" ? "切回“全部”看看所有执行。" : "手动运行一次，或等计划触发。",
      );
}

function runRow(run: RunRecord, snapshot: Snapshot, now: number): string {
  const open = openRuns.has(run.runId);
  return `<article class="row-card run-card ${open ? "is-open" : ""}" data-run="${escapeHtml(run.runId)}">
    <button type="button" class="run-head" data-toggle aria-expanded="${open}">
      <span class="state-dot ${run.status}"></span>
      <span class="run-name">${escapeHtml(run.workspaceName)}</span>
      <span class="run-chips">
        <span class="chip chip-muted">${escapeHtml(TRIGGER_LABELS[run.trigger] ?? run.trigger)}</span>
        ${
          // A manual run's schedule id is always "manual", so the chip would
          // only repeat the trigger next to it.
          run.scheduleId === "manual" ? "" : `<span class="chip chip-mono">${escapeHtml(run.scheduleId)}</span>`
        }
      </span>
      ${badge(run.status)}
      ${timeText(run.startedAt, snapshot.timezone, "run-when")}
      <span class="run-span"${run.finishedAt ? "" : ` data-since="${escapeHtml(run.startedAt)}"`}>${escapeHtml(
        runSpan(run, now),
      )}</span>
      <span class="run-caret">${icon("chevron")}</span>
    </button>
    <div class="run-detail ${open ? "" : "hidden"}">${runSteps(run, now)}</div>
  </article>`;
}

function runSteps(run: RunRecord, now: number): string {
  if (!run.steps.length) {
    return `<p class="form-note">这次执行没有步骤记录。</p>`;
  }
  return `<ol class="steps-list">${run.steps
    .map((step) => {
      const detail = step.error ?? step.outputTail ?? "";
      return `<li class="step">
        <span class="step-idx">${step.index + 1}</span>
        <span class="state-dot ${step.status}"></span>
        <span class="step-name">${escapeHtml(step.summary || step.type)}
          <span class="chip chip-muted">${escapeHtml(STATUS_LABELS[step.status] ?? step.status)}</span>
          ${
            step.exitCode !== undefined && step.exitCode !== null && step.exitCode !== 0
              ? `<span class="chip chip-mono">exit ${step.exitCode}</span>`
              : ""
          }
        </span>
        <span class="step-span">${escapeHtml(spanOf(step.startedAt, step.finishedAt, now))}</span>
        ${detail ? `<pre class="step-out${step.error ? " is-error" : ""}">${escapeHtml(detail.trimEnd())}</pre>` : ""}
      </li>`;
    })
    .join("")}</ol>`;
}

/* --- toolsets ------------------------------------------------------------- */
function renderToolsets(snapshot: Snapshot): void {
  const toolsets = snapshot.toolsets ?? [];
  $("toolsets").innerHTML = toolsets.length
    ? toolsets.map(toolsetCard).join("")
    : emptyState("layers", "没有工具集", "内置工具集通常随程序一起提供，这里为空说明数据目录不完整。");
}

function toolsetCard(toolset: ToolsetView): string {
  const ready = toolset.installed && toolset.depsReady;
  const status = ready
    ? `已就绪 · schema v${toolset.schemaVersion}${toolset.sha ? ` · ${toolset.sha.slice(0, 7)}` : ""}`
    : toolset.installed
      ? `依赖未就绪 · ${toolset.error ?? "原因未知"}`
      : `未安装 · ${toolset.error ?? "点击下载"}`;

  const tools = toolset.tools.slice(0, 8);
  const rest = toolset.tools.length - tools.length;

  return `<article class="toolset">
    <div class="toolset-head">
      <span class="state-dot ${ready ? "succeeded" : "failed"}"></span>
      <h3>${escapeHtml(toolset.displayName)}</h3>
      <span class="chip chip-mono">${escapeHtml(toolset.id)}</span>
    </div>
    <div class="toolset-meta">
      <span>${escapeHtml(status)}</span>
      <span class="toolset-root" title="${escapeHtml(toolset.root)}">${escapeHtml(toolset.root)}</span>
    </div>
    <div class="toolset-tools">${
      tools.map((tool) => `<span class="chip chip-mono">${escapeHtml(tool.displayName || tool.id)}</span>`).join("") ||
      `<span class="chip chip-muted">没有工具</span>`
    }${rest > 0 ? `<span class="chip chip-muted">+${rest}</span>` : ""}</div>
    ${
      toolset.id === "builtin"
        ? ""
        : `<div class="chip-row"><button type="button" class="btn btn-sm" data-toolset-update="${escapeHtml(
            toolset.id,
          )}">${icon("download")}${toolset.installed ? "更新" : "下载"}</button></div>`
    }
  </article>`;
}

/* ==========================================================================
   Live time
   ========================================================================== */
function tickTimes(): void {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>("[data-rel]").forEach((el) => {
    const iso = el.dataset.rel;
    const timezone = el.dataset.tz;
    if (!iso || !timezone) {
      return;
    }
    el.textContent = relLabel(iso, now) || dayLabel(iso, timezone);
  });
  document.querySelectorAll<HTMLElement>("[data-since]").forEach((el) => {
    const iso = el.dataset.since;
    if (iso) {
      el.textContent = spanOf(iso, undefined, now);
    }
  });
}

async function refresh(): Promise<void> {
  applySnapshot(await apiOrThrow().getSnapshot());
}

/* ==========================================================================
   Wiring
   ========================================================================== */
document.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
  const name = el.dataset.icon as IconName | undefined;
  if (name) {
    el.insertAdjacentHTML("afterbegin", icon(name));
    delete el.dataset.icon;
  }
});

$("nav").addEventListener("click", (event) => {
  const view = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-view]")?.dataset.view as View | undefined;
  if (!view || view === currentView) {
    return;
  }
  if (view === "config") {
    void handle(() => showConfig(), "正在加载配置…");
    return;
  }
  setView(view);
  void refresh();
});

$("config-link").addEventListener("click", (event) =>
  handle(openConfigFile, OPENING_CONFIG_FILE, event.currentTarget as HTMLElement),
);

$("catchup").addEventListener("click", (event) =>
  handle(
    async () => {
      applySnapshot(await apiOrThrow().catchUp());
      toast("已检查补跑队列");
    },
    "正在检查补跑…",
    event.currentTarget as HTMLElement,
  ),
);

$("open-config").addEventListener("click", (event) =>
  handle(openConfigFile, OPENING_CONFIG_FILE, event.currentTarget as HTMLElement),
);

$("open-logs").addEventListener("click", (event) =>
  handle(
    async () => {
      const result = await apiOrThrow().openLogs();
      if (!result.ok) {
        throw new Error(result.error ?? "无法打开日志目录");
      }
      toast("已打开日志目录");
    },
    "正在打开日志…",
    event.currentTarget as HTMLElement,
  ),
);

$("scheduler").addEventListener("change", (event) => {
  const on = (event.target as HTMLInputElement).checked;
  void handle(() => apiOrThrow().setSchedulerEnabled(on) as Promise<void>, on ? "已启用自动调度" : "已关闭自动调度");
});

$("login").addEventListener("change", (event) => {
  const on = (event.target as HTMLInputElement).checked;
  void handle(() => apiOrThrow().setOpenAtLogin(on) as Promise<void>, on ? "已设置登录启动" : "已取消登录启动");
});

const THEME_TOASTS: Record<ThemePref, string> = {
  system: "主题已跟随系统",
  light: "已切换浅色主题",
  dark: "已切换深色主题",
};

$("theme-picker").addEventListener("click", (event) => {
  const theme = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-theme]")?.dataset.theme as
    | ThemePref
    | undefined;
  if (theme) {
    void handle(() => apiOrThrow().setTheme(theme) as Promise<void>, THEME_TOASTS[theme]);
  }
});

const OPEN_TARGETS = {
  config: { call: () => apiOrThrow().openConfig(), label: "配置文件" },
  logs: { call: () => apiOrThrow().openLogs(), label: "日志目录" },
  data: { call: () => apiOrThrow().openDataDir(), label: "数据目录" },
} as const;

$("settings-paths").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-open]");
  const key = button?.dataset.open;
  if (!key || !(key in OPEN_TARGETS)) {
    return;
  }
  const target = OPEN_TARGETS[key as keyof typeof OPEN_TARGETS];
  void handle(
    async () => {
      const result = await target.call();
      if (!result.ok) {
        throw new Error(result.error ?? `无法打开${target.label}`);
      }
      toast(`已打开${target.label}`);
    },
    `正在打开${target.label}…`,
    button,
  );
});

$("run-filter").addEventListener("click", (event) => {
  const next = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-filter]")?.dataset.filter as
    | RunFilter
    | undefined;
  if (!next || next === runFilter) {
    return;
  }
  runFilter = next;
  if (latest) {
    renderDash(latest, true);
  }
});

$("workspaces").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!button) {
    return;
  }
  const runId = button.dataset.run;
  const cancelId = button.dataset.cancel;
  const editId = button.dataset.edit;

  if (runId) {
    void handle(
      async () => {
        applySnapshot(await apiOrThrow().runWorkspace(runId));
        toast(`已开始运行 ${runId}`);
      },
      `正在启动 ${runId}…`,
      button,
    );
  }
  if (cancelId) {
    void handle(
      async () => {
        await apiOrThrow().cancelRun(cancelId);
        await refresh();
        toast("已请求取消");
      },
      "正在取消…",
      button,
    );
  }
  if (editId) {
    void handle(() => showConfig(editId), "正在加载配置…", button);
  }
  if (button.dataset.act === "goto-config") {
    void handle(() => showConfig(), "正在加载配置…", button);
  }
});

// Expanding a run keeps the raw output out of the list until it is asked for.
$("runs").addEventListener("click", (event) => {
  const head = (event.target as HTMLElement).closest<HTMLButtonElement>(".run-head");
  if (!head) {
    return;
  }
  const card = head.closest<HTMLElement>(".run-card");
  const runId = card?.dataset.run;
  if (!card || !runId) {
    return;
  }
  const open = !openRuns.has(runId);
  if (open) {
    openRuns.add(runId);
  } else {
    openRuns.delete(runId);
  }
  card.classList.toggle("is-open", open);
  card.querySelector(".run-detail")?.classList.toggle("hidden", !open);
  head.setAttribute("aria-expanded", String(open));
});

$("toolsets").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-toolset-update]");
  const id = button?.dataset.toolsetUpdate;
  if (!id) {
    return;
  }
  void handle(
    async () => {
      applySnapshot(await apiOrThrow().updateToolset(id));
      toast(`工具集 ${id} 已更新`);
    },
    `正在下载/更新 ${id}…`,
    button,
  );
});

$("banners").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
  const act = button?.dataset.act;
  if (act === "reload") {
    void handle(
      async () => {
        applySnapshot(await apiOrThrow().reloadConfig());
        toast("已重新加载配置");
      },
      "正在重新加载配置…",
      button,
    );
  }
  if (act === "enable-scheduler") {
    void handle(() => apiOrThrow().setSchedulerEnabled(true) as Promise<void>, "已启用自动调度", button);
  }
});

const VIEW_KEYS: Record<string, View> = { "1": "dash", "2": "config", "3": "settings" };

window.addEventListener("keydown", (event) => {
  if (!event.ctrlKey || event.altKey) {
    return;
  }
  if (event.key.toLowerCase() === "s" && currentView === "config") {
    event.preventDefault();
    $("config-save").click();
    return;
  }
  const view = VIEW_KEYS[event.key];
  if (view) {
    event.preventDefault();
    if (view === "config") {
      void handle(() => showConfig(), "正在加载配置…");
      return;
    }
    setView(view);
    void refresh();
  }
});

try {
  const api = apiOrThrow();
  bindConfigEditor({
    api,
    toast: (message, fail = false) => void toast(message, fail ? "fail" : "ok"),
    onSaved: refresh,
    onDirtyChange: (dirty) => $("nav-dirty").classList.toggle("hidden", !dirty),
  });
  api.onSnapshot((snapshot) => applySnapshot(snapshot));
  window.setInterval(tickTimes, 20_000);
  void refresh();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  $("banners").innerHTML = `<div class="banner banner-fail">${icon("alert")}<div>
      <div class="banner-title">界面无法启动</div>
      <div class="banner-body">${escapeHtml(message)}</div>
    </div><span></span></div>`;
}

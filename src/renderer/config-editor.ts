import type {
  ConfigEditorPayload,
  EditorDraft,
  EditorStep,
  EditorWorkspace,
  ToolParamView,
  ToolsetView,
} from "../shared/types";
import { draftToYaml } from "../shared/draft-yaml";

type Host = {
  api: NonNullable<Window["api"]>;
  toast: (message: string, fail?: boolean) => void;
  onSaved: () => Promise<void>;
};

const CRON_PRESETS: Array<{ label: string; cron: string }> = [
  { label: "每天 02:10", cron: "10 2 * * *" },
  { label: "每天 00:05", cron: "5 0 * * *" },
  { label: "0–7 点每 15 分钟", cron: "*/15 0-7 * * *" },
  { label: "每小时", cron: "0 * * * *" },
];

let host: Host;
let payload: ConfigEditorPayload | undefined;
let draft: EditorDraft | undefined;
let yamlText = "";
let source: "form" | "yaml" = "form";
let dirty = false;
let panel: "workspaces" | "schedules" | "runtime" | "yaml" = "workspaces";
let selectedWorkspaceId = "";
let selectedScheduleId = "";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function bindConfigEditor(options: Host): void {
  host = options;
  $("config-save").addEventListener("click", () => void save());
  $("config-reload-disk").addEventListener("click", () => void loadFromDisk(true));
  $("config-subtabs").addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const next = target.getAttribute("data-panel") as typeof panel | null;
    if (!next) {
      return;
    }
    if (panel === "yaml" && next !== "yaml") {
      yamlText = ($("config-yaml") as HTMLTextAreaElement | null)?.value ?? yamlText;
      if (source === "yaml" && dirty) {
        host.toast("YAML 有未保存修改：请先保存，或从磁盘重新加载后再切回表单", true);
        return;
      }
    }
    if (panel !== "yaml" && next === "yaml" && draft && source === "form") {
      yamlText = draftToYaml(draft);
    }
    panel = next;
    $("config-subtabs").querySelectorAll(".tab").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-panel") === panel);
    });
    render();
  });
}

export async function openConfigEditor(workspaceId?: string): Promise<void> {
  await loadFromDisk(false);
  if (workspaceId && draft?.workspaces.some((item) => item.id === workspaceId)) {
    selectedWorkspaceId = workspaceId;
    panel = "workspaces";
  }
  render();
}

export function isConfigDirty(): boolean {
  return dirty;
}

async function loadFromDisk(announce: boolean): Promise<void> {
  payload = await host.api.getConfigEditor();
  yamlText = payload.text;
  draft = payload.draft ? structuredClone(payload.draft) : undefined;
  source = draft ? "form" : "yaml";
  dirty = false;
  selectedWorkspaceId = draft?.workspaces[0]?.id ?? "";
  selectedScheduleId = draft?.schedules[0]?.id ?? "";
  if (payload.parseError) {
    panel = "yaml";
    showHint(payload.parseError);
  } else {
    showHint("");
  }
  if (announce) {
    host.toast("已从磁盘重新加载配置");
  }
  render();
}

function markDirty(): void {
  dirty = true;
  updateDirtyLabel();
}

function updateDirtyLabel(): void {
  $("config-dirty").textContent = dirty ? "有未保存修改" : "未修改";
}

function showHint(text: string): void {
  const el = $("config-hint");
  if (!text) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.classList.remove("hidden");
  el.textContent = text;
}

function render(): void {
  updateDirtyLabel();
  $("config-subtabs").querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-panel") === panel);
  });
  if (panel === "yaml" || !draft) {
    renderYaml();
    return;
  }
  if (panel === "runtime") {
    renderRuntime();
    return;
  }
  if (panel === "schedules") {
    renderSchedules();
    return;
  }
  renderWorkspaces();
}

function renderYaml(): void {
  $("config-body").innerHTML = `
    <div class="form">
      <div class="field">
        <label>直接编辑 YAML。保存前会做完整校验；校验失败不会写盘。</label>
        <textarea id="config-yaml" class="yaml" spellcheck="false">${escapeHtml(yamlText)}</textarea>
      </div>
    </div>`;
  $("config-yaml").addEventListener("input", (event) => {
    yamlText = (event.target as HTMLTextAreaElement).value;
    source = "yaml";
    markDirty();
  });
}

function renderRuntime(): void {
  if (!draft) {
    return;
  }
  $("config-body").innerHTML = `
    <div class="form" style="max-width:520px">
      <div class="field">
        <label>时区</label>
        <input id="rt-tz" value="${escapeHtml(draft.timezone)}" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>最大并发</label>
          <input id="rt-conc" type="number" min="1" value="${draft.runtime.maxConcurrentRuns}" />
        </div>
        <div class="field">
          <label>补跑回溯天数</label>
          <input id="rt-catch" type="number" min="0" value="${draft.runtime.catchUpPreviousDays}" />
        </div>
      </div>
      <label class="check">
        <input id="rt-retry" type="checkbox" ${draft.runtime.retryFailedOnCatchUp ? "checked" : ""} />
        补跑时重试失败任务
      </label>
    </div>`;
  $("rt-tz").addEventListener("input", (e) => {
    draft!.timezone = (e.target as HTMLInputElement).value;
    markDirty();
  });
  $("rt-conc").addEventListener("input", (e) => {
    draft!.runtime.maxConcurrentRuns = Number((e.target as HTMLInputElement).value) || 1;
    markDirty();
  });
  $("rt-catch").addEventListener("input", (e) => {
    draft!.runtime.catchUpPreviousDays = Number((e.target as HTMLInputElement).value) || 0;
    markDirty();
  });
  $("rt-retry").addEventListener("change", (e) => {
    draft!.runtime.retryFailedOnCatchUp = (e.target as HTMLInputElement).checked;
    markDirty();
  });
}

function renderSchedules(): void {
  if (!draft) {
    return;
  }
  if (!draft.schedules.some((item) => item.id === selectedScheduleId)) {
    selectedScheduleId = draft.schedules[0]?.id ?? "";
  }
  const current = draft.schedules.find((item) => item.id === selectedScheduleId);
  const list = draft.schedules
    .map(
      (item) => `<button type="button" class="list-item ${item.id === selectedScheduleId ? "active" : ""}" data-sel="${escapeHtml(item.id)}">
        ${escapeHtml(item.id)}
        <span class="sub">${escapeHtml(item.cron)}</span>
      </button>`,
    )
    .join("");
  const checks = draft.workspaces
    .map((ws) => {
      const on = current?.workspaceIds.includes(ws.id);
      return `<label class="check"><input type="checkbox" data-ws="${escapeHtml(ws.id)}" ${on ? "checked" : ""} /> ${escapeHtml(ws.name)} <span class="muted">(${escapeHtml(ws.id)})</span></label>`;
    })
    .join("");
  const presets = CRON_PRESETS.map(
    (item) => `<button type="button" class="small" data-cron="${escapeHtml(item.cron)}">${escapeHtml(item.label)}</button>`,
  ).join("");

  $("config-body").innerHTML = `
    <div class="editor-split">
      <div class="list-col">
        ${list || `<p class="muted">还没有计划</p>`}
        <button type="button" class="small" id="add-schedule">新增计划</button>
      </div>
      <div class="form">
        ${
          current
            ? `
          <div class="field-row">
            <div class="field"><label>ID</label><input id="sch-id" value="${escapeHtml(current.id)}" /></div>
            <div class="field"><label>Cron</label><input id="sch-cron" value="${escapeHtml(current.cron)}" /></div>
          </div>
          <div class="field"><label>说明</label><input id="sch-desc" value="${escapeHtml(current.description ?? "")}" /></div>
          <div class="row actions">${presets}</div>
          <h2>绑定工作目录</h2>
          ${checks}
          <div class="row actions">
            <button type="button" class="danger small" id="del-schedule">删除此计划</button>
          </div>`
            : `<p class="muted">选择或新增一个计划</p>`
        }
      </div>
    </div>`;

  $("config-body").querySelector(".list-col")?.addEventListener("click", (event) => {
    const btn = event.target as HTMLElement;
    const id = btn.closest("[data-sel]")?.getAttribute("data-sel");
    if (id) {
      selectedScheduleId = id;
      render();
    }
  });
  $("add-schedule")?.addEventListener("click", () => {
    const id = uniqueId(
      "schedule",
      draft!.schedules.map((item) => item.id),
    );
    draft!.schedules.push({ id, description: "", cron: "10 2 * * *", workspaceIds: [] });
    selectedScheduleId = id;
    source = "form";
    markDirty();
    render();
  });
  if (!current) {
    return;
  }
  $("sch-id")?.addEventListener("change", (e) => {
    const next = (e.target as HTMLInputElement).value.trim();
    if (!next) {
      return;
    }
    current.id = next;
    selectedScheduleId = next;
    source = "form";
    markDirty();
    render();
  });
  $("sch-cron")?.addEventListener("input", (e) => {
    current.cron = (e.target as HTMLInputElement).value;
    source = "form";
    markDirty();
  });
  $("sch-desc")?.addEventListener("input", (e) => {
    current.description = (e.target as HTMLInputElement).value;
    source = "form";
    markDirty();
  });
  $("config-body").querySelectorAll("[data-cron]").forEach((btn) => {
    btn.addEventListener("click", () => {
      current.cron = btn.getAttribute("data-cron") ?? current.cron;
      source = "form";
      markDirty();
      render();
    });
  });
  $("config-body").querySelectorAll("[data-ws]").forEach((box) => {
    box.addEventListener("change", (e) => {
      const id = (e.target as HTMLInputElement).getAttribute("data-ws")!;
      const on = (e.target as HTMLInputElement).checked;
      current.workspaceIds = on
        ? [...new Set([...current.workspaceIds, id])]
        : current.workspaceIds.filter((item) => item !== id);
      source = "form";
      markDirty();
    });
  });
  $("del-schedule")?.addEventListener("click", () => {
    if (draft!.schedules.length <= 1) {
      host.toast("至少保留一个计划", true);
      return;
    }
    draft!.schedules = draft!.schedules.filter((item) => item.id !== current.id);
    selectedScheduleId = draft!.schedules[0].id;
    source = "form";
    markDirty();
    render();
  });
}

function renderWorkspaces(): void {
  if (!draft) {
    return;
  }
  if (!draft.workspaces.some((item) => item.id === selectedWorkspaceId)) {
    selectedWorkspaceId = draft.workspaces[0]?.id ?? "";
  }
  const current = draft.workspaces.find((item) => item.id === selectedWorkspaceId);
  const list = draft.workspaces
    .map((item) => {
      const bound = draft!.schedules.filter((sch) => sch.workspaceIds.includes(item.id)).map((sch) => sch.id);
      return `<button type="button" class="list-item ${item.id === selectedWorkspaceId ? "active" : ""}" data-sel="${escapeHtml(item.id)}">
        ${escapeHtml(item.name)}
        <span class="sub">${bound.length ? escapeHtml(bound.join(", ")) : "仅手动"}</span>
      </button>`;
    })
    .join("");

  $("config-body").innerHTML = `
    <div class="editor-split">
      <div class="list-col">
        ${list}
        <button type="button" class="small" id="add-ws">新增工作目录</button>
      </div>
      <div id="ws-form" class="form"></div>
    </div>`;
  $("config-body").querySelector(".list-col")?.addEventListener("click", (event) => {
    const id = (event.target as HTMLElement).closest("[data-sel]")?.getAttribute("data-sel");
    if (id) {
      selectedWorkspaceId = id;
      render();
    }
  });
  $("add-ws").addEventListener("click", () => {
    const id = uniqueId(
      "workspace",
      draft!.workspaces.map((item) => item.id),
    );
    const created: EditorWorkspace = {
      id,
      name: "新工作目录",
      path: "D:/workspace",
      oncePerDay: true,
      steps: [defaultStep()],
    };
    draft!.workspaces.push(created);
    selectedWorkspaceId = id;
    source = "form";
    markDirty();
    render();
  });
  if (current) {
    renderWorkspaceForm(current);
  }
}

function renderWorkspaceForm(current: EditorWorkspace): void {
  const tools = payload?.toolsets ?? [];
  const options = tools
    .map((ts) => {
      const opts = ts.tools
        .map((tool) => {
          const value = `${ts.id}::${tool.id}`;
          return `<option value="${escapeHtml(value)}">${escapeHtml(ts.displayName)} / ${escapeHtml(tool.displayName)}</option>`;
        })
        .join("");
      return opts;
    })
    .join("");

  const stepsHtml = current.steps
    .map((step, index) => renderStepCard(step, index, options, tools))
    .join("");

  $("ws-form").innerHTML = `
    <div class="field-row">
      <div class="field"><label>显示名称</label><input id="ws-name" value="${escapeHtml(current.name)}" /></div>
      <div class="field"><label>ID</label><input id="ws-id" value="${escapeHtml(current.id)}" /></div>
    </div>
    <div class="path-row">
      <div class="field"><label>本地路径</label><input id="ws-path" value="${escapeHtml(current.path)}" /></div>
      <button type="button" class="ghost" id="ws-browse">浏览…</button>
    </div>
    <label class="check">
      <input id="ws-once" type="checkbox" ${current.oncePerDay ? "checked" : ""} />
      同一天只自动跑一次
    </label>
    <h2>步骤</h2>
    ${stepsHtml}
    <div class="row actions">
      <button type="button" class="small" id="add-step">添加步骤</button>
      <button type="button" class="small" id="dup-ws">复制此工作目录</button>
      <button type="button" class="danger small" id="del-ws">删除</button>
    </div>`;

  $("ws-name").addEventListener("input", (e) => {
    current.name = (e.target as HTMLInputElement).value;
    source = "form";
    markDirty();
  });
  $("ws-id").addEventListener("change", (e) => {
    const next = (e.target as HTMLInputElement).value.trim();
    if (!next) {
      return;
    }
    renameWorkspace(current.id, next);
    selectedWorkspaceId = next;
    source = "form";
    markDirty();
    render();
  });
  $("ws-path").addEventListener("input", (e) => {
    current.path = (e.target as HTMLInputElement).value;
    source = "form";
    markDirty();
  });
  $("ws-browse").addEventListener("click", () => {
    void host.api.pickFolder().then((folder) => {
      if (!folder) {
        return;
      }
      current.path = folder.replace(/\\/g, "/");
      source = "form";
      markDirty();
      render();
    });
  });
  $("ws-once").addEventListener("change", (e) => {
    current.oncePerDay = (e.target as HTMLInputElement).checked;
    source = "form";
    markDirty();
  });
  $("add-step").addEventListener("click", () => {
    current.steps.push(defaultStep());
    source = "form";
    markDirty();
    render();
  });
  $("dup-ws").addEventListener("click", () => {
    const id = uniqueId(
      `${current.id}-copy`,
      draft!.workspaces.map((item) => item.id),
    );
    draft!.workspaces.push({
      ...structuredClone(current),
      id,
      name: `${current.name}（副本）`,
    });
    selectedWorkspaceId = id;
    source = "form";
    markDirty();
    render();
  });
  $("del-ws").addEventListener("click", () => {
    if (draft!.workspaces.length <= 1) {
      host.toast("至少保留一个工作目录", true);
      return;
    }
    draft!.workspaces = draft!.workspaces.filter((item) => item.id !== current.id);
    for (const schedule of draft!.schedules) {
      schedule.workspaceIds = schedule.workspaceIds.filter((id) => id !== current.id);
    }
    selectedWorkspaceId = draft!.workspaces[0].id;
    source = "form";
    markDirty();
    render();
  });

  $("ws-form").querySelectorAll("[data-step]").forEach((card) => {
    const index = Number(card.getAttribute("data-step"));
    const step = current.steps[index];
    card.querySelector("[data-tool]")?.addEventListener("change", (e) => {
      const [toolsetId, tool] = (e.target as HTMLSelectElement).value.split("::");
      step.toolsetId = toolsetId;
      step.tool = tool;
      step.params = defaultParams(findTool(tools, toolsetId, tool)?.params);
      source = "form";
      markDirty();
      render();
    });
    card.querySelector("[data-timeout]")?.addEventListener("input", (e) => {
      step.timeout = (e.target as HTMLInputElement).value;
      source = "form";
      markDirty();
    });
    card.querySelector("[data-retry]")?.addEventListener("input", (e) => {
      const value = Number((e.target as HTMLInputElement).value);
      step.retry = Number.isFinite(value) && value > 0 ? value : undefined;
      source = "form";
      markDirty();
    });
    card.querySelector("[data-continue]")?.addEventListener("change", (e) => {
      step.continueOnError = (e.target as HTMLInputElement).checked;
      source = "form";
      markDirty();
    });
    card.querySelector("[data-up]")?.addEventListener("click", () => {
      if (index === 0) {
        return;
      }
      [current.steps[index - 1], current.steps[index]] = [current.steps[index], current.steps[index - 1]];
      source = "form";
      markDirty();
      render();
    });
    card.querySelector("[data-down]")?.addEventListener("click", () => {
      if (index >= current.steps.length - 1) {
        return;
      }
      [current.steps[index + 1], current.steps[index]] = [current.steps[index], current.steps[index + 1]];
      source = "form";
      markDirty();
      render();
    });
    card.querySelector("[data-del-step]")?.addEventListener("click", () => {
      if (current.steps.length <= 1) {
        host.toast("至少保留一个步骤", true);
        return;
      }
      current.steps.splice(index, 1);
      source = "form";
      markDirty();
      render();
    });
    card.querySelectorAll("[data-param]").forEach((input) => {
      const name = (input as HTMLElement).getAttribute("data-param")!;
      const spec = findTool(tools, step.toolsetId, step.tool)?.params?.find((item) => item.name === name);
      input.addEventListener("change", () => {
        step.params[name] = readParam(input as HTMLInputElement | HTMLSelectElement, spec);
        source = "form";
        markDirty();
      });
      input.addEventListener("input", () => {
        if ((input as HTMLInputElement).type === "checkbox") {
          return;
        }
        step.params[name] = readParam(input as HTMLInputElement | HTMLSelectElement, spec);
        source = "form";
        markDirty();
      });
    });
  });
}

function renderStepCard(step: EditorStep, index: number, options: string, tools: ToolsetView[]): string {
  const value = `${step.toolsetId}::${step.tool}`;
  const escaped = escapeHtml(value);
  let toolOptions = options;
  if (!toolOptions.includes(`value="${escaped}"`)) {
    toolOptions = `<option value="${escaped}" selected>${escaped}（未安装）</option>${toolOptions}`;
  } else {
    toolOptions = toolOptions.replace(`value="${escaped}"`, `value="${escaped}" selected`);
  }
  const spec = findTool(tools, step.toolsetId, step.tool);
  const params = (spec?.params ?? [])
    .map((param) => paramField(param, step.params[param.name]))
    .join("");
  return `<article class="step-card" data-step="${index}">
    <div class="step-head">
      <div class="field" style="flex:1">
        <label>工具</label>
        <select data-tool>${toolOptions}</select>
      </div>
      <div class="row actions">
        <button type="button" class="small" data-up>上移</button>
        <button type="button" class="small" data-down>下移</button>
        <button type="button" class="danger small" data-del-step>删除</button>
      </div>
    </div>
    <div class="param-grid">${params}</div>
    <div class="field-row">
      <div class="field"><label>超时</label><input data-timeout value="${escapeHtml(step.timeout)}" placeholder="90m" /></div>
      <div class="field"><label>重试次数</label><input data-retry type="number" min="0" value="${step.retry ?? 0}" /></div>
    </div>
    <label class="check"><input data-continue type="checkbox" ${step.continueOnError ? "checked" : ""} /> 失败后继续</label>
  </article>`;
}

function paramField(spec: ToolParamView, value: unknown): string {
  const label = `${spec.name}${spec.required ? " *" : ""}`;
  const title = spec.description ? ` title="${escapeHtml(spec.description)}"` : "";
  if (spec.type === "boolean") {
    const on = value === undefined ? spec.default === true : value === true;
    return `<label class="check"${title}><input type="checkbox" data-param="${escapeHtml(spec.name)}" ${on ? "checked" : ""} /> ${escapeHtml(label)}</label>`;
  }
  if (spec.type === "enum") {
    const current = String(value ?? spec.default ?? "");
    const opts = (spec.enum ?? [])
      .map((item) => `<option value="${escapeHtml(item)}" ${item === current ? "selected" : ""}>${escapeHtml(item)}</option>`)
      .join("");
    return `<div class="field"${title}><label>${escapeHtml(label)}</label><select data-param="${escapeHtml(spec.name)}">${opts}</select></div>`;
  }
  if (spec.type === "string[]") {
    const text = Array.isArray(value) ? value.join(", ") : "";
    return `<div class="field"${title}><label>${escapeHtml(label)}（逗号分隔）</label><input data-param="${escapeHtml(spec.name)}" value="${escapeHtml(text)}" /></div>`;
  }
  if (spec.type === "number") {
    return `<div class="field"${title}><label>${escapeHtml(label)}</label><input type="number" data-param="${escapeHtml(spec.name)}" value="${escapeHtml(String(value ?? spec.default ?? ""))}" /></div>`;
  }
  return `<div class="field"${title}><label>${escapeHtml(label)}</label><input data-param="${escapeHtml(spec.name)}" value="${escapeHtml(String(value ?? spec.default ?? ""))}" /></div>`;
}

function readParam(input: HTMLInputElement | HTMLSelectElement, spec?: ToolParamView): unknown {
  if (!spec || spec.type === "boolean") {
    return (input as HTMLInputElement).checked;
  }
  if (spec.type === "number") {
    const n = Number(input.value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (spec.type === "string[]") {
    return input.value
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return input.value;
}

function findTool(tools: ToolsetView[], toolsetId: string, tool: string) {
  return tools.find((item) => item.id === toolsetId)?.tools.find((item) => item.id === tool);
}

function defaultStep(): EditorStep {
  return {
    toolsetId: "builtin",
    tool: "svn-update",
    timeout: "2h",
    retry: 1,
    params: { strategy: "follow-latest", onConflict: "fail" },
  };
}

function defaultParams(specs?: ToolParamView[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const spec of specs ?? []) {
    if (spec.default !== undefined) {
      params[spec.name] = spec.default;
    }
  }
  return params;
}

function renameWorkspace(from: string, to: string): void {
  if (!draft) {
    return;
  }
  const ws = draft.workspaces.find((item) => item.id === from);
  if (ws) {
    ws.id = to;
  }
  for (const schedule of draft.schedules) {
    schedule.workspaceIds = schedule.workspaceIds.map((id) => (id === from ? to : id));
  }
}

function uniqueId(base: string, used: string[]): string {
  const set = new Set(used);
  if (!set.has(base)) {
    return base;
  }
  let i = 2;
  while (set.has(`${base}-${i}`)) {
    i += 1;
  }
  return `${base}-${i}`;
}

async function save(): Promise<void> {
  try {
    host.toast("正在保存配置…");
    if (panel === "yaml" || source === "yaml" || !draft) {
      yamlText = ($("config-yaml") as HTMLTextAreaElement | null)?.value ?? yamlText;
      const checked = await host.api.validateConfig(yamlText);
      if (!checked.ok) {
        throw new Error(checked.error ?? "配置无效");
      }
      await host.api.saveConfigText(yamlText);
    } else {
      const text = draftToYaml(draft);
      const checked = await host.api.validateConfig(text);
      if (!checked.ok) {
        throw new Error(checked.error ?? "配置无效");
      }
      await host.api.saveConfigDraft(draft);
    }
    dirty = false;
    await loadFromDisk(false);
    await host.onSaved();
    host.toast("配置已保存并生效");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showHint(message);
    host.toast(message, true);
  }
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

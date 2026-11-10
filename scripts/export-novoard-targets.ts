/**
 * 退役实施单 C2：把 cronkit config.yaml（v1 / v2）导出成 novoard-agent targets.yaml 片段。
 *
 * 用法：
 *   npm run export-novoard -- [config.yaml] [--data-dir <cronkit 数据目录>] [--out <文件>]
 *
 * 不传 config 时按 cronkit 自己的查找顺序取第一个存在的配置。输出写到 stdout（或 --out），
 * 无法原样表达的地方写成文件头注释，同时打印到 stderr。存在 error 级问题时退出码为 1。
 *
 * 映射规则见 document/roadmap/retire-plan.md「C2 导出脚本」；规则之外的补充也写在那里。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  type AppConfig,
  type Step,
  configV1Schema,
  configV2Schema,
  defaultConfigCandidates,
  stepWorkingPath,
  toInvocation,
} from "../src/core/config";
import { migrateV1toV2 } from "../src/core/config-migrate";
import { defaultDataDir } from "../src/core/paths";
import { parseTimeout } from "../src/core/time";
import { lookupTool } from "../src/core/toolset";
import type { ToolManifest } from "../src/core/toolset/types";
import { expandTemplate } from "../src/shared/step-template";

export type AgentStep =
  | { uses: string; cwd: string; with?: Record<string, unknown>; retry?: number }
  | { script: string; cwd: string };

export type AgentTarget = {
  title: string;
  schedule?: string;
  oncePerDay?: boolean;
  deadline?: string;
  timeout: string;
  expose: "local";
  audit: "summary";
  requiresApproval: boolean;
  notify: "on-failure";
  steps: AgentStep[];
};

export type ExportIssue = {
  level: "error" | "warning";
  target: string;
  /** 原配置中的步骤序号，从 1 开始 */
  step?: number;
  message: string;
};

export type ExportResult = {
  timezone: string;
  targets: Record<string, AgentTarget>;
  issues: ExportIssue[];
};

export type ToolLookup = (toolsetId: string, tool: string) => ToolManifest | undefined;

const AGENT_RETRY_MAX = 10;
/** 每步额外留的余量：进程启动、结果文件、quit-idle 自带的 30 秒宽限等 */
const PER_STEP_SLACK_MS = 60_000;

/** cronkit builtin 工具在 novoard-packs 里的归属。 */
export function packForBuiltin(tool: string): string | undefined {
  if (tool.startsWith("svn-") || tool.startsWith("git-")) return "versionControl";
  if (tool === "unity-warmup" || tool === "quit-idle" || tool === "release-occupants") return "general";
  return undefined;
}

/** 按 Windows CommandLineToArgv 规则引用单个参数（agent 在 Windows 上用 cmd.exe /c 执行 script）。 */
export function quoteArg(arg: string): string {
  if (arg === "") return '""';
  if (!/[\s"&|<>^()%!,;=]/.test(arg)) return arg;
  const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1");
  return `"${escaped}"`;
}

/**
 * 读 cronkit 配置：schema 校验、v1 迁移、路径相对配置文件解析、展开步骤模板。
 * 与 cronkit 装载的区别：不检查外部 toolset 是否已安装（导出时不需要）。
 */
export function loadCronkitConfig(raw: string, filePath: string): AppConfig {
  const parsed = parseYaml(raw.replace(/^\uFEFF+/g, ""));
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`配置不是 YAML 对象: ${filePath}`);
  }
  const version = (parsed as { version?: unknown }).version;
  let config: AppConfig;
  if (version === 2) {
    config = configV2Schema.parse(parsed);
  } else if (version === 1) {
    config = migrateV1toV2(configV1Schema.parse(parsed)).config;
  } else {
    throw new Error(`仅支持 version 1 或 2，收到 ${String(version)}: ${filePath}`);
  }
  const configDir = path.dirname(path.resolve(filePath));
  const templates = new Map(config.stepTemplates.map((t) => [t.id, t]));
  for (const task of config.tasks) {
    for (const target of task.targets) {
      target.path = path.resolve(configDir, target.path);
      if (!target.usesTemplate) continue;
      const template = templates.get(target.usesTemplate);
      if (!template) {
        throw new Error(`tasks.${task.id}.targets.${target.id}: 步骤模板 ${target.usesTemplate} 不存在`);
      }
      const { steps, issues } = expandTemplate<Step>(
        { vars: template.vars, steps: template.steps as Step[] },
        { id: target.id, name: target.name, path: target.path, vars: target.vars },
      );
      if (issues.length > 0) {
        throw new Error(
          `tasks.${task.id}.targets.${target.id}: ${issues.map((i) => i.message).join("；")}`,
        );
      }
      target.steps = steps;
    }
  }
  return config;
}

function cleanParams(
  params: Record<string, unknown>,
  report: (message: string) => void,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "confirmRemoteWrite") continue; // 改由 agent 审批（requiresApproval）
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      out[key] = value.map(String);
      continue;
    }
    if (typeof value === "object") {
      report(`参数 ${key} 是对象，agent 不支持，已丢弃`);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function formatMinutes(ms: number): string {
  return `${Math.max(1, Math.ceil(ms / 60_000))}m`;
}

export function exportNovoardTargets(config: AppConfig, lookup: ToolLookup): ExportResult {
  const targets: Record<string, AgentTarget> = {};
  const issues: ExportIssue[] = [];
  const releaseBefore = config.runtime.releaseOccupants !== false;

  for (const task of config.tasks) {
    const scheduled = task.trigger.type === "cron";
    for (const target of task.targets) {
      const id = `${task.id}-${target.id}`;
      const add = (level: ExportIssue["level"], message: string, step?: number) =>
        issues.push({ level, target: id, step, message });

      const steps: AgentStep[] = [];
      let requiresApproval = false;
      let budgetMs = 0;
      let prevExclusive = false;

      target.steps.forEach((raw, index) => {
        const no = index + 1;
        const isLast = index === target.steps.length - 1;
        const inv = toInvocation(raw);
        const cwd = stepWorkingPath(target, inv);
        const timeoutMs = parseTimeout(inv.timeout);

        if (inv.continueOnError && !isLast) {
          add("warning", "cronkit 中此步失败后继续执行后续步骤，agent 会在此停止", no);
        }
        if (inv.rawArgs && inv.rawArgs.length > 0) {
          add("warning", `args ${JSON.stringify(inv.rawArgs)} agent 不支持，已丢弃`, no);
        }

        if (inv.toolsetId === "builtin" && inv.tool === "script") {
          const command = String(inv.params.command ?? "");
          const args = Array.isArray(inv.params.args) ? inv.params.args.map(String) : [];
          if ((inv.retry ?? 0) > 0) add("warning", `script 步骤不支持 retry，retry=${inv.retry} 已丢弃`, no);
          steps.push({ script: [command, ...args].map(quoteArg).join(" "), cwd });
          budgetMs += timeoutMs + PER_STEP_SLACK_MS;
          prevExclusive = false;
          return;
        }

        const pack = inv.toolsetId === "builtin" ? packForBuiltin(inv.tool) : inv.toolsetId;
        if (!pack) {
          add("error", `builtin/${inv.tool} 在 novoard-packs 中没有对应工具，未导出`, no);
          return;
        }

        const strategy = inv.params.strategy;
        if (
          scheduled &&
          strategy === "manual" &&
          (inv.tool === "svn-update" || inv.tool === "git-pull")
        ) {
          add(
            "warning",
            `${inv.tool} strategy=manual：cronkit 定时运行时跳过此步，agent 不区分触发方式，已删除此步`,
            no,
          );
          return;
        }

        const meta = lookup(inv.toolsetId, inv.tool);
        if (!meta && inv.toolsetId !== "builtin") {
          add(
            "warning",
            `本机找不到 ${inv.toolsetId}/${inv.tool} 的 manifest，无法判断是否写远端、是否独占工作区`,
            no,
          );
        }
        if (meta?.remoteWrite) requiresApproval = true;

        const exclusive = meta?.requiresExclusiveWorkspace === true;
        if (exclusive && releaseBefore && !prevExclusive) {
          // cronkit 在独占工具前由编排器释放目录占用（runtime.releaseOccupants）；agent 改为显式步骤
          steps.push({ uses: "general/release-occupants", cwd: target.path, with: { path: target.path } });
          budgetMs += PER_STEP_SLACK_MS * 2;
        }
        prevExclusive = exclusive;

        const withParams = cleanParams(inv.params, (m) => add("warning", m, no));
        if (inv.tool === "quit-idle" && withParams.timeout === undefined) {
          withParams.timeout = inv.timeout;
        }
        const step: AgentStep = { uses: `${pack}/${inv.tool}`, cwd };
        if (Object.keys(withParams).length > 0) step.with = withParams;
        const retry = inv.retry ?? 0;
        if (retry > 0) {
          if (retry > AGENT_RETRY_MAX) add("warning", `retry=${retry} 超过 agent 上限，改为 ${AGENT_RETRY_MAX}`, no);
          step.retry = Math.min(retry, AGENT_RETRY_MAX);
        }
        const attempts = meta?.idempotent === false ? 1 : (step.retry ?? 0) + 1;
        budgetMs += timeoutMs * attempts + PER_STEP_SLACK_MS;
        steps.push(step);
      });

      if (steps.length === 0) {
        add("error", "没有可导出的步骤，未导出这个 target");
        continue;
      }

      const out: AgentTarget = {
        title: task.name === target.name ? task.name : `${task.name} · ${target.name}`,
        timeout: formatMinutes(budgetMs),
        expose: "local",
        audit: "summary",
        requiresApproval,
        notify: "on-failure",
        steps,
      };
      if (task.trigger.type === "cron") {
        if (task.enabled) {
          out.schedule = task.trigger.cron;
          out.oncePerDay = target.oncePerDay;
          if (task.trigger.deadline) out.deadline = task.trigger.deadline;
        } else {
          add("warning", "cronkit 中这个任务已停用，未导出 schedule，只能手动触发");
        }
      }
      // 固定字段顺序，方便人工核对
      targets[id] = {
        title: out.title,
        ...(out.schedule !== undefined ? { schedule: out.schedule, oncePerDay: out.oncePerDay } : {}),
        ...(out.deadline !== undefined ? { deadline: out.deadline } : {}),
        timeout: out.timeout,
        expose: out.expose,
        audit: out.audit,
        requiresApproval: out.requiresApproval,
        notify: out.notify,
        steps: out.steps,
      };
    }
  }
  return { timezone: config.timezone, targets, issues };
}

export function renderTargetsYaml(result: ExportResult, source: string): string {
  const lines = [
    `# 由 cronkit scripts/export-novoard-targets.ts 从 ${source} 导出`,
    `# cronkit 时区 ${result.timezone}：agent.json 中 schedule.timezone 需设为同一时区`,
  ];
  if (result.issues.length > 0) {
    lines.push("#", "# 需要人工核对：");
    for (const issue of result.issues) {
      const where = issue.step ? `${issue.target} 第 ${issue.step} 步` : issue.target;
      lines.push(`#   [${issue.level}] ${where}：${issue.message}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n${stringifyYaml({ targets: result.targets }, { lineWidth: 0 })}`;
}

function parseCliArgs(argv: string[]): { config?: string; dataDir: string; out?: string } {
  let config: string | undefined;
  let dataDir = defaultDataDir();
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--data-dir") dataDir = argv[++i] ?? dataDir;
    else if (arg === "--out") out = argv[++i];
    else if (arg.startsWith("--")) throw new Error(`未知参数 ${arg}`);
    else if (config === undefined) config = arg;
    else throw new Error(`多余参数 ${arg}`);
  }
  return { config, dataDir, out };
}

export function main(argv = process.argv.slice(2)): number {
  const args = parseCliArgs(argv);
  const configPath = args.config ?? defaultConfigCandidates(args.dataDir).find((p) => existsSync(p));
  if (!configPath) {
    process.stderr.write("找不到 cronkit 配置，请传入 config.yaml 路径\n");
    return 64;
  }
  const config = loadCronkitConfig(readFileSync(configPath, "utf8"), configPath);
  const result = exportNovoardTargets(config, (ts, tool) => lookupTool(ts, tool, args.dataDir));
  const text = renderTargetsYaml(result, configPath);
  if (args.out) writeFileSync(args.out, text, "utf8");
  else process.stdout.write(text);
  for (const issue of result.issues) {
    const where = issue.step ? `${issue.target} 第 ${issue.step} 步` : issue.target;
    process.stderr.write(`[${issue.level}] ${where}：${issue.message}\n`);
  }
  process.stderr.write(`导出 ${Object.keys(result.targets).length} 个 target，${result.issues.length} 条需核对\n`);
  return result.issues.some((i) => i.level === "error") ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runCommand } from "../exec";
import type {
  ToolInvocation,
  ToolManifest,
  ToolRunContext,
  ToolRunResult,
  ToolsetManifest,
} from "./types";
import { SUPPORTED_SCHEMA_VERSION } from "./types";
import { paramsToArgv, validateToolParams } from "./validate";

export function loadToolsetManifest(root: string): ToolsetManifest {
  const file = path.join(root, "toolset.json");
  if (!existsSync(file)) {
    throw new Error(`缺少 toolset.json: ${file}`);
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as ToolsetManifest;
  if (!raw.id || !Array.isArray(raw.tools)) {
    throw new Error(`无效 toolset.json: ${file}`);
  }
  if (raw.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `Toolset ${raw.id} schemaVersion=${raw.schemaVersion} 高于 cronkit 支持的 ${SUPPORTED_SCHEMA_VERSION}，请升级 cronkit`,
    );
  }
  return raw;
}

export function resolvePython(root: string): string {
  const win = path.join(root, ".venv", "Scripts", "python.exe");
  const nix = path.join(root, ".venv", "bin", "python");
  if (existsSync(win)) {
    return win;
  }
  if (existsSync(nix)) {
    return nix;
  }
  throw new Error(`未找到虚拟环境 Python，请先在面板更新 Toolset: ${root}`);
}

export function depsReady(root: string): boolean {
  try {
    resolvePython(root);
    const marker = path.join(root, ".venv", ".deps-ok");
    return existsSync(marker);
  } catch {
    return false;
  }
}

export async function runExternalTool(
  root: string,
  manifest: ToolsetManifest,
  invocation: ToolInvocation,
  ctx: ToolRunContext,
): Promise<ToolRunResult> {
  const tool = manifest.tools.find((item) => item.id === invocation.tool);
  if (!tool) {
    throw new Error(`Toolset ${manifest.id} 没有工具 ${invocation.tool}`);
  }
  const { params, errors } = validateToolParams(tool, invocation.params, invocation.rawArgs);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  if (tool.remoteWrite && params.confirmRemoteWrite !== true) {
    throw new Error(`远端写需要 with.confirmRemoteWrite=true (${tool.id})`);
  }

  const python = resolvePython(root);
  const entry = path.join(root, manifest.entry ?? "toolset.py");
  if (!existsSync(entry)) {
    throw new Error(`入口不存在: ${entry}`);
  }

  const resultJson =
    ctx.resultJsonPath ?? path.join(path.dirname(ctx.logFile), `${path.basename(ctx.logFile)}.result.json`);
  const argv = [
    entry,
    invocation.tool,
    "--project-root",
    ctx.cwd,
    ...paramsToArgv(params),
    ...(invocation.rawArgs ?? []),
  ];
  if (tool.supportsResultJson !== false) {
    argv.push("--result-json", resultJson);
  }
  if (ctx.dryRun && tool.supportsDryRun) {
    argv.push("--dry-run");
  }

  const result = await runCommand({
    command: python,
    args: argv,
    cwd: root,
    timeoutMs: ctx.timeoutMs,
    logFile: ctx.logFile,
    abortSignal: ctx.abortSignal,
    lowPriority: tool.lowPriority === true,
  }).done;

  if (result.cancelled) {
    throw new Error(result.timedOut ? `${tool.displayName} 超时` : "已取消");
  }

  let detail = "";
  if (existsSync(resultJson)) {
    try {
      const parsed = JSON.parse(readFileSync(resultJson, "utf8")) as {
        summary?: string;
        detail?: string;
        skipped?: boolean;
      };
      detail = parsed.summary || parsed.detail || "";
      if (result.code !== 0) {
        throw new Error(detail || `${tool.displayName} 退出码 ${result.code}`);
      }
      return {
        detail: detail || `${tool.displayName} 完成`,
        code: result.code,
        skipped: parsed.skipped === true,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("退出码")) {
        throw error;
      }
    }
  }

  if (result.code !== 0) {
    throw new Error(tail(result.stderr || result.stdout) || `${tool.displayName} 退出码 ${result.code}`);
  }
  return {
    detail: detail || tail(result.stdout) || `${tool.displayName} 完成`,
    code: result.code,
  };
}

export function findToolInManifest(manifest: ToolsetManifest, toolId: string): ToolManifest | undefined {
  return manifest.tools.find((item) => item.id === toolId);
}

function tail(text: string): string {
  return text.trim().split(/\r?\n/).filter(Boolean).slice(-12).join("\n");
}

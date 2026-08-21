import type { ToolInvocation } from "./types";
import { getBuiltinTool } from "./builtin";
import { validateToolParams } from "./validate";

type LegacyRaw = Record<string, unknown>;

/**
 * Normalize any step shape (legacy or unified) into a ToolInvocation.
 * Legacy types become thin aliases into builtin tools.
 */
export function normalizeStep(raw: LegacyRaw): ToolInvocation {
  const type = String(raw.type ?? "");
  if (type === "toolset") {
    return {
      toolsetId: String(raw.toolsetId ?? ""),
      tool: String(raw.tool ?? ""),
      params: (raw.with as Record<string, unknown>) ?? {},
      rawArgs: Array.isArray(raw.args) ? (raw.args as string[]) : undefined,
      path: typeof raw.path === "string" ? raw.path : undefined,
      timeout: String(raw.timeout ?? "30m"),
      retry: typeof raw.retry === "number" ? raw.retry : undefined,
      continueOnError: raw.continueOnError === true,
    };
  }

  if (type === "svn-update") {
    return {
      toolsetId: "builtin",
      tool: "svn-update",
      params: {
        strategy: raw.strategy,
        onConflict: raw.onConflict ?? "fail",
        backupOnRevert: raw.backupOnRevert ?? true,
        ...(typeof raw.backupDir === "string" ? { backupDir: raw.backupDir } : {}),
        ...(typeof raw.path === "string" ? { path: raw.path } : {}),
      },
      path: typeof raw.path === "string" ? raw.path : undefined,
      timeout: String(raw.timeout),
      retry: typeof raw.retry === "number" ? raw.retry : undefined,
      continueOnError: raw.continueOnError === true,
    };
  }

  if (type === "unity-warmup") {
    return {
      toolsetId: "builtin",
      tool: "unity-warmup",
      params: {
        nographics: raw.nographics ?? false,
        ...(raw.executeMethod !== undefined ? { executeMethod: raw.executeMethod } : {}),
        ...(typeof raw.path === "string" ? { path: raw.path } : {}),
      },
      path: typeof raw.path === "string" ? raw.path : undefined,
      timeout: String(raw.timeout),
      retry: typeof raw.retry === "number" ? raw.retry : undefined,
      continueOnError: raw.continueOnError === true,
    };
  }

  if (type === "quit-idle") {
    return {
      toolsetId: "builtin",
      tool: "quit-idle",
      params: {
        processNames: raw.processNames,
        idleFor: raw.idleFor,
        countIdleFrom: raw.countIdleFrom ?? "00:00",
        until: raw.until ?? "08:00",
      },
      timeout: String(raw.timeout),
      retry: typeof raw.retry === "number" ? raw.retry : undefined,
      continueOnError: raw.continueOnError === true,
    };
  }

  if (type === "script") {
    return {
      toolsetId: "builtin",
      tool: "script",
      params: {
        command: raw.command,
        args: raw.args ?? [],
        ...(typeof raw.path === "string" ? { path: raw.path } : {}),
      },
      rawArgs: Array.isArray(raw.args) ? (raw.args as string[]) : undefined,
      path: typeof raw.path === "string" ? raw.path : undefined,
      timeout: String(raw.timeout),
      retry: typeof raw.retry === "number" ? raw.retry : undefined,
      continueOnError: raw.continueOnError === true,
    };
  }

  throw new Error(`未知 step.type: ${type || "(empty)"}`);
}

export function summarizeInvocation(inv: ToolInvocation): string {
  if (inv.toolsetId === "builtin") {
    const tool = getBuiltinTool(inv.tool);
    const name = tool?.displayName ?? inv.tool;
    if (inv.tool === "svn-update") {
      return `${name} (${String(inv.params.strategy ?? "")})`;
    }
    if (inv.tool === "quit-idle") {
      const names = Array.isArray(inv.params.processNames)
        ? (inv.params.processNames as string[]).join(", ")
        : "";
      return `${name} (${names})`;
    }
    if (inv.tool === "script") {
      return `${name} ${String(inv.params.command ?? "")}`;
    }
    return name;
  }
  return `${inv.toolsetId}/${inv.tool}`;
}

export function validateInvocationParams(
  inv: ToolInvocation,
  resolveTool: (toolsetId: string, tool: string) => ReturnType<typeof getBuiltinTool>,
): string[] {
  const tool = resolveTool(inv.toolsetId, inv.tool);
  if (!tool) {
    return [`未知工具: ${inv.toolsetId}/${inv.tool}`];
  }
  const { errors } = validateToolParams(tool, inv.params, inv.rawArgs);
  return errors;
}

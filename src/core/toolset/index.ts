import { getBuiltinTool, runBuiltinTool } from "./builtin";
import { loadExternalManifest, resolveTool, toolsetDir } from "./manager";
import { runExternalTool } from "./external";
import { normalizeStep, summarizeInvocation, validateInvocationParams } from "./normalize";
import type { ToolInvocation, ToolRunContext, ToolRunResult } from "./types";

export * from "./types";
export { normalizeStep, summarizeInvocation, validateInvocationParams } from "./normalize";
export { getBuiltinTool, listBuiltinTools, BUILTIN_MANIFEST } from "./builtin";
export {
  listInstalledToolsets,
  installOrUpdateToolset,
  resolveTool,
  toolsetDir,
  rememberToolsetSha,
  KNOWN_TOOLSETS,
} from "./manager";

export async function runToolInvocation(
  invocation: ToolInvocation,
  ctx: ToolRunContext,
  dataDir?: string,
): Promise<ToolRunResult> {
  if (invocation.toolsetId === "builtin") {
    return runBuiltinTool(invocation, ctx);
  }
  const root = toolsetDir(invocation.toolsetId, dataDir);
  const manifest = loadExternalManifest(invocation.toolsetId, dataDir);
  return runExternalTool(root, manifest, invocation, ctx);
}

export function lookupTool(toolsetId: string, tool: string, dataDir?: string) {
  return resolveTool(toolsetId, tool, dataDir);
}

export function invocationFromRawStep(raw: Record<string, unknown>): ToolInvocation {
  return normalizeStep(raw);
}

export function validateRawStep(
  raw: Record<string, unknown>,
  dataDir?: string,
): { invocation: ToolInvocation; errors: string[] } {
  const invocation = normalizeStep(raw);
  if (!invocation.toolsetId || !invocation.tool) {
    return { invocation, errors: ["toolsetId/tool 不能为空"] };
  }
  if (!invocation.timeout) {
    return { invocation, errors: ["timeout 不能为空"] };
  }
  const errors = validateInvocationParams(invocation, (ts, tool) =>
    resolveTool(ts, tool, dataDir),
  );
  return { invocation, errors };
}

export { getBuiltinTool as getToolMeta };

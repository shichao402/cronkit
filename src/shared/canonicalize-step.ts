type InvocationLike = {
  toolsetId: string;
  tool: string;
  params: Record<string, unknown>;
  rawArgs?: string[];
  path?: string;
  timeout: string;
  retry?: number;
  continueOnError?: boolean;
};

/** Browser-safe step → invocation (mirrors core normalizeStep, no Node imports). */
function stepToInvocation(raw: Record<string, unknown>): InvocationLike {
  if (typeof raw.uses === "string") {
    const slash = raw.uses.indexOf("/");
    const toolsetId = slash >= 0 ? raw.uses.slice(0, slash) : "builtin";
    const tool = slash >= 0 ? raw.uses.slice(slash + 1) : String(raw.uses);
    return {
      toolsetId,
      tool,
      params: (raw.with as Record<string, unknown>) ?? {},
      rawArgs: Array.isArray(raw.args) ? (raw.args as string[]) : undefined,
      path: typeof raw.path === "string" ? raw.path : undefined,
      timeout: String(raw.timeout ?? "30m"),
      retry: typeof raw.retry === "number" ? raw.retry : undefined,
      continueOnError: raw.continueOnError === true,
    };
  }

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
      timeout: String(raw.timeout ?? "30m"),
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
      timeout: String(raw.timeout ?? "30m"),
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
      timeout: String(raw.timeout ?? "30m"),
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
      timeout: String(raw.timeout ?? "30m"),
      retry: typeof raw.retry === "number" ? raw.retry : undefined,
      continueOnError: raw.continueOnError === true,
    };
  }

  throw new Error(`未知 step.type: ${type || "(empty)"}`);
}

/** Normalize any accepted step shape into canonical v2 `uses:` form. */
export function canonicalizeStep(step: Record<string, unknown>): Record<string, unknown> {
  const inv = stepToInvocation(step);
  const withParams = compactParams(inv.params);
  const node: Record<string, unknown> = {
    uses: `${inv.toolsetId}/${inv.tool}`,
    timeout: inv.timeout,
  };
  if (Object.keys(withParams).length > 0) {
    node.with = withParams;
  }
  if (inv.rawArgs && inv.rawArgs.length > 0) {
    node.args = inv.rawArgs;
  }
  if (inv.path) {
    node.path = inv.path;
  }
  if (typeof inv.retry === "number" && inv.retry > 0) {
    node.retry = inv.retry;
  }
  if (inv.continueOnError) {
    node.continueOnError = true;
  }
  return node;
}

function compactParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

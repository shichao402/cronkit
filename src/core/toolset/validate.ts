import type { ToolManifest, ToolParamSpec } from "./types";

export function validateToolParams(
  tool: ToolManifest,
  raw: Record<string, unknown> | undefined,
  rawArgs?: string[],
): { params: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const input = { ...(raw ?? {}) };
  const specs = tool.params ?? [];
  const known = new Set(specs.map((s) => s.name));

  if (rawArgs && rawArgs.length > 0 && !tool.allowRawArgs) {
    errors.push(`工具 ${tool.id} 不允许 raw args`);
  }

  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      errors.push(`未知参数: ${key}`);
    }
  }

  const params: Record<string, unknown> = {};
  for (const spec of specs) {
    const has = Object.prototype.hasOwnProperty.call(input, spec.name);
    let value = has ? input[spec.name] : spec.default;
    if (value === undefined || value === null) {
      if (spec.required) {
        errors.push(`缺少必填参数: ${spec.name}`);
      }
      continue;
    }
    const coerced = coerceParam(spec, value);
    if (coerced.error) {
      errors.push(coerced.error);
      continue;
    }
    params[spec.name] = coerced.value;
  }

  return { params, errors };
}

function coerceParam(
  spec: ToolParamSpec,
  value: unknown,
): { value?: unknown; error?: string } {
  switch (spec.type) {
    case "string":
      if (typeof value !== "string") {
        return { error: `${spec.name} 应为 string` };
      }
      return { value };
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        return { error: `${spec.name} 应为 number` };
      }
      return { value };
    case "boolean":
      if (typeof value !== "boolean") {
        return { error: `${spec.name} 应为 boolean` };
      }
      return { value };
    case "string[]":
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        return { error: `${spec.name} 应为 string[]` };
      }
      return { value };
    case "enum": {
      if (typeof value !== "string") {
        return { error: `${spec.name} 应为枚举字符串` };
      }
      if (spec.enum && !spec.enum.includes(value)) {
        return { error: `${spec.name} 必须是 ${spec.enum.join("|")}` };
      }
      return { value };
    }
    default:
      return { error: `${spec.name} 未知类型` };
  }
}

/** Serialize object params to CLI argv: { onConflict: "revert" } -> ["--on-conflict", "revert"] */
export function paramsToArgv(params: Record<string, unknown>): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const flag = `--${camelToKebab(key)}`;
    if (typeof value === "boolean") {
      if (value) {
        args.push(flag);
      } else {
        args.push(`${flag}=false`);
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        args.push(flag, String(item));
      }
      continue;
    }
    if (value === null || value === undefined) {
      continue;
    }
    args.push(flag, String(value));
  }
  return args;
}

function camelToKebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

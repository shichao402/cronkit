import type { EditorStep, EditorTarget, StepTemplate, TemplateVar } from "./types";

/** `${name}` 占位符；名字允许字母数字、下划线、连字符、点。 */
const VAR_PATTERN = /\$\{([A-Za-z0-9_.-]+)\}/g;

export type ExpandIssue = {
  /** 缺失取值的变量名。 */
  name: string;
  message: string;
};

export type ExpandResult<S = EditorStep> = {
  steps: S[];
  issues: ExpandIssue[];
};

/** 内置变量：来自目标自身，模板里可直接引用，无需声明。 */
export function builtinVars(target: Pick<EditorTarget, "id" | "name" | "path">): Record<string, string> {
  return {
    "target.id": target.id,
    "target.name": target.name,
    "target.path": target.path,
  };
}

/** 收集一段文本里引用到的变量名。 */
export function collectVarNames(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const match of value.matchAll(VAR_PATTERN)) {
      into.add(match[1]);
    }
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectVarNames(item, into);
    }
    return into;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectVarNames(item, into);
    }
  }
  return into;
}

/** 模板里用到的全部变量名（含步骤各字段）。 */
export function templateVarNames(template: StepTemplate): Set<string> {
  return collectVarNames(template.steps);
}

function substituteString(
  input: string,
  values: Record<string, string>,
  missing: Set<string>,
): string {
  return input.replace(VAR_PATTERN, (whole, name: string) => {
    const value = values[name];
    if (value === undefined) {
      missing.add(name);
      return whole;
    }
    return value;
  });
}

function substituteDeep(
  value: unknown,
  values: Record<string, string>,
  missing: Set<string>,
): unknown {
  if (typeof value === "string") {
    return substituteString(value, values, missing);
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteDeep(item, values, missing));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = substituteDeep(item, values, missing);
    }
    return out;
  }
  return value;
}

/** 合并变量取值：内置 < 模板默认值 < 目标显式取值。 */
export function resolveVarValues(
  vars: TemplateVar[],
  provided: Record<string, string> | undefined,
  builtin: Record<string, string>,
): Record<string, string> {
  const values: Record<string, string> = { ...builtin };
  for (const item of vars) {
    if (item.default !== undefined) {
      values[item.name] = item.default;
    }
  }
  for (const [key, value] of Object.entries(provided ?? {})) {
    if (value !== undefined && value !== "") {
      values[key] = value;
    }
  }
  return values;
}

/** 把模板按目标的变量取值展开成实际步骤。 */
export function expandTemplate<S = EditorStep>(
  template: { vars: TemplateVar[]; steps: S[] },
  target: { id: string; name: string; path: string; vars?: Record<string, string> },
): ExpandResult<S> {
  const values = resolveVarValues(template.vars, target.vars, builtinVars({
    id: target.id,
    name: target.name,
    path: target.path,
  }));
  const missing = new Set<string>();
  const steps = template.steps.map((step) => substituteDeep(step, values, missing) as S);
  return {
    steps,
    issues: [...missing].map((name) => ({
      name,
      message: `变量 \${${name}} 没有取值`,
    })),
  };
}

/** 目标最终执行的步骤：引用模板则展开，否则用自有 steps。 */
export function effectiveSteps(
  target: EditorTarget,
  templates: StepTemplate[],
): ExpandResult<EditorStep> {
  if (!target.usesTemplate) {
    return { steps: target.steps, issues: [] };
  }
  const template = templates.find((item) => item.id === target.usesTemplate);
  if (!template) {
    return {
      steps: [],
      issues: [{ name: target.usesTemplate, message: `步骤模板 ${target.usesTemplate} 不存在` }],
    };
  }
  return expandTemplate<EditorStep>(template, target);
}

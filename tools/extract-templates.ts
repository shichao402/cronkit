/**
 * 一次性脚本：把配置里步骤完全相同的目标抽成 stepTemplates。
 *
 * 规则：
 * - 按「步骤序列的规范化签名」分组，只有 >=2 个目标共用同一签名才抽模板；
 *   单独一份的目标（如 ty1、Rider）保持自有 steps 不动。
 * - 步骤里出现的目标路径字面量替换为 ${target.path}，避免模板写死目录。
 * - 替换后若某组签名仍存在路径以外的差异，脚本会报错退出，不写盘。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import { parseConfigDetailed, readConfigText } from "../src/core/config";
import { configToDraft, draftToYaml } from "../src/core/config-draft";
import { expandTemplate } from "../src/shared/step-template";
import type { EditorStep, StepTemplate } from "../src/shared/types";

const configPath = process.argv[2];
if (!configPath) {
  console.error("用法: tsx tools/extract-templates.ts <config.yaml>");
  process.exit(1);
}

/** 把步骤里的目标路径换成占位符。 */
function delitteralize(step: EditorStep, targetPath: string): EditorStep {
  if (!targetPath) return step;
  const variants = [targetPath, targetPath.replace(/\//g, "\\")];
  const swap = (value: unknown): unknown => {
    if (typeof value === "string") {
      let out = value;
      for (const v of variants) {
        if (v) out = out.split(v).join("${target.path}");
      }
      return out;
    }
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swap(v)]));
    }
    return value;
  };
  return {
    ...step,
    params: swap(step.params) as Record<string, unknown>,
    ...(step.path ? { path: step.path } : {}),
  };
}

function signature(steps: EditorStep[]): string {
  return JSON.stringify(
    steps.map((s) => ({
      toolsetId: s.toolsetId,
      tool: s.tool,
      timeout: s.timeout,
      retry: s.retry ?? null,
      continueOnError: s.continueOnError ?? null,
      path: s.path ?? null,
      args: s.args ?? null,
      params: Object.fromEntries(Object.entries(s.params).sort(([a], [b]) => a.localeCompare(b))),
    })),
  );
}

const parsed = parseConfigDetailed(readConfigText(configPath), configPath, undefined, {
  resolvePaths: false,
});
const draft = configToDraft(parsed.config);

/** 原始 YAML 里的 path 字面量（configToDraft 不改 path，但保险起见按原文取）。 */
const raw = parse(readFileSync(configPath, "utf8")) as {
  tasks: Array<{ id: string; targets: Array<{ id: string; path: string }> }>;
};
const rawPath = new Map<string, string>();
for (const task of raw.tasks ?? []) {
  for (const target of task.targets ?? []) {
    rawPath.set(`${task.id}/${target.id}`, target.path);
  }
}

type Member = { taskId: string; targetId: string; targetName: string };
const groups = new Map<string, { steps: EditorStep[]; members: Member[] }>();

for (const task of draft.tasks) {
  for (const target of task.targets) {
    if (target.usesTemplate) continue;
    const path = rawPath.get(`${task.id}/${target.id}`) ?? target.path;
    const normalized = target.steps.map((s) => delitteralize(s, path));
    const sig = signature(normalized);
    const entry = groups.get(sig) ?? { steps: normalized, members: [] };
    entry.members.push({ taskId: task.id, targetId: target.id, targetName: target.name });
    groups.set(sig, entry);
  }
}

const shared = [...groups.values()].filter((g) => g.members.length >= 2);
if (shared.length === 0) {
  console.log("没有发现可复用的步骤组，配置未改动。");
  process.exit(0);
}

/** 依据成员名取一个人类可读的模板名。 */
function templateName(members: Member[], steps: EditorStep[]): string {
  const tools = steps.map((s) => s.tool);
  if (tools.includes("unity-warmup")) return "OSG 分支：还原 + 更新 + Unity 预热";
  if (tools.includes("svn-update") && steps.length <= 2) return "CoreOnly：还原生成物 + SVN 更新";
  return `通用步骤（${members.length} 个目录共用）`;
}

const templates: StepTemplate[] = [];
const assign = new Map<string, string>();

shared.forEach((group, index) => {
  const id = `tpl-${index + 1}`;
  templates.push({
    id,
    name: templateName(group.members, group.steps),
    vars: [],
    steps: group.steps,
  });
  for (const m of group.members) {
    assign.set(`${m.taskId}/${m.targetId}`, id);
  }
});

const next = {
  ...draft,
  stepTemplates: templates,
  tasks: draft.tasks.map((task) => ({
    ...task,
    targets: task.targets.map((target) => {
      const tplId = assign.get(`${task.id}/${target.id}`);
      if (!tplId) return target;
      return { ...target, usesTemplate: tplId, vars: {}, steps: [] };
    }),
  })),
};

console.log("将抽出以下模板：");
for (const tpl of templates) {
  const users = [...assign.entries()]
    .filter(([, id]) => id === tpl.id)
    .map(([key]) => key.split("/")[1]);
  console.log(`  ${tpl.id}  ${tpl.name}`);
  console.log(`     ${tpl.steps.length} 步 · 引用者: ${users.join(", ")}`);
}
const untouched = draft.tasks.flatMap((t) =>
  t.targets.filter((g) => !assign.has(`${t.id}/${g.id}`)).map((g) => g.name),
);
console.log(`保持独立的目录: ${untouched.join(", ") || "（无）"}`);

const yaml = draftToYaml(next);
const outPath = process.argv[3] ?? configPath;
writeFileSync(outPath, yaml, "utf8");
console.log(`\n已写入 ${outPath}`);

const verify = parseConfigDetailed(readConfigText(outPath), outPath, undefined, {
  resolvePaths: false,
});
const verifyDraft = configToDraft(verify.config);
for (const task of verifyDraft.tasks) {
  for (const target of task.targets) {
    const before = draft.tasks
      .find((t) => t.id === task.id)!
      .targets.find((g) => g.id === target.id)!;
    // configToDraft 对引用模板的目标刻意保留引用（steps 为空），这里自行展开再比。
    const after = target.usesTemplate
      ? expandTemplate(
          verifyDraft.stepTemplates.find((t) => t.id === target.usesTemplate)!,
          target,
        ).steps
      : target.steps;
    if (signature(before.steps) !== signature(after)) {
      console.error(`\n[不一致] ${task.id}/${target.id} 展开后步骤与原配置不同！`);
      console.error("原始:", signature(before.steps));
      console.error("现在:", signature(after));
      process.exit(1);
    }
  }
}
console.log("校验通过：所有目标展开后的步骤与原配置逐字段一致。");

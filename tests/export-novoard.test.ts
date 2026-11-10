import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  exportNovoardTargets,
  loadCronkitConfig,
  quoteArg,
  renderTargetsYaml,
  type ToolLookup,
} from "../scripts/export-novoard-targets";
import { lookupTool } from "../src/core/toolset";

const ROOT = path.resolve(__dirname, "..");
const NO_DATA = path.join(ROOT, ".no-such-data-dir");
const lookup: ToolLookup = (ts, tool) => lookupTool(ts, tool, NO_DATA);

function exportYaml(yaml: string, file = path.join(ROOT, "virtual.yaml")) {
  return exportNovoardTargets(loadCronkitConfig(yaml, file), lookup);
}

const base = (tasks: string, runtime = "") => `
version: 2
timezone: Asia/Shanghai
runtime:
  maxConcurrentRuns: 1
${runtime}
tasks:
${tasks}
reporting: { enabled: false }
brain: { enabled: false }
`;

describe("config.demo.yaml 导出", () => {
  const demoPath = path.join(ROOT, "config.demo.yaml");
  const result = exportNovoardTargets(loadCronkitConfig(readFileSync(demoPath, "utf8"), demoPath), lookup);
  const wc = path.join(ROOT, "fixtures", "wc");

  it("每个 task × target 一个 target，id 为 <task>-<target>", () => {
    expect(Object.keys(result.targets)).toEqual([
      "after-midnight-trunk-client",
      "after-midnight-tools-scripts",
      "rider-idle-watch-rider-idle-quit",
      "manual-release-1.0-release-1.0",
      "manual-osg-build-example-osg-build-example",
      "manual-git-repo-example-git-repo-example",
    ]);
    expect(result.issues).toEqual([]);
    expect(result.timezone).toBe("Asia/Shanghai");
  });

  it("定时任务带 schedule / oncePerDay，手动任务不带；固定字段", () => {
    const t = result.targets["after-midnight-trunk-client"];
    expect(t).toMatchObject({
      title: "每天凌晨后的例行更新与预热 · 主干客户端（演示）",
      schedule: "10 2 * * *",
      oncePerDay: true,
      expose: "local",
      audit: "summary",
      requiresApproval: false,
      notify: "on-failure",
    });
    expect(result.targets["rider-idle-watch-rider-idle-quit"].oncePerDay).toBe(false);
    const manual = result.targets["manual-release-1.0-release-1.0"];
    expect(manual.schedule).toBeUndefined();
    expect(manual.oncePerDay).toBeUndefined();
    expect(manual.title).toBe("发布分支（演示，仅手动）");
  });

  it("builtin 工具映射到 versionControl / general，连续独占步骤前只插一次释放占用", () => {
    expect(result.targets["after-midnight-trunk-client"].steps).toEqual([
      { uses: "general/release-occupants", cwd: wc, with: { path: wc } },
      { uses: "versionControl/svn-update", cwd: wc, with: { strategy: "follow-latest", onConflict: "revert" }, retry: 1 },
      { uses: "general/unity-warmup", cwd: wc, with: { nographics: false }, retry: 1 },
    ]);
    const git = result.targets["manual-git-repo-example-git-repo-example"].steps.map((s) => ("uses" in s ? s.uses : "script"));
    expect(git).toEqual(["versionControl/git-status", "general/release-occupants", "versionControl/git-pull"]);
  });

  it("timeout = Σ(步骤 timeout × 尝试次数) + 每步 1 分钟余量（释放占用算 2 分钟）", () => {
    // 2 + (120×2 + 1) + (90×2 + 1)
    expect(result.targets["after-midnight-trunk-client"].timeout).toBe("424m");
  });

  it("quit-idle 把步骤 timeout 带进 with.timeout", () => {
    const [step] = result.targets["rider-idle-watch-rider-idle-quit"].steps;
    expect(step).toMatchObject({ uses: "general/quit-idle", with: { timeout: "3m", idleFor: "1h", processNames: ["rider64", "rider"] } });
  });

  it("script 拼成命令行，cwd 为工作目录", () => {
    const steps = result.targets["manual-osg-build-example-osg-build-example"].steps;
    expect(steps.at(-1)).toEqual({
      script: 'powershell -NoProfile -Command "Write-Host osg-build-example placeholder"',
      cwd: wc,
    });
  });

  it("渲染结果可被 YAML 解析回同一结构，带时区提示", () => {
    const text = renderTargetsYaml(result, "config.demo.yaml");
    expect(text).toContain("schedule.timezone 需设为同一时区");
    expect(parseYaml(text)).toEqual({ targets: result.targets });
  });
});

describe("映射规则边界", () => {
  it("定时任务里 strategy=manual 的更新步骤删除并提示；手动任务保留", () => {
    const r = exportYaml(base(`
  - id: night
    name: 夜间
    trigger: { type: cron, cron: "0 3 * * *", deadline: "07:30" }
    targets:
      - id: a
        name: A
        path: /w/a
        steps:
          - uses: builtin/svn-update
            with: { strategy: manual }
            timeout: 1h
          - uses: builtin/svn-cleanup
            timeout: 5m
`));
    const t = r.targets["night-a"];
    expect(t.deadline).toBe("07:30");
    expect(t.steps.map((s) => ("uses" in s ? s.uses : ""))).toEqual(["general/release-occupants", "versionControl/svn-cleanup"]);
    expect(r.issues).toEqual([
      expect.objectContaining({ level: "warning", target: "night-a", step: 1, message: expect.stringContaining("strategy=manual") }),
    ]);
  });

  it("远端写工具：requiresApproval=true，删除 confirmRemoteWrite", () => {
    const r = exportYaml(base(`
  - id: rel
    name: 发版
    trigger: { type: manual }
    targets:
      - id: tag
        name: 打标签
        path: /w/a
        steps:
          - uses: builtin/svn-copy
            with: { from: "^/trunk", to: "^/tags/v1", message: "tag", confirmRemoteWrite: true }
            timeout: 5m
            retry: 2
`));
    const t = r.targets["rel-tag"];
    expect(t.requiresApproval).toBe(true);
    expect(t.steps[0]).toEqual({
      uses: "versionControl/svn-copy",
      cwd: "/w/a",
      with: { from: "^/trunk", to: "^/tags/v1", message: "tag" },
      retry: 2,
    });
    // svn-copy 非幂等：只算 1 次尝试
    expect(t.timeout).toBe("6m");
  });

  it("continueOnError 不在最后一步时提示；停用的任务不导出 schedule", () => {
    const r = exportYaml(base(`
  - id: off
    name: 停用
    enabled: false
    trigger: { type: cron, cron: "0 1 * * *" }
    targets:
      - id: a
        name: A
        path: /w/a
        steps:
          - uses: builtin/script
            with: { command: cmd, args: ["/c", "echo a&b"] }
            timeout: 1m
            retry: 2
            continueOnError: true
          - uses: builtin/git-status
            timeout: 1m
`));
    const t = r.targets["off-a"];
    expect(t.schedule).toBeUndefined();
    expect(t.steps[0]).toEqual({ script: 'cmd /c "echo a&b"', cwd: "/w/a" });
    const messages = r.issues.map((i) => i.message);
    expect(messages).toEqual([
      expect.stringContaining("agent 会在此停止"),
      expect.stringContaining("不支持 retry"),
      expect.stringContaining("已停用"),
    ]);
  });

  it("runtime.releaseOccupants=false 时不插释放占用；step.path 拼到 cwd", () => {
    const r = exportYaml(base(`
  - id: t
    name: T
    trigger: { type: manual }
    targets:
      - id: a
        name: A
        path: /w/a
        steps:
          - uses: builtin/svn-update
            path: sub
            with: { strategy: follow-latest }
            timeout: 10m
`, "  releaseOccupants: false"));
    expect(r.targets["t-a"].steps).toEqual([
      { uses: "versionControl/svn-update", cwd: path.resolve("/w/a", "sub"), with: { strategy: "follow-latest" } },
    ]);
  });

  it("外部 toolset 原样保留并提示找不到 manifest；没有对应包的 builtin 报 error 且不导出空 target", () => {
    const r = exportYaml(base(`
  - id: t
    name: T
    trigger: { type: manual }
    targets:
      - id: osg
        name: OSG
        path: /w/a
        steps:
          - uses: osg/cmake-build
            with: { target: GameCore_Editor }
            args: ["--x"]
            timeout: 1h
      - id: bad
        name: Bad
        path: /w/a
        steps:
          - uses: builtin/no-such-tool
            timeout: 1m
`));
    expect(r.targets["t-osg"].steps).toEqual([{ uses: "osg/cmake-build", cwd: "/w/a", with: { target: "GameCore_Editor" } }]);
    expect(r.targets["t-bad"]).toBeUndefined();
    expect(r.issues.map((i) => [i.level, i.target])).toEqual([
      ["warning", "t-osg"],
      ["warning", "t-osg"],
      ["error", "t-bad"],
      ["error", "t-bad"],
    ]);
  });

  it("步骤模板展开成内联 steps", () => {
    const yaml = base(`
  - id: t
    name: T
    trigger: { type: cron, cron: "0 2 * * *" }
    targets:
      - id: a
        name: A
        path: /w/a
        oncePerDay: false
        usesTemplate: warm
        vars: { gfx: "true" }
        steps: []
`).replace("tasks:", `stepTemplates:
  - id: warm
    name: 预热
    vars: [{ name: gfx }]
    steps:
      - uses: builtin/quit-idle
        with: { processNames: ["Unity"], idleFor: "\${gfx}" }
        timeout: 2m
tasks:`);
    const t = exportYaml(yaml).targets["t-a"];
    expect(t.oncePerDay).toBe(false);
    expect(t.steps).toEqual([
      { uses: "general/quit-idle", cwd: "/w/a", with: { processNames: ["Unity"], idleFor: "true", timeout: "2m" } },
    ]);
  });
});

describe("quoteArg", () => {
  it("按 Windows 命令行规则引用", () => {
    expect(quoteArg("plain")).toBe("plain");
    expect(quoteArg("")).toBe('""');
    expect(quoteArg("a b")).toBe('"a b"');
    expect(quoteArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteArg("C:\\dir with space\\")).toBe('"C:\\dir with space\\\\"');
  });
});

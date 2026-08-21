import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { configV1Schema, parseConfigDetailed, parseConfigFromText } from "../src/core/config";
import { migrateV1toV2 } from "../src/core/config-migrate";
import { configToDraft } from "../src/core/config-draft";
import { draftToYaml } from "../src/shared/draft-yaml";
import { buildPlan } from "../src/core/plan";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const v1Path = path.join(root, "fixtures", "config.v1.yaml");
const demoPath = path.join(root, "config.demo.yaml");

describe("config v2 migration", () => {
  it("migrates v1 fixture to tasks with stable target ids", () => {
    const raw = readFileSync(v1Path, "utf8");
    const detailed = parseConfigDetailed(raw, v1Path, root, { resolvePaths: false });
    expect(detailed.migratedFromV1).toBe(true);
    expect(detailed.config.version).toBe(2);
    expect(detailed.config.tasks.map((t) => t.id).sort()).toEqual(
      ["after-midnight", "manual-release-only", "rider-idle-watch"].sort(),
    );

    const midnight = detailed.config.tasks.find((t) => t.id === "after-midnight")!;
    expect(midnight.targets.map((t) => t.id)).toEqual(["trunk-client", "tools-scripts"]);
    expect(midnight.trigger).toEqual({ type: "cron", cron: "10 2 * * *" });

    const rider = detailed.config.tasks.find((t) => t.id === "rider-idle-watch")!;
    expect(rider.targets[0].oncePerDay).toBe(false);
    expect(rider.targets[0].id).toBe("rider-idle-quit");

    const manual = detailed.config.tasks.find((t) => t.id === "manual-release-only")!;
    expect(manual.trigger.type).toBe("manual");
  });

  it("duplicates shared workspace with warning", () => {
    const v1 = configV1Schema.parse({
      version: 1,
      timezone: "Asia/Shanghai",
      runtime: {
        maxConcurrentRuns: 1,
        catchUpPreviousDays: 0,
        retryFailedOnCatchUp: false,
      },
      schedules: [
        { id: "a", cron: "0 1 * * *", workspaceIds: ["shared"] },
        { id: "b", cron: "0 2 * * *", workspaceIds: ["shared"] },
      ],
      workspaces: [
        {
          id: "shared",
          name: "Shared",
          path: "fixtures/wc",
          steps: [{ type: "svn-update", strategy: "follow-latest", timeout: "1h" }],
        },
      ],
      reporting: { enabled: false, on: [] },
      brain: {
        enabled: false,
        allowedTools: [],
        allowedCommands: [],
        requireConfirmationFor: [],
      },
    });
    const { config, warnings } = migrateV1toV2(v1);
    expect(config.tasks).toHaveLength(2);
    expect(config.tasks[0].targets[0].id).toBe("shared");
    expect(config.tasks[1].targets[0].id).toBe("shared@b");
    expect(warnings.some((w) => w.includes("shared@b"))).toBe(true);
  });

  it("round-trips demo yaml through draft", () => {
    const raw = readFileSync(demoPath, "utf8");
    const config = parseConfigFromText(raw, demoPath, root, { resolvePaths: false });
    const draft = configToDraft(config);
    const yaml = draftToYaml(draft);
    const again = parseConfigFromText(yaml, demoPath, root, { resolvePaths: false });
    expect(again.tasks).toHaveLength(config.tasks.length);
    expect(again.tasks.map((t) => t.id).sort()).toEqual(config.tasks.map((t) => t.id).sort());
    const trunk = again.tasks.flatMap((t) => t.targets).find((t) => t.id === "trunk-client")!;
    expect(trunk.steps[0]).toMatchObject({
      uses: "builtin/svn-update",
    });
  });

  it("preserves step path through draft round-trip", () => {
    const raw = readFileSync(v1Path, "utf8");
    const detailed = parseConfigDetailed(raw, v1Path, root, { resolvePaths: false });
    const draft = configToDraft(detailed.config);
    const yaml = draftToYaml(draft);
    const again = parseConfigFromText(yaml, v1Path, root, { resolvePaths: false });
    const trunk = again.tasks.flatMap((t) => t.targets).find((t) => t.id === "trunk-client")!;
    const unity = trunk.steps.find((s) => "uses" in s && s.uses === "builtin/unity-warmup");
    expect(unity).toMatchObject({ path: "Project" });
  });

  it("buildPlan expands cron targets and marks manuals", () => {
    const raw = readFileSync(demoPath, "utf8");
    const config = parseConfigFromText(raw, demoPath, root, { resolvePaths: false });
    const plan = buildPlan(config);
    const auto = plan.filter((p) => p.autoScheduled);
    const manual = plan.filter((p) => !p.autoScheduled);
    expect(auto.some((p) => p.workspaceId === "trunk-client")).toBe(true);
    expect(manual.some((p) => p.workspaceId === "release-1.0")).toBe(true);
    expect(auto.find((p) => p.workspaceId === "trunk-client")?.taskId).toBe("after-midnight");
  });
});

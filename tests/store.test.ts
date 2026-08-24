import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../src/core/store";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cronkit-store-"));
  dirs.push(dir);
  return dir;
}

describe("Store toolset repositories", () => {
  it("migrates an existing v1 state without toolset repositories", () => {
    const dir = tempDir();
    writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify({
        version: 1,
        schedulerEnabled: true,
        theme: "dark",
        keyed: {},
        runs: [],
      }),
      "utf8",
    );

    expect(new Store(dir).data.toolsetRepos).toEqual({});
  });

  it("persists repository overrides", () => {
    const dir = tempDir();
    const store = new Store(dir);
    store.data.toolsetRepos.osg = "https://example.com/OSGToolset.git";
    store.flush();

    const disk = JSON.parse(readFileSync(path.join(dir, "state.json"), "utf8")) as {
      toolsetRepos: Record<string, string>;
    };
    expect(disk.toolsetRepos.osg).toBe("https://example.com/OSGToolset.git");
    expect(new Store(dir).data.toolsetRepos.osg).toBe("https://example.com/OSGToolset.git");
  });
});

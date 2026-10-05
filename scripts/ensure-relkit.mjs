#!/usr/bin/env node
/**
 * relkit CLI 自举引导（舰队统一版本 P1 原则，2026-10-05）。
 *
 * 版本单一事实源：scripts/relkit.lock.json 的 source.version。
 * npm scripts 不便携带 shell 变量展开，这里读 lock 后代为执行
 * `go run github.com/shichao402/relkit/cmd/relkit@<lock.version> install`。
 * re-pin 时只更新 lock（relkit upgrade vX.Y.Z），本脚本零改动。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(root, "scripts", "relkit.lock.json");

let version;
let release;
try {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  version = lock?.source?.version;
  release = lock?.release;
} catch {
  // fall through to the error below
}
if (!version) {
  console.error(
    `无法从 ${path.relative(root, lockPath)} 读取 source.version；` +
      "先运行 `go run github.com/shichao402/relkit/cmd/relkit@v0.5.19 upgrade v0.5.19` 生成 lock。",
  );
  process.exit(1);
}

const isLatest = String(version).trim().toLowerCase() === "latest" && String(release).trim().toLowerCase() === "latest";

const ref = process.env.RELKIT_REF && process.env.RELKIT_REF !== "" ? process.env.RELKIT_REF : version;
if (ref !== version) {
  console.error(
    `RELKIT_REF=${ref} 与 lock 钉定 ${version} 不一致（舰队必须同版本）。` +
      "\n要么改 lock：go run github.com/shichao402/relkit/cmd/relkit@" + ref + " upgrade " + ref +
      "\n要么去掉 RELKIT_REF 环境变量，跟随 lock。",
  );
  process.exit(1);
}

if (isLatest) {
  // follow-latest form (P4): the lock expresses intent, not a version.
  // `go run module@latest` does not understand our keyword, so delegate
  // to the locally pinned CLI (tools/bin or bootstrap via module channel)
  // which runs the full resolution chain (redirect -> api -> mirrors).
  const candidates = [
    path.join(root, "tools", "bin", process.platform === "win32" ? "relkit.exe" : "relkit"),
  ];
  const placed = candidates.find((c) => existsSync(c));
  if (placed) {
    const r = spawnSync(placed, ["install"], { stdio: "inherit", cwd: root });
    process.exit(r.status ?? 1);
  }
  // Bootstrap: one explicit pinned go run (the fleet floor at the time of
  // the switch), then let the placed CLI own all future resolutions.
  const boot = spawnSync(
    "go",
    ["run", "github.com/shichao402/relkit/cmd/relkit@v0.5.19", "install"],
    { stdio: "inherit", cwd: root },
  );
  process.exit(boot.status ?? 1);
}

const result = spawnSync(
  "go",
  ["run", `github.com/shichao402/relkit/cmd/relkit@${version}`, "install"],
  { stdio: "inherit", cwd: root },
);
process.exit(result.status ?? 1);

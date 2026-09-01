/**
 * 把 electron-builder 的 win-unpacked 组装成 relkit versionedDir 产物。
 *
 * 输出：
 *   dist/cronkit-<version>-win-x64.zip
 *     WorkspaceOrchestrator.exe  (稳定 launcher)
 *     relkit-apply.exe           (固定到已审提交的 sidecar)
 *     active.json
 *     versions/<version>/...     (Electron 应用)
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildOutputDir = path.resolve(root, process.argv[2] ?? "dist");
const artifactOutputDir = path.join(root, "dist");
const versionFile = JSON.parse(readFileSync(path.join(root, "VERSION.json"), "utf8"));
const version = String(versionFile.version ?? "");
if (!/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(version)) {
  throw new Error(`VERSION.json 中的版本号不能用作目录名：${version}`);
}

const unpackedDir = path.join(buildOutputDir, "win-unpacked");
if (!existsSync(path.join(unpackedDir, "WorkspaceOrchestrator.exe"))) {
  throw new Error("找不到 dist/win-unpacked；请先运行 electron-builder --dir");
}

const toolDir = path.join(root, "build", "update-tools");
mkdirSync(toolDir, { recursive: true });
const launcher = path.join(toolDir, "WorkspaceOrchestrator.exe");
const sidecar = path.join(toolDir, "relkit-apply.exe");
const goFlags = process.platform === "win32" ? ["-ldflags=-H=windowsgui"] : [];

run("go", [
  "build",
  ...goFlags,
  "-o",
  launcher,
  path.join(root, "tools", "update-launcher", "main.go"),
]);

// 首次提供 versionedDir 的上游提交。固定 commit，避免构建结果随 relkit HEAD 漂移。
run(
  "go",
  [
    "install",
    "cnb.cool/shichao402/relkit/cmd/relkit-apply@b255ad090bde4134780202a9edc4fede8ec129fe",
  ],
  { GOBIN: toolDir },
);
if (!existsSync(sidecar)) {
  throw new Error(`relkit-apply 构建完成但未出现在 ${sidecar}`);
}

const bundleDir = path.join(buildOutputDir, "versioned");
rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(path.join(bundleDir, "versions"), { recursive: true });
cpSync(unpackedDir, path.join(bundleDir, "versions", version), { recursive: true });
copyFileSync(launcher, path.join(bundleDir, "WorkspaceOrchestrator.exe"));
copyFileSync(sidecar, path.join(bundleDir, "relkit-apply.exe"));
writeFileSync(
  path.join(bundleDir, "active.json"),
  `${JSON.stringify(
    {
      code: versionCode(version),
      version,
      path: `versions/${version}`,
      executable: `versions/${version}/WorkspaceOrchestrator.exe`,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

mkdirSync(artifactOutputDir, { recursive: true });
const artifact = path.join(artifactOutputDir, `cronkit-${version}-win-x64.zip`);
rmSync(artifact, { force: true });
run("powershell", [
  "-NoProfile",
  "-Command",
  "Compress-Archive -Path (Join-Path $env:CRONKIT_BUNDLE '*') -DestinationPath $env:CRONKIT_ARTIFACT -CompressionLevel Optimal",
], {
  CRONKIT_BUNDLE: bundleDir,
  CRONKIT_ARTIFACT: artifact,
});
console.log(`versionedDir artifact: ${artifact}`);

function versionCode(value) {
  const matched = /\+([0-9]+)$/.exec(value);
  const code = matched ? Number(matched[1]) : NaN;
  if (!Number.isSafeInteger(code) || code <= 0) {
    throw new Error(`版本号缺少正整数 build code：${value}`);
  }
  return code;
}

function run(command, args, env = {}) {
  execFileSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

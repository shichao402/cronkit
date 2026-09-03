#!/usr/bin/env node
/**
 * 把 relkit 稀疏检出到 third_party/relkit，并构建其中的 Node SDK。
 *
 * rup-client 是 relkit 仓库里的一个子目录，没有发到 npm registry。依赖若指向仓库外的
 * 兄弟检出，就只有那台开发机能装依赖，"本地打包"会从便利变成唯一可行路径 —— 发布也就
 * 必然绕开 CI。把它固定在仓库内的相对路径上，CI 与开发机才是同一条构建路径。
 *
 * 用法：
 *   node scripts/ensure-relkit.mjs             检出并构建 SDK（已在固定点则秒退）
 *   node scripts/ensure-relkit.mjs --force     忽略短路检查，强制重新同步
 *   node scripts/ensure-relkit.mjs --skip-sdk  只同步源码，不构建 SDK
 *
 * 挂在 package.json 的 preinstall 上，因此 `npm install` / `npm ci` 会自动满足依赖。
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RELKIT_DIR, RELKIT_REF, RELKIT_URL } from "./relkit-pin.mjs";

// Go 侧只需要 cmd/relkit（stage）与 cmd/relkit-apply（sidecar）能编译，
// 其余是它们的依赖树。sdk 同时带来 sdk/node。
const SPARSE_DIRS = [
  "api",
  "cmd/relkit",
  "cmd/relkit-apply",
  "embed",
  "internal",
  "sdk",
  "version",
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, RELKIT_DIR);
const skipSdk = process.argv.includes("--skip-sdk");
const force = process.argv.includes("--force");

function main() {
  // 它挂在 preinstall 上，每次 npm install 都会跑。已经在固定点时不该再联网。
  if (!force && isUpToDate()) {
    console.log(`ensure-relkit: 已在固定点 ${RELKIT_REF}，跳过`);
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  syncCheckout();
  assertFile(path.join(dest, "go.mod"), "Go 模块根");
  assertFile(path.join(dest, "cmd", "relkit-apply", "main.go"), "relkit-apply 源码");
  assertFile(path.join(dest, "sdk", "node", "package.json"), "Node SDK");

  if (skipSdk) {
    console.log("ensure-relkit: 跳过 SDK 构建（--skip-sdk）");
    return;
  }
  buildSdk();
}

function isUpToDate() {
  if (!existsSync(path.join(dest, ".git"))) {
    return false;
  }
  if (!skipSdk && !existsSync(path.join(dest, "sdk", "node", "dist", "src", "index.js"))) {
    return false;
  }
  try {
    return capture("git", ["rev-parse", "HEAD"], dest) === RELKIT_REF;
  } catch {
    return false;
  }
}

function syncCheckout() {
  const url = authenticatedUrl(RELKIT_URL);
  if (!existsSync(path.join(dest, ".git"))) {
    rmSync(dest, { recursive: true, force: true });
    run("git", ["clone", "--filter=blob:none", "--sparse", url, dest], { cwd: root });
  } else {
    run("git", ["remote", "set-url", "origin", url], { cwd: dest });
  }
  run("git", ["sparse-checkout", "set", "--cone", ...SPARSE_DIRS], { cwd: dest });

  // 直接 fetch 一个 commit 需要服务端允许 want-sha1；不允许时退回抓全部分支再 checkout。
  try {
    run("git", ["fetch", "--filter=blob:none", "origin", RELKIT_REF], { cwd: dest });
    run("git", ["checkout", "--force", "FETCH_HEAD"], { cwd: dest });
  } catch {
    run("git", ["fetch", "--filter=blob:none", "--tags", "origin"], { cwd: dest });
    run("git", ["checkout", "--force", RELKIT_REF], { cwd: dest });
  }

  const head = capture("git", ["rev-parse", "HEAD"], dest);
  console.log(`ensure-relkit: relkit HEAD = ${head}（固定点 ${RELKIT_REF}）`);
}

main();

function buildSdk() {
  const sdkDir = path.join(dest, "sdk", "node");
  runNpm(["ci"], sdkDir);
  runNpm(["run", "build"], sdkDir);
  assertFile(path.join(sdkDir, "dist", "src", "index.js"), "SDK 构建产物");
  console.log(`ensure-relkit: rup-client 就绪于 ${path.relative(root, sdkDir)}`);
}

function runNpm(args, cwd) {
  // npm on Windows is a .cmd shim. Node 26 rejects spawning it directly with
  // EINVAL, so run the fixed command through cmd.exe.
  if (process.platform === "win32") {
    run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm.cmd", ...args], { cwd });
    return;
  }
  run("npm", args, { cwd });
}

/** GitHub 公开仓默认匿名拉；CI 有 GITHUB_TOKEN / GH_TOKEN 时注入，避免限流。 */
function authenticatedUrl(url) {
  const github = "https://github.com/";
  const githubToken = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  if (githubToken && url.startsWith(github) && !url.slice(github.length).includes("@")) {
    return `https://x-access-token:${githubToken}@github.com/${url.slice(github.length)}`;
  }
  const cnbToken = (process.env.CNB_TOKEN || "").trim();
  const cnb = "https://cnb.cool/";
  if (cnbToken && url.startsWith(cnb) && !url.slice(cnb.length).includes("@")) {
    return `https://cnb:${cnbToken}@cnb.cool/${url.slice(cnb.length)}`;
  }
  return url;
}

function assertFile(file, what) {
  if (!existsSync(file)) {
    throw new Error(`稀疏检出缺少${what}：${file}`);
  }
}

function run(command, args, { cwd }) {
  console.log(`$ ${command} ${args.join(" ")}  (cwd=${path.relative(root, cwd) || "."})`);
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function capture(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8" }).trim();
}

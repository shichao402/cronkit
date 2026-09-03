#!/usr/bin/env node
// 版本号唯一来源是仓库根的 VERSION.json（relkit 管理，用 `relkit version set|bump` 改）。
// package.json.version 与 src/generated/version.ts 都是本脚本的构建期产物，禁止手改。
//
// 用法：
//   node scripts/sync-version.mjs          写入并在有变化时打印
//   node scripts/sync-version.mjs --check  只校验，不一致则退出码 1（给 CI 用）

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const checkOnly = process.argv.includes("--check");

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)\+(\d+)$/;

function fail(message) {
  console.error(`sync-version: ${message}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
}

function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n");
}

const versionPath = join(root, "VERSION.json");
if (!existsSync(versionPath)) {
  fail("VERSION.json missing; run `relkit init --product cronkit` first");
}

const versionDoc = readJson(versionPath);
if (versionDoc.schema !== "rup.version/1") {
  fail(`VERSION.json schema must be "rup.version/1", got ${JSON.stringify(versionDoc.schema)}`);
}

const raw = versionDoc.version;
if (typeof raw !== "string") {
  fail("VERSION.json.version must be a string");
}

const matched = VERSION_PATTERN.exec(raw);
if (!matched) {
  fail(`VERSION.json.version must look like x.y.z+build, got ${JSON.stringify(raw)}`);
}

const semver = `${matched[1]}.${matched[2]}.${matched[3]}`;
// codeStrategy 是 version-build：code 就是 `+` 后面那个整数（relkit.json 若改策略，这里要跟着改）。
const code = Number.parseInt(matched[4], 10);
if (!Number.isSafeInteger(code) || code < 1) {
  fail(`code must be a positive integer, got ${matched[4]}`);
}

const pkgPath = join(root, "package.json");
const pkgText = readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(pkgText);

const generatedPath = join(root, "src", "generated", "version.ts");
const generated = `// 本文件由 scripts/sync-version.mjs 生成，禁止手改。
// 唯一来源：仓库根 VERSION.json（用 \`relkit version set|bump\` 修改）。
export const APP_VERSION = "${semver}";
export const APP_VERSION_FULL = "${raw}";
export const APP_VERSION_CODE = ${code};
`;

const pkgNeedsWrite = pkg.version !== semver;
// The worktree copy is CRLF wherever core.autocrlf is on (every Windows CI
// runner), while this script always writes LF. Compare on content alone, or
// --check fails on a tree that is perfectly in sync.
const generatedNeedsWrite =
  !existsSync(generatedPath) ||
  normalizeEol(readFileSync(generatedPath, "utf8")) !== normalizeEol(generated);

if (checkOnly) {
  if (pkgNeedsWrite || generatedNeedsWrite) {
    fail(
      `out of sync with VERSION.json (${raw}); run \`node scripts/sync-version.mjs\` and commit the result`,
    );
  }
  console.log(`sync-version: ok (${raw}, code=${code})`);
  process.exit(0);
}

if (pkgNeedsWrite) {
  // 只改 version 一个键，保留原文件的键顺序与缩进风格。
  const replaced = pkgText.replace(
    /("version"\s*:\s*)"[^"]*"/,
    `$1"${semver}"`,
  );
  if (replaced === pkgText) {
    fail("could not locate the version field in package.json");
  }
  writeFileSync(pkgPath, replaced);
}

if (generatedNeedsWrite) {
  mkdirSync(dirname(generatedPath), { recursive: true });
  writeFileSync(generatedPath, generated);
}

if (pkgNeedsWrite || generatedNeedsWrite) {
  console.log(`sync-version: wrote ${raw} (semver=${semver}, code=${code})`);
} else {
  console.log(`sync-version: already at ${raw} (code=${code})`);
}

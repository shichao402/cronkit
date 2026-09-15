/**
 * 把 electron-builder 的 win-unpacked 组装成 relkit versionedDir 产物。
 *
 * 输出：
 *   dist/cronkit-<version>-win-x64.zip
 *     WorkspaceOrchestrator.exe  (稳定 launcher)
 *     relkit-apply.exe           (固定到已审提交的 sidecar)
 *     active.json
 *     versions/<version>/...     (Electron 应用)
 *   dist/cronkit-<version>-win-x64-setup.exe
 *     同上树的 NSIS 首次安装包（selectors 带 audience=user）
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import yazl from "yazl";

import { RELKIT_DIR } from "./relkit-pin.mjs";

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

// 目标平台写死为 Windows x64 而不是跟随宿主：CNB 官方构建节点只有 Linux Docker，
// 开发机是 Windows，两边必须产出同一套二进制，否则 CI 会静默产出 Linux 可执行文件。
const winEnv = { GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" };

// launcher 是 GUI 进程，windowsgui 子系统避免每次启动闪出控制台窗口。
run(
  "go",
  [
    "build",
    "-trimpath",
    "-ldflags=-H=windowsgui",
    "-o",
    launcher,
    path.join(root, "tools", "update-launcher", "main.go"),
  ],
  { env: winEnv },
);

// sidecar 从固定点的 relkit 源码构建（scripts/relkit-pin.mjs），不走 `go install @commit`：
// 同一份稀疏检出既提供 rup-client 也提供 relkit-apply，只有一个上游版本需要对齐，
// 也不必让构建机拿到 cnb.cool 的 Go module 拉取凭据。
const relkitDir = path.join(root, RELKIT_DIR);
if (!existsSync(path.join(relkitDir, "cmd", "relkit-apply", "main.go"))) {
  throw new Error(`缺少 ${RELKIT_DIR}；先运行 npm run ensure-relkit`);
}
run("go", ["build", "-trimpath", "-o", sidecar, "./cmd/relkit-apply"], {
  cwd: relkitDir,
  env: winEnv,
});
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
await zipDirectory(bundleDir, artifact);
console.log(`versionedDir artifact: ${artifact}`);

const setup = path.join(artifactOutputDir, `cronkit-${version}-win-x64-setup.exe`);
buildNsisInstaller({ version, bundleDir, setup });
console.log(`nsis installer: ${setup}`);

/**
 * 用本机 makensis 把 versionedDir 打成首次安装用的 setup.exe。
 * 安装树与 zip 同源，因此装完后仍可走 relkit-apply。
 */
function buildNsisInstaller({ version, bundleDir, setup }) {
  const makensis = findMakensis();
  if (!makensis) {
    if (process.platform === "win32") {
      throw new Error(
        "找不到 makensis。请安装 NSIS 3（https://nsis.sourceforge.io/）并确保 makensis 在 PATH，或设置 MAKENSIS。",
      );
    }
    console.warn("跳过 NSIS：非 Windows 宿主且未设置 MAKENSIS");
    return;
  }

  const script = path.join(root, "build", "installer.nsi");
  if (!existsSync(script)) {
    throw new Error(`缺少 ${script}`);
  }

  const versionFour = toNsisProductVersion(version);
  const iconFile = path.join(root, "build", "icon.ico");
  rmSync(setup, { force: true });

  const defines = [
    `VERSION=${version}`,
    `VERSION_FOUR=${versionFour}`,
    `SRCDIR=${bundleDir}`,
    `OUTFILE=${setup}`,
  ];
  if (existsSync(iconFile)) {
    defines.push(`ICONFILE=${iconFile}`);
  }

  // NSIS 的 /D 不吃引号；路径含空格时改用短路径会更稳，但当前产物目录无空格。
  run(makensis, [...defines.map((item) => `/D${item}`), script]);
  if (!existsSync(setup)) {
    throw new Error(`makensis 完成但未产出 ${setup}`);
  }
}

/** `0.1.0+2` → `0.1.0.2`，供 VIProductVersion（必须四段数字）。 */
function toNsisProductVersion(value) {
  const matched = /^(\d+)\.(\d+)\.(\d+)\+(\d+)$/.exec(value);
  if (!matched) {
    throw new Error(`版本号无法转成 NSIS VIProductVersion：${value}`);
  }
  return `${matched[1]}.${matched[2]}.${matched[3]}.${matched[4]}`;
}

function findMakensis() {
  const candidates = [
    process.env.MAKENSIS,
    "makensis",
    "makensis.exe",
    "C:\\Program Files (x86)\\NSIS\\makensis.exe",
    "C:\\Program Files\\NSIS\\makensis.exe",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (candidate.includes("\\") || candidate.includes("/")) {
        if (existsSync(candidate)) return candidate;
        continue;
      }
      execFileSync(candidate, ["/VERSION"], { stdio: "pipe" });
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * 自己写 zip，而不是调 Compress-Archive 或 zip(1)。
 *
 * Windows PowerShell 的 Compress-Archive 会把条目名写成反斜杠分隔，违反 ZIP 规范
 * （APPNOTE 4.4.17.1 要求正斜杠）；Linux 的 zip(1) 写正斜杠。两条命令产出的包结构不同，
 * 而构建可能发生在任一平台上。统一由 yazl 生成，本地与 CI 才是同一个产物。
 */
function zipDirectory(sourceDir, target) {
  const zip = new yazl.ZipFile();
  for (const relative of walkFiles(sourceDir)) {
    zip.addFile(path.join(sourceDir, relative), relative.split(path.sep).join("/"));
  }
  zip.end();
  return new Promise((resolve, reject) => {
    const output = createWriteStream(target);
    output.on("close", resolve);
    output.on("error", reject);
    zip.outputStream.on("error", reject);
    zip.outputStream.pipe(output);
  });
}

/** 相对 sourceDir 的文件路径，目录不单独入包（解压方按需创建）。 */
function walkFiles(sourceDir, prefix = "") {
  const files = [];
  for (const entry of readdirSync(path.join(sourceDir, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(sourceDir, relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

function versionCode(value) {
  const matched = /\+([0-9]+)$/.exec(value);
  const code = matched ? Number(matched[1]) : NaN;
  if (!Number.isSafeInteger(code) || code <= 0) {
    throw new Error(`版本号缺少正整数 build code：${value}`);
  }
  return code;
}

function run(command, args, { cwd = root, env = {} } = {}) {
  execFileSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

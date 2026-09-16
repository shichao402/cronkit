import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { defaultDataDir } from "../paths";
import { runCommand } from "../exec";
import { depsReady, loadToolsetManifest } from "./external";
import type { InstalledToolsetInfo, ToolManifest, ToolsetManifest } from "./types";
import { getBuiltinTool, listBuiltinTools } from "./builtin";

export type ToolsetSource = {
  id: string;
  displayName: string;
  /** 公开仓不内置内网默认地址；本机在设置里填 toolsetRepos。 */
  repo?: string;
  branch?: string;
};

export const KNOWN_TOOLSETS: ToolsetSource[] = [
  {
    id: "osg",
    displayName: "OSGToolset",
    branch: "main",
  },
];

export function toolsetsRoot(dataDir = defaultDataDir()): string {
  return path.join(dataDir, "toolsets");
}

export function toolsetDir(id: string, dataDir = defaultDataDir()): string {
  return path.join(toolsetsRoot(dataDir), id);
}

export function resolveTool(
  toolsetId: string,
  toolId: string,
  dataDir = defaultDataDir(),
): ToolManifest | undefined {
  if (toolsetId === "builtin") {
    return getBuiltinTool(toolId);
  }
  try {
    const manifest = loadToolsetManifest(toolsetDir(toolsetId, dataDir));
    return manifest.tools.find((t) => t.id === toolId);
  } catch {
    return undefined;
  }
}

export function listInstalledToolsets(
  dataDir = defaultDataDir(),
  repoOverrides: Record<string, string> = {},
): InstalledToolsetInfo[] {
  const infos: InstalledToolsetInfo[] = [
    {
      id: "builtin",
      displayName: "内置工具",
      root: "(in-process)",
      schemaVersion: 1,
      installed: true,
      depsReady: true,
      tools: listBuiltinTools(),
    },
  ];

  for (const source of KNOWN_TOOLSETS) {
    const root = toolsetDir(source.id, dataDir);
    const repo = repoOverrides[source.id]?.trim() || source.repo;
    if (!existsSync(path.join(root, "toolset.json"))) {
      infos.push({
        id: source.id,
        displayName: source.displayName,
        root,
        repo,
        schemaVersion: 0,
        installed: false,
        depsReady: false,
        tools: [],
        error: "未安装",
      });
      continue;
    }
    try {
      const manifest = loadToolsetManifest(root);
      infos.push({
        id: manifest.id,
        displayName: manifest.displayName || source.displayName,
        root,
        repo,
        schemaVersion: manifest.schemaVersion,
        sha: readSha(root),
        installed: true,
        depsReady: depsReady(root),
        tools: manifest.tools,
      });
    } catch (error) {
      infos.push({
        id: source.id,
        displayName: source.displayName,
        root,
        repo,
        schemaVersion: 0,
        installed: false,
        depsReady: false,
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return infos;
}

export function readSha(root: string): string | undefined {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  if (result.status === 0) {
    return result.stdout.trim().slice(0, 12);
  }
  return undefined;
}

export async function installOrUpdateToolset(
  id: string,
  dataDir = defaultDataDir(),
  logFile?: string,
  repoOverride?: string,
): Promise<InstalledToolsetInfo> {
  const source = KNOWN_TOOLSETS.find((item) => item.id === id);
  if (!source) {
    throw new Error(`未知 toolset: ${id}`);
  }
  const repo = repoOverride?.trim() || source.repo?.trim();
  if (!repo) {
    throw new Error("未配置 OSGToolset 仓库地址，请在设置里填写 toolsetRepos.osg");
  }
  const root = toolsetDir(id, dataDir);
  mkdirSync(toolsetsRoot(dataDir), { recursive: true });
  const log =
    logFile ??
    path.join(dataDir, "logs", "toolset-install", `${id}-${Date.now()}.log`);
  mkdirSync(path.dirname(log), { recursive: true });

  if (!existsSync(path.join(root, ".git"))) {
    const clone = await runCommand({
      command: "git",
      args: [
        "clone",
        "--branch",
        source.branch ?? "main",
        "--single-branch",
        repo,
        root,
      ],
      cwd: toolsetsRoot(dataDir),
      timeoutMs: 10 * 60_000,
      logFile: log,
    }).done;
    if (clone.code !== 0) {
      throw new Error(`git clone 失败: ${clone.stderr || clone.stdout}`);
    }
  } else {
    const setRemote = await runCommand({
      command: "git",
      args: ["remote", "set-url", "origin", repo],
      cwd: root,
      timeoutMs: 30_000,
      logFile: log,
    }).done;
    if (setRemote.code !== 0) {
      throw new Error(`设置工具集仓库失败: ${setRemote.stderr || setRemote.stdout}`);
    }
    const branch = source.branch ?? "main";
    const fetch = await runCommand({
      command: "git",
      args: ["fetch", "origin", branch],
      cwd: root,
      timeoutMs: 10 * 60_000,
      logFile: log,
    }).done;
    if (fetch.code !== 0) {
      throw new Error(`git fetch 失败: ${fetch.stderr || fetch.stdout}`);
    }
    backupLocalChanges(root, id, dataDir, log);
    const reset = await runCommand({
      command: "git",
      args: ["reset", "--hard", `origin/${branch}`],
      cwd: root,
      timeoutMs: 5 * 60_000,
      logFile: log,
    }).done;
    if (reset.code !== 0) {
      throw new Error(`更新到 origin/${branch} 失败: ${reset.stderr || reset.stdout}`);
    }
  }

  await ensureVenv(root, log);
  const manifest = loadToolsetManifest(root);
  return {
    id: manifest.id,
    displayName: manifest.displayName,
    root,
    repo,
    schemaVersion: manifest.schemaVersion,
    sha: readSha(root),
    installed: true,
    depsReady: depsReady(root),
    tools: manifest.tools,
  };
}

/**
 * 工具集检出由应用管理，更新一律以远端为准。直接改这里的文件迟早会被覆盖，
 * 所以重置前先把已跟踪文件的改动存成 patch，留一条找回来的路。
 */
function backupLocalChanges(
  root: string,
  id: string,
  dataDir: string,
  logFile: string,
): string | undefined {
  const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  if (dirty.status !== 0 || !dirty.stdout.trim()) {
    return undefined;
  }
  const patch = spawnSync("git", ["diff"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (patch.status !== 0 || !patch.stdout) {
    return undefined;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dataDir, "logs", "toolset-install", `${id}-local-${stamp}.patch`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, patch.stdout, "utf8");
  appendFileSync(
    logFile,
    `\n[cronkit] 检出有本地改动，已备份到 ${file} 后重置：\n${dirty.stdout.trim()}\n`,
    "utf8",
  );
  return file;
}

async function ensureVenv(root: string, logFile: string): Promise<void> {
  const venvPython = path.join(root, ".venv", "Scripts", "python.exe");
  const req = path.join(root, "requirements.txt");
  if (!existsSync(path.join(root, ".venv"))) {
    const created = await runCommand({
      command: "python",
      args: ["-m", "venv", ".venv"],
      cwd: root,
      timeoutMs: 5 * 60_000,
      logFile,
    }).done;
    if (created.code !== 0) {
      throw new Error(`创建 venv 失败: ${created.stderr || created.stdout}`);
    }
  }
  if (existsSync(req)) {
    const pip = await runCommand({
      command: venvPython,
      args: ["-m", "pip", "install", "-r", "requirements.txt"],
      cwd: root,
      timeoutMs: 15 * 60_000,
      logFile,
    }).done;
    if (pip.code !== 0) {
      throw new Error(`pip install 失败: ${pip.stderr || pip.stdout}`);
    }
  }
  writeFileSync(path.join(root, ".venv", ".deps-ok"), new Date().toISOString(), "utf8");
}

export function loadExternalManifest(id: string, dataDir = defaultDataDir()): ToolsetManifest {
  return loadToolsetManifest(toolsetDir(id, dataDir));
}

export function toolsetInstallStatePath(dataDir = defaultDataDir()): string {
  return path.join(dataDir, "toolsets-state.json");
}

export function rememberToolsetSha(id: string, sha: string, dataDir = defaultDataDir()): void {
  const file = toolsetInstallStatePath(dataDir);
  let data: Record<string, string> = {};
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
    } catch {
      data = {};
    }
  }
  data[id] = sha;
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

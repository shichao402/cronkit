import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  repo: string;
  branch?: string;
};

export const KNOWN_TOOLSETS: ToolsetSource[] = [
  {
    id: "osg",
    displayName: "OSGToolset",
    repo: "https://git.woa.com/firoyang/OSGToolset.git",
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

export function listInstalledToolsets(dataDir = defaultDataDir()): InstalledToolsetInfo[] {
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
    if (!existsSync(path.join(root, "toolset.json"))) {
      infos.push({
        id: source.id,
        displayName: source.displayName,
        root,
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
): Promise<InstalledToolsetInfo> {
  const source = KNOWN_TOOLSETS.find((item) => item.id === id);
  if (!source) {
    throw new Error(`未知 toolset: ${id}`);
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
        source.repo,
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
    const pull = await runCommand({
      command: "git",
      args: ["pull", "--ff-only"],
      cwd: root,
      timeoutMs: 10 * 60_000,
      logFile: log,
    }).done;
    if (pull.code !== 0) {
      throw new Error(`git pull 失败: ${pull.stderr || pull.stdout}`);
    }
  }

  await ensureVenv(root, log);
  const manifest = loadToolsetManifest(root);
  return {
    id: manifest.id,
    displayName: manifest.displayName,
    root,
    schemaVersion: manifest.schemaVersion,
    sha: readSha(root),
    installed: true,
    depsReady: depsReady(root),
    tools: manifest.tools,
  };
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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { runCommand } from "./exec";

export type UnityEditor = { version: string; exe: string };

export function readProjectVersion(projectPath: string): string {
  const file = path.join(projectPath, "ProjectSettings", "ProjectVersion.txt");
  if (!existsSync(file)) {
    throw new Error(`未找到 ${file}`);
  }
  const text = readFileSync(file, "utf8");
  const match = text.match(/m_EditorVersion:\s*(\S+)/);
  if (!match) {
    throw new Error("ProjectVersion.txt 没有 m_EditorVersion");
  }
  return match[1];
}

export function listUnityEditors(): UnityEditor[] {
  const found = new Map<string, UnityEditor>();
  const add = (version: string, exe: string): void => {
    if (existsSync(exe)) {
      found.set(exe.toLowerCase(), { version, exe });
    }
  };

  const hubDir = path.join(homedir(), "AppData", "Roaming", "UnityHub");
  const editorsV2 = path.join(hubDir, "editors-v2.json");
  if (existsSync(editorsV2)) {
    try {
      const json = JSON.parse(readFileSync(editorsV2, "utf8")) as {
        data?: Array<{ version?: string; location?: string[] }>;
      };
      for (const editor of json.data ?? []) {
        for (const location of editor.location ?? []) {
          add(editor.version ?? path.basename(path.dirname(location)), location);
        }
      }
    } catch {
      // Hub 文件损坏时继续扫描其它位置
    }
  }

  const secondary = path.join(hubDir, "secondaryInstallPath.json");
  const extraRoots: string[] = [
    path.join(process.env["ProgramFiles"] ?? "C:/Program Files", "Unity/Hub/Editor"),
    path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Unity/Hub/Editor"),
  ];
  if (existsSync(secondary)) {
    const raw = readFileSync(secondary, "utf8").replace(/^"|"$/g, "").trim();
    if (raw) {
      extraRoots.push(raw);
    }
  }

  for (const root of extraRoots) {
    if (!existsSync(root)) {
      continue;
    }
    for (const name of readdirSync(root, { withFileTypes: true })) {
      if (!name.isDirectory()) {
        continue;
      }
      const exe = path.join(root, name.name, "Editor", "Unity.exe");
      add(name.name, exe);
    }
  }

  return [...found.values()];
}

export function resolveUnityEditor(version: string): UnityEditor {
  const editors = listUnityEditors();
  const exact = editors.find((item) => item.version === version);
  if (exact) {
    return exact;
  }
  const prefix = editors.find(
    (item) => item.version.startsWith(version) || version.startsWith(item.version),
  );
  if (prefix) {
    return prefix;
  }
  const available = editors.map((item) => `${item.version} @ ${item.exe}`).join("\n") || "(未发现任何编辑器)";
  throw new Error(`找不到 Unity ${version}。已发现:\n${available}`);
}

export async function warmupUnity(options: {
  projectPath: string;
  timeoutMs: number;
  logFile: string;
  abortSignal: AbortSignal;
  nographics?: boolean;
  executeMethod?: string | null;
  lowPriority?: boolean;
}): Promise<{ detail: string; code: number | null }> {
  if (!existsSync(options.projectPath)) {
    throw new Error(`工程不存在: ${options.projectPath}`);
  }
  const lockFile = path.join(options.projectPath, "Temp", "UnityLockfile");
  if (existsSync(lockFile)) {
    throw new Error("项目锁仍在（Temp/UnityLockfile），预热前未能释放已打开的 Unity");
  }

  const version = readProjectVersion(options.projectPath);
  const editor = resolveUnityEditor(version);
  const args = [
    "-batchmode",
    "-quit",
    "-projectPath",
    options.projectPath,
    "-logFile",
    options.logFile,
  ];
  if (options.nographics) {
    args.push("-nographics");
  }
  if (options.executeMethod) {
    args.push("-executeMethod", options.executeMethod);
  }

  const result = await runCommand({
    command: editor.exe,
    args,
    cwd: options.projectPath,
    timeoutMs: options.timeoutMs,
    logFile: `${options.logFile}.spawn.log`,
    abortSignal: options.abortSignal,
    lowPriority: options.lowPriority ?? true,
  }).done;

  if (result.cancelled) {
    throw new Error(result.timedOut ? "Unity 预热超时" : "已取消");
  }
  if (result.code !== 0) {
    throw new Error(tail(result.stderr || result.stdout) || `Unity 退出码 ${result.code}`);
  }
  return { detail: `Unity ${version} 预热完成`, code: result.code };
}

function tail(text: string): string {
  return text.trim().split(/\r?\n/).filter(Boolean).slice(-12).join("\n");
}

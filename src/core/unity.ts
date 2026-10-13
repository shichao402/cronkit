import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { runCommand } from "./exec";
import { isUnityLockHeld } from "./occupants";

/** Unity 日志里的告警关键词：错误、异常、失败（小写匹配）。 */
const UNITY_WARN_KEYWORDS = ["error", "exception", "failed"];

/** 日志跟随读出的内容按行拆开，末尾不完整行留到下个采样。 */
function splitCompleteLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split(/\r?\n/);
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
}

export type UnityLogTail = {
  stop: () => void;
  warnings: () => string[];
  /** 单测用：立即采样一次，不等心跳周期。 */
  tickForTest: () => void;
};

/**
 * 跟随 Unity 的 -logFile 做增量读取：
 * - 每 20s 把最近一行日志作为心跳推给 onProgress（UI 实时可见导入没卡死）；
 * - 含 error/exception/failed 的行视为告警，最多保留 40 条（去重）防刷屏；
 * - 处理 BOM、日志截断重置（size 变小则从头读）。
 * 日志文件由 Unity 启动后才创建，采样间隔内不存在属正常。
 */
export function followUnityLog(
  logFile: string,
  onProgress: (line: string) => void,
): UnityLogTail {
  let stopped = false;
  let offset = 0;
  let partial = "";
  const warnLines: string[] = [];
  const warnSeen = new Set<string>();
  const HEARTBEAT_MS = 20_000;
  const MAX_WARNINGS = 40;

  const sample = (): void => {
    if (stopped) {
      return;
    }
    let size = 0;
    try {
      size = statSync(logFile).size;
    } catch {
      return; // 尚未创建
    }
    let text = "";
    if (size > offset) {
      try {
        const fd = openSync(logFile, "r");
        try {
          const chunk = Buffer.alloc(size - offset);
          readSync(fd, chunk, 0, chunk.length, offset);
          text = chunk.toString("utf8");
        } finally {
          closeSync(fd);
        }
      } catch {
        return;
      }
      if (offset === 0) {
        text = text.replace(/^\uFEFF/, "");
      }
      offset = size;
    } else if (size < offset) {
      // 日志被截断重置（Unity 崩溃重启场景），从头读
      offset = 0;
      partial = "";
      return;
    } else {
      return;
    }
    const { lines, rest } = splitCompleteLines(partial + text);
    partial = rest;
    let lastLine = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      lastLine = trimmed;
      const lower = trimmed.toLowerCase();
      if (UNITY_WARN_KEYWORDS.some((kw) => lower.includes(kw))) {
        if (warnLines.length < MAX_WARNINGS && !warnSeen.has(trimmed)) {
          warnSeen.add(trimmed);
          warnLines.push(trimmed);
        }
      }
    }
    if (lastLine) {
      onProgress(lastLine);
    }
  };

  const timer = setInterval(sample, HEARTBEAT_MS);
  timer.unref?.();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    warnings: () => warnLines,
    tickForTest: sample,
  };
}

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
  onProgress?: (line: string) => void;
}): Promise<{ detail: string; code: number | null }> {
  if (!existsSync(options.projectPath)) {
    throw new Error(`工程不存在: ${options.projectPath}`);
  }
  const lockFile = path.join(options.projectPath, "Temp", "UnityLockfile");
  if (isUnityLockHeld(lockFile)) {
    throw new Error("Unity 正在使用该项目（Temp/UnityLockfile 被占用），预热前未能释放已打开的 Unity");
  }
  if (existsSync(lockFile)) {
    // 独占测试通过 = 异常退出残留的死锁文件，清掉继续
    try {
      unlinkSync(lockFile);
    } catch {
      // 清理失败不阻塞：Unity 启动时会自行处理残留锁
    }
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
    // 无人值守预热不向共享 Cache Server 上传，避免污染团队缓存
    "-cacheServerEnableUpload",
    "false",
  ];
  if (options.nographics) {
    args.push("-nographics");
  }
  if (options.executeMethod) {
    args.push("-executeMethod", options.executeMethod);
  }

  const tail = options.onProgress ? followUnityLog(options.logFile, options.onProgress) : undefined;
  try {
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
      throw new Error(tailText(result.stderr || result.stdout) || `Unity 退出码 ${result.code}`);
    }
    const warnings = tail?.warnings() ?? [];
    const warnNote =
      warnings.length > 0 ? `（日志中有 ${warnings.length} 条告警）` : "";
    return { detail: `Unity ${version} 预热完成${warnNote}`, code: result.code };
  } finally {
    tail?.stop();
  }
}

function tailText(text: string): string {
  return text.trim().split(/\r?\n/).filter(Boolean).slice(-12).join("\n");
}

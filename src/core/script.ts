import path from "node:path";
import { existsSync } from "node:fs";
import { runCommand } from "./exec";

export async function runScriptStep(options: {
  cwd: string;
  command: string;
  args: string[];
  timeoutMs: number;
  logFile: string;
  abortSignal: AbortSignal;
}): Promise<{ detail: string; code: number | null }> {
  const fileFlag = options.args.findIndex((arg) => arg === "-File");
  if (fileFlag >= 0 && options.args[fileFlag + 1]) {
    const scriptPath = path.resolve(options.cwd, options.args[fileFlag + 1]);
    if (!existsSync(scriptPath)) {
      throw new Error(`脚本不存在: ${scriptPath}`);
    }
  }

  const result = await runCommand({
    command: options.command,
    args: options.args,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    logFile: options.logFile,
    abortSignal: options.abortSignal,
  }).done;

  if (result.cancelled) {
    throw new Error(result.timedOut ? "脚本超时" : "已取消");
  }
  if (result.code !== 0) {
    throw new Error(tail(result.stderr || result.stdout) || `退出码 ${result.code}`);
  }
  return { detail: tail(result.stdout) || "脚本完成", code: result.code };
}

function tail(text: string): string {
  return text.trim().split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
}

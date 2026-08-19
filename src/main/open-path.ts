import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { shell } from "electron";

export type OpenResult = { ok: boolean; error?: string };

export async function openPathReliable(target: string, kind: "file" | "dir"): Promise<OpenResult> {
  try {
    if (kind === "dir" && !existsSync(target)) {
      mkdirSync(target, { recursive: true });
    }
    if (kind === "file" && !existsSync(target)) {
      return { ok: false, error: `文件不存在: ${target}` };
    }
    if (process.platform === "win32") {
      const opener = kind === "dir" ? "explorer.exe" : "notepad.exe";
      const child = spawn(opener, [target], { detached: true, stdio: "ignore" });
      child.unref();
      return { ok: true };
    }
    const error = await shell.openPath(target);
    if (error) {
      shell.showItemInFolder(target);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function pathKind(target: string): "file" | "dir" {
  try {
    return statSync(target).isDirectory() ? "dir" : "file";
  } catch {
    return "dir";
  }
}

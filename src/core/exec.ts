import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";

export type ExecResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
  timedOut: boolean;
};

export type ExecHandle = {
  cancel: () => void;
  done: Promise<ExecResult>;
};

const STRIP_ENV = new Set(["VSCODE_NLS_CONFIG", "VSCODE_PID", "VSCODE_CWD", "VSCODE_NLS_CONFIG_JSON"]);

export function buildChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of STRIP_ENV) {
    delete env[key];
  }
  env.GIT_TERMINAL_PROMPT = "0";
  env.PYTHONUTF8 = "1";
  env.PYTHONIOENCODING = "utf-8";
  env.SVN_NON_INTERACTIVE = "1";
  return env;
}

export function runCommand(options: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  logFile: string;
  abortSignal?: AbortSignal;
  lowPriority?: boolean;
  gracefulMs?: number;
  env?: NodeJS.ProcessEnv;
}): ExecHandle {
  mkdirSync(path.dirname(options.logFile), { recursive: true });
  const log = createWriteStream(options.logFile, { flags: "a" });
  log.write(`$ ${options.command} ${options.args.join(" ")}\ncwd=${options.cwd}\n\n`);

  let stdout = "";
  let stderr = "";
  let cancelled = false;
  let timedOut = false;
  let proc: ChildProcess | undefined;
  let settled = false;
  let timer: NodeJS.Timeout | undefined;
  let forceTimer: NodeJS.Timeout | undefined;
  const gracefulMs = options.gracefulMs ?? 15_000;

  const forceKill = (): void => {
    if (!proc?.pid) {
      return;
    }
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  };

  const softKill = (): void => {
    if (!proc?.pid) {
      return;
    }
    // Try graceful tree terminate first (no /F).
    spawn("taskkill", ["/pid", String(proc.pid), "/T"], {
      windowsHide: true,
      stdio: "ignore",
    });
    if (forceTimer) {
      clearTimeout(forceTimer);
    }
    forceTimer = setTimeout(() => {
      if (!settled) {
        log.write("\n[cronkit] graceful wait elapsed, force kill\n");
        forceKill();
      }
    }, gracefulMs);
  };

  const done = new Promise<ExecResult>((resolve) => {
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (forceTimer) {
        clearTimeout(forceTimer);
      }
      options.abortSignal?.removeEventListener("abort", onAbort);
      log.end();
      resolve({ code, signal, stdout, stderr, cancelled, timedOut });
    };

    const onAbort = (): void => {
      cancelled = true;
      softKill();
    };

    const env = buildChildEnv(options.env ?? process.env);
    proc = spawn(options.command, options.args, {
      cwd: options.cwd,
      windowsHide: true,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (options.lowPriority && proc.pid) {
      spawn(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `try { (Get-Process -Id ${proc.pid}).PriorityClass = 'BelowNormal' } catch {}`,
        ],
        { windowsHide: true, stdio: "ignore" },
      );
    }

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout = cap(stdout + chunk.toString("utf8"));
      log.write(chunk);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr = cap(stderr + chunk.toString("utf8"));
      log.write(chunk);
    });
    proc.on("error", (error) => {
      const message = `${error.message}\n`;
      stderr = cap(stderr + message);
      log.write(message);
      finish(1, null);
    });
    proc.on("close", (code, signal) => finish(code, signal));

    timer = setTimeout(() => {
      timedOut = true;
      cancelled = true;
      softKill();
    }, options.timeoutMs);

    if (options.abortSignal?.aborted) {
      onAbort();
    } else {
      options.abortSignal?.addEventListener("abort", onAbort, { once: true });
    }
  });

  return {
    cancel: () => {
      cancelled = true;
      softKill();
    },
    done,
  };
}

function cap(text: string, max = 200_000): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}

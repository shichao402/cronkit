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

export function runCommand(options: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  logFile: string;
  abortSignal?: AbortSignal;
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

  const killTree = (): void => {
    if (!proc?.pid) {
      return;
    }
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
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
      options.abortSignal?.removeEventListener("abort", onAbort);
      log.end();
      resolve({ code, signal, stdout, stderr, cancelled, timedOut });
    };

    const onAbort = (): void => {
      cancelled = true;
      killTree();
    };

    proc = spawn(options.command, options.args, {
      cwd: options.cwd,
      windowsHide: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

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
      killTree();
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
      killTree();
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

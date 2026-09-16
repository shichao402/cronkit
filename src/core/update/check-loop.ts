import type { CheckPolicy } from "@relkit/updater-bindings/updater/v1";
import type { CheckResult, Updater } from "./sidecar";

const MIN_WAIT_MS = 5 * 60 * 1000;
const DEFAULT_SUCCESS_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FAILURE_MS = 60 * 60 * 1000;

export type CheckLoopEvent = {
  kind: "tick" | "result";
  force: boolean;
  result?: CheckResult;
};

export class CheckLoop {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(
    private readonly updater: Updater,
    private readonly policy: CheckPolicy | undefined,
    private readonly onEvent: (event: CheckLoopEvent) => void,
  ) {}

  start(options: { checkOnStart?: boolean; forceOnStart?: boolean } = {}): void {
    if (this.running) {
      return;
    }
    this.running = true;
    if (options.checkOnStart ?? true) {
      void this.tick(options.forceOnStart ?? false);
    } else {
      this.arm();
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(force: boolean): Promise<void> {
    if (!this.running) {
      return;
    }
    this.onEvent({ kind: "tick", force });
    const result = await this.updater.check({ force, policy: this.policy });
    if (!this.running) {
      return;
    }
    this.onEvent({ kind: "result", force, result });
    this.arm();
  }

  private arm(): void {
    if (!this.running) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(false), waitMs(this.policy));
  }
}

function waitMs(policy: CheckPolicy | undefined): number {
  let success = DEFAULT_SUCCESS_MS;
  let failure = DEFAULT_FAILURE_MS;
  const afterSuccess = durationMs(policy?.afterSuccess);
  const afterFailure = durationMs(policy?.afterFailure);
  if (afterSuccess > 0) {
    success = afterSuccess;
  }
  if (afterFailure > 0) {
    failure = afterFailure;
  }
  return Math.max(MIN_WAIT_MS, Math.min(success, failure));
}

function durationMs(value: { seconds?: bigint; nanos?: number } | undefined): number {
  if (!value) {
    return 0;
  }
  return Number(value.seconds ?? 0n) * 1000 + Math.floor((value.nanos ?? 0) / 1e6);
}

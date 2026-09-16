/**
 * relkit.updater.v1 宿主 facade。
 *
 * TypeScript bindings 只给 protobuf 类型；本文件对齐 Go/Dart 官方 facade 的
 * 搜索顺序、4 字节大端帧和 capabilities 握手。禁止在产品仓再声明 CheckResult /
 * UpdateAvailable 形状。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  CheckResultSchema,
  DownloadResultSchema,
  ErrorCode,
  ResultSchema,
  StatusSnapshotSchema,
  UpdaterEventSchema,
  UpdaterRequestSchema,
  type Capabilities,
  type CheckPolicy,
  type CheckResult,
  type ClientProfile,
  type DownloadResult,
  ApplyResultSchema,
  type ApplyResult,
  type Result,
  type Runtime,
  type StatusSnapshot,
  type UpdaterEvent,
} from "@relkit/updater-bindings/updater/v1";

export {
  ErrorCode,
  type CheckResult,
  type UpdaterEvent,
} from "@relkit/updater-bindings/updater/v1";
export const IPC_MIN = 1;
export const IPC_MAX = 1;
const MAX_FRAME = 32 << 20;

export type Glue = {
  locate(runtime: Runtime): Promise<string>;
  run(bin: string, args: string[], stdin: Uint8Array): AsyncIterable<UpdaterEvent>;
};

export type Opened = {
  kind: "opened";
  updater: Updater;
  capabilities: Capabilities;
};

export type OpenFailed = {
  kind: "failed";
  error: { code: ErrorCode; message: string };
};

export class DefaultGlue implements Glue {
  async locate(runtime: Runtime): Promise<string> {
    const name = process.platform === "win32" ? "relkit-updater.exe" : "relkit-updater";
    const candidates: string[] = [];
    if (runtime.sidecarPath) {
      candidates.push(runtime.sidecarPath);
    }
    const env = process.env.RELKIT_UPDATER?.trim();
    if (env) {
      candidates.push(env);
    }
    const installRoot = runtime.install?.installRoot;
    if (installRoot) {
      candidates.push(path.join(installRoot, name));
    }
    candidates.push(path.join(path.dirname(process.execPath), name));
    if (installRoot && runtime.install?.sidecarRelpath) {
      candidates.push(path.join(installRoot, runtime.install.sidecarRelpath));
    }
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    throw new Error("sidecar not found");
  }

  async *run(bin: string, args: string[], stdin: Uint8Array): AsyncIterable<UpdaterEvent> {
    const child = spawn(bin, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let notify: (() => void) | undefined;
    let ended = false;
    let spawnError: Error | undefined;

    child.once("error", (error) => {
      spawnError = error;
      ended = true;
      notify?.();
    });
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      notify?.();
    });
    child.stdout.on("end", () => {
      ended = true;
      notify?.();
    });
    child.stderr?.resume();

    if (stdin.length > 0) {
      child.stdin.write(Buffer.from(stdin));
    }
    child.stdin.end();

    let pending = Buffer.alloc(0);
    while (true) {
      while (pending.length >= 4) {
        const size = pending.readUInt32BE(0);
        if (size > MAX_FRAME) {
          throw new Error(`frame too large: ${size}`);
        }
        if (pending.length < 4 + size) {
          break;
        }
        const payload = pending.subarray(4, 4 + size);
        pending = Buffer.from(pending.subarray(4 + size));
        yield fromBinary(UpdaterEventSchema, payload);
      }
      if (ended && chunks.length === 0) {
        break;
      }
      if (chunks.length === 0) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
        notify = undefined;
      }
      if (chunks.length > 0) {
        pending = Buffer.concat([pending, ...chunks]);
        chunks.length = 0;
      }
    }
    if (spawnError) {
      throw spawnError;
    }
  }
}

export class Updater {
  private constructor(
    private readonly profile: ClientProfile,
    private readonly runtime: Runtime,
    private readonly glue: Glue,
    private readonly bin: string,
    readonly capabilities: Capabilities,
  ) {}

  static async open(
    profile: ClientProfile,
    runtime: Runtime,
    glue: Glue = new DefaultGlue(),
  ): Promise<Opened | OpenFailed> {
    try {
      const bin = await glue.locate(runtime);
      let caps: Capabilities | undefined;
      let failed: string | undefined;
      for await (const event of glue.run(bin, ["-capabilities"], new Uint8Array())) {
        if (event.kind.case === "capabilities") {
          caps = event.kind.value;
        }
        if (event.kind.case === "failed") {
          failed = event.kind.value.error?.message ?? "capabilities failed";
        }
      }
      if (failed) {
        return { kind: "failed", error: { code: ErrorCode.PROTOCOL_MISMATCH, message: failed } };
      }
      if (!caps) {
        return {
          kind: "failed",
          error: { code: ErrorCode.PROTOCOL_MISMATCH, message: "no capabilities" },
        };
      }
      if (caps.ipc < IPC_MIN) {
        return {
          kind: "failed",
          error: { code: ErrorCode.UPDATER_TOO_OLD, message: "sidecar IPC too old" },
        };
      }
      if (caps.ipc > IPC_MAX) {
        return {
          kind: "failed",
          error: { code: ErrorCode.UPDATER_TOO_NEW, message: "sidecar IPC too new" },
        };
      }
      return { kind: "opened", updater: new Updater(profile, runtime, glue, bin, caps), capabilities: caps };
    } catch (error) {
      return {
        kind: "failed",
        error: {
          code: ErrorCode.SIDECAR_NOT_FOUND,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  async check(options: { force?: boolean; exactCode?: bigint; policy?: CheckPolicy } = {}): Promise<CheckResult> {
    for await (const event of this.call({
      case: "check",
      value: {
        force: options.force ?? false,
        exactCode: options.exactCode ?? 0n,
        policy: options.policy,
      },
    })) {
      if (event.kind.case === "check") {
        return event.kind.value;
      }
      if (event.kind.case === "failed") {
        return create(CheckResultSchema, { kind: { case: "failed", value: event.kind.value } });
      }
    }
    return create(CheckResultSchema, {
      kind: {
        case: "failed",
        value: {
          error: { code: ErrorCode.NETWORK, message: "no check result" },
        },
      },
    });
  }

  async skip(code: bigint): Promise<Result> {
    return this.lastResult(this.call({ case: "skip", value: { code } }));
  }

  async download(
    planId: string,
    onEvent?: (event: UpdaterEvent) => void,
  ): Promise<DownloadResult> {
    for await (const event of this.call({ case: "download", value: { planId } })) {
      onEvent?.(event);
      if (event.kind.case === "download") {
        return event.kind.value;
      }
      if (event.kind.case === "failed") {
        return create(DownloadResultSchema, { kind: { case: "failed", value: event.kind.value } });
      }
    }
    return create(DownloadResultSchema, {
      kind: {
        case: "failed",
        value: { error: { code: ErrorCode.NETWORK, message: "no download result" } },
      },
    });
  }

  async apply(planId: string, onEvent?: (event: UpdaterEvent) => void): Promise<ApplyResult> {
    for await (const event of this.call({ case: "apply", value: { planId } })) {
      onEvent?.(event);
      if (event.kind.case === "apply") {
        return event.kind.value;
      }
      if (event.kind.case === "failed") {
        return create(ApplyResultSchema, { kind: { case: "failed", value: event.kind.value } });
      }
    }
    return create(ApplyResultSchema, {
      kind: {
        case: "failed",
        value: { error: { code: ErrorCode.NETWORK, message: "no apply result" } },
      },
    });
  }

  async status(): Promise<StatusSnapshot> {
    for await (const event of this.call({ case: "status", value: {} })) {
      if (event.kind.case === "status") {
        return event.kind.value;
      }
    }
    return create(StatusSnapshotSchema, {});
  }

  private async *call(op: { case: string; value?: object }): AsyncIterable<UpdaterEvent> {
    const request = create(UpdaterRequestSchema, {
      hello: { ipcMin: IPC_MIN, ipcMax: IPC_MAX },
      profile: this.profile,
      runtime: this.runtime,
      op: op as never,
    });
    const payload = toBinary(UpdaterRequestSchema, request);
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeUInt32BE(payload.length, 0);
    frame.set(payload, 4);
    yield* this.glue.run(this.bin, [], frame);
  }

  private async lastResult(events: AsyncIterable<UpdaterEvent>): Promise<Result> {
    for await (const event of events) {
      if (event.kind.case === "result") {
        return event.kind.value;
      }
      if (event.kind.case === "failed") {
        return create(ResultSchema, { kind: { case: "failed", value: event.kind.value } });
      }
    }
    return create(ResultSchema, { kind: { case: "ok", value: {} } });
  }
}

export function encodeFrameForTest(event: UpdaterEvent): Uint8Array {
  const payload = toBinary(UpdaterEventSchema, event);
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  frame.set(payload, 4);
  return frame;
}

import { ErrorCode } from "@relkit/updater-bindings/updater/v1";
import { create } from "@bufbuild/protobuf";
import { ClientProfileSchema, RuntimeSchema } from "@relkit/updater-bindings/updater/v1";
import { describe, expect, it } from "vitest";
import { IPC_MAX, IPC_MIN, Updater, type Glue, type UpdaterEvent } from "../src/core/update/sidecar";
import { CheckResultSchema, UpdaterEventSchema } from "@relkit/updater-bindings/updater/v1";

class ScriptedGlue implements Glue {
  constructor(private readonly events: UpdaterEvent[][]) {}

  async locate(): Promise<string> {
    return "scripted-updater";
  }

  async *run(_bin: string, args: string[]): AsyncIterable<UpdaterEvent> {
    const batch = this.events.shift();
    if (!batch) {
      throw new Error(`unexpected run args=${args.join(" ")}`);
    }
    yield* batch;
  }
}

const profile = create(ClientProfileSchema, { product: "cronkit" });
const runtime = create(RuntimeSchema, { channel: "stable", currentCode: 1n });

describe("sidecar facade", () => {
  it("opens when capabilities sit in the IPC window", async () => {
    const glue = new ScriptedGlue([
      [create(UpdaterEventSchema, { kind: { case: "capabilities", value: { ipc: IPC_MIN } } })],
    ]);
    const opened = await Updater.open(profile, runtime, glue);
    expect(opened.kind).toBe("opened");
    if (opened.kind === "opened") {
      expect(opened.capabilities.ipc).toBe(IPC_MAX);
    }
  });

  it("rejects a sidecar that is too new", async () => {
    const glue = new ScriptedGlue([
      [create(UpdaterEventSchema, { kind: { case: "capabilities", value: { ipc: IPC_MAX + 1 } } })],
    ]);
    const opened = await Updater.open(profile, runtime, glue);
    expect(opened.kind).toBe("failed");
    if (opened.kind === "failed") {
      expect(opened.error.code).toBe(ErrorCode.UPDATER_TOO_NEW);
    }
  });

  it("maps a check event onto the protobuf result", async () => {
    const glue = new ScriptedGlue([
      [create(UpdaterEventSchema, { kind: { case: "capabilities", value: { ipc: 1 } } })],
      [
        create(UpdaterEventSchema, {
          kind: {
            case: "check",
            value: create(CheckResultSchema, {
              kind: {
                case: "updateAvailable",
                value: { planId: "p1", version: "0.1.0+2", code: 2n, remainingHops: 1 },
              },
            }),
          },
        }),
      ],
    ]);
    const opened = await Updater.open(profile, runtime, glue);
    expect(opened.kind).toBe("opened");
    if (opened.kind !== "opened") {
      return;
    }
    const result = await opened.updater.check({ force: true });
    expect(result.kind.case).toBe("updateAvailable");
    if (result.kind.case === "updateAvailable") {
      expect(result.kind.value.planId).toBe("p1");
      expect(Number(result.kind.value.code)).toBe(2);
    }
  });
});

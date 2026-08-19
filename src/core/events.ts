import { EventEmitter } from "node:events";
import type { RunRecord, Snapshot } from "../shared/types";

export type CoreEvents = {
  change: [];
  runFinished: [RunRecord];
  snapshot: [Snapshot];
};

export class TypedEmitter extends EventEmitter {
  emitChange(): void {
    this.emit("change");
  }
}

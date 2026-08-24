import { describe, expect, it } from "vitest";
import { describeIdleReason } from "../src/core/idle-quit";

describe("describeIdleReason", () => {
  it("keeps leftover process ids in the timeout message", () => {
    expect(
      describeIdleReason("timeout", "leftover-no-window", {
        remaining: ["rider64:49124"],
      }),
    ).toContain("remaining=rider64:49124");
  });

  it("keeps killed ids after a forced close", () => {
    expect(
      describeIdleReason("close", "leftover-forced-kill", {
        killed: ["rider64:49124"],
        remaining: [],
      }),
    ).toContain("killed=rider64:49124");
  });
});

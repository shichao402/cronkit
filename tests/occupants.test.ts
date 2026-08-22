import { describe, expect, it } from "vitest";
import { parseTasklistCsv } from "../src/core/occupants";

describe("parseTasklistCsv", () => {
  it("picks Unity editor family and ignores unrelated processes", () => {
    const csv = [
      '"Unity.exe","41200","Console","1","1,024 K"',
      '"UnityCrashHandler64.exe","41201","Console","1","12 K"',
      '"rider64.exe","88856","Console","1","2,048 K"',
      '"explorer.exe","1234","Console","1","80 K"',
    ].join("\n");
    const found = parseTasklistCsv(csv);
    expect(found.map((item) => `${item.name}:${item.pid}`).sort()).toEqual([
      "Unity.exe:41200",
      "UnityCrashHandler64.exe:41201",
    ]);
    expect(found.every((item) => item.source === "process-name")).toBe(true);
  });

  it("skips malformed rows", () => {
    expect(parseTasklistCsv("INFO: No tasks are running which match the specified criteria.")).toEqual([]);
  });
});

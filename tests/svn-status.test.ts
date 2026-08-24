import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSvnLockError,
  parseSvnStatusXml,
  pathsFromSvnError,
  prioritizeLockTargets,
  revertWriteRelatives,
  updateWriteRelatives,
} from "../src/core/svn-status";

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<status>
<target path=".">
<entry path="Assets/Foo.dll">
<wc-status props="none" item="normal" revision="10"></wc-status>
<repos-status props="none" item="modified" revision="12"></repos-status>
</entry>
<entry path="Assets/Local.cs">
<wc-status item="modified" props="none" revision="10"></wc-status>
</entry>
<entry path="Assets/Both.txt">
<wc-status item="modified" props="none" revision="10"></wc-status>
<repos-status item="modified" props="none" revision="12"></repos-status>
</entry>
<entry path="gone.bin">
<wc-status item="deleted" props="none" revision="10"></wc-status>
</entry>
</target>
</status>`;

describe("parseSvnStatusXml", () => {
  it("reads wc and repos items", () => {
    const entries = parseSvnStatusXml(sample);
    expect(entries).toEqual([
      { path: "Assets/Foo.dll", wcItem: "normal", reposItem: "modified" },
      { path: "Assets/Local.cs", wcItem: "modified" },
      { path: "Assets/Both.txt", wcItem: "modified", reposItem: "modified" },
      { path: "gone.bin", wcItem: "deleted" },
    ]);
  });
});

describe("write-set prediction", () => {
  it("update only includes incoming repos changes", () => {
    const rels = updateWriteRelatives(parseSvnStatusXml(sample), false);
    expect(rels.sort()).toEqual(["Assets/Both.txt", "Assets/Foo.dll"].map(toSep).sort());
  });

  it("revert includes local dirty files, not untouched incoming", () => {
    const rels = revertWriteRelatives(parseSvnStatusXml(sample));
    expect(rels.sort()).toEqual(["Assets/Both.txt", "Assets/Local.cs", "gone.bin"].map(toSep).sort());
  });

  it("prioritizes binaries ahead of sources when capped", () => {
    const rels = ["a.cs", "b.dll", "c.txt", "d.exe"];
    expect(prioritizeLockTargets(rels).slice(0, 2)).toEqual(["b.dll", "d.exe"]);
  });
});

describe("svn lock errors", () => {
  it("detects sharing violation and Chinese in-use text", () => {
    expect(isSvnLockError("svn: E720032: Can't move 'D:\\wc\\a.dll'")).toBe(true);
    expect(isSvnLockError("另一个程序正在使用此文件，进程无法访问。")).toBe(true);
    expect(isSvnLockError("svn: E160024: Authorization failed")).toBe(false);
  });

  it("extracts windows paths from quoted error text", () => {
    const text = `svn: E720032: Can't move 'D:\\wc\\.svn\\tmp\\svn-1' to 'D:\\wc\\Assets\\Foo.dll'`;
    expect(pathsFromSvnError(text)).toEqual(["D:\\wc\\.svn\\tmp\\svn-1", "D:\\wc\\Assets\\Foo.dll"]);
  });
});

function toSep(rel: string): string {
  return rel.replace(/\//g, path.sep);
}

import { existsSync } from "node:fs";
import path from "node:path";

export type SvnStatusEntry = {
  path: string;
  wcItem: string;
  reposItem?: string;
  wcLocked?: boolean;
};

const LOCAL_WRITE_ITEMS = new Set([
  "modified",
  "added",
  "deleted",
  "replaced",
  "conflicted",
  "missing",
  "incomplete",
  "obstructed",
]);

const INCOMING_WRITE_ITEMS = new Set(["modified", "added", "deleted", "replaced"]);

const LOCK_PRONE_EXT = new Set([
  ".dll",
  ".exe",
  ".pdb",
  ".mdb",
  ".so",
  ".dylib",
  ".lib",
  ".sys",
  ".ocx",
  ".pyd",
  ".node",
  ".unity3d",
  ".resource",
  ".bundle",
  ".pak",
  ".dat",
  ".db",
  ".sqlite",
  ".lock",
]);

/** Restart Manager 单次会话不宜塞太多路径；超出时优先二进制/锁文件。 */
export const MAX_LOCK_PROBE_FILES = 2048;

export function parseSvnStatusXml(xml: string): SvnStatusEntry[] {
  const entries: SvnStatusEntry[] = [];
  const re = /<entry\b([^>]*)>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const pathAttr = /(?:^|\s)path="([^"]*)"/i.exec(match[1]);
    if (!pathAttr) {
      continue;
    }
    const body = match[2];
    const wc = /<wc-status\b([^>]*)>/i.exec(body);
    const repos = /<repos-status\b([^>]*)>/i.exec(body);
    const wcItem = attr(wc?.[1], "item") ?? "none";
    const reposItem = attr(repos?.[1], "item");
    const wcLocked = attr(wc?.[1], "wc-locked") === "true";
    entries.push({
      path: decodeXml(pathAttr[1]),
      wcItem,
      ...(reposItem ? { reposItem } : {}),
      ...(wcLocked ? { wcLocked: true } : {}),
    });
  }
  return entries;
}

function attr(source: string | undefined, name: string): string | undefined {
  if (!source) {
    return undefined;
  }
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i").exec(source)?.[1];
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function relativeFromStatusPath(entryPath: string): string {
  return entryPath.replace(/\//g, path.sep);
}

/** revert / cleanup 会改写的本地脏路径。 */
export function revertWriteRelatives(entries: SvnStatusEntry[]): string[] {
  const found = new Set<string>();
  for (const entry of entries) {
    if (LOCAL_WRITE_ITEMS.has(entry.wcItem)) {
      found.add(relativeFromStatusPath(entry.path));
    }
  }
  return [...found];
}

/**
 * 完成 update 后可能被改写的路径：远端有差异的条目。
 * 本地-only 修改通常不会被 update 覆盖，除非随后走 revert。
 */
export function updateWriteRelatives(entries: SvnStatusEntry[], includeRevertLocal: boolean): string[] {
  const found = new Set<string>();
  for (const entry of entries) {
    if (entry.reposItem && INCOMING_WRITE_ITEMS.has(entry.reposItem)) {
      found.add(relativeFromStatusPath(entry.path));
      continue;
    }
    if (includeRevertLocal && LOCAL_WRITE_ITEMS.has(entry.wcItem)) {
      found.add(relativeFromStatusPath(entry.path));
    }
  }
  return [...found];
}

export function prioritizeLockTargets(rels: string[]): string[] {
  const lockProne: string[] = [];
  const rest: string[] = [];
  for (const rel of rels) {
    if (isLockProne(rel)) {
      lockProne.push(rel);
    } else {
      rest.push(rel);
    }
  }
  return [...lockProne, ...rest].slice(0, MAX_LOCK_PROBE_FILES);
}

export function isLockProne(rel: string): boolean {
  return LOCK_PRONE_EXT.has(path.extname(rel).toLowerCase());
}

export function svnMetadataPaths(workingCopy: string): string[] {
  return [
    path.join(workingCopy, ".svn", "wc.db"),
    path.join(workingCopy, ".svn", "lock"),
    path.join(workingCopy, "Temp", "UnityLockfile"),
    path.join(workingCopy, "Project", "Temp", "UnityLockfile"),
  ];
}

export function resolveWriteTargets(workingCopy: string, relatives: string[]): string[] {
  const abs = new Set<string>();
  for (const rel of prioritizeLockTargets(relatives)) {
    const file = path.resolve(workingCopy, rel);
    abs.add(file);
    if (!existsSync(file)) {
      abs.add(path.dirname(file));
    }
  }
  for (const extra of svnMetadataPaths(workingCopy)) {
    abs.add(extra);
  }
  abs.add(path.resolve(workingCopy));
  return [...abs];
}

export function isSvnLockError(text: string): boolean {
  const blob = text || "";
  if (/E720032|E720005|E720033|E155004|E200031/.test(blob)) {
    return true;
  }
  return (
    /being used by another process/i.test(blob) ||
    /另一个程序正在使用此文件/.test(blob) ||
    /进程无法访问/.test(blob) ||
    /Access is denied/i.test(blob) ||
    /工作副本被锁定/.test(blob) ||
    /working copy .*locked/i.test(blob)
  );
}

export function pathsFromSvnError(text: string): string[] {
  const found = new Set<string>();
  const quoted = /'((?:[A-Za-z]:)?[^']*[\\/][^']+)'|"((?:[A-Za-z]:)?[^"]*[\\/][^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(text))) {
    const value = match[1] ?? match[2] ?? "";
    if (value) {
      found.add(value);
    }
  }
  return [...found];
}

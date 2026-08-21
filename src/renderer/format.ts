import type { RunRecord } from "../shared/types";

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char]);
}

type Fields = { date: string; time: string };

function fieldsIn(date: Date, timezone: string): Fields {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  // Some ICU builds render midnight as hour 24 under hour12:false.
  const hour = pick("hour") === "24" ? "00" : pick("hour");
  return { date: `${pick("year")}-${pick("month")}-${pick("day")}`, time: `${hour}:${pick("minute")}` };
}

function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function today(timezone: string, now = new Date()): string {
  return fieldsIn(now, timezone).date;
}

export function formatAbsolute(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const fields = fieldsIn(date, timezone);
  return `${fields.date} ${fields.time}`;
}

/** `今天 02:10` beats a bare timestamp for anything the user has to act on. */
export function dayLabel(value: string, timezone: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const target = fieldsIn(date, timezone);
  const base = fieldsIn(now, timezone).date;
  if (target.date === base) {
    return `今天 ${target.time}`;
  }
  if (target.date === shiftDate(base, 1)) {
    return `明天 ${target.time}`;
  }
  if (target.date === shiftDate(base, -1)) {
    return `昨天 ${target.time}`;
  }
  return `${target.date.slice(5)} ${target.time}`;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Empty string means "too far away to be useful" — callers fall back to a date. */
export function relLabel(value: string, now = Date.now()): string {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    return "";
  }
  const diff = time - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) {
    return diff > 0 ? "即将" : "刚刚";
  }
  const suffix = diff > 0 ? "后" : "前";
  if (abs < HOUR) {
    return `${Math.round(abs / MINUTE)} 分钟${suffix}`;
  }
  if (abs < DAY) {
    const hours = Math.floor(abs / HOUR);
    const minutes = Math.round((abs % HOUR) / MINUTE);
    return minutes ? `${hours} 小时 ${minutes} 分${suffix}` : `${hours} 小时${suffix}`;
  }
  if (abs < 7 * DAY) {
    return `${Math.round(abs / DAY)} 天${suffix}`;
  }
  return "";
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "";
  }
  if (ms < 1000) {
    return "<1s";
  }
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function spanOf(startedAt?: string, finishedAt?: string, now = Date.now()): string {
  if (!startedAt) {
    return "";
  }
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) {
    return "";
  }
  const end = finishedAt ? new Date(finishedAt).getTime() : now;
  return formatDuration(end - start);
}

export function runSpan(run: RunRecord, now = Date.now()): string {
  return spanOf(run.startedAt, run.finishedAt, now);
}

/** Keeps both ends of a path visible, which is what identifies a workspace. */
export function truncateMiddle(text: string, max = 64): string {
  if (text.length <= max) {
    return text;
  }
  const head = Math.ceil((max - 1) * 0.45);
  const tail = max - 1 - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/** Plan labels arrive as `svn-update (timeout 2h)`; the timeout belongs in a tooltip. */
export function splitStepLabel(label: string): { name: string; timeout?: string } {
  const match = label.match(/^(.*?)\s*\(timeout\s+([^)]+)\)\s*$/);
  return match ? { name: match[1], timeout: match[2] } : { name: label };
}

export const TRIGGER_LABELS: Record<string, string> = {
  schedule: "计划",
  "catch-up": "补跑",
  manual: "手动",
};

export const STATUS_LABELS: Record<string, string> = {
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
  running: "运行中",
  queued: "排队中",
  skipped: "已跳过",
  pending: "等待",
};

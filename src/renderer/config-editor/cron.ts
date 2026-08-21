import { CronExpressionParser } from "cron-parser";

const PRESETS: Array<{ label: string; cron: string }> = [
  { label: "每天 02:10", cron: "10 2 * * *" },
  { label: "每天 00:05", cron: "5 0 * * *" },
  { label: "0–7 点每 15 分钟", cron: "*/15 0-7 * * *" },
  { label: "每小时", cron: "0 * * * *" },
];

export function cronPresets(): typeof PRESETS {
  return PRESETS;
}

export function describeCron(cron: string): string {
  const trimmed = cron.trim();
  if (!trimmed) {
    return "请输入 cron 表达式";
  }
  const known = PRESETS.find((item) => item.cron === trimmed);
  if (known) {
    return known.label;
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return "需要 5 段 cron（分 时 日 月 周）";
  }
  const [min, hour, dom, month, dow] = parts;
  if (dom === "*" && month === "*" && dow === "*" && hour !== "*" && min !== "*") {
    return `每天 ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  if (min.startsWith("*/") && hour.includes("-") && dom === "*" && month === "*" && dow === "*") {
    return `${hour} 点每 ${min.slice(2)} 分钟`;
  }
  return `表达式 ${trimmed}`;
}

export function nextRuns(cron: string, timezone: string, count = 3): string[] {
  try {
    const expr = CronExpressionParser.parse(cron, { tz: timezone });
    const out: string[] = [];
    for (let i = 0; i < count; i += 1) {
      out.push(expr.next().toISOString());
    }
    return out;
  } catch {
    return [];
  }
}

export function formatIsoLocal(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

import type { IconName } from "../icons";

const OUTLINE: Record<string, string> = {
  gauge: '<circle cx="12" cy="12" r="8.5"/><path d="M12 12l4.2-4.2"/>',
  sliders:
    '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="15.5" cy="7" r="2"/><circle cx="8.5" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.6v3M12 18.4v3M4.4 7.2l2.6 1.5M17 15.3l2.6 1.5M4.4 16.8l2.6-1.5M17 8.7l2.6-1.5"/>',
  folder:
    '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h3.8l1.9 2.4h6.3A1.5 1.5 0 0 1 18 9.9v7.6A1.5 1.5 0 0 1 16.5 19h-12A1.5 1.5 0 0 1 3 17.5z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.4V12l3.3 2"/>',
  check: '<path d="M4.5 12.5l4.5 4.5L19.5 6.5"/>',
  alert: '<path d="M12 4.2 2.9 19.8h18.2z"/><path d="M12 10v4.3M12 17.2v.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  play: '<path d="M9 6.2 18.2 12 9 17.8z"/>',
  stop: '<rect x="7.5" y="7.5" width="9" height="9" rx="1.6"/>',
  pencil: '<path d="M4 20h4.2L20 8.2 15.8 4 4 15.8z"/><path d="M14.2 5.6 18.4 9.8"/>',
  download: '<path d="M12 4v10.5m0 0 4-4m-4 4-4-4M4.5 19.5h15"/>',
  refresh: '<path d="M19.8 12a7.8 7.8 0 1 1-2.3-5.5"/><path d="M20 4.2v4.4h-4.4"/>',
  chevron: '<path d="M9.5 6.5 15 12l-5.5 5.5"/>',
  external:
    '<path d="M14 4.5h5.5V10M19.5 4.5 12 12"/><path d="M18 13.5v4.6A1.4 1.4 0 0 1 16.6 19.5H5.9A1.4 1.4 0 0 1 4.5 18.1V7.4A1.4 1.4 0 0 1 5.9 6h4.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.6 7l.9 12.3h9l.9-12.3"/>',
  up: '<path d="M12 19V5.8m0 0-5 5m5-5 5 5"/>',
  down: '<path d="M12 5v13.2m0 0 5-5m-5 5-5-5"/>',
  layers: '<path d="M12 3.5 3.5 8 12 12.5 20.5 8z"/><path d="M3.5 13 12 17.5 20.5 13"/>',
  inbox:
    '<path d="M4 13.5h4l1.4 2.8h5.2L16 13.5h4"/><path d="M4 13.5 6.6 5.5h10.8L20 13.5v4.6A1.4 1.4 0 0 1 18.6 19.5H5.4A1.4 1.4 0 0 1 4 18.1z"/>',
  hand: '<path d="M8.5 11V5.8a1.6 1.6 0 0 1 3.2 0V11m0-1.2a1.6 1.6 0 0 1 3.2 0V12m0-1.4a1.6 1.6 0 0 1 3.1 0v4.7a5.5 5.5 0 0 1-5.5 5.5h-1.4a5.5 5.5 0 0 1-5.5-5.5v-2.6a1.6 1.6 0 0 1 2.9-.9"/>',
  terminal:
    '<rect x="3.5" y="4.8" width="17" height="14.4" rx="2"/><path d="M7.5 10 10 12.4l-2.5 2.4M12.5 15h4.2"/>',
};

const FILLED = new Set(["play", "stop"]);

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  if (name === "dot") {
    return (
      <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden focusable="false" fill="currentColor">
        <circle cx="12" cy="12" r="5" />
      </svg>
    );
  }
  const filled = FILLED.has(name);
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: OUTLINE[name] ?? "" }}
    />
  );
}

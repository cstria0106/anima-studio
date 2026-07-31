import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function formatElapsed(milliseconds?: number) {
  if (!milliseconds || milliseconds < 0) return "0:00";
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours) {
    return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatDate(value?: string | number | Date | null) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getTagAtCursor(value: string, cursor: number) {
  const position = clamp(cursor, 0, value.length);
  const previousSeparator =
    position === 0
      ? -1
      : Math.max(
          value.lastIndexOf(",", position - 1),
          value.lastIndexOf("\n", position - 1),
          value.lastIndexOf("\r", position - 1),
        );
  const nextSeparators = [",", "\n", "\r"]
    .map((separator) => value.indexOf(separator, position))
    .filter((index) => index >= 0);
  const start = previousSeparator + 1;
  const end = nextSeparators.length ? Math.min(...nextSeparators) : value.length;

  return {
    start,
    end,
    tag: value.slice(start, end).trim(),
    query: value.slice(start, position).trim(),
  };
}

export function replaceTagAtCursor(
  value: string,
  cursor: number,
  replacement: string,
) {
  const tag = getTagAtCursor(value, cursor);
  const before = value.slice(0, tag.start);
  const after = value.slice(tag.end);
  const leadingSpace = before && !/\s$/.test(before) ? " " : "";
  const completed = `${before}${leadingSpace}${replacement}${after}`;

  if (tag.end < value.length) {
    return {
      value: completed,
      cursor: before.length + leadingSpace.length + replacement.length,
    };
  }

  return {
    value: `${completed}, `,
    cursor: completed.length + 2,
  };
}

export function extractTags(value: string) {
  return value
    .split(/[,\n]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function tagComparisonKey(value: string) {
  const unescaped = value
    .replaceAll("\\(", "(")
    .replaceAll("\\)", ")")
    .trim()
    .toLowerCase();
  if (/^score_[1-9]$/.test(unescaped)) return unescaped;
  return unescaped.replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

export function uniqueId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function outputUrl(idOrUrl?: string | null) {
  if (!idOrUrl) return "";
  if (
    idOrUrl.startsWith("http://") ||
    idOrUrl.startsWith("https://") ||
    idOrUrl.startsWith("/") ||
    idOrUrl.startsWith("blob:")
  ) {
    return idOrUrl;
  }
  return `/api/outputs/${encodeURIComponent(idOrUrl)}`;
}

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

export function getLastTag(value: string) {
  return value.split(",").at(-1)?.trim() ?? "";
}

export function replaceLastTag(value: string, replacement: string) {
  const parts = value.split(",");
  parts[parts.length - 1] = ` ${replacement}`;
  return `${parts.join(",").trimStart()}, `;
}

export function extractTags(value: string) {
  return value
    .split(/[,\n]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
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

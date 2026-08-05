import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getPromptCommentRanges, stripPromptComments } from "@anima/shared";

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
  const commentRanges = getPromptCommentRanges(value);
  let previousSeparator =
    position === 0
      ? -1
      : Math.max(
          value.lastIndexOf(",", position - 1),
          value.lastIndexOf("\n", position - 1),
          value.lastIndexOf("\r", position - 1),
        );
  const previousComment = commentRanges.findLast(
    (range) => range.end <= position,
  );
  if (previousComment) {
    previousSeparator = Math.max(previousSeparator, previousComment.end - 1);
  }
  const nextSeparators = [",", "\n", "\r"]
    .map((separator) => value.indexOf(separator, position))
    .filter((index) => index >= 0);
  const nextComment = commentRanges.find(
    (range) => range.start >= position,
  );
  if (nextComment) nextSeparators.push(nextComment.start);
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
  const position = clamp(cursor, tag.start, tag.end);
  const before = value.slice(0, tag.start);
  const after = value.slice(tag.end);
  const remainingTag = value.slice(position, tag.end).trim();
  const leadingSpace = before && !/\s$/.test(before) ? " " : "";
  const completed = `${before}${leadingSpace}${replacement}${after}`;
  const completedCursor =
    before.length + leadingSpace.length + replacement.length;

  if (remainingTag) {
    const splitTag = `${before}${leadingSpace}${replacement}, ${remainingTag}${after}`;
    return {
      value:
        tag.end === value.length
          ? `${splitTag}, `
          : value[tag.end] === "\n" || value[tag.end] === "\r"
            ? `${before}${leadingSpace}${replacement}, ${remainingTag},${after}`
            : splitTag,
      cursor: completedCursor + 2,
    };
  }

  if (tag.end < value.length) {
    const commentStartsAtTagEnd = getPromptCommentRanges(value).some(
      (range) => range.start === tag.end,
    );
    if (commentStartsAtTagEnd) {
      const commentSpacing =
        value.slice(tag.start, tag.end).match(/[^\S\r\n]*$/)?.[0] || " ";
      return {
        value: `${before}${leadingSpace}${replacement}${commentSpacing}${after}`,
        cursor: completedCursor,
      };
    }

    if (value[tag.end] === "\n" || value[tag.end] === "\r") {
      return {
        value: `${before}${leadingSpace}${replacement},${after}`,
        cursor: completedCursor + 1,
      };
    }

    const trailingHorizontalSpace =
      value.slice(tag.end + 1).match(/^[^\S\r\n]*/)?.[0].length ?? 0;
    return {
      value: completed,
      cursor: completedCursor + 1 + trailingHorizontalSpace,
    };
  }

  return {
    value: `${completed}, `,
    cursor: completed.length + 2,
  };
}

export function isAutocompleteCommitKey(
  key: string,
  isComposing: boolean,
) {
  return !isComposing && (key === "Enter" || key === "Tab");
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

export function promptHasTag(value: string, tag: string) {
  const target = tagComparisonKey(tag);
  return extractTags(stripPromptComments(value)).some(
    (current) => tagComparisonKey(current) === target,
  );
}

export function appendPromptTag(value: string, tag: string) {
  if (promptHasTag(value, tag)) return value;

  const prompt = value.trimEnd();
  if (!prompt) return `${tag}, `;

  const trailingComment = getPromptCommentRanges(prompt).some(
    (range) => range.end === prompt.length,
  );
  if (trailingComment) return `${prompt}\n${tag}, `;

  return `${prompt}${prompt.endsWith(",") ? " " : ", "}${tag}, `;
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

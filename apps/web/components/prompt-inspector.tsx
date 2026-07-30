"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clipboard,
  Eye,
  EyeOff,
  Layers3,
  ScanSearch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type {
  GenerationDraft,
  LoraSelection,
  PromptConflict,
  PromptInspectorSource,
  PromptSourceKind,
} from "@/lib/types";
import { cn, extractTags } from "@/lib/utils";

const SOURCE_STYLES: Record<
  PromptInspectorSource["tone"],
  { dot: string; chip: string; text: string }
> = {
  pink: {
    dot: "bg-pink-400",
    chip: "border-pink-400/20 bg-pink-400/10",
    text: "text-pink-100",
  },
  violet: {
    dot: "bg-violet-400",
    chip: "border-violet-400/20 bg-violet-400/10",
    text: "text-violet-100",
  },
  cyan: {
    dot: "bg-cyan-400",
    chip: "border-cyan-400/20 bg-cyan-400/10",
    text: "text-cyan-100",
  },
  amber: {
    dot: "bg-amber-400",
    chip: "border-amber-400/20 bg-amber-400/10",
    text: "text-amber-100",
  },
  emerald: {
    dot: "bg-emerald-400",
    chip: "border-emerald-400/20 bg-emerald-400/10",
    text: "text-emerald-100",
  },
  slate: {
    dot: "bg-slate-400",
    chip: "border-slate-400/20 bg-slate-400/10",
    text: "text-slate-100",
  },
  red: {
    dot: "bg-red-400",
    chip: "border-red-400/20 bg-red-400/10",
    text: "text-red-100",
  },
};

const OPPOSITES: Array<[string, string, string]> = [
  ["long hair", "short hair", "서로 다른 머리 길이"],
  ["black hair", "white hair", "서로 다른 머리색"],
  ["black hair", "blonde hair", "서로 다른 머리색"],
  ["red eyes", "blue eyes", "서로 다른 눈동자색"],
  ["open mouth", "closed mouth", "서로 다른 입 모양"],
  ["smile", "frown", "서로 반대되는 표정"],
  ["standing", "sitting", "서로 다른 자세"],
  ["solo", "multiple girls", "인원 구성이 충돌"],
  ["1girl", "2girls", "인원 수가 충돌"],
  ["lineart", "no lineart", "선화 스타일이 충돌"],
  ["monochrome", "pastel colors", "색상 스타일이 충돌"],
];

function normalizeTag(tag: string) {
  return tag
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\s+/g, " ");
}

function buildSources(
  prompts: GenerationDraft["prompts"],
  loras: LoraSelection[],
  autoTags: string[],
): PromptInspectorSource[] {
  const loraTriggers = loras
    .filter((lora) => lora.enabled)
    .flatMap((lora) => lora.triggerWords);
  return [
    {
      id: "base-positive",
      label: "기본 품질",
      tone: "violet",
      text: prompts.basePositive,
      tags: extractTags(prompts.basePositive),
    },
    {
      id: "user-positive",
      label: "사용자 긍정",
      tone: "pink",
      text: prompts.positive,
      tags: extractTags(prompts.positive),
    },
    {
      id: "natural",
      label: "자연어",
      tone: "cyan",
      text: prompts.natural.trim(),
      tags: [],
    },
    {
      id: "lora-trigger",
      label: "LoRA trigger 참고",
      tone: "amber",
      text: loraTriggers.join(", "),
      tags: loraTriggers,
      runtime: false,
    },
    {
      id: "auto-tag",
      label: "완료 후 자동 태그",
      tone: "emerald",
      text: autoTags.join(", "),
      tags: autoTags,
      runtime: true,
    },
    {
      id: "base-negative",
      label: "기본 부정",
      tone: "slate",
      text: prompts.baseNegative,
      tags: extractTags(prompts.baseNegative),
    },
    {
      id: "user-negative",
      label: "사용자 부정",
      tone: "red",
      text: prompts.negative,
      tags: extractTags(prompts.negative),
    },
  ];
}

interface PromptInspectorProps {
  prompts: GenerationDraft["prompts"];
  loras?: LoraSelection[];
  autoTags?: string[];
}

export function PromptInspector({
  prompts,
  loras = [],
  autoTags = [],
}: PromptInspectorProps) {
  const sources = React.useMemo(
    () => buildSources(prompts, loras, autoTags),
    [autoTags, loras, prompts],
  );
  const [visible, setVisible] = React.useState<
    Partial<Record<PromptSourceKind, boolean>>
  >({ "lora-trigger": false });
  const [deduplicate, setDeduplicate] = React.useState(true);
  const [showConflicts, setShowConflicts] = React.useState(true);
  const [copied, setCopied] = React.useState(false);

  const enabled = React.useCallback(
    (id: PromptSourceKind) => visible[id] !== false,
    [visible],
  );

  const positiveSources = sources.filter(
    (source) =>
      !source.id.includes("negative") &&
      source.id !== "natural" &&
      source.id !== "lora-trigger" &&
      source.id !== "auto-tag" &&
      enabled(source.id) &&
      source.tags.length,
  );
  const referenceSources = sources.filter(
    (source) =>
      (source.id === "lora-trigger" || source.id === "auto-tag") &&
      enabled(source.id) &&
      source.tags.length,
  );
  const natural = sources.find(
    (source) => source.id === "natural" && enabled(source.id),
  );
  const negativeSources = sources.filter(
    (source) =>
      source.id.includes("negative") &&
      enabled(source.id) &&
      source.tags.length,
  );

  const tagOccurrences = React.useMemo(() => {
    const occurrences = new Map<
      string,
      Array<{ tag: string; source: PromptInspectorSource }>
    >();
    for (const source of positiveSources) {
      for (const tag of source.tags) {
        const key = normalizeTag(tag);
        const values = occurrences.get(key) ?? [];
        values.push({ tag, source });
        occurrences.set(key, values);
      }
    }
    return occurrences;
  }, [positiveSources]);

  const duplicateCount = [...tagOccurrences.values()].filter(
    (values) => values.length > 1,
  ).length;

  const renderedTags = React.useMemo(() => {
    const seen = new Set<string>();
    return positiveSources.flatMap((source) =>
      source.tags
        .filter((tag) => {
          const key = normalizeTag(tag);
          if (!deduplicate || !seen.has(key)) {
            seen.add(key);
            return true;
          }
          return false;
        })
        .map((tag) => ({ tag, source })),
    );
  }, [deduplicate, positiveSources]);

  const conflicts = React.useMemo(() => {
    const result: PromptConflict[] = [];
    const positive = new Set([...tagOccurrences.keys()]);
    for (const [left, right, reason] of OPPOSITES) {
      if (positive.has(left) && positive.has(right)) {
        result.push({ left, right, reason });
      }
    }
    const negative = new Map<string, string>();
    negativeSources.forEach((source) =>
      source.tags.forEach((tag) => negative.set(normalizeTag(tag), tag)),
    );
    for (const [key, values] of tagOccurrences) {
      if (negative.has(key)) {
        result.push({
          left: values[0].tag,
          right: negative.get(key) ?? key,
          reason: "긍정과 부정 프롬프트에 동시에 포함됨",
        });
      }
    }
    return result;
  }, [negativeSources, tagOccurrences]);

  const copyText = [
    renderedTags.map((item) => item.tag).join(", "),
    natural?.text,
    negativeSources.length
      ? `Negative: ${negativeSources.flatMap((source) => source.tags).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  async function copyPrompt() {
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <details className="group rounded-lg border border-border bg-surface-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30">
        <span className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-primary/10 text-pink-300">
            <ScanSearch className="size-3.5" />
          </span>
          <span>
            <span className="block text-xs font-medium">최종 프롬프트 검사기</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              {renderedTags.length} tags · 중복 {duplicateCount} · 충돌{" "}
              {conflicts.length}
            </span>
          </span>
        </span>
        <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
      </summary>

      <div className="space-y-4 border-t border-border/70 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {sources.map((source) => {
            const style = SOURCE_STYLES[source.tone];
            const isVisible = enabled(source.id);
            return (
              <button
                key={source.id}
                type="button"
                aria-pressed={isVisible}
                onClick={() =>
                  setVisible((current) => ({
                    ...current,
                    [source.id]: !isVisible,
                  }))
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] outline-none transition focus-visible:ring-2 focus-visible:ring-primary/35",
                  isVisible
                    ? `${style.chip} ${style.text}`
                    : "border-border bg-background/40 text-muted-foreground opacity-55",
                )}
                title="검사기에서 이 레이어 표시 또는 숨기기"
              >
                <span className={cn("size-1.5 rounded-full", style.dot)} />
                {source.label}
                {source.id === "auto-tag" ? (
                  <span className="text-[8px] opacity-60">RESULT</span>
                ) : source.id === "lora-trigger" ? (
                  <span className="text-[8px] opacity-60">REF</span>
                ) : null}
                {isVisible ? (
                  <Eye className="size-2.5" />
                ) : (
                  <EyeOff className="size-2.5" />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-border/70 bg-background/35 px-3 py-2">
          <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Switch
              checked={deduplicate}
              onCheckedChange={setDeduplicate}
              aria-label="중복 태그 한 번만 표시"
            />
            중복 한 번만 표시
          </label>
          <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Switch
              checked={showConflicts}
              onCheckedChange={setShowConflicts}
              aria-label="태그 충돌 표시"
            />
            충돌 표시
          </label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => void copyPrompt()}
            disabled={!copyText}
          >
            {copied ? <Check /> : <Clipboard />}
            {copied ? "복사됨" : "조립 결과 복사"}
          </Button>
        </div>

        <div className="rounded-lg border border-border/70 bg-black/15 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <Layers3 className="size-3" />
            Positive assembly
          </div>
          {renderedTags.length ? (
            <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
              {renderedTags.map(({ tag, source }, index) => {
                const duplicated =
                  (tagOccurrences.get(normalizeTag(tag))?.length ?? 0) > 1;
                const style = SOURCE_STYLES[source.tone];
                return (
                  <span
                    key={`${source.id}-${tag}-${index}`}
                    className={cn(
                      "rounded border px-1.5 py-1 text-[10px]",
                      style.chip,
                      style.text,
                      duplicated && !deduplicate && "ring-1 ring-amber-300/30",
                    )}
                    title={`${source.label}${duplicated ? " · 중복" : ""}`}
                  >
                    {tag}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              표시할 긍정 태그가 없습니다.
            </p>
          )}
          {natural?.text ? (
            <p className="mt-3 border-t border-border/60 pt-3 text-[11px] leading-5 text-cyan-100/85">
              {natural.text}
            </p>
          ) : null}
        </div>

        {referenceSources.length ? (
          <div className="rounded-lg border border-border/60 bg-background/20 p-3">
            <p className="text-[10px] font-medium text-muted-foreground">
              참고 태그 · 실행 프롬프트에 자동 삽입되지 않음
            </p>
            <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {referenceSources.flatMap((source) =>
                source.tags.map((tag, index) => {
                  const style = SOURCE_STYLES[source.tone];
                  return (
                    <span
                      key={`${source.id}-${tag}-${index}`}
                      className={cn(
                        "rounded border px-1.5 py-1 text-[10px]",
                        style.chip,
                        style.text,
                      )}
                      title={source.label}
                    >
                      {tag}
                    </span>
                  );
                }),
              )}
            </div>
          </div>
        ) : null}

        {showConflicts && conflicts.length ? (
          <div
            role="alert"
            className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3"
          >
            <p className="flex items-center gap-2 text-[11px] font-medium text-amber-200">
              <AlertTriangle className="size-3.5" />
              확인할 태그 충돌 {conflicts.length}개
            </p>
            <ul className="mt-2 space-y-1.5 text-[10px] leading-4 text-amber-100/70">
              {conflicts.slice(0, 6).map((conflict, index) => (
                <li key={`${conflict.left}-${conflict.right}-${index}`}>
                  <span className="text-amber-100">
                    {conflict.left} ↔ {conflict.right}
                  </span>
                  {" · "}
                  {conflict.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-[10px] leading-4 text-muted-foreground">
          실제 긍정 프롬프트는 기본 품질 → 사용자 긍정 → 자연어 순서입니다.
          LoRA trigger와 완료 후 추출된 자동 태그는 참고용이며, 클릭해 사용자가
          편집기에 추가하기 전에는 실행 프롬프트를 바꾸지 않습니다.
        </p>
      </div>
    </details>
  );
}

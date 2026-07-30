"use client";

import * as React from "react";
import {
  AlertCircle,
  ChevronDown,
  Hash,
  LoaderCircle,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PromptInspector } from "@/components/prompt-inspector";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { searchTags } from "@/lib/api";
import type {
  GenerationDraft,
  LoraSelection,
  TagSuggestion,
} from "@/lib/types";
import {
  cn,
  extractTags,
  getLastTag,
  replaceLastTag,
} from "@/lib/utils";

type Prompts = GenerationDraft["prompts"];

interface PromptEditorProps {
  value: Prompts;
  onChange: (value: Prompts) => void;
  loras?: LoraSelection[];
  autoTags?: string[];
}

function TagTextarea({
  id,
  label,
  value,
  onChange,
  placeholder,
  description,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  description?: string;
}) {
  const [suggestions, setSuggestions] = React.useState<TagSuggestion[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const latestTag = getLastTag(value);
  const tags = React.useMemo(() => extractTags(value), [value]);
  const contextTags = React.useMemo(
    () => tags.slice(0, Math.max(0, tags.length - 1)),
    [tags],
  );
  const duplicateTags = React.useMemo(() => {
    const counts = new Map<string, number>();
    tags.forEach((tag) =>
      counts.set(tag.toLowerCase(), (counts.get(tag.toLowerCase()) ?? 0) + 1),
    );
    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([tag]) => tag);
  }, [tags]);

  React.useEffect(() => {
    if (latestTag.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      searchTags(latestTag, {
        context: contextTags,
        limit: 10,
        signal: controller.signal,
      })
        .then((results) => {
          setSuggestions(results.slice(0, 10));
          setOpen(Boolean(results.length));
          setActiveIndex(0);
        })
        .catch((error) => {
          if ((error as Error).name !== "AbortError") setSuggestions([]);
        })
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [contextTags, latestTag]);

  function choose(suggestion: TagSuggestion) {
    onChange(replaceLastTag(value, suggestion.tag));
    setOpen(false);
  }

  function removeTag(index: number) {
    const next = [...tags];
    next.splice(index, 1);
    onChange(next.length ? `${next.join(", ")}, ` : "");
  }

  return (
    <Field
      label={label}
      htmlFor={id}
      hint={`${tags.length} tags`}
      error={
        duplicateTags.length
          ? `중복 태그: ${duplicateTags.slice(0, 4).join(", ")}`
          : undefined
      }
    >
      <div className="relative">
        <Textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => suggestions.length && setOpen(true)}
          placeholder={placeholder}
          spellCheck={false}
          className={cn(
            "min-h-32 pr-10 font-mono text-[13px]",
            duplicateTags.length && "border-amber-400/35",
          )}
          aria-autocomplete="list"
          aria-controls={`${id}-suggestions`}
          aria-expanded={open}
          onKeyDown={(event) => {
            if (!open) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) =>
                Math.min(index + 1, suggestions.length - 1),
              );
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            }
            if (event.key === "Enter" && suggestions[activeIndex]) {
              event.preventDefault();
              choose(suggestions[activeIndex]);
            }
            if (event.key === "Escape") setOpen(false);
          }}
        />
        <div className="absolute right-3 top-3 text-muted-foreground">
          {loading ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <WandSparkles className="size-4" />
          )}
        </div>
        {open ? (
          <div
            id={`${id}-suggestions`}
            role="listbox"
            className="absolute inset-x-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-lg border border-border bg-popover/95 p-1.5 shadow-2xl backdrop-blur-xl"
          >
            {suggestions.map((suggestion, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                key={suggestion.tag}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(suggestion)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none hover:bg-accent",
                  index === activeIndex && "bg-accent",
                )}
              >
                <Hash className="size-3.5 text-pink-300" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm">{suggestion.tag}</span>
                    {suggestion.category ? (
                      <Badge variant="outline" className="px-1.5 py-0.5">
                        {suggestion.category}
                      </Badge>
                    ) : null}
                  </div>
                  {suggestion.description ? (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {suggestion.description}
                    </p>
                  ) : null}
                </div>
                {suggestion.cooccurrenceCount ? (
                  <span
                    className="shrink-0 text-[10px] tabular-nums text-pink-200/75"
                    title={`${suggestion.matchedContext?.join(", ") || "입력 태그"}와 함께 사용됨`}
                  >
                    연관 {suggestion.cooccurrenceCount.toLocaleString()}
                  </span>
                ) : suggestion.count ? (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {suggestion.count.toLocaleString()}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {description ? (
        <p className="text-[11px] leading-5 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {tags.length ? (
        <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
          {tags.slice(0, 24).map((tag, index) => {
            const duplicate = duplicateTags.includes(tag.toLowerCase());
            return (
              <button
                key={`${tag}-${index}`}
                type="button"
                onClick={() => removeTag(index)}
                className={cn(
                  "group inline-flex items-center gap-1 rounded-full border border-border bg-secondary/55 px-2 py-1 text-[10px] text-muted-foreground transition hover:border-red-400/25 hover:text-red-200",
                  duplicate &&
                    "border-amber-400/25 bg-amber-400/10 text-amber-200",
                )}
                aria-label={`${tag} 태그 제거`}
              >
                {tag}
                <X className="size-2.5 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />
              </button>
            );
          })}
          {tags.length > 24 ? (
            <Badge variant="outline">+{tags.length - 24}</Badge>
          ) : null}
        </div>
      ) : null}
    </Field>
  );
}

export function PromptEditor({
  value,
  onChange,
  loras = [],
  autoTags = [],
}: PromptEditorProps) {
  return (
    <div className="space-y-5">
      <TagTextarea
        id="positive-prompt"
        label="긍정 프롬프트"
        value={value.positive}
        onChange={(positive) => onChange({ ...value, positive })}
        placeholder="1girl, solo, red eyes, white pupils, ..."
        description="쉼표 단위로 태그를 입력하세요. 2글자부터 오프라인 태그 제안이 표시됩니다."
      />

      <Field
        label={
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-violet-300" />
            자연어 프롬프트
          </span>
        }
        htmlFor="natural-prompt"
        hint="선택 입력"
      >
        <Textarea
          id="natural-prompt"
          value={value.natural}
          onChange={(event) =>
            onChange({ ...value, natural: event.target.value })
          }
          placeholder="부드러운 햇빛 아래 소파에 앉아 고양이 인형을 안고 있다…"
          className="min-h-24"
        />
      </Field>

      <TagTextarea
        id="negative-prompt"
        label="추가 부정 프롬프트"
        value={value.negative}
        onChange={(negative) => onChange({ ...value, negative })}
        placeholder="필요한 경우에만 추가하세요"
        description="워크플로우 기본 부정 태그 뒤에 이어 붙습니다."
      />

      <PromptInspector
        prompts={value}
        loras={loras}
        autoTags={autoTags}
      />

      <details className="group rounded-lg border border-border/70 bg-background/30">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-medium text-muted-foreground transition hover:text-foreground">
          <span className="inline-flex items-center gap-2">
            <AlertCircle className="size-3.5" />
            워크플로우 기본 태그
          </span>
          <ChevronDown className="size-4 transition group-open:rotate-180" />
        </summary>
        <div className="grid gap-4 border-t border-border/60 p-4">
          <Field label="기본 긍정" htmlFor="base-positive">
            <Input
              id="base-positive"
              value={value.basePositive}
              onChange={(event) =>
                onChange({ ...value, basePositive: event.target.value })
              }
              className="font-mono text-xs"
            />
          </Field>
          <Field label="기본 부정" htmlFor="base-negative">
            <Textarea
              id="base-negative"
              value={value.baseNegative}
              onChange={(event) =>
                onChange({ ...value, baseNegative: event.target.value })
              }
              className="min-h-20 font-mono text-xs"
            />
          </Field>
          <p className="text-[11px] leading-5 text-muted-foreground">
            기본 태그 → 사용자 태그 → 자연어 순서로 결합됩니다. 완료 후 자동
            태그는 결과에서 확인하고 필요한 것만 추가할 수 있습니다.
          </p>
        </div>
      </details>
    </div>
  );
}

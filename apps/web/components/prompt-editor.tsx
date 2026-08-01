"use client";

import * as React from "react";
import { ChevronDown, Hash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import {
  AutoResizeTextarea,
  Input,
  Textarea,
} from "@/components/ui/input";
import { searchTags } from "@/lib/api";
import type { GenerationDraft, TagSuggestion } from "@/lib/types";
import {
  cn,
  extractTags,
  getTagAtCursor,
  isAutocompleteCommitKey,
  replaceTagAtCursor,
  tagComparisonKey,
} from "@/lib/utils";

type Prompts = GenerationDraft["prompts"];

interface PromptEditorProps {
  value: Prompts;
  onChange: (value: Prompts) => void;
}

function TagTextarea({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [suggestions, setSuggestions] = React.useState<TagSuggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [autocompleteActive, setAutocompleteActive] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [cursor, setCursor] = React.useState(value.length);
  const autocompleteRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const acceptsSuggestions = React.useRef(false);
  const pendingCursor = React.useRef<number | null>(null);
  const requestSequence = React.useRef(0);
  const activeTag = React.useMemo(
    () => getTagAtCursor(value, cursor),
    [cursor, value],
  );
  const latestTag = activeTag.query;
  const contextTags = React.useMemo(
    () =>
      extractTags(
        `${value.slice(0, activeTag.start)}${value.slice(activeTag.end)}`,
      ),
    [activeTag.end, activeTag.start, value],
  );
  const includedTagKeys = React.useMemo(
    () => new Set(contextTags.map(tagComparisonKey)),
    [contextTags],
  );

  function isIncluded(suggestion: TagSuggestion) {
    return includedTagKeys.has(tagComparisonKey(suggestion.tag));
  }

  function selectableIndex(start: number, direction: -1 | 1, fallback: number) {
    for (
      let index = start;
      index >= 0 && index < suggestions.length;
      index += direction
    ) {
      if (!isIncluded(suggestions[index]!)) return index;
    }
    return fallback;
  }

  React.useLayoutEffect(() => {
    if (pendingCursor.current === null) return;
    textareaRef.current?.setSelectionRange(
      pendingCursor.current,
      pendingCursor.current,
    );
    pendingCursor.current = null;
  }, [cursor, value]);

  React.useEffect(() => {
    function dismissOnOutsidePointerDown(event: PointerEvent) {
      if (
        autocompleteRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      acceptsSuggestions.current = false;
      setAutocompleteActive(false);
      setOpen(false);
    }

    document.addEventListener("pointerdown", dismissOnOutsidePointerDown);
    return () =>
      document.removeEventListener("pointerdown", dismissOnOutsidePointerDown);
  }, []);

  React.useEffect(() => {
    const requestId = ++requestSequence.current;
    if (!autocompleteActive || latestTag.length < 1) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    void searchTags(latestTag, {
      context: contextTags,
      limit: 10,
      signal: controller.signal,
    })
      .then((results) => {
        if (
          controller.signal.aborted ||
          requestSequence.current !== requestId
        ) {
          return;
        }
        const visibleResults = results.slice(0, 10);
        setSuggestions(visibleResults);
        setOpen(Boolean(results.length) && acceptsSuggestions.current);
        const firstSelectable = visibleResults.findIndex(
          (suggestion) =>
            !includedTagKeys.has(tagComparisonKey(suggestion.tag)),
        );
        setActiveIndex(firstSelectable >= 0 ? firstSelectable : 0);
      })
      .catch((error) => {
        if (
          (error as Error).name !== "AbortError" &&
          requestSequence.current === requestId
        ) {
          setSuggestions([]);
          setOpen(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, [autocompleteActive, contextTags, includedTagKeys, latestTag]);

  function choose(suggestion: TagSuggestion) {
    if (isIncluded(suggestion)) return;
    const completed = replaceTagAtCursor(
      value,
      cursor,
      suggestion.insertText ?? suggestion.tag,
    );
    pendingCursor.current = completed.cursor;
    setCursor(completed.cursor);
    onChange(completed.value);
    setOpen(false);
  }

  return (
    <Field label={label} htmlFor={id}>
      <div ref={autocompleteRef} className="relative">
        <AutoResizeTextarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={(event) => {
            setCursor(event.target.selectionStart);
            onChange(event.target.value);
          }}
          onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
          onClick={(event) => {
            acceptsSuggestions.current = true;
            setAutocompleteActive(true);
            setCursor(event.currentTarget.selectionStart);
          }}
          onFocus={(event) => {
            acceptsSuggestions.current = true;
            setAutocompleteActive(true);
            setCursor(event.currentTarget.selectionStart);
          }}
          onBlur={() => {
            acceptsSuggestions.current = false;
            setAutocompleteActive(false);
            setOpen(false);
          }}
          placeholder={placeholder}
          spellCheck={false}
          className="font-mono text-[13px]"
          aria-autocomplete="list"
          aria-controls={`${id}-suggestions`}
          aria-expanded={open}
          onKeyDown={(event) => {
            if (!open) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => selectableIndex(index + 1, 1, index));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => selectableIndex(index - 1, -1, index));
            }
            if (
              isAutocompleteCommitKey(
                event.key,
                event.nativeEvent.isComposing,
              ) &&
              suggestions[activeIndex] &&
              !isIncluded(suggestions[activeIndex])
            ) {
              event.preventDefault();
              choose(suggestions[activeIndex]);
            }
            if (event.key === "Escape") setOpen(false);
          }}
        />
        {open ? (
          <div
            id={`${id}-suggestions`}
            role="listbox"
            className="absolute inset-x-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-lg border border-border bg-popover/95 p-1.5 shadow-2xl backdrop-blur-xl"
          >
            {suggestions.map((suggestion, index) => {
              const included = isIncluded(suggestion);
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={!included && index === activeIndex}
                  aria-disabled={included}
                  disabled={included}
                  key={suggestion.tag}
                  onMouseEnter={() => {
                    if (!included) setActiveIndex(index);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(suggestion)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none hover:bg-accent",
                    !included && index === activeIndex && "bg-accent",
                    included &&
                      "cursor-default bg-muted/20 text-muted-foreground opacity-55 grayscale hover:bg-muted/20",
                  )}
                >
                  <Hash
                    className={cn(
                      "size-3.5 text-pink-300",
                      included && "text-muted-foreground",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm">{suggestion.tag}</span>
                      {suggestion.category ? (
                        <Badge variant="outline" className="px-1.5 py-0.5">
                          {suggestion.category}
                        </Badge>
                      ) : null}
                      {included ? (
                        <Badge variant="outline" className="px-1.5 py-0.5">
                          포함됨
                        </Badge>
                      ) : null}
                    </div>
                    {suggestion.description ? (
                      <p
                        className="mt-0.5 truncate text-[11px] text-muted-foreground"
                        title={suggestion.description}
                      >
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
              );
            })}
          </div>
        ) : null}
      </div>
    </Field>
  );
}

export function PromptEditor({ value, onChange }: PromptEditorProps) {
  return (
    <div className="space-y-5">
      <TagTextarea
        id="positive-prompt"
        label="긍정"
        value={value.positive}
        onChange={(positive) => onChange({ ...value, positive })}
      />

      <TagTextarea
        id="negative-prompt"
        label="부정"
        value={value.negative}
        onChange={(negative) => onChange({ ...value, negative })}
      />

      <details className="group rounded-lg border border-border/70 bg-background/30">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-medium text-muted-foreground transition hover:text-foreground">
          <span className="text-foreground">고급</span>
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
        </div>
      </details>
    </div>
  );
}

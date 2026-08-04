"use client";

import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { GenerationDraft } from "@/lib/types";
import { appendPromptTag, promptHasTag } from "@/lib/utils";

interface RecognizedTagsProps {
  tags: string[];
  prompts: GenerationDraft["prompts"];
  onChange: (prompts: GenerationDraft["prompts"]) => void;
}

export function RecognizedTags({
  tags,
  prompts,
  onChange,
}: RecognizedTagsProps) {
  if (tags.length === 0) return null;

  return (
    <details className="group rounded-lg border border-border/70 bg-background/30">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
        <span className="inline-flex items-center gap-2 text-xs font-medium">
          인식된 태그
          <Badge
            variant="secondary"
            className="px-2 py-0.5 text-[10px] font-normal tabular-nums"
          >
            {tags.length}개
          </Badge>
        </span>
        <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
      </summary>

      <div className="flex flex-wrap gap-2 border-t border-border/60 p-4">
        {tags.map((tag) => {
          const included = promptHasTag(prompts.positive, tag);
          return (
            <button
              key={tag}
              type="button"
              disabled={included}
              title={included ? "이미 긍정 프롬프트에 있습니다." : undefined}
              aria-label={
                included
                  ? `${tag}, 이미 추가됨`
                  : `${tag}, 긍정 프롬프트에 추가`
              }
              className="rounded-full border border-border bg-secondary/45 px-3 py-1.5 text-xs text-secondary-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-pink-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:border-border/50 disabled:bg-muted/30 disabled:text-muted-foreground/55"
              onClick={() =>
                onChange({
                  ...prompts,
                  positive: appendPromptTag(prompts.positive, tag),
                })
              }
            >
              {tag}
            </button>
          );
        })}
      </div>
    </details>
  );
}

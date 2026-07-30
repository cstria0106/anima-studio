"use client";

import * as React from "react";
import {
  AlertTriangle,
  ChevronDown,
  Grid3X3,
  LoaderCircle,
  Play,
  Shuffle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommittedNumberField } from "@/components/ui/committed-number-field";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import type {
  GenerationDraft,
  StudioJob,
  VariationCombination,
  VariationMatrixRequest,
} from "@/lib/types";
import { uniqueId } from "@/lib/utils";

type SeedAxis = "same" | "random" | "increment";

interface VariationMatrixProps {
  draft: GenerationDraft;
  disabled?: boolean;
  disabledReason?: string;
  onBeforeSubmit?: (jobCount: number) => boolean | Promise<boolean>;
  onSubmit: (request: VariationMatrixRequest) => Promise<StudioJob[]>;
  onJobsCreated: (jobs: StudioJob[]) => void;
}

export function VariationMatrix({
  draft,
  disabled,
  disabledReason,
  onBeforeSubmit,
  onSubmit,
  onJobsCreated,
}: VariationMatrixProps) {
  const [promptVariants, setPromptVariants] = React.useState("");
  const [seedAxis, setSeedAxis] = React.useState<SeedAxis>("random");
  const [seedCount, setSeedCount] = React.useState(2);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [submittedCount, setSubmittedCount] = React.useState(0);

  const prompts = React.useMemo(
    () =>
      promptVariants
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    [promptVariants],
  );
  const promptAxis = prompts.length ? prompts : [""];
  const effectiveSeedCount = seedAxis === "same" ? 1 : seedCount;
  const combinationCount = promptAxis.length * effectiveSeedCount;
  const tooMany = combinationCount > 16;

  function combinations(): VariationCombination[] {
    const values: VariationCombination[] = [];
    promptAxis.forEach((promptSuffix) => {
      Array.from({ length: effectiveSeedCount }, (_, seedIndex) => {
        const base = draft.prompts.positive.replace(/,\s*$/, "");
        const positive = [base, promptSuffix]
          .filter(Boolean)
          .join(", ")
          .concat(base || promptSuffix ? ", " : "");
        values.push({
          id: uniqueId("variation"),
          label: [
            promptSuffix || "기본 프롬프트",
            seedAxis === "same"
              ? `seed ${draft.sampling.seed}`
              : seedAxis === "increment"
                ? `seed ${draft.sampling.seed + seedIndex}`
                : `random ${seedIndex + 1}`,
          ].join(" · "),
          positive,
          seedMode: seedAxis === "random" ? "random" : "fixed",
          seed:
            seedAxis === "increment"
              ? draft.sampling.seed + seedIndex
              : draft.sampling.seed,
        });
      });
    });
    return values;
  }

  async function submit() {
    if (disabled || tooMany || !combinationCount) return;
    if (onBeforeSubmit && !(await onBeforeSubmit(combinationCount))) return;
    setSubmitting(true);
    setError("");
    try {
      const jobs = await onSubmit({
        baseDraft: draft,
        combinations: combinations(),
      });
      setSubmittedCount(jobs.length);
      onJobsCreated(jobs);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "변형 작업을 제출하지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <details className="group rounded-lg border border-border bg-surface-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30">
        <span className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-violet-400/10 text-violet-300">
            <Grid3X3 className="size-3.5" />
          </span>
          <span>
            <span className="block text-xs font-medium">변형 매트릭스</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              프롬프트 {promptAxis.length} × 시드 {effectiveSeedCount}
            </span>
          </span>
          <Badge variant={tooMany ? "destructive" : "outline"}>
            {combinationCount} jobs
          </Badge>
        </span>
        <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
      </summary>

      <div className="space-y-4 border-t border-border/70 p-4">
        <Field
          label="프롬프트 변형"
          htmlFor="variation-prompts"
          hint="한 줄에 하나"
        >
          <Textarea
            id="variation-prompts"
            value={promptVariants}
            onChange={(event) => setPromptVariants(event.target.value)}
            placeholder={"smile, waving\nshy, hands behind back\nsleepy, holding pillow"}
            className="min-h-24 font-mono text-xs"
          />
          <p className="text-[10px] leading-4 text-muted-foreground">
            각 줄을 현재 긍정 프롬프트 뒤에 붙입니다. 비워두면 프롬프트는
            그대로 두고 시드만 비교합니다.
          </p>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="시드 축" htmlFor="variation-seed-mode">
            <div className="relative">
              <Shuffle className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <select
                id="variation-seed-mode"
                value={seedAxis}
                onChange={(event) =>
                  setSeedAxis(event.target.value as SeedAxis)
                }
                className="h-10 w-full appearance-none rounded-md border border-input bg-background/55 pl-9 pr-8 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="random">각 작업 랜덤</option>
                <option value="increment">현재 시드부터 순차</option>
                <option value="same">모두 같은 시드</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </Field>
          <CommittedNumberField
              id="variation-seed-count"
              label="시드 개수"
              min={1}
              max={8}
              value={effectiveSeedCount}
              disabled={seedAxis === "same"}
              onChange={setSeedCount}
            />
        </div>

        {tooMany ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[10px] leading-4 text-amber-100"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
            한 번에 최대 16개 작업을 만들 수 있습니다. 프롬프트 줄이나 시드
            개수를 줄여주세요.
          </p>
        ) : null}
        {disabledReason && disabled ? (
          <p className="text-[10px] leading-4 text-amber-200/80">
            {disabledReason}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[10px] leading-4 text-red-200"
          >
            {error}
          </p>
        ) : null}
        {submittedCount ? (
          <p role="status" className="text-[10px] text-emerald-300">
            {submittedCount}개 작업을 대기열에 추가했습니다.
          </p>
        ) : null}

        <Button
          type="button"
          size="sm"
          variant="soft"
          className="w-full"
          disabled={disabled || submitting || tooMany}
          onClick={() => void submit()}
        >
          {submitting ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Play />
          )}
          {combinationCount}개 변형 생성
        </Button>
      </div>
    </details>
  );
}

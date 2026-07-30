"use client";

import * as React from "react";
import Image from "next/image";
import {
  CalendarDays,
  ChevronLeft,
  Clock3,
  Download,
  Filter,
  ImageIcon,
  Layers3,
  LoaderCircle,
  Maximize2,
  MinusCircle,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  ClipboardCopy,
  XCircle,
} from "lucide-react";
import { ResultActionBar } from "@/components/result-action-bar";
import { ResultComparison } from "@/components/result-comparison";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Divider, Skeleton } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getJob, getJobs, upscaleJob } from "@/lib/api";
import type {
  ComparisonItem,
  GenerationDraft,
  JobStatus,
  StudioJob,
} from "@/lib/types";
import { cn, formatDate, outputUrl } from "@/lib/utils";

const statusLabels: Record<JobStatus, string> = {
  draft: "초안",
  uploading: "업로드",
  queued: "대기",
  running: "생성 중",
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
};

function StatusBadge({ status }: { status: JobStatus }) {
  const variant =
    status === "completed"
      ? "success"
      : status === "failed"
        ? "destructive"
        : status === "running" || status === "queued"
          ? "warning"
          : "secondary";
  return <Badge variant={variant}>{statusLabels[status]}</Badge>;
}

function JobThumbnail({
  job,
  priority = false,
}: {
  job: StudioJob;
  priority?: boolean;
}) {
  const output =
    job.outputs.find((item) => item.kind === "upscale") ?? job.outputs[0];
  return (
    <div className="relative aspect-[4/5] overflow-hidden bg-muted panel-grid">
      {output ? (
        <Image
          src={outputUrl(output.url ?? output.id)}
          alt="생성 결과"
          fill
          priority={priority}
          unoptimized
          sizes="(max-width: 640px) 50vw, 260px"
          className="object-cover"
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground">
          {["running", "queued", "uploading"].includes(job.status) ? (
            <LoaderCircle className="size-6 animate-spin text-pink-300" />
          ) : job.status === "failed" ? (
            <XCircle className="size-6 text-red-300" />
          ) : (
            <ImageIcon className="size-6" />
          )}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent px-3 pb-3 pt-10">
        <p className="truncate text-xs font-medium text-white">
          {job.settings.prompts.positive || "프롬프트 없음"}
        </p>
      </div>
      <div className="absolute left-2 top-2">
        <StatusBadge status={job.status} />
      </div>
    </div>
  );
}

interface HistoryViewProps {
  onLoadSettings: (settings: GenerationDraft) => void;
  onTrackJob: (job: StudioJob) => void;
  onRepeatJob: (job: StudioJob) => Promise<void>;
  onNewSeedJob: (job: StudioJob) => Promise<void>;
  onEditJobPrompt: (job: StudioJob) => void;
  onSetRepresentative: (job: StudioJob) => Promise<void>;
  activeProfileName?: string;
}

export function HistoryView({
  onLoadSettings,
  onTrackJob,
  onRepeatJob,
  onNewSeedJob,
  onEditJobPrompt,
  onSetRepresentative,
  activeProfileName,
}: HistoryViewProps) {
  const [jobs, setJobs] = React.useState<StudioJob[]>([]);
  const [selected, setSelected] = React.useState<StudioJob | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState("");
  const [actionNotice, setActionNotice] = React.useState("");
  const [pendingFailedAction, setPendingFailedAction] = React.useState("");
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [comparison, setComparison] = React.useState<ComparisonItem[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getJobs(status ? { status } : {});
      setJobs(result.jobs);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "히스토리를 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [status]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filtered = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return jobs;
    return jobs.filter((job) =>
      [
        job.settings.prompts.positive,
        job.settings.models.diffusion,
        String(job.settings.sampling.seed),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [jobs, query]);

  function toComparisonItem(
    job: StudioJob,
    output: StudioJob["outputs"][number],
  ): ComparisonItem {
    return {
      id: output.id,
      jobId: job.id,
      label: `${output.kind === "upscale" || output.kind === "upscaled" ? "업스케일" : "기본"} · ${job.id.slice(0, 6)}`,
      url: output.url ?? output.id,
      width: output.width,
      height: output.height,
      seed: job.settings.sampling.seed,
      kind: output.kind,
    };
  }

  function toggleComparison(
    job: StudioJob,
    output: StudioJob["outputs"][number],
  ) {
    const item = toComparisonItem(job, output);
    setComparison((current) => {
      if (current.some((value) => value.id === item.id)) {
        return current.filter((value) => value.id !== item.id);
      }
      if (current.length >= 2) return [current[1], item];
      return [...current, item];
    });
  }

  async function openJob(job: StudioJob) {
    setSelected(job);
    window.scrollTo({ top: 0, behavior: "auto" });
    setActionError("");
    setActionNotice("");
    setDetailLoading(true);
    try {
      setSelected(await getJob(job.id));
    } catch {
      // The list snapshot is still useful if the detail request fails.
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleUpscale(job: StudioJob) {
    setActionError("");
    try {
      const sourceOutputId = job.outputs.find(
        (output) => output.kind === "base",
      )?.id;
      const nextJob = await upscaleJob(
        job.id,
        job.settings.upscale,
        sourceOutputId,
      );
      onTrackJob(nextJob);
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "업스케일 작업을 시작하지 못했습니다.",
      );
    }
  }

  async function repeatFailedJob(job: StudioJob) {
    setPendingFailedAction(job.id);
    setActionError("");
    setActionNotice("");
    try {
      await onRepeatJob(job);
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "같은 설정으로 작업을 다시 시작하지 못했습니다.",
      );
    } finally {
      setPendingFailedAction("");
    }
  }

  async function copyDiagnostics(job: StudioJob) {
    setActionError("");
    setActionNotice("");
    const diagnostics = {
      jobId: job.id,
      promptId: job.promptId ?? null,
      status: job.status,
      stage: job.stage ?? null,
      error: job.error ?? null,
      createdAt: job.createdAt,
      startedAt: job.startedAt ?? null,
      completedAt: job.completedAt ?? null,
      model: job.settings.models.diffusion,
      clip: job.settings.models.clip,
      vae: job.settings.models.vae,
      sampling: job.settings.sampling,
      upscale: job.settings.upscale,
    };
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(diagnostics, null, 2),
      );
      setActionNotice("진단 정보를 클립보드에 복사했습니다.");
    } catch {
      setActionError("진단 정보를 클립보드에 복사하지 못했습니다.");
    }
  }

  function loadWithAutoTag(
    job: StudioJob,
    tag: string,
    target: "positive" | "exclude",
  ) {
    const settings = job.settings;
    if (target === "positive") {
      const existing = settings.prompts.positive
        .split(",")
        .map((value) => value.trim().toLowerCase());
      const positive = existing.includes(tag.toLowerCase())
        ? settings.prompts.positive
        : [settings.prompts.positive.replace(/,\s*$/, ""), tag]
            .filter(Boolean)
            .join(", ")
            .concat(", ");
      onLoadSettings({
        ...settings,
        prompts: { ...settings.prompts, positive },
      });
      return;
    }
    const existing = settings.tagging.excludeTags
      .split(",")
      .map((value) => value.trim().toLowerCase());
    const excludeTags = existing.includes(tag.toLowerCase())
      ? settings.tagging.excludeTags
      : [settings.tagging.excludeTags.replace(/,\s*$/, ""), tag]
          .filter(Boolean)
          .join(", ")
          .concat(", ");
    onLoadSettings({
      ...settings,
      tagging: { ...settings.tagging, excludeTags },
    });
  }

  if (selected) {
    const output =
      selected.outputs.find((item) => item.kind === "upscale") ??
      selected.outputs[0];
    const canUpscale =
      selected.status === "completed" &&
      selected.settings.upscale.enabled === false &&
      selected.outputs.some((item) => item.kind === "base") &&
      !selected.outputs.some(
        (item) => item.kind === "upscale" || item.kind === "upscaled",
      );
    return (
      <div className="animate-fade-in space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setSelected(null)}
          >
            <ChevronLeft />
            히스토리
          </Button>
          <div className="flex items-center gap-2">
            {output ? (
              <Button asChild type="button" size="sm" variant="outline">
                <a
                  href={outputUrl(output.url ?? output.id)}
                  download
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download />
                  다운로드
                </a>
              </Button>
            ) : null}
            {selected.outputs.length > 1 ? (
              <Button
                type="button"
                size="sm"
                variant="soft"
                onClick={() =>
                  setComparison(
                    selected.outputs
                      .slice(0, 2)
                      .map((item) => toComparisonItem(selected, item)),
                  )
                }
              >
                <Maximize2 />
                기본/업스케일 비교
              </Button>
            ) : null}
          </div>
        </div>

        {comparison.length === 2 ? (
          <ResultComparison
            left={comparison[0]}
            right={comparison[1]}
            onClose={() => setComparison([])}
          />
        ) : null}

        {actionError ? (
          <p
            role="alert"
            className="rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-xs text-red-200"
          >
            {actionError}
          </p>
        ) : null}
        {actionNotice ? (
          <p
            role="status"
            className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-xs text-emerald-100"
          >
            {actionNotice}
          </p>
        ) : null}

        {selected.status === "failed" ? (
          <div
            role="alert"
            className="rounded-xl border border-red-400/20 bg-red-400/[0.05] p-4"
          >
            <div className="flex items-start gap-3">
              <XCircle className="mt-0.5 size-5 shrink-0 text-red-300" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-red-100">
                  생성 작업을 완료하지 못했습니다.
                </p>
                <p className="mt-1 break-words text-xs leading-5 text-red-100/70">
                  {selected.error ?? "ComfyUI에서 작업 오류가 발생했습니다."}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onLoadSettings(selected.settings)}
              >
                <Settings2 />
                문제 설정 열기
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void repeatFailedJob(selected)}
                disabled={pendingFailedAction === selected.id}
              >
                {pendingFailedAction === selected.id ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Play />
                )}
                같은 설정 재시도
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void copyDiagnostics(selected)}
              >
                <ClipboardCopy />
                진단 복사
              </Button>
            </div>
          </div>
        ) : null}

        {selected.status === "completed" && selected.outputs.length ? (
          <div className="rounded-xl border border-border bg-card p-3">
            <ResultActionBar
              job={selected}
              canUpscale={canUpscale}
              activeProfileName={activeProfileName}
              onRepeat={onRepeatJob}
              onNewSeed={onNewSeedJob}
              onEditPrompt={onEditJobPrompt}
              onLoadSettings={(job) => onLoadSettings(job.settings)}
              onUpscale={handleUpscale}
              onSetRepresentative={onSetRepresentative}
            />
          </div>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="overflow-hidden">
            <div className="relative min-h-[460px] bg-black/30 panel-grid">
              {detailLoading ? (
                <div className="absolute inset-0 grid place-items-center">
                  <LoaderCircle className="size-6 animate-spin text-pink-300" />
                </div>
              ) : output ? (
                <Image
                  src={outputUrl(output.url ?? output.id)}
                  alt="생성 결과 상세"
                  fill
                  unoptimized
                  priority
                  sizes="(max-width: 1280px) 100vw, 800px"
                  className="object-contain"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                  <ImageIcon className="size-8" />
                </div>
              )}
            </div>
            {selected.outputs.length > 1 ? (
              <div className="flex gap-3 border-t border-border p-3">
                {selected.outputs.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => toggleComparison(selected, item)}
                    aria-pressed={comparison.some(
                      (value) => value.id === item.id,
                    )}
                    title="비교 대상으로 선택"
                    className={cn(
                      "relative aspect-square w-16 overflow-hidden rounded-md border border-border transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      comparison.some((value) => value.id === item.id) &&
                        "border-primary/60 ring-2 ring-primary/20",
                    )}
                  >
                    <Image
                      src={outputUrl(item.url ?? item.id)}
                      alt={`${item.kind} 결과`}
                      fill
                      unoptimized
                      sizes="64px"
                      className="object-cover"
                    />
                    <span className="absolute inset-x-1 bottom-1 rounded bg-black/70 px-1 py-0.5 text-[8px] uppercase text-white">
                      {item.kind}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Job {selected.id.slice(0, 8)}
                    </p>
                    <CardTitle className="mt-1">생성 상세</CardTitle>
                  </div>
                  <StatusBadge status={selected.status} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <CalendarDays className="size-3.5" />
                    생성 시각
                  </span>
                  <span>{formatDate(selected.createdAt)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Settings2 className="size-3.5" />
                    크기
                  </span>
                  <span className="tabular-nums">
                    {selected.settings.sampling.width} ×{" "}
                    {selected.settings.sampling.height}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Sparkles className="size-3.5" />
                    Seed
                  </span>
                  <span className="max-w-40 truncate font-mono">
                    {selected.settings.sampling.seed}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Layers3 className="size-3.5" />
                    Model
                  </span>
                  <span className="max-w-48 truncate">
                    {selected.settings.models.diffusion}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>프롬프트</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="max-h-36 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-foreground/85">
                  {selected.settings.prompts.positive || "—"}
                </p>
                {selected.settings.prompts.negative ? (
                  <>
                    <Divider />
                    <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                      {selected.settings.prompts.negative}
                    </p>
                  </>
                ) : null}
              </CardContent>
            </Card>

            {selected.autoTags?.length ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>자동 태그</CardTitle>
                </CardHeader>
                <CardContent className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                  {selected.autoTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center overflow-hidden rounded-full border border-border bg-secondary/70 text-xs text-secondary-foreground"
                    >
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 px-2 py-1.5 transition hover:bg-primary/10 hover:text-pink-200"
                        onClick={() =>
                          loadWithAutoTag(selected, tag, "positive")
                        }
                        title="긍정 프롬프트에 추가"
                      >
                        <Plus className="size-2.5" />
                        {tag}
                      </button>
                      <button
                        type="button"
                        className="border-l border-border px-1.5 py-1.5 text-muted-foreground transition hover:bg-red-400/10 hover:text-red-200"
                        onClick={() =>
                          loadWithAutoTag(selected, tag, "exclude")
                        }
                        title="태깅 제외 목록에 추가"
                        aria-label={`${tag} 태그를 제외 목록에 추가`}
                      >
                        <MinusCircle className="size-2.5" />
                      </button>
                    </span>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {selected.settings.referenceAssets.length ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>참조 이미지</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-4 gap-2">
                  {selected.settings.referenceAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className="relative aspect-square overflow-hidden rounded-md border border-border"
                    >
                      <Image
                        src={asset.url || `/api/assets/${asset.id}`}
                        alt={asset.name}
                        fill
                        unoptimized
                        sizes="80px"
                        className="object-cover"
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            결과 라이브러리
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            생성 히스토리
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            결과와 모든 설정이 함께 보존됩니다.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
          새로고침
        </Button>
      </div>

      {comparison.length === 2 ? (
        <ResultComparison
          left={comparison[0]}
          right={comparison[1]}
          onClose={() => setComparison([])}
        />
      ) : comparison.length === 1 ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/[0.06] px-4 py-3 text-xs text-pink-100"
        >
          <span>
            비교 A를 선택했습니다. 다른 결과의 ‘비교에 추가’를 누르세요.
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setComparison([])}
          >
            선택 취소
          </Button>
        </div>
      ) : null}

      {actionError ? (
        <p
          role="alert"
          className="rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-xs text-red-200"
        >
          {actionError}
        </p>
      ) : null}
      {actionNotice ? (
        <p
          role="status"
          className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-xs text-emerald-100"
        >
          {actionNotice}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
            placeholder="프롬프트, 모델, 시드 검색"
          />
        </div>
        <div className="relative min-w-40">
          <Filter className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 w-full appearance-none rounded-md border border-input bg-background/55 pl-9 pr-8 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            aria-label="상태 필터"
          >
            <option value="">모든 상태</option>
            <option value="completed">완료</option>
            <option value="running">생성 중</option>
            <option value="failed">실패</option>
            <option value="cancelled">취소</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <Skeleton className="aspect-[4/5] rounded-none" />
              <div className="space-y-2 p-3">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-400/20 bg-red-400/[0.06] px-6 py-12 text-center">
          <XCircle className="mx-auto size-7 text-red-300" />
          <p className="mt-3 text-sm font-medium">히스토리를 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-200/75">{error}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={() => void load()}
          >
            <RefreshCw />
            다시 시도
          </Button>
        </div>
      ) : filtered.length ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {filtered.map((job, index) => {
            const compareOutput =
              job.outputs.find(
                (item) =>
                  item.kind === "upscale" || item.kind === "upscaled",
              ) ?? job.outputs[0];
            const selectedForCompare = compareOutput
              ? comparison.some((item) => item.id === compareOutput.id)
              : false;
            return (
              <div
                key={job.id}
                className={cn(
                  "overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-input",
                  selectedForCompare && "border-primary/50 ring-2 ring-primary/15",
                )}
              >
                <button
                  type="button"
                  className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                  onClick={() => void openJob(job)}
                >
                  <JobThumbnail job={job} priority={index < 2} />
                  <div className="space-y-2 p-3">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex min-w-0 items-center gap-1 truncate">
                        <Clock3 className="size-3 shrink-0" />
                        {formatDate(job.createdAt)}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {job.settings.sampling.width}×
                        {job.settings.sampling.height}
                      </span>
                    </div>
                    <p className="truncate text-xs text-foreground/70">
                      {job.settings.models.diffusion || "모델 정보 없음"}
                    </p>
                  </div>
                </button>
                {job.status === "failed" ? (
                  <div className="grid grid-cols-3 border-t border-border/70">
                    <button
                      type="button"
                      onClick={() => onLoadSettings(job.settings)}
                      className="inline-flex min-h-11 items-center justify-center gap-1 border-r border-border/70 px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      title="문제가 난 설정을 생성 화면에서 열기"
                    >
                      <Settings2 className="size-3.5" />
                      설정
                    </button>
                    <button
                      type="button"
                      onClick={() => void repeatFailedJob(job)}
                      disabled={pendingFailedAction === job.id}
                      className="inline-flex min-h-11 items-center justify-center gap-1 border-r border-border/70 px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
                      title="같은 설정으로 다시 실행"
                    >
                      {pendingFailedAction === job.id ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                      재시도
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyDiagnostics(job)}
                      className="inline-flex min-h-11 items-center justify-center gap-1 px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      title="오류 진단 정보를 복사"
                    >
                      <ClipboardCopy className="size-3.5" />
                      진단
                    </button>
                  </div>
                ) : compareOutput ? (
                  <button
                    type="button"
                    aria-pressed={selectedForCompare}
                    onClick={() => toggleComparison(job, compareOutput)}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      selectedForCompare && "bg-primary/[0.08] text-pink-200",
                    )}
                  >
                    <Layers3 className="size-3" />
                    {selectedForCompare ? "비교 선택됨" : "비교에 추가"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-20 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-border bg-card text-muted-foreground">
            <ImageIcon className="size-6" />
          </span>
          <h2 className="mt-4 text-sm font-medium">아직 결과가 없습니다.</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            첫 이미지를 만들면 설정과 함께 여기에 저장됩니다.
          </p>
        </div>
      )}
    </div>
  );
}

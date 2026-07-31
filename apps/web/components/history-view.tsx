"use client";

import * as React from "react";
import Image from "next/image";
import {
  CalendarDays,
  ClipboardCopy,
  Clock3,
  Copy,
  Dice5,
  Download,
  Filter,
  ImageIcon,
  Images,
  Layers3,
  LoaderCircle,
  Maximize2,
  MinusCircle,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  XCircle,
} from "lucide-react";
import { ResultComparison } from "@/components/result-comparison";
import { ZoomableImageViewer } from "@/components/zoomable-image-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Divider, Skeleton } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
        : status === "running" ||
            status === "queued" ||
            status === "uploading"
          ? "warning"
          : "secondary";
  return <Badge variant={variant}>{statusLabels[status]}</Badge>;
}

function preferredOutput(job: StudioJob) {
  return (
    job.outputs.find(
      (item) => item.kind === "upscale" || item.kind === "upscaled",
    ) ?? job.outputs[0]
  );
}

function toComparisonItem(
  job: StudioJob,
  output: StudioJob["outputs"][number],
): ComparisonItem {
  return {
    id: output.id,
    jobId: job.id,
    label: `${
      output.kind === "upscale" || output.kind === "upscaled"
        ? "업스케일"
        : "기본"
    } · ${job.id.slice(0, 6)}`,
    url: output.url ?? output.id,
    width: output.width,
    height: output.height,
    seed: job.settings.sampling.seed,
    kind: output.kind,
  };
}

function mergeJobs(current: StudioJob[], incoming: StudioJob[]) {
  const byId = new Map(current.map((job) => [job.id, job]));
  for (const job of incoming) byId.set(job.id, job);
  return [...byId.values()].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function JobThumbnail({
  job,
  priority = false,
}: {
  job: StudioJob;
  priority?: boolean;
}) {
  const output = preferredOutput(job);
  return (
    <div className="relative aspect-[4/5] overflow-hidden bg-muted panel-grid">
      {output ? (
        <Image
          src={outputUrl(output.url ?? output.id)}
          alt=""
          fill
          priority={priority}
          unoptimized
          sizes="150px"
          className="object-cover"
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground">
          {["running", "queued", "uploading"].includes(job.status) ? (
            <LoaderCircle className="size-5 animate-spin text-pink-300" />
          ) : job.status === "failed" ? (
            <XCircle className="size-5 text-red-300" />
          ) : (
            <ImageIcon className="size-5" />
          )}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent px-2 pb-2 pt-8">
        <p className="truncate text-[10px] font-medium text-white">
          {job.settings.prompts.positive || "프롬프트 없음"}
        </p>
      </div>
      <div className="absolute left-1.5 top-1.5">
        <StatusBadge status={job.status} />
      </div>
    </div>
  );
}

interface HistoryRailContentProps {
  jobs: StudioJob[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  query: string;
  status: string;
  hasMore: boolean;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onOpenJob: (job: StudioJob) => void;
}

function HistoryRailContent({
  jobs,
  loading,
  loadingMore,
  error,
  query,
  status,
  hasMore,
  onQueryChange,
  onStatusChange,
  onRefresh,
  onLoadMore,
  onOpenJob,
}: HistoryRailContentProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background/95">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
          <h2 className="truncate text-sm font-semibold">History</h2>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="mr-10 size-9 xl:mr-0"
          disabled={loading}
          onClick={onRefresh}
          aria-label="히스토리 새로고침"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="h-9 pl-8 text-xs"
            placeholder="프롬프트, 모델, 시드"
            aria-label="히스토리 검색"
          />
        </div>
        <div className="relative">
          <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <select
            value={status}
            onChange={(event) => onStatusChange(event.target.value)}
            className="h-9 w-full appearance-none rounded-md border border-input bg-background/55 pl-8 pr-7 text-xs outline-none focus:ring-2 focus:ring-primary/20"
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

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="grid grid-cols-2 gap-2.5" aria-label="불러오는 중">
            {Array.from({ length: 8 }, (_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                <Skeleton className="aspect-[4/5] rounded-none" />
                <div className="space-y-1.5 p-2">
                  <Skeleton className="h-2.5 w-4/5" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : error && !jobs.length ? (
          <div className="rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-8 text-center">
            <XCircle className="mx-auto size-6 text-red-300" />
            <p className="mt-2 text-xs font-medium">
              히스토리를 불러오지 못했습니다.
            </p>
            <p className="mt-1 break-words text-[10px] text-red-200/75">
              {error}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={onRefresh}
            >
              다시 시도
            </Button>
          </div>
        ) : jobs.length ? (
          <>
            {error ? (
              <p
                role="alert"
                className="mb-3 rounded-md border border-red-400/20 bg-red-400/[0.06] px-2.5 py-2 text-[10px] text-red-200"
              >
                {error}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2.5">
              {jobs.map((job, index) => (
                <button
                  type="button"
                  key={job.id}
                  className="min-w-0 overflow-hidden rounded-lg border border-border bg-card text-left outline-none transition-colors hover:border-primary/35 focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpenJob(job)}
                  aria-label={`${formatDate(job.createdAt)} 생성 결과 상세 열기`}
                >
                  <JobThumbnail job={job} priority={index < 2} />
                  <span className="flex items-center gap-1.5 px-2 py-2 text-[10px] text-muted-foreground">
                    <Clock3 className="size-3 shrink-0" />
                    <span className="truncate">{formatDate(job.createdAt)}</span>
                  </span>
                </button>
              ))}
            </div>
            {hasMore ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3 w-full"
                disabled={loadingMore}
                onClick={onLoadMore}
              >
                {loadingMore ? (
                  <LoaderCircle className="animate-spin" />
                ) : null}
                더 보기
              </Button>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card px-3 py-12 text-center">
            <ImageIcon className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-3 text-xs font-medium">
              {query || status ? "조건에 맞는 결과가 없습니다." : "아직 결과가 없습니다."}
            </p>
            {!query && !status ? (
              <p className="mt-1 text-[10px] text-muted-foreground">
                이미지를 생성하면 여기에 표시됩니다.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

interface HistoryDetailDialogProps {
  job: StudioJob | null;
  detailLoading: boolean;
  activeOutputId: string;
  comparison: ComparisonItem[];
  actionError: string;
  actionNotice: string;
  pendingFailedAction: boolean;
  onOpenChange: (open: boolean) => void;
  onOutputChange: (id: string) => void;
  onComparisonChange: (items: ComparisonItem[]) => void;
  onLoadSettings: (settings: GenerationDraft) => void;
  onRepeatJob: (job: StudioJob) => Promise<void>;
  onNewSeedJob: (job: StudioJob) => Promise<void>;
  onEditJobPrompt: (job: StudioJob) => void;
  onUpscale: (job: StudioJob) => Promise<void>;
  onRepeatFailed: (job: StudioJob) => Promise<void>;
  onCopyDiagnostics: (job: StudioJob) => Promise<void>;
  onLoadWithAutoTag: (
    job: StudioJob,
    tag: string,
    target: "positive" | "exclude",
  ) => void;
}

function HistoryDetailDialog({
  job,
  detailLoading,
  activeOutputId,
  comparison,
  actionError,
  actionNotice,
  pendingFailedAction,
  onOpenChange,
  onOutputChange,
  onComparisonChange,
  onLoadSettings,
  onRepeatJob,
  onNewSeedJob,
  onEditJobPrompt,
  onUpscale,
  onRepeatFailed,
  onCopyDiagnostics,
  onLoadWithAutoTag,
}: HistoryDetailDialogProps) {
  if (!job) return null;

  const output =
    job.outputs.find((item) => item.id === activeOutputId) ??
    preferredOutput(job);
  const compared = output
    ? comparison.some((item) => item.id === output.id)
    : false;
  const canUpscale =
    job.status === "completed" &&
    job.settings.upscale.enabled === false &&
    job.outputs.some((item) => item.kind === "base") &&
    !job.outputs.some(
      (item) => item.kind === "upscale" || item.kind === "upscaled",
    );

  const toggleComparison = () => {
    if (!output) return;
    const item = toComparisonItem(job, output);
    if (compared) {
      onComparisonChange(comparison.filter((value) => value.id !== item.id));
    } else if (comparison.length >= 2) {
      onComparisonChange([comparison[1], item]);
    } else {
      onComparisonChange([...comparison, item]);
    }
  };

  const restoreSettings = () => {
    onLoadSettings(structuredClone(job.settings));
    onOpenChange(false);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1400px] sm:rounded-xl sm:border">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-14 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>생성 상세</DialogTitle>
            <StatusBadge status={job.status} />
            <span className="font-mono text-[10px] text-muted-foreground">
              {job.id.slice(0, 8)}
            </span>
          </div>
          <DialogDescription className="sr-only">
            생성 이미지와 사용한 설정을 확인하고 복원합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-5">
            <Button type="button" size="sm" onClick={restoreSettings}>
              <Copy />
              설정 복원
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void onRepeatJob(job)}
            >
              <RefreshCw />
              같은 설정
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void onNewSeedJob(job)}
            >
              <Dice5 />
              새 시드
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                onEditJobPrompt(job);
                onOpenChange(false);
              }}
            >
              <PencilLine />
              프롬프트 수정
            </Button>
            {canUpscale ? (
              <Button
                type="button"
                size="sm"
                variant="soft"
                onClick={() => void onUpscale(job)}
              >
                <Maximize2 />
                업스케일
              </Button>
            ) : null}
            {output ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant={compared ? "soft" : "ghost"}
                  onClick={toggleComparison}
                  aria-pressed={compared}
                >
                  <Images />
                  {compared ? "비교 선택됨" : "비교에 추가"}
                </Button>
                <Button asChild type="button" size="sm" variant="ghost">
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
              </>
            ) : null}
          </div>

          {actionError ? (
            <p
              role="alert"
              className="mx-3 mt-3 shrink-0 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-xs text-red-200 sm:mx-5"
            >
              {actionError}
            </p>
          ) : null}
          {actionNotice ? (
            <p
              role="status"
              className="mx-3 mt-3 shrink-0 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-xs text-emerald-100 sm:mx-5"
            >
              {actionNotice}
            </p>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
            {comparison.length === 2 ? (
              <div className="mb-4">
                <ResultComparison
                  left={comparison[0]}
                  right={comparison[1]}
                  onClose={() => onComparisonChange([])}
                />
              </div>
            ) : comparison.length === 1 ? (
              <div
                role="status"
                className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/[0.06] px-3 py-2 text-xs text-pink-100"
              >
                <span>다른 결과를 열고 비교에 추가하세요.</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onComparisonChange([])}
                >
                  선택 취소
                </Button>
              </div>
            ) : null}

            {job.status === "failed" ? (
              <div
                role="alert"
                className="mb-4 rounded-xl border border-red-400/20 bg-red-400/[0.05] p-4"
              >
                <div className="flex items-start gap-3">
                  <XCircle className="mt-0.5 size-5 shrink-0 text-red-300" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-red-100">
                      생성 작업을 완료하지 못했습니다.
                    </p>
                    <p className="mt-1 break-words text-xs leading-5 text-red-100/70">
                      {job.error ?? "ComfyUI에서 작업 오류가 발생했습니다."}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void onRepeatFailed(job)}
                    disabled={pendingFailedAction}
                  >
                    {pendingFailedAction ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Play />
                    )}
                    재시도
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void onCopyDiagnostics(job)}
                  >
                    <ClipboardCopy />
                    진단 복사
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="grid min-h-[520px] gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <Card className="flex min-h-[520px] flex-col overflow-hidden">
                <div className="relative min-h-[420px] flex-1">
                  {detailLoading ? (
                    <div className="absolute inset-0 grid place-items-center bg-black/35">
                      <LoaderCircle className="size-6 animate-spin text-pink-300" />
                    </div>
                  ) : output ? (
                    <ZoomableImageViewer
                      src={outputUrl(output.url ?? output.id)}
                      alt="생성 결과 상세"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center bg-black/30 text-muted-foreground panel-grid">
                      <ImageIcon className="size-8" />
                    </div>
                  )}
                </div>
                {job.outputs.length > 1 ? (
                  <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-border p-2">
                    {job.outputs.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => onOutputChange(item.id)}
                        aria-pressed={output?.id === item.id}
                        className={cn(
                          "relative aspect-square w-16 shrink-0 overflow-hidden rounded-md border border-border outline-none transition hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring",
                          output?.id === item.id &&
                            "border-primary/60 ring-2 ring-primary/20",
                        )}
                      >
                        <Image
                          src={outputUrl(item.url ?? item.id)}
                          alt={`${item.kind} 결과로 전환`}
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
                    <CardTitle>생성 설정</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <CalendarDays className="size-3.5" />
                        생성 시각
                      </span>
                      <span>{formatDate(job.createdAt)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Settings2 className="size-3.5" />
                        크기
                      </span>
                      <span className="tabular-nums">
                        {job.settings.sampling.width} ×{" "}
                        {job.settings.sampling.height}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Sparkles className="size-3.5" />
                        Seed
                      </span>
                      <span className="max-w-40 truncate font-mono">
                        {job.settings.sampling.seed}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Layers3 className="size-3.5" />
                        Model
                      </span>
                      <span className="max-w-44 truncate">
                        {job.settings.models.diffusion || "—"}
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
                      {job.settings.prompts.positive || "—"}
                    </p>
                    {job.settings.prompts.negative ? (
                      <>
                        <Divider />
                        <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                          {job.settings.prompts.negative}
                        </p>
                      </>
                    ) : null}
                  </CardContent>
                </Card>

                {job.autoTags?.length ? (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle>자동 태그</CardTitle>
                    </CardHeader>
                    <CardContent className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                      {job.autoTags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center overflow-hidden rounded-full border border-border bg-secondary/70 text-xs text-secondary-foreground"
                        >
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 px-2 py-1.5 transition hover:bg-primary/10 hover:text-pink-200"
                            onClick={() =>
                              onLoadWithAutoTag(job, tag, "positive")
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
                              onLoadWithAutoTag(job, tag, "exclude")
                            }
                            aria-label={`${tag} 태그를 제외 목록에 추가`}
                          >
                            <MinusCircle className="size-2.5" />
                          </button>
                        </span>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}

                {job.settings.referenceAssets.length ? (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle>참조 이미지</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-4 gap-2">
                      {job.settings.referenceAssets.map((asset) => (
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface HistoryViewProps {
  onLoadSettings: (settings: GenerationDraft) => void;
  onTrackJob: (job: StudioJob) => void;
  onRepeatJob: (job: StudioJob) => Promise<void>;
  onNewSeedJob: (job: StudioJob) => Promise<void>;
  onEditJobPrompt: (job: StudioJob) => void;
  activeJob?: StudioJob | null;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

export function HistoryView({
  onLoadSettings,
  onTrackJob,
  onRepeatJob,
  onNewSeedJob,
  onEditJobPrompt,
  activeJob,
  mobileOpen,
  onMobileOpenChange,
}: HistoryViewProps) {
  const [jobs, setJobs] = React.useState<StudioJob[]>([]);
  const [nextCursor, setNextCursor] = React.useState("");
  const [selected, setSelected] = React.useState<StudioJob | null>(null);
  const [activeOutputId, setActiveOutputId] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState("");
  const [actionNotice, setActionNotice] = React.useState("");
  const [pendingFailedAction, setPendingFailedAction] = React.useState("");
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [comparison, setComparison] = React.useState<ComparisonItem[]>([]);
  const listRequest = React.useRef(0);
  const detailRequest = React.useRef(0);
  const activeJobRef = React.useRef(activeJob);

  React.useEffect(() => {
    activeJobRef.current = activeJob;
    if (!activeJob) return;
    setJobs((current) => {
      if (status && activeJob.status !== status) {
        return current.filter((job) => job.id !== activeJob.id);
      }
      return mergeJobs(current, [activeJob]);
    });
    setSelected((current) =>
      current?.id === activeJob.id ? activeJob : current,
    );
  }, [activeJob, status]);

  const load = React.useCallback(
    async (cursor = "") => {
      const requestId = ++listRequest.current;
      setError("");
      if (cursor) setLoadingMore(true);
      else {
        setLoading(true);
      }
      try {
        const result = await getJobs({
          ...(status ? { status } : {}),
          ...(cursor ? { cursor } : {}),
        });
        if (requestId !== listRequest.current) return;
        const currentActive = activeJobRef.current;
        const incoming =
          currentActive && (!status || currentActive.status === status)
            ? mergeJobs(result.jobs, [currentActive])
            : result.jobs;
        setJobs((current) =>
          cursor ? mergeJobs(current, incoming) : incoming,
        );
        setNextCursor(result.nextCursor ?? "");
      } catch (requestError) {
        if (requestId !== listRequest.current) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "히스토리를 불러오지 못했습니다.",
        );
      } finally {
        if (requestId === listRequest.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [status],
  );

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

  async function openJob(job: StudioJob) {
    const requestId = ++detailRequest.current;
    onMobileOpenChange(false);
    setSelected(job);
    setActiveOutputId(preferredOutput(job)?.id ?? "");
    setActionError("");
    setActionNotice("");
    setDetailLoading(true);
    try {
      const detailed = await getJob(job.id);
      if (requestId !== detailRequest.current) return;
      setSelected(detailed);
      setActiveOutputId((current) =>
        detailed.outputs.some((item) => item.id === current)
          ? current
          : (preferredOutput(detailed)?.id ?? ""),
      );
      setJobs((current) => mergeJobs(current, [detailed]));
    } catch {
      // Keep the useful list snapshot when the detail refresh fails.
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false);
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
      setJobs((current) => mergeJobs(current, [nextJob]));
      setActionNotice("업스케일 작업을 시작했습니다.");
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
      setActionNotice("같은 설정으로 작업을 다시 시작했습니다.");
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
        ...structuredClone(settings),
        prompts: { ...settings.prompts, positive },
      });
      setSelected(null);
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
      ...structuredClone(settings),
      tagging: { ...settings.tagging, excludeTags },
    });
    setSelected(null);
  }

  const railProps: HistoryRailContentProps = {
    jobs: filtered,
    loading,
    loadingMore,
    error,
    query,
    status,
    hasMore: Boolean(nextCursor),
    onQueryChange: setQuery,
    onStatusChange: setStatus,
    onRefresh: () => void load(),
    onLoadMore: () => void load(nextCursor),
    onOpenJob: (job) => void openJob(job),
  };

  return (
    <>
      <aside className="glass-surface fixed inset-y-0 left-0 z-40 hidden w-80 border-r border-border xl:block">
        <HistoryRailContent {...railProps} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent
          side="left"
          className="w-[min(100vw,400px)] p-0 sm:max-w-[400px] xl:hidden"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>History</SheetTitle>
            <SheetDescription>
              생성 결과를 선택해 상세 화면을 엽니다.
            </SheetDescription>
          </SheetHeader>
          <HistoryRailContent {...railProps} />
        </SheetContent>
      </Sheet>

      <HistoryDetailDialog
        job={selected}
        detailLoading={detailLoading}
        activeOutputId={activeOutputId}
        comparison={comparison}
        actionError={actionError}
        actionNotice={actionNotice}
        pendingFailedAction={pendingFailedAction === selected?.id}
        onOpenChange={(open) => {
          if (!open) {
            detailRequest.current += 1;
            setSelected(null);
            setDetailLoading(false);
          }
        }}
        onOutputChange={setActiveOutputId}
        onComparisonChange={setComparison}
        onLoadSettings={onLoadSettings}
        onRepeatJob={onRepeatJob}
        onNewSeedJob={onNewSeedJob}
        onEditJobPrompt={onEditJobPrompt}
        onUpscale={handleUpscale}
        onRepeatFailed={repeatFailedJob}
        onCopyDiagnostics={copyDiagnostics}
        onLoadWithAutoTag={loadWithAutoTag}
      />
    </>
  );
}

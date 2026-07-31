"use client";

import * as React from "react";
import Image from "next/image";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCopy,
  Clock3,
  Copy,
  Dices,
  Download,
  ImageIcon,
  Layers3,
  LoaderCircle,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { ZoomableImageViewer } from "@/components/zoomable-image-viewer";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { deleteJob, getJob, getJobs, upscaleJob } from "@/lib/api";
import type {
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

function ThumbnailStatusBadge({ status }: { status: JobStatus }) {
  const tone =
    status === "completed"
      ? "border-emerald-300/25 bg-emerald-950/70 text-emerald-200"
      : status === "failed"
        ? "border-red-300/25 bg-red-950/70 text-red-200"
        : status === "running" ||
            status === "queued" ||
            status === "uploading"
          ? "border-amber-300/25 bg-amber-950/70 text-amber-200"
          : "border-white/15 bg-black/60 text-white/75";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold leading-none shadow-sm backdrop-blur-md",
        tone,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full bg-current",
          ["running", "queued", "uploading"].includes(status) &&
            "animate-pulse",
        )}
      />
      {statusLabels[status]}
    </span>
  );
}

function preferredOutput(job: StudioJob) {
  return (
    job.outputs.find(
      (item) => item.kind === "upscale" || item.kind === "upscaled",
    ) ?? job.outputs[0]
  );
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
          className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.025]"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_42%,hsl(var(--surface-2)),transparent_66%)] text-muted-foreground">
          <div className="flex -translate-y-2 flex-col items-center gap-2.5">
            <span
              className={cn(
                "grid size-10 place-items-center rounded-full border bg-background/55 shadow-inner backdrop-blur-sm",
                job.status === "failed"
                  ? "border-red-300/20 text-red-300"
                  : "border-white/10",
              )}
            >
              {["running", "queued", "uploading"].includes(job.status) ? (
                <LoaderCircle className="size-5 animate-spin text-pink-300" />
              ) : job.status === "failed" ? (
                <XCircle className="size-5" />
              ) : (
                <ImageIcon className="size-5" />
              )}
            </span>
            <span className="text-[10px] font-medium text-foreground/60">
              {job.status === "failed"
                ? "생성하지 못했어요"
                : ["running", "queued", "uploading"].includes(job.status)
                  ? "이미지 준비 중"
                  : "미리보기 없음"}
            </span>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/[0.06]" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent px-2.5 pb-2.5 pt-12">
        <p className="line-clamp-2 text-[10px] font-medium leading-[1.35] text-white/95 drop-shadow-sm">
          {job.settings.prompts.positive || "프롬프트 없음"}
        </p>
      </div>
      {job.status !== "completed" ? (
        <div className="absolute left-2 top-2">
          <ThumbnailStatusBadge status={job.status} />
        </div>
      ) : null}
    </div>
  );
}

interface HistoryRailContentProps {
  jobs: StudioJob[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  query: string;
  hasMore: boolean;
  selectionMode: boolean;
  selectedJobIds: ReadonlySet<string>;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onOpenJob: (job: StudioJob) => void;
  onSelectionModeChange: (active: boolean) => void;
  onToggleSelection: (job: StudioJob) => void;
  onDeleteSelected: () => void;
}

const HISTORY_LOAD_MORE_THRESHOLD_PX = 240;

function HistoryRailContent({
  jobs,
  loading,
  loadingMore,
  error,
  query,
  hasMore,
  selectionMode,
  selectedJobIds,
  onQueryChange,
  onRefresh,
  onLoadMore,
  onOpenJob,
  onSelectionModeChange,
  onToggleSelection,
  onDeleteSelected,
}: HistoryRailContentProps) {
  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    if (loading || loadingMore || !hasMore) return;

    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    const remainingScroll = scrollHeight - scrollTop - clientHeight;
    if (scrollTop > 0 && remainingScroll <= HISTORY_LOAD_MORE_THRESHOLD_PX) {
      onLoadMore();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background/95">
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="fixed bottom-3 left-3 z-10 size-10 rounded-full bg-background shadow-lg sm:bottom-4 sm:left-4"
        disabled={loading}
        onClick={onRefresh}
        aria-label="히스토리 새로고침"
        title="히스토리 새로고침"
      >
        <RefreshCw className={cn("size-4", loading && "animate-spin")} />
      </Button>

      <div className="shrink-0 border-b border-border p-3">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              className="h-9 pl-8 text-xs"
              placeholder="프롬프트, 모델, 시드"
              aria-label="히스토리 검색"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant={selectionMode ? "secondary" : "outline"}
            className="h-9 shrink-0 px-3 text-xs"
            onClick={() => onSelectionModeChange(!selectionMode)}
          >
            {selectionMode ? "취소" : "선택"}
          </Button>
        </div>
        {selectionMode ? (
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              {selectedJobIds.size}개 선택
            </span>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-8 px-2.5 text-[11px]"
              disabled={selectedJobIds.size === 0}
              onClick={onDeleteSelected}
            >
              <Trash2 />
              선택 삭제
            </Button>
          </div>
        ) : null}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-3 pb-16"
        onScroll={handleScroll}
      >
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
            <div className="grid grid-cols-2 gap-3">
              {jobs.map((job, index) => {
                const selected = selectedJobIds.has(job.id);
                const selectionEligible = [
                  "completed",
                  "failed",
                  "cancelled",
                ].includes(job.status);
                return (
                  <button
                    type="button"
                    key={job.id}
                    className={cn(
                      "group relative min-w-0 overflow-hidden rounded-xl border border-white/[0.09] bg-card/80 text-left shadow-[0_8px_24px_-18px_rgba(0,0,0,0.9)] outline-none transition-[border-color,box-shadow,opacity] duration-200 hover:border-primary/40 hover:shadow-[0_12px_30px_-16px_hsl(var(--primary)/0.28)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      selected && "border-primary/70 ring-2 ring-primary/30",
                      selectionMode &&
                        !selectionEligible &&
                        "cursor-not-allowed opacity-45",
                    )}
                    onClick={() =>
                      selectionMode
                        ? selectionEligible && onToggleSelection(job)
                        : onOpenJob(job)
                    }
                    aria-pressed={selectionMode ? selected : undefined}
                    aria-disabled={selectionMode && !selectionEligible}
                    aria-label={
                      selectionMode
                        ? `${formatDate(job.createdAt)} 생성 기록 ${selected ? "선택 해제" : "선택"}`
                        : `${formatDate(job.createdAt)} 생성 결과 상세 열기`
                    }
                  >
                    <JobThumbnail job={job} priority={index < 2} />
                    {selectionMode && selectionEligible ? (
                      <span
                        className={cn(
                          "absolute right-2 top-2 grid size-6 place-items-center rounded-full border bg-black/65 text-white/70 backdrop-blur-sm",
                          selected &&
                            "border-primary bg-primary text-primary-foreground",
                        )}
                        aria-hidden="true"
                      >
                        <CheckCircle2 className="size-4" />
                      </span>
                    ) : null}
                    <span className="flex items-center gap-1.5 border-t border-white/[0.05] px-2.5 py-2.5 text-[10px] text-muted-foreground transition-colors group-hover:text-foreground/70">
                      <Clock3 className="size-3 shrink-0 text-muted-foreground/75" />
                      <span className="truncate">
                        {formatDate(job.createdAt)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {loadingMore ? (
              <div
                className="flex items-center justify-center gap-2 py-4 text-[10px] text-muted-foreground"
                role="status"
              >
                <LoaderCircle className="size-4 animate-spin" />
                추가 기록 불러오는 중
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card px-3 py-12 text-center">
            <ImageIcon className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-3 text-xs font-medium">
              {query ? "검색 결과가 없습니다." : "아직 결과가 없습니다."}
            </p>
            {!query ? (
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
  actionError: string;
  actionNotice: string;
  pendingFailedAction: boolean;
  deleting: boolean;
  onOpenChange: (open: boolean) => void;
  onOutputChange: (id: string) => void;
  onLoadSettings: (settings: GenerationDraft) => void;
  onLoadSeed: (seed: number) => void;
  onUpscale: (job: StudioJob) => Promise<void>;
  onRepeatFailed: (job: StudioJob) => Promise<void>;
  onCopyDiagnostics: (job: StudioJob) => Promise<void>;
  onDelete: (job: StudioJob) => Promise<boolean>;
}

function HistoryDetailDialog({
  job,
  detailLoading,
  activeOutputId,
  actionError,
  actionNotice,
  pendingFailedAction,
  deleting,
  onOpenChange,
  onOutputChange,
  onLoadSettings,
  onLoadSeed,
  onUpscale,
  onRepeatFailed,
  onCopyDiagnostics,
  onDelete,
}: HistoryDetailDialogProps) {
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  React.useEffect(() => {
    setDeleteOpen(false);
  }, [job?.id]);

  if (!job) return null;

  const output =
    job.outputs.find((item) => item.id === activeOutputId) ??
    preferredOutput(job);
  const canUpscale =
    job.status === "completed" &&
    job.settings.upscale.enabled === false &&
    job.outputs.some((item) => item.kind === "base") &&
    !job.outputs.some(
      (item) => item.kind === "upscale" || item.kind === "upscaled",
    );
  const canDelete = ["completed", "failed", "cancelled"].includes(
    job.status,
  );

  const restoreSettings = () => {
    onLoadSettings(structuredClone(job.settings));
    onOpenChange(false);
  };

  const restoreSeed = () => {
    onLoadSeed(job.settings.sampling.seed);
    onOpenChange(false);
  };

  return (
    <>
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
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="gap-1 px-2 text-[11px]"
                onClick={restoreSettings}
              >
                <Copy />
                설정 불러오기
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1 px-2 text-[11px]"
                onClick={restoreSeed}
              >
                <Dices />
                시드 불러오기
              </Button>
              {canUpscale ? (
                <Button
                  type="button"
                  size="sm"
                  variant="soft"
                  className="gap-1 px-2 text-[11px]"
                  onClick={() => void onUpscale(job)}
                >
                  <Maximize2 />
                  업스케일
                </Button>
              ) : null}
            </div>
            {output ? (
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
            ) : null}
            {canDelete ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto gap-1 px-2 text-[11px] text-red-300 hover:text-red-200"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 />
                기록 삭제
              </Button>
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

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 sm:p-5 lg:overflow-hidden">
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

            <div className="grid min-h-[520px] gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
              <Card className="flex min-h-[520px] flex-col overflow-hidden lg:min-h-0">
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

              <div className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
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
    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <AlertDialogContent className="max-w-md border-destructive/30">
        <AlertDialogHeader>
          <AlertDialogTitle>이 생성 기록을 삭제할까요?</AlertDialogTitle>
          <AlertDialogDescription>
            생성 기록과 저장된 결과 이미지가 함께 삭제되며 되돌릴 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={deleting}
            onClick={() => {
              void onDelete(job).then(() => setDeleteOpen(false));
            }}
          >
            {deleting ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
            {deleting ? "삭제 중" : "삭제"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

interface HistoryViewProps {
  onLoadSettings: (settings: GenerationDraft) => void;
  onLoadSeed: (seed: number) => void;
  onTrackJob: (job: StudioJob) => void;
  onRepeatJob: (job: StudioJob) => Promise<void>;
  onDeleteJob: (jobId: string) => void;
  activeJob?: StudioJob | null;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  desktopCollapsed: boolean;
  onDesktopCollapsedChange: (collapsed: boolean) => void;
  detailRequest?: {
    id: number;
    job: StudioJob;
    outputId?: string;
  } | null;
}

export function HistoryView({
  onLoadSettings,
  onLoadSeed,
  onTrackJob,
  onRepeatJob,
  onDeleteJob,
  activeJob,
  mobileOpen,
  onMobileOpenChange,
  desktopCollapsed,
  onDesktopCollapsedChange,
  detailRequest,
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
  const [deletingJobId, setDeletingJobId] = React.useState("");
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectedJobIds, setSelectedJobIds] = React.useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [bulkDeleting, setBulkDeleting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const listRequest = React.useRef(0);
  const loadingMoreRequest = React.useRef(false);
  const detailFetchRequest = React.useRef(0);
  const handledDetailRequest = React.useRef(0);
  const activeJobRef = React.useRef(activeJob);
  const selectedJobIdSet = React.useMemo(
    () => new Set(selectedJobIds),
    [selectedJobIds],
  );

  React.useEffect(() => {
    activeJobRef.current = activeJob;
    if (!activeJob) return;
    setJobs((current) => mergeJobs(current, [activeJob]));
    setSelected((current) =>
      current?.id === activeJob.id ? activeJob : current,
    );
  }, [activeJob]);

  const load = React.useCallback(
    async (cursor = "") => {
      if (cursor && loadingMoreRequest.current) return;

      const requestId = ++listRequest.current;
      setError("");
      if (cursor) {
        loadingMoreRequest.current = true;
        setLoadingMore(true);
      }
      else {
        loadingMoreRequest.current = false;
        setLoadingMore(false);
        setLoading(true);
      }
      try {
        const result = await getJobs({
          ...(cursor ? { cursor } : {}),
        });
        if (requestId !== listRequest.current) return;
        const currentActive = activeJobRef.current;
        const incoming =
          currentActive
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
        if (cursor) loadingMoreRequest.current = false;
        if (requestId === listRequest.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [],
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

  const openJob = React.useCallback(
    async (job: StudioJob, requestedOutputId?: string) => {
      const requestId = ++detailFetchRequest.current;
      onMobileOpenChange(false);
      setSelected(job);
      setActiveOutputId(
        requestedOutputId &&
          job.outputs.some((item) => item.id === requestedOutputId)
          ? requestedOutputId
          : (preferredOutput(job)?.id ?? ""),
      );
      setActionError("");
      setActionNotice("");
      setDetailLoading(true);
      try {
        const detailed = await getJob(job.id);
        if (requestId !== detailFetchRequest.current) return;
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
        if (requestId === detailFetchRequest.current) setDetailLoading(false);
      }
    },
    [onMobileOpenChange],
  );

  React.useEffect(() => {
    if (
      !detailRequest ||
      handledDetailRequest.current === detailRequest.id
    ) {
      return;
    }
    handledDetailRequest.current = detailRequest.id;
    void openJob(detailRequest.job, detailRequest.outputId);
  }, [detailRequest, openJob]);

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

  async function handleDeleteJob(job: StudioJob): Promise<boolean> {
    setDeletingJobId(job.id);
    setActionError("");
    setActionNotice("");
    try {
      await deleteJob(job.id);
      setJobs((current) => current.filter((item) => item.id !== job.id));
      onDeleteJob(job.id);
      setSelected(null);
      return true;
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "생성 기록을 삭제하지 못했습니다.",
      );
      return false;
    } finally {
      setDeletingJobId("");
    }
  }

  function changeSelectionMode(active: boolean) {
    setSelectionMode(active);
    if (!active) setSelectedJobIds([]);
  }

  function toggleJobSelection(job: StudioJob) {
    setSelectedJobIds((current) =>
      current.includes(job.id)
        ? current.filter((id) => id !== job.id)
        : [...current, job.id],
    );
  }

  async function deleteSelectedJobs() {
    const selectedJobs = jobs.filter((job) => selectedJobIdSet.has(job.id));
    const selectedById = new Map(selectedJobs.map((job) => [job.id, job]));
    const lineageDepth = (job: StudioJob) => {
      let depth = 0;
      let parentId = job.parentJobId;
      const visited = new Set<string>();
      while (parentId && selectedById.has(parentId) && !visited.has(parentId)) {
        visited.add(parentId);
        depth += 1;
        parentId = selectedById.get(parentId)?.parentJobId;
      }
      return depth;
    };
    selectedJobs.sort(
      (left, right) =>
        lineageDepth(right) - lineageDepth(left) ||
        new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
    );

    setBulkDeleting(true);
    setError("");
    const deletedIds: string[] = [];
    const failedIds: string[] = [];
    for (const job of selectedJobs) {
      try {
        await deleteJob(job.id);
        deletedIds.push(job.id);
        onDeleteJob(job.id);
      } catch {
        failedIds.push(job.id);
      }
    }

    setJobs((current) =>
      current.filter((job) => !deletedIds.includes(job.id)),
    );
    setSelectedJobIds(failedIds);
    setBulkDeleting(false);
    setBulkDeleteOpen(false);
    if (failedIds.length > 0) {
      setError(
        `${deletedIds.length}개를 삭제했고 ${failedIds.length}개는 삭제하지 못했습니다.`,
      );
    } else {
      setSelectionMode(false);
    }
  }

  const railProps: HistoryRailContentProps = {
    jobs: filtered,
    loading,
    loadingMore,
    error,
    query,
    hasMore: Boolean(nextCursor),
    selectionMode,
    selectedJobIds: selectedJobIdSet,
    onQueryChange: setQuery,
    onRefresh: () => void load(),
    onLoadMore: () => void load(nextCursor),
    onOpenJob: (job) => void openJob(job),
    onSelectionModeChange: changeSelectionMode,
    onToggleSelection: toggleJobSelection,
    onDeleteSelected: () => setBulkDeleteOpen(true),
  };

  return (
    <>
      <aside
        className={cn(
          "glass-surface fixed inset-y-0 left-0 z-40 hidden w-80 border-r border-border transition-transform duration-200 xl:block",
          desktopCollapsed && "-translate-x-full",
        )}
      >
        <HistoryRailContent {...railProps} />
      </aside>

      <Button
        type="button"
        size="icon"
        variant="outline"
        className={cn(
          "fixed bottom-4 z-40 hidden size-10 rounded-full bg-background shadow-lg transition-[left] duration-200 xl:inline-flex",
          desktopCollapsed ? "left-4" : "left-16",
        )}
        onClick={() => onDesktopCollapsedChange(!desktopCollapsed)}
        aria-label={
          desktopCollapsed ? "히스토리 사이드바 펼치기" : "히스토리 사이드바 접기"
        }
        title={desktopCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
      >
        {desktopCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      </Button>

      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent
          side="left"
          className="w-[min(100vw,400px)] p-0 [&>button]:bottom-3 [&>button]:right-3 [&>button]:top-auto [&>button]:z-20 sm:max-w-[400px] sm:[&>button]:bottom-4 sm:[&>button]:right-4 xl:hidden"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>생성 기록</SheetTitle>
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
        actionError={actionError}
        actionNotice={actionNotice}
        pendingFailedAction={pendingFailedAction === selected?.id}
        deleting={deletingJobId === selected?.id}
        onOpenChange={(open) => {
          if (!open) {
            detailFetchRequest.current += 1;
            setSelected(null);
            setDetailLoading(false);
          }
        }}
        onOutputChange={setActiveOutputId}
        onLoadSettings={onLoadSettings}
        onLoadSeed={onLoadSeed}
        onUpscale={handleUpscale}
        onRepeatFailed={repeatFailedJob}
        onCopyDiagnostics={copyDiagnostics}
        onDelete={handleDeleteJob}
      />

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent className="max-w-md border-destructive/30">
          <AlertDialogHeader>
            <AlertDialogTitle>
              선택한 기록 {selectedJobIds.length}개를 삭제할까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              선택한 생성 기록과 저장된 결과 이미지가 함께 삭제되며 되돌릴 수
              없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>취소</AlertDialogCancel>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={bulkDeleting}
              onClick={() => void deleteSelectedJobs()}
            >
              {bulkDeleting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              {bulkDeleting ? "삭제 중" : "모두 삭제"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

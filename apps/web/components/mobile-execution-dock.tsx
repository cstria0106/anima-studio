"use client";

import * as React from "react";
import Image from "next/image";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  ImageIcon,
  LoaderCircle,
  Play,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cancelJob } from "@/lib/api";
import type { PreflightIssue } from "@/lib/studio-ux";
import type { HealthResponse, JobStatus, StudioJob } from "@/lib/types";
import { cn, formatElapsed, outputUrl } from "@/lib/utils";

const ACTIVE_JOB_STATUSES: JobStatus[] = ["uploading", "queued", "running"];

const STAGE_LABELS: Record<string, string> = {
  preparing: "실행 준비",
  uploading: "참조 이미지 업로드",
  queued: "ComfyUI 대기열",
  loading_models: "모델 로딩",
  loading: "모델 로딩",
  training: "참조 LoRA 학습",
  encoding: "프롬프트 인코딩",
  sampling: "기본 이미지 샘플링",
  upscaling: "업스케일 샘플링",
  saving: "결과 저장",
  completed: "생성 완료",
  failed: "생성 실패",
  cancelled: "취소됨",
};

const STATUS_LABELS: Record<JobStatus, string> = {
  draft: "초안",
  uploading: "업로드 중",
  queued: "대기 중",
  running: "생성 중",
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
};

export interface MobileExecutionDockProps {
  job: StudioJob | null;
  health: HealthResponse | null;
  canGenerate: boolean;
  validationMessage?: string;
  submitting: boolean;
  onGenerate: () => void;
  onJobUpdate: (job: StudioJob) => void;
  preflightIssues?: PreflightIssue[];
  onResolveIssue?: (issue: PreflightIssue) => void;
}

export function MobileExecutionDock({
  job,
  health,
  canGenerate,
  validationMessage,
  submitting,
  onGenerate,
  onJobUpdate,
  preflightIssues = [],
  onResolveIssue,
}: MobileExecutionDockProps) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [actionError, setActionError] = React.useState("");
  const [selectedOutputId, setSelectedOutputId] = React.useState<string | null>(
    null,
  );
  const [now, setNow] = React.useState(() => Date.now());

  const active = Boolean(job && ACTIVE_JOB_STATUSES.includes(job.status));
  const connected = Boolean(
    health?.comfyui || (health?.ok && health.comfyui !== false),
  );
  const selectedOutput =
    job?.outputs.find((output) => output.id === selectedOutputId) ??
    job?.outputs.find((output) => output.kind === "upscale") ??
    job?.outputs[0];
  const preview = active ? job?.preview : undefined;
  const stageLabel = job
    ? (STAGE_LABELS[job.stage ?? ""] ?? STATUS_LABELS[job.status])
    : canGenerate
      ? "생성 준비 완료"
      : connected
        ? "설정을 확인해 주세요"
        : "ComfyUI 오프라인";
  const elapsed = job
    ? job.elapsedMs ??
      (job.startedAt
        ? (job.completedAt ? new Date(job.completedAt).getTime() : now) -
          new Date(job.startedAt).getTime()
        : 0)
    : 0;

  React.useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);

  React.useEffect(() => {
    if (!job?.outputs.length) {
      setSelectedOutputId(null);
      return;
    }
    if (!job.outputs.some((output) => output.id === selectedOutputId)) {
      setSelectedOutputId(
        job.outputs.find((output) => output.kind === "upscale")?.id ??
          job.outputs[0].id,
      );
    }
  }, [job?.outputs, selectedOutputId]);

  React.useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setSheetOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  async function handleCancel() {
    if (!job || !active || cancelling) return;
    setCancelling(true);
    setActionError("");
    try {
      onJobUpdate(await cancelJob(job.id));
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "작업을 취소하지 못했습니다.",
      );
      setSheetOpen(true);
    } finally {
      setCancelling(false);
    }
  }

  function resolveIssue(issue: PreflightIssue) {
    setSheetOpen(false);
    window.setTimeout(() => onResolveIssue?.(issue), 220);
  }

  const statusTone =
    job?.status === "failed"
      ? "bg-danger"
      : job?.status === "completed"
        ? "bg-success"
        : active
          ? "bg-warning"
          : connected
            ? "bg-success"
            : "bg-danger";

  return (
    <>
      <div
        aria-hidden
        className="h-[calc(5.5rem+env(safe-area-inset-bottom))] 2xl:hidden"
      />

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <div className="fixed inset-x-0 bottom-0 z-40 2xl:hidden">
          <div className="glass-surface border-t border-border/80 px-3 pt-2 shadow-dialog">
            <div className="mx-auto flex max-w-3xl items-center gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2.5 text-left outline-none transition-colors duration-[120ms] hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${stageLabel}. 진행 미리보기 열기`}
                >
                  <span className="relative grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2">
                    <span
                      className={cn(
                        "absolute right-1 top-1 size-2 rounded-full",
                        statusTone,
                      )}
                    />
                    {active ? (
                      <LoaderCircle className="size-4 animate-spin text-primary" />
                    ) : job?.status === "completed" ? (
                      <CheckCircle2 className="size-4 text-success" />
                    ) : (
                      <ImageIcon className="size-4 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {stageLabel}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {active && typeof job?.progress === "number"
                        ? `${Math.round(job.progress)}% · 탭하여 미리보기`
                        : "상세 보기"}
                    </span>
                  </span>
                </button>
              </SheetTrigger>

              {active ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 min-w-[6.5rem] border-danger/35 text-danger hover:bg-danger/10 hover:text-danger"
                  disabled={cancelling}
                  onClick={handleCancel}
                >
                  {cancelling ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Ban />
                  )}
                  취소
                </Button>
              ) : (
                <Button
                  type="button"
                  className="h-11 min-w-[7.25rem]"
                  disabled={!canGenerate || submitting}
                  onClick={onGenerate}
                >
                  {submitting ? (
                    <LoaderCircle className="animate-spin" />
                  ) : job ? (
                    <RotateCcw />
                  ) : (
                    <Play />
                  )}
                  {job ? "다시 생성" : "생성"}
                </Button>
              )}
            </div>
          </div>
        </div>

        <SheetContent
          side="bottom"
          className="flex max-h-[88dvh] flex-col overflow-hidden rounded-t-xl p-0 2xl:hidden"
        >
          <SheetHeader className="shrink-0 border-b border-border px-4 pb-3 pt-4 pr-14">
            <div className="flex items-center gap-2">
              <span className={cn("size-2 rounded-full", statusTone)} />
              <SheetTitle>{stageLabel}</SheetTitle>
              {job ? (
                <Badge
                  variant={
                    job.status === "completed"
                      ? "success"
                      : job.status === "failed"
                        ? "destructive"
                        : active
                          ? "warning"
                          : "secondary"
                  }
                >
                  {STATUS_LABELS[job.status]}
                </Badge>
              ) : null}
            </div>
            <SheetDescription className="sr-only">
              생성 작업 상태
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="relative mx-3 mt-3 aspect-[4/5] max-h-[48dvh] overflow-hidden rounded-xl border border-border bg-surface-2">
              {preview ? (
                <>
                  <Image
                    key={`${preview.url}:${preview.revision ?? preview.updatedAt ?? ""}`}
                    src={outputUrl(preview.url)}
                    alt="현재 이미지 생성 과정"
                    fill
                    unoptimized
                    priority
                    sizes="100vw"
                    className="object-contain"
                  />
                  {typeof preview.step === "number" &&
                  typeof preview.total === "number" ? (
                    <div className="absolute right-3 top-3 flex min-h-11 items-center rounded-lg border border-white/10 bg-black/65 px-3 text-xs text-white/90 backdrop-blur">
                      <span className="tabular-nums">
                        {preview.step} / {preview.total}
                      </span>
                    </div>
                  ) : null}
                </>
              ) : selectedOutput ? (
                <Image
                  src={outputUrl(selectedOutput.url ?? selectedOutput.id)}
                  alt={`${selectedOutput.kind} 생성 결과`}
                  fill
                  unoptimized
                  priority
                  sizes="100vw"
                  className="object-contain"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center px-8 text-center">
                  <div>
                    {active ? (
                      <LoaderCircle className="mx-auto size-8 animate-spin text-primary" />
                    ) : (
                      <ImageIcon className="mx-auto size-8 text-muted-foreground" />
                    )}
                    <p className="mt-3 text-sm font-medium">
                      {active ? "미리보기 준비 중" : "아직 생성 결과가 없습니다"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {job?.outputs.length && job.outputs.length > 1 ? (
              <div
                className="mx-3 mt-2 flex gap-1 rounded-lg bg-surface-2 p-1"
                aria-label="결과 선택"
              >
                {job.outputs.map((output) => (
                  <Button
                    key={output.id}
                    type="button"
                    variant={
                      output.id === selectedOutput?.id ? "soft" : "ghost"
                    }
                    size="sm"
                    className="min-h-11 flex-1"
                    onClick={() => setSelectedOutputId(output.id)}
                  >
                    {output.kind === "upscale" ||
                    output.kind === "upscaled"
                      ? "업스케일"
                      : "기본"}
                  </Button>
                ))}
              </div>
            ) : null}

            <div className="space-y-4 p-4">
              {active && job ? (
                <section className="space-y-2" aria-label="작업 진행률">
                  <Progress value={job.progress} />
                  <div
                    className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
                    aria-live="polite"
                  >
                    <span>
                      {typeof job.progress === "number"
                        ? `${Math.round(job.progress)}%`
                        : "활동 중"}
                    </span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Clock3 className="size-3.5" />
                      {formatElapsed(elapsed)}
                    </span>
                  </div>
                  {job.status === "queued" &&
                  job.queuePosition !== undefined ? (
                    <p className="rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2 text-xs text-warning">
                      대기열 {job.queuePosition}번째
                    </p>
                  ) : null}
                </section>
              ) : null}

              {job?.status === "failed" ? (
                <div
                  role="alert"
                  className="flex gap-2 rounded-lg border border-danger/25 bg-danger/[0.06] p-3 text-xs leading-5 text-danger"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>{job.error ?? "ComfyUI 작업이 실패했습니다."}</span>
                </div>
              ) : null}

              {actionError ? (
                <p
                  role="alert"
                  className="rounded-lg border border-danger/25 bg-danger/[0.06] p-3 text-xs leading-5 text-danger"
                >
                  {actionError}
                </p>
              ) : null}

              {selectedOutput ? (
                <section className="space-y-3" aria-label="결과 상세">
                  <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-surface-2 p-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">크기</p>
                      <p className="mt-1 font-medium tabular-nums">
                        {selectedOutput.width && selectedOutput.height
                          ? `${selectedOutput.width}×${selectedOutput.height}`
                          : `${job?.settings.sampling.width}×${job?.settings.sampling.height}`}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">시드</p>
                      <p className="mt-1 truncate font-medium tabular-nums">
                        {job?.settings.sampling.seed ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">종류</p>
                      <p className="mt-1 font-medium">
                        {selectedOutput.kind === "upscale" ||
                        selectedOutput.kind === "upscaled"
                          ? "업스케일"
                          : "기본"}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="outline" className="min-h-11 flex-1">
                      <a
                        href={outputUrl(
                          selectedOutput.url ?? selectedOutput.id,
                        )}
                        download
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Download />
                        다운로드
                      </a>
                    </Button>
                    <Button asChild variant="ghost" size="icon">
                      <a
                        href={outputUrl(
                          selectedOutput.url ?? selectedOutput.id,
                        )}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="새 창에서 결과 열기"
                      >
                        <ExternalLink />
                      </a>
                    </Button>
                  </div>
                </section>
              ) : null}

              {!canGenerate && preflightIssues.length ? (
                <section className="space-y-2" aria-label="생성 전 확인 항목">
                  <p className="text-[13px] font-medium">생성 전 확인</p>
                  {preflightIssues.map((issue) => (
                    <button
                      key={`${issue.code}:${issue.fieldId ?? ""}`}
                      type="button"
                      className="flex min-h-11 w-full items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2.5 text-left text-xs leading-5 text-warning outline-none transition-colors duration-[120ms] hover:bg-warning/10 focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => resolveIssue(issue)}
                    >
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>{issue.message}</span>
                    </button>
                  ))}
                </section>
              ) : !canGenerate && validationMessage ? (
                <p className="text-xs leading-5 text-warning">
                  {validationMessage}
                </p>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-popover/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {active ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full border-danger/35 text-danger hover:bg-danger/10 hover:text-danger"
                disabled={cancelling}
                onClick={handleCancel}
              >
                {cancelling ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Ban />
                )}
                작업 취소
              </Button>
            ) : (
              <Button
                type="button"
                className="h-11 w-full"
                disabled={!canGenerate || submitting}
                onClick={() => {
                  setSheetOpen(false);
                  onGenerate();
                }}
              >
                {submitting ? (
                  <LoaderCircle className="animate-spin" />
                ) : job ? (
                  <RotateCcw />
                ) : (
                  <Play />
                )}
                생성
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

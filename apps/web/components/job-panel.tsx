"use client";

import * as React from "react";
import Image from "next/image";
import {
  AlertTriangle,
  Ban,
  Clock3,
  Download,
  ExternalLink,
  ImageIcon,
  LoaderCircle,
  PauseCircle,
  Play,
  RotateCcw,
  Server,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ResultActionBar } from "@/components/result-action-bar";
import { cancelJob, upscaleJob } from "@/lib/api";
import type {
  CapabilitiesResponse,
  JobStatus,
  StudioJob,
} from "@/lib/types";
import type { PreflightIssue } from "@/lib/studio-ux";
import { formatElapsed, outputUrl } from "@/lib/utils";
import { useJobTracker } from "@/components/use-job-tracker";

const stageLabels: Record<string, string> = {
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
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
};

const statusMeta: Record<
  JobStatus,
  { label: string; variant: "secondary" | "success" | "warning" | "destructive" }
> = {
  draft: { label: "초안", variant: "secondary" },
  uploading: { label: "업로드 중", variant: "warning" },
  queued: { label: "대기 중", variant: "warning" },
  running: { label: "생성 중", variant: "warning" },
  completed: { label: "완료", variant: "success" },
  failed: { label: "실패", variant: "destructive" },
  cancelled: { label: "취소", variant: "secondary" },
};

interface JobPanelProps {
  job: StudioJob | null;
  capabilities: CapabilitiesResponse | null;
  submitting: boolean;
  canGenerate: boolean;
  validationMessage?: string;
  preflightIssues?: PreflightIssue[];
  onResolveIssue?: (issue: PreflightIssue) => void;
  onGenerate: () => void;
  onJobUpdate: (job: StudioJob) => void;
  onLoadSettings: (job: StudioJob) => void;
  onLoadSeed: (job: StudioJob) => void;
  onOpenDetail: (job: StudioJob, outputId?: string) => void;
}

export function JobPanel({
  job,
  capabilities,
  submitting,
  canGenerate,
  validationMessage,
  preflightIssues = [],
  onResolveIssue,
  onGenerate,
  onJobUpdate,
  onLoadSettings,
  onLoadSeed,
  onOpenDetail,
}: JobPanelProps) {
  const latestEvent = useJobTracker(job, onJobUpdate);
  const [selectedOutputId, setSelectedOutputId] = React.useState<string | null>(
    null,
  );
  const [cancelling, setCancelling] = React.useState(false);
  const [actionError, setActionError] = React.useState("");
  const [now, setNow] = React.useState(Date.now());
  const jobStatus = job?.status;
  const jobOutputs = job?.outputs;

  React.useEffect(() => {
    if (!jobStatus || !["queued", "running", "uploading"].includes(jobStatus))
      return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [jobStatus]);

  React.useEffect(() => {
    if (!jobOutputs?.length) setSelectedOutputId(null);
    else if (!jobOutputs.some((output) => output.id === selectedOutputId)) {
      setSelectedOutputId(
        jobOutputs.find((output) => output.kind === "upscale")?.id ??
          jobOutputs[0].id,
      );
    }
  }, [jobOutputs, selectedOutputId]);

  const output =
    job?.outputs.find((item) => item.id === selectedOutputId) ??
    job?.outputs[0];
  const active =
    job && ["uploading", "queued", "running"].includes(job.status);
  const preview = active ? job.preview : undefined;
  const hasBaseOutput = job?.outputs.some((item) => item.kind === "base");
  const hasUpscaleOutput = job?.outputs.some(
    (item) => item.kind === "upscale" || item.kind === "upscaled",
  );
  const canUpscaleResult =
    job?.status === "completed" &&
    job.settings.upscale.enabled === false &&
    hasBaseOutput &&
    !hasUpscaleOutput;
  const elapsed = job
    ? job.elapsedMs ??
      (job.startedAt
        ? (job.completedAt ? new Date(job.completedAt).getTime() : now) -
          new Date(job.startedAt).getTime()
        : 0)
    : 0;

  async function handleCancel() {
    if (!job || !active) return;
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
    } finally {
      setCancelling(false);
    }
  }

  async function handleUpscale() {
    if (!job || !canUpscaleResult) return;
    setActionError("");
    try {
      const nextJob = await upscaleJob(
        job.id,
        job.settings.upscale,
        output?.kind === "base" ? output.id : undefined,
      );
      onJobUpdate(nextJob);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "업스케일 작업을 시작하지 못했습니다.",
      );
    }
  }

  return (
    <aside
      id="execution-dock"
      className="hidden 2xl:block"
    >
      <div className="glass-surface overflow-hidden rounded-xl border border-border shadow-sm">
        <div className="relative aspect-[4/5] overflow-hidden bg-[#0b0b0e] panel-grid">
          {preview ? (
            <>
              <Image
                key={`${preview.url}:${preview.revision ?? preview.updatedAt ?? ""}`}
                src={outputUrl(preview.url)}
                alt="현재 이미지 생성 과정"
                fill
                unoptimized
                priority
                sizes="(max-width: 1280px) 100vw, 360px"
                className="object-contain"
              />
              {typeof preview.step === "number" &&
              typeof preview.total === "number" ? (
                <div className="absolute right-3 top-3 rounded-lg border border-white/10 bg-black/65 px-3 py-2 text-[10px] text-white/85 backdrop-blur">
                  <span className="tabular-nums" aria-live="polite">
                    {preview.step} / {preview.total}
                  </span>
                </div>
              ) : null}
            </>
          ) : output && job ? (
            <button
              type="button"
              className="absolute inset-0 cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => onOpenDetail(job, output.id)}
              aria-label="생성 상세 열기"
            >
              <Image
                src={outputUrl(output.url ?? output.id)}
                alt={`${output.kind} 생성 결과`}
                fill
                unoptimized
                priority
                sizes="(max-width: 1280px) 100vw, 360px"
                className="object-contain"
              />
            </button>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
              {active ? (
                <>
                  <div className="relative mb-5">
                    <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
                    <span className="relative grid size-14 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                      <Sparkles className="size-6 animate-pulse" />
                    </span>
                  </div>
                  <p className="text-sm font-medium">
                    {stageLabels[job.stage ?? ""] ?? "작업 진행 중"}
                  </p>
                </>
              ) : (
                <>
                  <span className="mb-4 grid size-14 place-items-center rounded-xl border border-border bg-surface-2 text-muted-foreground">
                    <ImageIcon className="size-6" />
                  </span>
                  <p className="text-sm font-medium text-foreground/85">
                    결과 미리보기
                  </p>
                </>
              )}
            </div>
          )}

          {job?.status === "failed" ? (
            <div className="absolute inset-x-3 bottom-3 rounded-lg border border-red-400/20 bg-red-950/80 p-3 backdrop-blur">
              <div className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-300" />
                <p className="text-xs leading-5 text-red-100">
                  {job.error ?? "ComfyUI 작업이 실패했습니다."}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {job?.outputs.length && job.outputs.length > 1 ? (
          <div className="flex gap-1 border-t border-border/60 bg-background/30 p-2">
            {job.outputs.map((item) => (
              <Button
                key={item.id}
                type="button"
                size="sm"
                variant={selectedOutputId === item.id ? "soft" : "ghost"}
                className="flex-1"
                onClick={() => setSelectedOutputId(item.id)}
              >
                {item.kind === "upscale" ? "업스케일" : "기본"}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="space-y-4 border-t border-border/70 p-4">
          {job ? (
            <div className="space-y-3">
              {job.status !== "completed" ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {active ? (
                      <LoaderCircle className="size-4 shrink-0 animate-spin text-pink-300" />
                    ) : job.status === "cancelled" ? (
                      <PauseCircle className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <AlertTriangle className="size-4 shrink-0 text-red-300" />
                    )}
                    <p className="truncate text-xs font-medium">
                      {stageLabels[job.stage ?? ""] ??
                        statusMeta[job.status].label}
                    </p>
                  </div>
                  <Badge variant={statusMeta[job.status].variant}>
                    {statusMeta[job.status].label}
                  </Badge>
                </div>
              ) : null}

              {active ? (
                <>
                  <Progress value={job.progress} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {typeof job.progress === "number"
                        ? `${Math.round(job.progress)}%`
                        : latestEvent?.message ?? "활동 중"}
                    </span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Clock3 className="size-3" />
                      {formatElapsed(elapsed)}
                    </span>
                  </div>
                  {job.status === "queued" &&
                  job.queuePosition !== undefined ? (
                    <p className="rounded-md bg-amber-400/10 px-2.5 py-2 text-[11px] text-amber-200">
                      대기열 {job.queuePosition}번째
                    </p>
                  ) : null}
                </>
              ) : null}

              {output ? (
                <div className="flex gap-2">
                  <Button asChild variant="outline" size="sm" className="flex-1">
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
                  <Button asChild variant="ghost" size="icon">
                    <a
                      href={outputUrl(output.url ?? output.id)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="새 창에서 결과 열기"
                    >
                      <ExternalLink />
                    </a>
                  </Button>
                </div>
              ) : null}

              {job.status === "completed" && job.outputs.length ? (
                <ResultActionBar
                  job={job}
                  compact
                  canUpscale={canUpscaleResult}
                  onLoadSettings={onLoadSettings}
                  onLoadSeed={onLoadSeed}
                  onUpscale={async () => handleUpscale()}
                />
              ) : null}

              {actionError ? (
                <p
                  role="alert"
                  className="rounded-md border border-red-400/20 bg-red-400/[0.06] px-2.5 py-2 text-[11px] leading-5 text-red-200"
                >
                  {actionError}
                </p>
              ) : null}
            </div>
          ) : !capabilities?.ready ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
              <Server className="size-3.5" />
              {capabilities
                ? `${capabilities.missingNodes.length}개 항목 확인 필요`
                : "서버 상태 확인 중"}
            </div>
          ) : null}

          {active ? (
            <Button
              type="button"
              variant="outline"
              className="w-full border-red-400/20 text-red-200 hover:bg-red-400/10 hover:text-red-100"
              onClick={handleCancel}
              disabled={cancelling}
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
              size="lg"
              className="w-full"
              disabled={!canGenerate || submitting}
              onClick={onGenerate}
              aria-keyshortcuts="Control+Enter"
              title="생성 (Ctrl+Enter)"
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

          {!canGenerate && preflightIssues.length ? (
            <div className="space-y-1.5" aria-label="생성 전 확인 항목">
              {preflightIssues.slice(0, 4).map((issue) => (
                <button
                  key={issue.code}
                  type="button"
                  className="flex min-h-10 w-full items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2 text-left text-xs leading-5 text-warning outline-none hover:bg-warning/10 focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onResolveIssue?.(issue)}
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{issue.message}</span>
                </button>
              ))}
            </div>
          ) : !canGenerate && validationMessage ? (
            <p className="text-center text-xs leading-5 text-warning">
              {validationMessage}
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

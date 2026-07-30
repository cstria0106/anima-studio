import { Clock3, Gauge, Info, MemoryStick } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { RuntimeHardware } from "@/lib/types";
import {
  estimateWorkload,
} from "@/lib/studio-ux";

export type ResourceEstimateInput = Omit<
  Parameters<typeof estimateWorkload>[0],
  "upscaleScale"
> & {
  upscaleScale?: number;
};

export interface ResourceEstimateProps {
  hardware: RuntimeHardware | null;
  workload: ResourceEstimateInput;
  label?: string;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `약 ${Math.max(1, Math.round(seconds))}초`;
  const minutes = Math.round(seconds / 60);
  return `약 ${minutes}분`;
}

export function ResourceEstimate({
  hardware,
  workload,
  label = "현재 설정",
}: ResourceEstimateProps) {
  const estimate = estimateWorkload(
    {
      ...workload,
      upscaleScale: workload.upscaleScale ?? 1.5,
    },
    hardware,
  );
  const fits =
    estimate.availableVramGiB === null
      ? null
      : estimate.estimatedVramGiB <= estimate.availableVramGiB * 0.9;

  return (
    <section
      aria-labelledby="resource-estimate-title"
      className="rounded-xl border border-border/70 bg-background/25 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-pink-300" />
            <h3 id="resource-estimate-title" className="text-xs font-medium">
              VRAM·소요 시간 사전 추정
            </h3>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {label} · 실제 시간은 모델, GPU와 캐시 상태에 따라 달라집니다.
          </p>
        </div>
        <Badge
          variant={
            estimate.risk === "high"
              ? "warning"
              : fits === null
                ? "secondary"
                : fits
                  ? "success"
                  : "warning"
          }
        >
          {estimate.risk === "high"
            ? "실행 전 확인"
            : fits === null
              ? "GPU 정보 필요"
              : fits
                ? "여유 있음"
                : "VRAM 주의"}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-background/30 p-3">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <MemoryStick className="size-3.5" />
            추정 피크 VRAM
          </div>
          <p className="mt-1 text-sm font-semibold">
            {estimate.estimatedVramGiB.toFixed(1)} GB
            {estimate.availableVramGiB !== null
              ? ` / ${estimate.availableVramGiB.toFixed(1)} GB`
              : ""}
          </p>
          <Progress value={estimate.vramRatio} className="mt-2" />
        </div>
        <div className="rounded-lg border border-border/60 bg-background/30 p-3">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Clock3 className="size-3.5" />
            첫 결과 예상
          </div>
          <p className="mt-1 text-sm font-semibold">
            {formatDuration(estimate.lowerSeconds)}–
            {formatDuration(estimate.upperSeconds)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            학습 {workload.trainingSteps} step + sampling{" "}
            {workload.samplingSteps} step
            {workload.upscaleEnabled
              ? ` + upscale ${workload.upscaleSteps} step`
              : ""}
            {estimate.jobCount > 1
              ? ` · ${estimate.jobCount}개 작업`
              : ""}
          </p>
        </div>
      </div>

      {estimate.reasons.length ? (
        <ul className="mt-3 space-y-1 text-xs text-amber-200">
          {estimate.reasons.map((reason) => (
            <li key={reason}>• {reason}</li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        이 값은 실행을 차단하는 검증이 아니라 계획용 추정치입니다. 서버
        preflight와 ComfyUI 오류가 최종 판단 기준입니다.
      </p>
    </section>
  );
}

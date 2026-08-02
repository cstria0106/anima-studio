"use client";

import * as React from "react";
import { Ban, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cancelJob } from "@/lib/api";
import type { StudioJob } from "@/lib/types";
import { cn } from "@/lib/utils";

const ACTIVE_STATUSES = new Set(["uploading", "queued", "running"]);

function queueLabel(job: StudioJob) {
  if (job.status === "running") return "생성 중";
  if (job.status === "uploading") return "준비 중";
  return job.queuePosition === undefined
    ? "대기 중"
    : `대기 ${job.queuePosition}번째`;
}

export function GenerationQueueList({
  jobs,
  onJobUpdate,
  className,
}: {
  jobs: StudioJob[];
  onJobUpdate: (job: StudioJob) => void;
  className?: string;
}) {
  const activeJobs = jobs
    .filter((job) => ACTIVE_STATUSES.has(job.status))
    .sort((left, right) => {
      if (left.status === "running" && right.status !== "running") return -1;
      if (right.status === "running" && left.status !== "running") return 1;
      return (
        (left.queuePosition ?? Number.MAX_SAFE_INTEGER) -
          (right.queuePosition ?? Number.MAX_SAFE_INTEGER) ||
        left.createdAt.localeCompare(right.createdAt)
      );
    });
  const [cancellingIds, setCancellingIds] = React.useState<string[]>([]);
  const [error, setError] = React.useState("");

  if (!activeJobs.length) return null;

  async function cancelQueuedJob(job: StudioJob) {
    if (cancellingIds.includes(job.id)) return;
    setCancellingIds((current) => [...current, job.id]);
    setError("");
    try {
      onJobUpdate(await cancelJob(job.id));
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "대기열 작업을 취소하지 못했습니다.",
      );
    } finally {
      setCancellingIds((current) => current.filter((id) => id !== job.id));
    }
  }

  return (
    <section
      className={cn("space-y-2", className)}
      aria-label="생성 대기열"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">생성 대기열</p>
        <Badge variant="secondary">{activeJobs.length}개</Badge>
      </div>
      <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
        {activeJobs.map((job) => {
          const cancelling = cancellingIds.includes(job.id);
          return (
            <div
              key={job.id}
              className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-2"
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  job.status === "running" ? "bg-warning" : "bg-primary",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  Seed {job.settings.sampling.seed}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {queueLabel(job)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="shrink-0 text-danger hover:bg-danger/10 hover:text-danger"
                disabled={cancelling}
                onClick={() => void cancelQueuedJob(job)}
                aria-label={`Seed ${job.settings.sampling.seed} 작업 취소`}
              >
                {cancelling ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Ban />
                )}
                취소
              </Button>
            </div>
          );
        })}
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/25 bg-danger/[0.06] px-2.5 py-2 text-[11px] leading-5 text-danger"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

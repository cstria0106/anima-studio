"use client";

import * as React from "react";
import { getJob } from "@/lib/api";
import type { JobEvent, JobPreview, StudioJob } from "@/lib/types";
import { clamp } from "@/lib/utils";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const FINAL_REFRESH_DELAYS = [0, 150, 300, 600, 1_000, 1_500, 2_500];

function progressValue(event: JobEvent) {
  if (typeof event.progress === "number") {
    return clamp(event.progress <= 1 ? event.progress * 100 : event.progress, 0, 100);
  }
  if (
    typeof (event.value ?? event.current) === "number" &&
    typeof (event.max ?? event.total) === "number" &&
    Number(event.max ?? event.total) > 0
  ) {
    return clamp(
      (Number(event.value ?? event.current) /
        Number(event.max ?? event.total)) *
        100,
      0,
      100,
    );
  }
  return undefined;
}

function previewValue(event: JobEvent): JobPreview | undefined {
  if (typeof event.preview === "string") return { url: event.preview };
  if (event.preview?.url) {
    return {
      ...event.preview,
      step:
        typeof event.preview.step === "number"
          ? event.preview.step
          : undefined,
      total:
        typeof event.preview.total === "number"
          ? event.preview.total
          : undefined,
    };
  }
  if (event.previewUrl) {
    return {
      url: event.previewUrl,
      step:
        typeof (event.current ?? event.value) === "number"
          ? Number(event.current ?? event.value)
          : undefined,
      total:
        typeof (event.total ?? event.max) === "number"
          ? Number(event.total ?? event.max)
          : undefined,
      updatedAt: event.createdAt,
    };
  }
  return undefined;
}

function isSettled(job: StudioJob) {
  if (job.status === "completed") return job.outputs.length > 0;
  return job.status === "failed" || job.status === "cancelled";
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export function useJobTracker(
  job: StudioJob | null,
  onUpdate: (job: StudioJob) => void,
) {
  const [latestEvent, setLatestEvent] = React.useState<JobEvent | null>(null);
  const onUpdateRef = React.useRef(onUpdate);
  const jobRef = React.useRef(job);
  onUpdateRef.current = onUpdate;
  jobRef.current = job;
  const trackedJobId = job?.id;

  React.useEffect(() => {
    setLatestEvent(null);
    if (!trackedJobId) return;

    let stopped = false;
    let refreshing = false;
    let reconciling = false;
    let source: EventSource | undefined;
    let interval: number | undefined;

    const publish = (next: StudioJob) => {
      if (stopped) return;
      jobRef.current = next;
      onUpdateRef.current(next);
    };

    const refresh = async () => {
      if (refreshing || stopped) return null;
      refreshing = true;
      try {
        const refreshed = await getJob(trackedJobId);
        publish(refreshed);
        return refreshed;
      } catch {
        // SSE and the next poll continue to provide recovery.
        return null;
      } finally {
        refreshing = false;
      }
    };

    const reconcileTerminal = async () => {
      if (reconciling || stopped) return;
      reconciling = true;
      for (const delay of FINAL_REFRESH_DELAYS) {
        if (delay) await sleep(delay);
        if (stopped) return;
        const refreshed = await refresh();
        const current = refreshed ?? jobRef.current;
        if (current && isSettled(current)) {
          source?.close();
          if (interval !== undefined) window.clearInterval(interval);
          reconciling = false;
          return;
        }
      }
      // If ComfyUI/API persistence is unusually slow, leave polling active.
      reconciling = false;
    };

    const handleEvent = (message: MessageEvent) => {
      try {
        const parsed = JSON.parse(message.data) as JobEvent;
        setLatestEvent(parsed);
        const progress = progressValue(parsed);
        const phase = parsed.stage ?? parsed.phase ?? parsed.type;
        const current = jobRef.current;
        if (!current) return;
        const derivedStatus =
          parsed.status ??
          (phase === "queued"
            ? "queued"
            : phase === "uploading"
              ? "uploading"
              : phase === "completed" ||
                  phase === "failed" ||
                  phase === "cancelled"
                ? phase
                : "running");
        const preview = previewValue(parsed);
        const updated: StudioJob = {
          ...current,
          status: derivedStatus,
          stage: phase ?? current.stage,
          progress: progress ?? current.progress,
          error: parsed.error ?? current.error,
          preview: preview ?? current.preview,
          outputs: parsed.output
            ? [
                ...current.outputs.filter(
                  (output) => output.id !== parsed.output?.id,
                ),
                parsed.output,
              ]
            : current.outputs,
        };
        publish(updated);
        if (TERMINAL.has(derivedStatus) || TERMINAL.has(phase ?? "")) {
          void reconcileTerminal();
        }
      } catch {
        // Ignore keep-alive and non-JSON frames.
      }
    };

    const current = jobRef.current;
    if (!current || !TERMINAL.has(current.status) || !isSettled(current)) {
      source = new EventSource(
        `/api/jobs/${encodeURIComponent(trackedJobId)}/events`,
      );
      source.addEventListener("job", handleEvent as EventListener);
      source.addEventListener("preview", handleEvent as EventListener);
      source.onmessage = handleEvent;
      source.onerror = () => {
        // EventSource reconnects with Last-Event-ID; polling covers the gap.
        void refresh();
      };

      interval = window.setInterval(() => {
        const latest = jobRef.current;
        if (latest && TERMINAL.has(latest.status)) {
          void reconcileTerminal();
        } else {
          void refresh();
        }
      }, 3_500);
    }

    if (current && TERMINAL.has(current.status)) {
      void reconcileTerminal();
    } else {
      void refresh();
    }

    return () => {
      stopped = true;
      source?.close();
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [trackedJobId]);

  return latestEvent;
}

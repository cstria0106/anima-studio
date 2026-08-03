"use client";

import * as React from "react";
import { Copy, Dices, LoaderCircle, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StudioJob } from "@/lib/types";

type ActionName = "load" | "seed";

interface ResultActionBarProps {
  job: StudioJob;
  canUpscale?: boolean;
  compact?: boolean;
  onLoadSettings: (job: StudioJob) => Promise<void> | void;
  onLoadSeed: (job: StudioJob) => Promise<void> | void;
  onUpscale?: (job: StudioJob) => void;
}

export function ResultActionBar({
  job,
  canUpscale,
  compact,
  onLoadSettings,
  onLoadSeed,
  onUpscale,
}: ResultActionBarProps) {
  const [busy, setBusy] = React.useState<ActionName | null>(null);
  const [error, setError] = React.useState("");

  async function run(
    name: ActionName,
    action: (job: StudioJob) => Promise<void> | void,
  ) {
    setBusy(name);
    setError("");
    try {
      await action(job);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "결과 작업을 처리하지 못했습니다.",
      );
    } finally {
      setBusy(null);
    }
  }

  const icon = (name: ActionName, fallback: React.ReactNode) =>
    busy === name ? <LoaderCircle className="animate-spin" /> : fallback;

  return (
    <div className="space-y-2">
      <div
        role="toolbar"
        aria-label="결과 빠른 작업"
        className={
          compact
            ? canUpscale && onUpscale
              ? "grid grid-cols-3 gap-1.5"
              : "grid grid-cols-2 gap-2"
            : "flex flex-wrap items-center gap-2"
        }
      >
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={compact ? "gap-1 px-1.5 text-[10px]" : undefined}
          disabled={busy !== null}
          onClick={() => void run("load", onLoadSettings)}
        >
          {icon("load", <Copy />)}
          설정 불러오기
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={compact ? "gap-1 px-1.5 text-[10px]" : undefined}
          disabled={busy !== null}
          onClick={() => void run("seed", onLoadSeed)}
        >
          {icon("seed", <Dices />)}
          시드 불러오기
        </Button>
        {canUpscale && onUpscale ? (
          <Button
            type="button"
            size="sm"
            variant="soft"
            className={compact ? "gap-1 px-1.5 text-[10px]" : undefined}
            disabled={busy !== null}
            onClick={() => onUpscale(job)}
          >
            <Maximize2 />
            업스케일
          </Button>
        ) : null}
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-400/20 bg-red-400/[0.06] px-2.5 py-2 text-[10px] leading-4 text-red-200"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

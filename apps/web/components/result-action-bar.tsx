"use client";

import * as React from "react";
import {
  Copy,
  Dice5,
  LoaderCircle,
  Maximize2,
  PencilLine,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StudioJob } from "@/lib/types";

type ActionName =
  | "repeat"
  | "new-seed"
  | "edit"
  | "load"
  | "upscale";

interface ResultActionBarProps {
  job: StudioJob;
  canUpscale?: boolean;
  compact?: boolean;
  onRepeat: (job: StudioJob) => Promise<void> | void;
  onNewSeed: (job: StudioJob) => Promise<void> | void;
  onEditPrompt: (job: StudioJob) => Promise<void> | void;
  onLoadSettings: (job: StudioJob) => Promise<void> | void;
  onUpscale?: (job: StudioJob) => Promise<void> | void;
}

export function ResultActionBar({
  job,
  canUpscale,
  compact,
  onRepeat,
  onNewSeed,
  onEditPrompt,
  onLoadSettings,
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
            ? "grid grid-cols-2 gap-2"
            : "flex flex-wrap items-center gap-2"
        }
      >
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void run("repeat", onRepeat)}
        >
          {icon("repeat", <RefreshCw />)}
          같은 설정
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void run("new-seed", onNewSeed)}
        >
          {icon("new-seed", <Dice5 />)}
          시드만 변경
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void run("edit", onEditPrompt)}
        >
          {icon("edit", <PencilLine />)}
          같은 시드로 수정
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => void run("load", onLoadSettings)}
        >
          {icon("load", <Copy />)}
          설정 불러오기
        </Button>
        {canUpscale && onUpscale ? (
          <Button
            type="button"
            size="sm"
            variant="soft"
            disabled={busy !== null}
            onClick={() => void run("upscale", onUpscale)}
          >
            {icon("upscale", <Maximize2 />)}
            동일 시드 업스케일
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

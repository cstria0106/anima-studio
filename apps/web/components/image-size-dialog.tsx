"use client";

import * as React from "react";
import { CURATED_IMAGE_PRESETS } from "@anima/shared";
import { Check, Expand, Ratio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommittedNumberField } from "@/components/ui/committed-number-field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ImageSizeDialogProps {
  width: number;
  height: number;
  extraPresets: Array<{ label: string; width: number; height: number }>;
  onChange: (size: { width: number; height: number }) => void;
}

function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function ratioLabel(width: number, height: number) {
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function fitPreview(width: number, height: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function normalizeDimension(value: number) {
  return Math.min(8192, Math.max(64, Math.round(value / 8) * 8));
}

export function ImageSizeDialog({
  width,
  height,
  extraPresets,
  onChange,
}: ImageSizeDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [draftWidth, setDraftWidth] = React.useState(width);
  const [draftHeight, setDraftHeight] = React.useState(height);
  const preview = fitPreview(draftWidth, draftHeight, 220, 220);
  const allPresets = [...CURATED_IMAGE_PRESETS, ...extraPresets];
  const selectedPreset = allPresets.find(
    (preset) => preset.width === draftWidth && preset.height === draftHeight,
  );

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setDraftWidth(width);
      setDraftHeight(height);
    }
    setOpen(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-3 rounded-lg border border-border/70 bg-background/35 p-3 text-left transition hover:border-primary/35 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="grid size-8 shrink-0 place-items-center text-violet-200">
            <Expand className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted-foreground">이미지 크기</span>
            <span className="mt-0.5 block text-sm font-medium tabular-nums">
              {width} × {height}
            </span>
          </span>
          <Badge variant="secondary">{ratioLabel(width, height)}</Badge>
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-border/70 px-5 pb-4 pt-5 pr-14">
          <DialogTitle>이미지 크기</DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 px-5 md:grid-cols-[minmax(0,1fr)_240px]">
          <div className="space-y-5">
            <div>
              <p className="mb-2.5 text-xs font-medium text-muted-foreground">
                추천 비율
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CURATED_IMAGE_PRESETS.map((preset) => {
                  const selected =
                    preset.width === draftWidth && preset.height === draftHeight;
                  const miniature = fitPreview(preset.width, preset.height, 34, 26);
                  return (
                    <button
                      key={`${preset.width}-${preset.height}`}
                      type="button"
                      aria-pressed={selected}
                      className={cn(
                        "relative flex min-h-16 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? "border-primary/55 bg-primary/10 text-foreground"
                          : "border-border/70 bg-background/30 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                      )}
                      onClick={() => {
                        setDraftWidth(preset.width);
                        setDraftHeight(preset.height);
                      }}
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/20">
                        <span
                          className="rounded-[2px] border border-violet-200/60 bg-violet-300/15"
                          style={miniature}
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] font-medium">
                          {preset.label}
                        </span>
                        <span className="mt-0.5 block text-[10px] tabular-nums opacity-75">
                          {preset.width} × {preset.height}
                        </span>
                      </span>
                      {selected ? (
                        <Check className="absolute right-1.5 top-1.5 size-3 text-pink-300" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {extraPresets.length ? (
              <div>
                <p className="mb-2.5 text-xs font-medium text-muted-foreground">
                  추가 프리셋
                </p>
                <div className="flex flex-wrap gap-2">
                  {extraPresets.map((preset) => {
                    const selected =
                      preset.width === draftWidth && preset.height === draftHeight;
                    return (
                      <Button
                        key={`${preset.width}-${preset.height}`}
                        type="button"
                        size="sm"
                        variant={selected ? "soft" : "outline"}
                        onClick={() => {
                          setDraftWidth(preset.width);
                          setDraftHeight(preset.height);
                        }}
                      >
                        {preset.label} · {preset.width} × {preset.height}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div>
              <p className="mb-2.5 text-xs font-medium text-muted-foreground">
                직접 입력
              </p>
              <div className="grid grid-cols-2 gap-3">
                <CommittedNumberField
                  label="Width"
                  value={draftWidth}
                  onChange={(nextWidth) =>
                    setDraftWidth(normalizeDimension(nextWidth))
                  }
                  min={64}
                  max={8192}
                  step={8}
                />
                <CommittedNumberField
                  label="Height"
                  value={draftHeight}
                  onChange={(nextHeight) =>
                    setDraftHeight(normalizeDimension(nextHeight))
                  }
                  min={64}
                  max={8192}
                  step={8}
                />
              </div>
            </div>
          </div>

          <div className="flex min-h-72 flex-col rounded-xl border border-border/70 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-xs font-medium">
                <Ratio className="size-3.5 text-violet-300" />
                비율 미리보기
              </span>
              <Badge variant="outline">
                {ratioLabel(draftWidth, draftHeight)}
              </Badge>
            </div>
            <div className="panel-grid my-4 flex min-h-56 flex-1 items-center justify-center overflow-hidden rounded-lg border border-white/5 bg-[#0b0b0e] p-3">
              <div
                className="relative rounded-md border border-violet-200/60 bg-gradient-to-br from-violet-400/25 via-pink-400/10 to-transparent shadow-[0_0_35px_rgba(168,85,247,0.12)]"
                style={preview}
              >
                <span className="absolute inset-0 grid place-items-center text-[10px] font-medium text-white/55">
                  {draftWidth} × {draftHeight}
                </span>
              </div>
            </div>
            <p className="truncate text-center text-xs text-muted-foreground">
              {selectedPreset?.label ?? "사용자 지정 크기"}
            </p>
          </div>
        </div>

        <DialogFooter className="border-t border-border/70 px-5 py-4">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button
            type="button"
            onClick={() => {
              onChange({ width: draftWidth, height: draftHeight });
              setOpen(false);
            }}
          >
            이 크기 적용
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

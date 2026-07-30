"use client";

import * as React from "react";
import Image from "next/image";
import {
  Columns2,
  Download,
  GripVertical,
  Images,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ComparisonItem } from "@/lib/types";
import { cn, outputUrl } from "@/lib/utils";

interface ResultComparisonProps {
  left: ComparisonItem;
  right: ComparisonItem;
  onClose?: () => void;
}

function imageRatio(item: ComparisonItem) {
  if (
    item.width &&
    item.height &&
    item.width > 0 &&
    item.height > 0
  ) {
    return item.width / item.height;
  }
  return 4 / 5;
}

function ItemCaption({
  item,
  side,
}: {
  item: ComparisonItem;
  side: "A" | "B";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Badge variant="outline">{side}</Badge>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{item.label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[item.width && item.height ? `${item.width}×${item.height}` : "", item.seed !== undefined ? `seed ${item.seed}` : ""]
            .filter(Boolean)
            .join(" · ") || "결과 이미지"}
        </p>
      </div>
    </div>
  );
}

export function ResultComparison({
  left,
  right,
  onClose,
}: ResultComparisonProps) {
  const [mode, setMode] = React.useState<"overlay" | "side">("overlay");
  const [split, setSplit] = React.useState(50);
  const overlayRatio = imageRatio(left);

  return (
    <section
      aria-label="결과 비교"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <Images className="size-4 text-pink-300" />
          <div>
            <h2 className="text-sm font-medium">결과 비교</h2>
            <p className="text-xs text-muted-foreground">
              기본/업스케일 또는 서로 다른 작업을 확대 비교합니다.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant={mode === "overlay" ? "soft" : "ghost"}
            onClick={() => setMode("overlay")}
            aria-pressed={mode === "overlay"}
          >
            <GripVertical />
            겹쳐 보기
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "side" ? "soft" : "ghost"}
            onClick={() => setMode("side")}
            aria-pressed={mode === "side"}
          >
            <Columns2 />
            나란히
          </Button>
          {onClose ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={onClose}
              aria-label="비교 닫기"
            >
              <X />
            </Button>
          ) : null}
        </div>
      </div>

      {mode === "overlay" ? (
        <div className="grid place-items-center bg-black/40 panel-grid">
          <div
            className="relative w-full max-w-full"
            style={{
              aspectRatio: String(overlayRatio),
              maxWidth: `min(100%, calc(72vh * ${overlayRatio}))`,
            }}
          >
            <Image
              src={outputUrl(right.url)}
              alt={`${right.label} 비교 이미지`}
              fill
              unoptimized
              sizes="(max-width: 1280px) 100vw, 900px"
              className="object-cover"
            />
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
              aria-hidden="true"
            >
              <Image
                src={outputUrl(left.url)}
                alt=""
                fill
                unoptimized
                sizes="(max-width: 1280px) 100vw, 900px"
                className="object-cover"
              />
            </div>
            <div
              className="pointer-events-none absolute inset-y-0 z-10 w-px bg-white/80 shadow-[0_0_0_1px_rgba(0,0,0,.4)]"
              style={{ left: `${split}%` }}
            >
              <span className="absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/40 bg-black/65 text-white shadow-xl backdrop-blur">
                <GripVertical className="size-4" />
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={split}
              onChange={(event) => setSplit(Number(event.target.value))}
              onKeyDown={(event) => {
                const delta =
                  event.key === "ArrowLeft" || event.key === "ArrowDown"
                    ? -1
                    : event.key === "ArrowRight" || event.key === "ArrowUp"
                      ? 1
                      : 0;
                if (delta) {
                  event.preventDefault();
                  setSplit((current) =>
                    Math.max(0, Math.min(100, current + delta)),
                  );
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  setSplit(event.key === "Home" ? 0 : 100);
                }
              }}
              className="peer absolute inset-0 z-20 h-full w-full cursor-ew-resize opacity-0"
              aria-label={`비교 분할 위치 ${split}%`}
              aria-valuetext={`${split}%에서 A와 B 이미지 분할`}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-2 z-20 rounded-lg border-2 border-transparent peer-focus-visible:border-ring"
            />
            <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex justify-between">
              <Badge className="bg-black/65 text-white">A · {left.label}</Badge>
              <Badge className="bg-black/65 text-white">B · {right.label}</Badge>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid items-start bg-black/35 md:grid-cols-2">
          {[left, right].map((item, index) => (
            <div
              key={item.id}
              className={cn(
                "relative w-full panel-grid",
                index && "border-t border-border md:border-l md:border-t-0",
              )}
              style={{ aspectRatio: String(imageRatio(item)) }}
            >
              <Image
                src={outputUrl(item.url)}
                alt={`${item.label} 비교 이미지`}
                fill
                unoptimized
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 border-t border-border/70 p-3 sm:grid-cols-2">
        {[left, right].map((item, index) => (
          <div
            key={item.id}
            className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/35 p-2"
          >
            <ItemCaption item={item} side={index ? "B" : "A"} />
            <Button asChild type="button" size="icon" variant="ghost">
              <a
                href={outputUrl(item.url)}
                download
                target="_blank"
                rel="noreferrer"
                aria-label={`${item.label} 다운로드`}
              >
                <Download />
              </a>
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

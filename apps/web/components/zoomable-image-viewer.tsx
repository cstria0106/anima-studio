"use client";

import * as React from "react";
import Image from "next/image";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MIN_ZOOM = 100;
const MAX_ZOOM = 400;
const ZOOM_STEP = 25;

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

interface ZoomableImageViewerProps {
  src: string;
  alt: string;
  className?: string;
}

export function ZoomableImageViewer({
  src,
  alt,
  className,
}: ZoomableImageViewerProps) {
  const [zoom, setZoom] = React.useState(MIN_ZOOM);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const drag = React.useRef<{
    pointerId: number;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const reset = React.useCallback(() => {
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
  }, []);

  React.useEffect(() => {
    reset();
  }, [reset, src]);

  const changeZoom = React.useCallback((next: number) => {
    const clamped = clampZoom(next);
    setZoom(clamped);
    if (clamped === MIN_ZOOM) setOffset({ x: 0, y: 0 });
  }, []);

  return (
    <div
      className={cn(
        "relative isolate h-full min-h-0 overflow-hidden bg-black/45 panel-grid",
        className,
      )}
    >
      <div
        role="application"
        aria-label={`${alt} 확대 보기`}
        tabIndex={0}
        className={cn(
          "absolute inset-0 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          zoom > MIN_ZOOM ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
        )}
        style={{ touchAction: "none" }}
        onDoubleClick={() =>
          changeZoom(zoom === MIN_ZOOM ? 200 : MIN_ZOOM)
        }
        onWheel={(event) => {
          event.preventDefault();
          changeZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            changeZoom(zoom + ZOOM_STEP);
          } else if (event.key === "-" || event.key === "_") {
            event.preventDefault();
            changeZoom(zoom - ZOOM_STEP);
          } else if (event.key === "0" || event.key === "Home") {
            event.preventDefault();
            reset();
          } else if (
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            )
          ) {
            event.preventDefault();
            const step = event.shiftKey ? 64 : 24;
            setOffset((current) => ({
              x:
                current.x +
                (event.key === "ArrowLeft"
                  ? -step
                  : event.key === "ArrowRight"
                    ? step
                    : 0),
              y:
                current.y +
                (event.key === "ArrowUp"
                  ? -step
                  : event.key === "ArrowDown"
                    ? step
                    : 0),
            }));
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || zoom === MIN_ZOOM) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            offsetX: offset.x,
            offsetY: offset.y,
          };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          setOffset({
            x: current.offsetX + event.clientX - current.x,
            y: current.offsetY + event.clientY - current.y,
          });
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          className="absolute inset-0 transition-transform duration-100 ease-out"
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom / 100})`,
          }}
        >
          <Image
            src={src}
            alt={alt}
            fill
            unoptimized
            priority
            draggable={false}
            sizes="(max-width: 768px) 100vw, (max-width: 1536px) 70vw, 980px"
            className="select-none object-contain"
          />
        </div>
      </div>

      <div
        role="toolbar"
        aria-label="이미지 확대 도구"
        className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/75 p-1 text-white shadow-lg backdrop-blur"
      >
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9 text-white hover:bg-white/10 hover:text-white"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => changeZoom(zoom - ZOOM_STEP)}
          aria-label="축소"
        >
          <Minus />
        </Button>
        <output
          className="min-w-14 text-center text-xs tabular-nums"
          aria-live="polite"
        >
          {zoom}%
        </output>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9 text-white hover:bg-white/10 hover:text-white"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => changeZoom(zoom + ZOOM_STEP)}
          aria-label="확대"
        >
          <Plus />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9 text-white hover:bg-white/10 hover:text-white"
          disabled={zoom === MIN_ZOOM && offset.x === 0 && offset.y === 0}
          onClick={reset}
          aria-label="확대 및 위치 초기화"
        >
          <RotateCcw />
        </Button>
      </div>
    </div>
  );
}

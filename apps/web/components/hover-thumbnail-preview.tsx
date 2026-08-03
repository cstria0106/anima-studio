"use client";

import * as React from "react";
import Image from "next/image";
import { createPortal } from "react-dom";

const MIN_ASPECT_RATIO = 1 / 4;
const MAX_ASPECT_RATIO = 4;
const MAX_PREVIEW_EDGE = 360;
const CURSOR_OFFSET = 16;
const VIEWPORT_PADDING = 12;

interface PreviewSize {
  width: number;
  height: number;
}

interface PointerPosition {
  x: number;
  y: number;
}

function previewSize(aspectRatio: number, maxEdge: number): PreviewSize {
  const ratio = Math.min(
    MAX_ASPECT_RATIO,
    Math.max(MIN_ASPECT_RATIO, aspectRatio),
  );

  return ratio >= 1
    ? { width: maxEdge, height: maxEdge / ratio }
    : { width: maxEdge * ratio, height: maxEdge };
}

function previewPosition(
  pointer: PointerPosition,
  size: PreviewSize,
): PointerPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let x = pointer.x + CURSOR_OFFSET;
  let y = pointer.y + CURSOR_OFFSET;

  if (x + size.width > viewportWidth - VIEWPORT_PADDING) {
    x = pointer.x - size.width - CURSOR_OFFSET;
  }
  if (y + size.height > viewportHeight - VIEWPORT_PADDING) {
    y = pointer.y - size.height - CURSOR_OFFSET;
  }

  return {
    x: Math.max(
      VIEWPORT_PADDING,
      Math.min(x, viewportWidth - size.width - VIEWPORT_PADDING),
    ),
    y: Math.max(
      VIEWPORT_PADDING,
      Math.min(y, viewportHeight - size.height - VIEWPORT_PADDING),
    ),
  };
}

export function HoverThumbnailPreview({
  src,
  className,
  children,
}: {
  src?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [pointer, setPointer] = React.useState<PointerPosition | null>(null);
  const [aspectRatio, setAspectRatio] = React.useState(1);
  const [failed, setFailed] = React.useState(false);
  const maxEdge = pointer
    ? Math.max(
        1,
        Math.min(
          MAX_PREVIEW_EDGE,
          window.innerWidth - VIEWPORT_PADDING * 2,
          window.innerHeight - VIEWPORT_PADDING * 2,
        ),
      )
    : MAX_PREVIEW_EDGE;
  const size = previewSize(aspectRatio, maxEdge);

  React.useEffect(() => {
    setAspectRatio(1);
    setFailed(false);
  }, [src]);

  function showPreview(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || !src) return;
    setPointer({ x: event.clientX, y: event.clientY });
  }

  const position = pointer ? previewPosition(pointer, size) : null;

  return (
    <div
      className={className}
      onPointerEnter={showPreview}
      onPointerMove={showPreview}
      onPointerLeave={() => setPointer(null)}
    >
      {children}
      {src && position && !failed
        ? createPortal(
            <div
              aria-hidden="true"
              className="pointer-events-none fixed z-[100] overflow-hidden rounded-lg border border-white/15 bg-black/90 shadow-2xl ring-1 ring-black/40"
              style={{
                left: position.x,
                top: position.y,
                width: size.width,
                height: size.height,
              }}
            >
              <Image
                src={src}
                alt=""
                fill
                unoptimized
                sizes={`${MAX_PREVIEW_EDGE}px`}
                className="object-contain"
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth && naturalHeight) {
                    setAspectRatio(naturalWidth / naturalHeight);
                  }
                }}
                onError={() => setFailed(true)}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

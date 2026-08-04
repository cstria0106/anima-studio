"use client";

import * as React from "react";
import {
  Brush,
  Circle,
  Eraser,
  FlipHorizontal2,
  LoaderCircle,
  Maximize,
  Redo2,
  Save,
  Square,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { uploadAsset } from "@/lib/api";
import {
  centeredInpaintCrop,
  maskHasPaint,
  reduceMaskHistory,
  type InpaintWorkspaceSource,
  type InpaintCrop,
  type MaskHistory,
} from "@/lib/inpaint";
import type {
  ReferenceAsset,
} from "@/lib/types";
import { cn, outputUrl } from "@/lib/utils";

interface InpaintEditorDialogProps {
  source: InpaintWorkspaceSource;
  maskAsset: ReferenceAsset | null;
  growMaskBy: number;
  onClose: () => void;
  onSave: (value: {
    maskAsset: ReferenceAsset;
    growMaskBy: number;
  }) => void;
}

interface LoadedSource {
  image: HTMLImageElement;
  crop: InpaintCrop;
  previewUrl: string;
}

type MaskTool = "brush" | "eraser" | "sphere" | "box";

interface Point {
  x: number;
  y: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("원본 이미지를 읽지 못했습니다."));
    image.src = src;
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("PNG 이미지를 만들지 못했습니다.")),
      "image/png",
    );
  });
}

export function InpaintEditorDialog({
  source,
  maskAsset,
  growMaskBy: initialGrowMaskBy,
  onClose,
  onSave,
}: InpaintEditorDialogProps) {
  const sourceCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const pointersRef = React.useRef(new Map<number, { x: number; y: number }>());
  const previousPointRef = React.useRef<{ x: number; y: number } | null>(null);
  const shapeStartRef = React.useRef<Point | null>(null);
  const shapeBaseRef = React.useRef<ImageData | null>(null);
  const pinchRef = React.useRef<{
    distance: number;
    zoom: number;
    pan: { x: number; y: number };
    center: { x: number; y: number };
  } | null>(null);
  const spacePressedRef = React.useRef(false);
  const panningRef = React.useRef(false);
  const maskInitializedRef = React.useRef(false);
  const [loaded, setLoaded] = React.useState<LoadedSource | null>(null);
  const [loadingError, setLoadingError] = React.useState("");
  const [tool, setTool] = React.useState<MaskTool>("brush");
  const [brushCursor, setBrushCursor] = React.useState<Point | null>(null);
  const [brushSize, setBrushSize] = React.useState(64);
  const [overlayOpacity, setOverlayOpacity] = React.useState(0.45);
  const [growMaskBy, setGrowMaskBy] = React.useState(initialGrowMaskBy);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [fitScale, setFitScale] = React.useState(1);
  const [history, setHistory] = React.useState<MaskHistory<ImageData> | null>(
    null,
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    const previewUrl =
      source.type === "asset"
        ? outputUrl(source.asset.url)
        : outputUrl(source.output.url ?? source.output.id);
    let disposed = false;
    setLoadingError("");
    setLoaded(null);
    void loadImage(previewUrl)
      .then((image) => {
        if (disposed) return;
        const crop = centeredInpaintCrop(image.naturalWidth, image.naturalHeight);
        if (crop.cropped) {
          throw new Error(
            "이 원본은 크기가 8의 배수가 아니어서 인페인트할 수 없습니다.",
          );
        }
        if (crop.width < 64 || crop.height < 64) {
          throw new Error("인페인트 원본은 가로와 세로가 각각 64px 이상이어야 합니다.");
        }
        setLoaded({ image, crop, previewUrl });
      })
      .catch((loadError) => {
        if (!disposed) {
          setLoadingError(
            loadError instanceof Error
              ? loadError.message
              : "원본 이미지를 읽지 못했습니다.",
          );
        }
      });
    return () => {
      disposed = true;
    };
  }, [source]);

  React.useEffect(() => {
    if (!loaded || !sourceCanvasRef.current || !maskCanvasRef.current) return;
    const { crop, image } = loaded;
    const sourceCanvas = sourceCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    sourceCanvas.width = crop.width;
    sourceCanvas.height = crop.height;
    sourceCanvas
      .getContext("2d")!
      .drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
      );

    if (maskInitializedRef.current) return;
    maskCanvas.width = crop.width;
    maskCanvas.height = crop.height;
    const initializeMask = async () => {
      const context = maskCanvas.getContext("2d")!;
      context.clearRect(0, 0, crop.width, crop.height);
      const maskUrl = maskAsset?.url;
      if (maskUrl) {
        const maskImage = await loadImage(outputUrl(maskUrl));
        const temporary = document.createElement("canvas");
        temporary.width = crop.width;
        temporary.height = crop.height;
        const temporaryContext = temporary.getContext("2d")!;
        temporaryContext.drawImage(maskImage, 0, 0, crop.width, crop.height);
        const stored = temporaryContext.getImageData(0, 0, crop.width, crop.height);
        const restored = context.createImageData(crop.width, crop.height);
        for (let index = 0; index < stored.data.length; index += 4) {
          restored.data[index] = 244;
          restored.data[index + 1] = 63;
          restored.data[index + 2] = 94;
          restored.data[index + 3] = 255 - stored.data[index + 3];
        }
        context.putImageData(restored, 0, 0);
      }
      const initial = context.getImageData(0, 0, crop.width, crop.height);
      setHistory({ past: [], present: initial, future: [] });
      maskInitializedRef.current = true;
    };
    void initializeMask().catch(() => {
      const context = maskCanvas.getContext("2d")!;
      context.clearRect(0, 0, crop.width, crop.height);
      setHistory({
        past: [],
        present: context.getImageData(0, 0, crop.width, crop.height),
        future: [],
      });
      maskInitializedRef.current = true;
    });
  }, [loaded, maskAsset]);

  React.useEffect(() => {
    if (!loaded || !viewportRef.current) return;
    const viewport = viewportRef.current;
    const update = () => {
      const bounds = viewport.getBoundingClientRect();
      setFitScale(
        Math.max(
          0.01,
          Math.min(bounds.width / loaded.crop.width, bounds.height / loaded.crop.height) *
            0.92,
        ),
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [loaded]);

  const applyHistory = React.useCallback((next: MaskHistory<ImageData>) => {
    maskCanvasRef.current?.getContext("2d")?.putImageData(next.present, 0, 0);
    return next;
  }, []);

  const undo = React.useCallback(() => {
    setHistory((current) =>
      current ? applyHistory(reduceMaskHistory(current, { type: "undo" })) : current,
    );
  }, [applyHistory]);

  const redo = React.useCallback(() => {
    setHistory((current) =>
      current ? applyHistory(reduceMaskHistory(current, { type: "redo" })) : current,
    );
  }, [applyHistory]);

  const fit = React.useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (event.code === "Space" && !editing) {
        spacePressedRef.current = true;
        event.preventDefault();
      }
      if (editing) return;
      if (event.key.toLowerCase() === "b") setTool("brush");
      if (event.key.toLowerCase() === "e") setTool("eraser");
      if (event.key.toLowerCase() === "c") setTool("sphere");
      if (event.key.toLowerCase() === "r") setTool("box");
      if (event.key === "0") fit();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spacePressedRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [fit, redo, undo]);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * event.currentTarget.width,
      y: ((event.clientY - bounds.top) / bounds.height) * event.currentTarget.height,
    };
  };

  const paintDot = (point: { x: number; y: number }) => {
    const context = maskCanvasRef.current?.getContext("2d");
    if (!context) return;
    context.save();
    context.globalCompositeOperation =
      tool === "eraser" ? "destination-out" : "source-over";
    context.fillStyle = "rgba(244, 63, 94, 1)";
    context.beginPath();
    context.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  };

  const paintLine = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const context = maskCanvasRef.current?.getContext("2d");
    if (!context) return;
    context.save();
    context.globalCompositeOperation =
      tool === "eraser" ? "destination-out" : "source-over";
    context.strokeStyle = "rgba(244, 63, 94, 1)";
    context.lineWidth = brushSize;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.restore();
  };

  const paintShape = (from: Point, to: Point) => {
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !shapeBaseRef.current) return;
    context.putImageData(shapeBaseRef.current, 0, 0);
    context.save();
    context.fillStyle = "rgba(244, 63, 94, 1)";
    const width = to.x - from.x;
    const height = to.y - from.y;
    if (Math.abs(width) < 1 || Math.abs(height) < 1) {
      context.restore();
      return;
    }
    context.beginPath();
    if (tool === "sphere") {
      context.ellipse(
        from.x + width / 2,
        from.y + height / 2,
        Math.abs(width) / 2,
        Math.abs(height) / 2,
        0,
        0,
        Math.PI * 2,
      );
    } else {
      context.rect(from.x, from.y, width, height);
    }
    context.fill();
    context.restore();
  };

  const commitMask = () => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const snapshot = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height);
    setHistory((current) =>
      current
        ? reduceMaskHistory(current, { type: "commit", value: snapshot })
        : { past: [], present: snapshot, future: [] },
    );
    setDirty(true);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (spacePressedRef.current || event.button === 1) {
      panningRef.current = true;
      previousPointRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    if (pointersRef.current.size === 2) {
      const points = [...pointersRef.current.values()];
      pinchRef.current = {
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
        center: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
        zoom,
        pan,
      };
      return;
    }
    const point = canvasPoint(event);
    previousPointRef.current = point;
    if (tool === "sphere" || tool === "box") {
      const canvas = maskCanvasRef.current;
      if (!canvas) return;
      shapeStartRef.current = point;
      shapeBaseRef.current = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height);
    } else {
      paintDot(point);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    setBrushCursor(canvasPoint(event));
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const points = [...pointersRef.current.values()].slice(0, 2);
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      setZoom(Math.min(8, Math.max(0.25, pinchRef.current.zoom * (distance / pinchRef.current.distance))));
      setPan({
        x: pinchRef.current.pan.x + center.x - pinchRef.current.center.x,
        y: pinchRef.current.pan.y + center.y - pinchRef.current.center.y,
      });
      return;
    }
    if (panningRef.current && previousPointRef.current) {
      const point = { x: event.clientX, y: event.clientY };
      setPan((current) => ({
        x: current.x + point.x - previousPointRef.current!.x,
        y: current.y + point.y - previousPointRef.current!.y,
      }));
      previousPointRef.current = point;
      return;
    }
    if (shapeStartRef.current) {
      paintShape(shapeStartRef.current, canvasPoint(event));
    } else if (previousPointRef.current) {
      const point = canvasPoint(event);
      paintLine(previousPointRef.current, point);
      previousPointRef.current = point;
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const wasPainting = !panningRef.current && pointersRef.current.size < 2;
    if (wasPainting && shapeStartRef.current) {
      const end = canvasPoint(event);
      const distance = Math.hypot(
        end.x - shapeStartRef.current.x,
        end.y - shapeStartRef.current.y,
      );
      if (distance < 1) {
        const radius = brushSize / 2;
        paintShape(
          { x: end.x - radius, y: end.y - radius },
          { x: end.x + radius, y: end.y + radius },
        );
      } else {
        paintShape(shapeStartRef.current, end);
      }
    }
    pointersRef.current.delete(event.pointerId);
    previousPointRef.current = null;
    shapeStartRef.current = null;
    shapeBaseRef.current = null;
    panningRef.current = false;
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (wasPainting) commitMask();
  };

  const clearMask = () => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    commitMask();
  };

  const invertMask = () => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d")!;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < image.data.length; index += 4) {
      image.data[index] = 244;
      image.data[index + 1] = 63;
      image.data[index + 2] = 94;
      image.data[index + 3] = 255 - image.data[index + 3];
    }
    context.putImageData(image, 0, 0);
    commitMask();
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty && !window.confirm("저장하지 않은 인페인트 변경을 폐기할까요?")) return;
    onClose();
  };

  const saveMask = async () => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || !loaded) return;
    setError("");
    const maskContext = maskCanvas.getContext("2d")!;
    const painted = maskContext.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    if (!maskHasPaint(painted.data)) {
      setError("수정할 영역을 브러시로 칠해주세요.");
      return;
    }

    setSaving(true);
    try {
      const storedMask = document.createElement("canvas");
      storedMask.width = maskCanvas.width;
      storedMask.height = maskCanvas.height;
      const storedContext = storedMask.getContext("2d")!;
      const pixels = storedContext.createImageData(storedMask.width, storedMask.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        pixels.data[index] = 255;
        pixels.data[index + 1] = 255;
        pixels.data[index + 2] = 255;
        pixels.data[index + 3] = 255 - painted.data[index + 3];
      }
      storedContext.putImageData(pixels, 0, 0);
      const maskFile = new File([await canvasBlob(storedMask)], "inpaint-mask.png", {
        type: "image/png",
      });
      const uploadedMask = await uploadAsset(maskFile);
      onSave({
        maskAsset: uploadedMask,
        growMaskBy,
      });
      setDirty(false);
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "인페인트 마스크를 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };

  const controls = (
    <>
      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/55 p-1 backdrop-blur">
        <Button
          type="button"
          size="icon"
          variant={tool === "brush" ? "soft" : "ghost"}
          onClick={() => setTool("brush")}
          title="브러시 (B)"
          aria-label="브러시"
        >
          <Brush />
        </Button>
        <Button
          type="button"
          size="icon"
          variant={tool === "eraser" ? "soft" : "ghost"}
          onClick={() => setTool("eraser")}
          title="지우개 (E)"
          aria-label="지우개"
        >
          <Eraser />
        </Button>
        <Button
          type="button"
          size="icon"
          variant={tool === "sphere" ? "soft" : "ghost"}
          onClick={() => setTool("sphere")}
          title="구 (C)"
          aria-label="구"
        >
          <Circle />
        </Button>
        <Button
          type="button"
          size="icon"
          variant={tool === "box" ? "soft" : "ghost"}
          onClick={() => setTool("box")}
          title="박스 (R)"
          aria-label="박스"
        >
          <Square />
        </Button>
        <label className="flex items-center gap-2 px-2 text-[11px] text-white/80">
          크기
          <input
            type="range"
            min={4}
            max={256}
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
            className="w-20 accent-primary"
          />
          <span className="w-8 tabular-nums">{brushSize}</span>
        </label>
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/55 p-1 backdrop-blur">
        <Button type="button" size="icon" variant="ghost" onClick={undo} disabled={!history?.past.length} title="실행취소 (Ctrl+Z)">
          <Undo2 />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={redo} disabled={!history?.future.length} title="다시실행 (Ctrl+Shift+Z)">
          <Redo2 />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={clearMask} title="마스크 전체 삭제">
          <Trash2 />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={invertMask} title="마스크 반전">
          <FlipHorizontal2 />
        </Button>
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/55 p-1 backdrop-blur">
        <Button type="button" size="icon" variant="ghost" onClick={() => setZoom((value) => Math.max(0.25, value / 1.2))} aria-label="축소">
          <ZoomOut />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={fit} title="화면 맞춤 (0)">
          <Maximize />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={() => setZoom((value) => Math.min(8, value * 1.2))} aria-label="확대">
          <ZoomIn />
        </Button>
        <span className="px-2 text-[11px] tabular-nums text-white/75">{Math.round(zoom * 100)}%</span>
      </div>
    </>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        showClose={false}
        aria-describedby={undefined}
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-[#09090b] p-0"
      >
        <DialogHeader className="flex h-14 shrink-0 flex-row items-center gap-3 border-b border-white/10 px-3 sm:px-4">
          <DialogTitle className="text-sm sm:text-base">인페인트 마스크 편집</DialogTitle>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              ref={viewportRef}
              className="absolute inset-0 overflow-hidden bg-[#111116] [background-image:radial-gradient(circle_at_center,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:20px_20px]"
              onWheel={(event) => {
                event.preventDefault();
                if (event.altKey) {
                  setBrushSize((value) =>
                    Math.min(
                      256,
                      Math.max(4, Math.round(value * (event.deltaY > 0 ? 0.9 : 1.1))),
                    ),
                  );
                  return;
                }
                setZoom((value) =>
                  Math.min(8, Math.max(0.25, value * (event.deltaY > 0 ? 0.9 : 1.1))),
                );
              }}
            >
              {loaded ? (
                <div
                  className="absolute left-1/2 top-1/2 shadow-2xl"
                  style={{
                    width: loaded.crop.width,
                    height: loaded.crop.height,
                    transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${fitScale * zoom})`,
                    transformOrigin: "center",
                  }}
                >
                  <canvas ref={sourceCanvasRef} className="absolute inset-0 size-full" />
                  <canvas
                    ref={maskCanvasRef}
                    className={cn(
                      "absolute inset-0 size-full touch-none",
                      tool === "brush" || tool === "eraser"
                        ? "cursor-none"
                        : "cursor-crosshair",
                    )}
                    style={{ opacity: overlayOpacity }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerEnter={(event) => setBrushCursor(canvasPoint(event))}
                    onPointerLeave={() => setBrushCursor(null)}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  />
                  {brushCursor && (tool === "brush" || tool === "eraser") ? (
                    <div
                      className="pointer-events-none absolute z-10 rounded-full border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.75)]"
                      style={{
                        left: brushCursor.x,
                        top: brushCursor.y,
                        width: brushSize,
                        height: brushSize,
                        transform: "translate(-50%, -50%)",
                      }}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
                  {loadingError || <LoaderCircle className="size-6 animate-spin" />}
                </div>
              )}
            </div>

            <div className="absolute left-3 right-3 top-3 flex flex-wrap gap-2">{controls}</div>
            <div className="absolute bottom-20 left-3 right-3 flex flex-wrap items-end justify-between gap-2">
              <div className="flex flex-wrap gap-3 rounded-lg border border-white/10 bg-black/65 px-3 py-2 text-[11px] text-white/80 backdrop-blur">
                <label className="flex items-center gap-2">
                  오버레이 {Math.round(overlayOpacity * 100)}%
                  <input type="range" min={0.1} max={1} step={0.05} value={overlayOpacity} onChange={(event) => setOverlayOpacity(Number(event.target.value))} className="w-24 accent-primary" />
                </label>
                <label className="flex items-center gap-2">
                  마스크 확장
                  <Input
                    type="number"
                    min={0}
                    max={64}
                    value={growMaskBy}
                    onChange={(event) => {
                      setGrowMaskBy(Math.min(64, Math.max(0, Number(event.target.value))));
                      setDirty(true);
                    }}
                    className="h-7 w-16 bg-black/30 px-2 text-xs"
                  />
                  px
                </label>
              </div>
            </div>
        </div>

        {error ? (
          <button type="button" className="fixed bottom-20 left-1/2 z-[70] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-red-400/30 bg-red-950/95 px-4 py-3 text-sm text-red-100 shadow-xl" onClick={() => setError("")}>
            {error}
          </button>
        ) : null}

        <div className="fixed inset-x-0 bottom-0 z-[65] flex justify-end gap-2 border-t border-white/10 bg-black/90 p-3 backdrop-blur">
          <Button type="button" variant="ghost" disabled={saving} onClick={requestClose}>
            취소
          </Button>
          <Button type="button" disabled={saving || !loaded} onClick={() => void saveMask()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            {saving ? "저장 중" : "저장"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

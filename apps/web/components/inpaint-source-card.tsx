"use client";

import Image from "next/image";
import * as React from "react";
import {
  ImagePlus,
  LoaderCircle,
  Paintbrush,
  Replace,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadAsset } from "@/lib/api";
import {
  centeredInpaintCrop,
  emptyInpaintWorkspace,
  type InpaintWorkspaceDraft,
} from "@/lib/inpaint";
import { cn, outputUrl, uniqueId } from "@/lib/utils";

interface InpaintSourceCardProps {
  value: InpaintWorkspaceDraft;
  onChange: (value: InpaintWorkspaceDraft) => void;
  onEditMask: () => void;
  onUploadReady: (value: InpaintWorkspaceDraft) => void;
}

function loadFileImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("인페인트 원본 이미지를 읽지 못했습니다."));
    };
    image.src = url;
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("마스크 미리보기를 읽지 못했습니다."));
    image.src = src;
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("원본 PNG를 만들지 못했습니다.")),
      "image/png",
    );
  });
}

export function InpaintSourceCard({
  value,
  onChange,
  onEditMask,
  onUploadReady,
}: InpaintSourceCardProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const operationRef = React.useRef(0);
  const [draggingOver, setDraggingOver] = React.useState(false);
  const [selectionError, setSelectionError] = React.useState("");
  const [maskPreviewUrl, setMaskPreviewUrl] = React.useState("");

  React.useEffect(() => {
    const maskUrl = value.maskAsset?.url;
    let disposed = false;
    let objectUrl = "";
    setMaskPreviewUrl("");
    if (!maskUrl) return;

    void loadImage(outputUrl(maskUrl))
      .then(async (image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < pixels.data.length; index += 4) {
          pixels.data[index] = 244;
          pixels.data[index + 1] = 63;
          pixels.data[index + 2] = 94;
          pixels.data[index + 3] = 255 - pixels.data[index + 3];
        }
        context.putImageData(pixels, 0, 0);
        objectUrl = URL.createObjectURL(await canvasBlob(canvas));
        if (disposed) URL.revokeObjectURL(objectUrl);
        else setMaskPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setMaskPreviewUrl("");
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [value.maskAsset?.url]);

  const selectFile = React.useCallback(
    async (file: File) => {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        setSelectionError("PNG, JPG, WebP 이미지만 사용할 수 있습니다.");
        return;
      }
      if (
        value.maskAsset &&
        !window.confirm("원본을 교체하면 저장된 마스크가 초기화됩니다. 계속할까요?")
      ) {
        return;
      }
      setSelectionError("");

      const operation = ++operationRef.current;
      onChange({
        ...emptyInpaintWorkspace(),
        sourceStatus: "preparing",
      });
      try {
        const image = await loadFileImage(file);
        const crop = centeredInpaintCrop(image.naturalWidth, image.naturalHeight);
        if (crop.width < 64 || crop.height < 64) {
          throw new Error("인페인트 원본은 가로와 세로가 각각 64px 이상이어야 합니다.");
        }
        const canvas = document.createElement("canvas");
        canvas.width = crop.width;
        canvas.height = crop.height;
        canvas
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
        const blob = await canvasBlob(canvas);
        const previewUrl = URL.createObjectURL(blob);
        const optimisticId = uniqueId("inpaint-source");
        const optimisticAsset = {
          id: optimisticId,
          name: file.name,
          url: previewUrl,
          size: blob.size,
          width: crop.width,
          height: crop.height,
          status: "uploading" as const,
        };
        if (operation !== operationRef.current) {
          URL.revokeObjectURL(previewUrl);
          return;
        }
        onChange({
          ...emptyInpaintWorkspace(),
          source: { type: "asset", asset: optimisticAsset, crop },
          sourceStatus: "uploading",
        });
        const uploaded = await uploadAsset(
          new File([blob], "inpaint-source.png", { type: "image/png" }),
        ).finally(() => URL.revokeObjectURL(previewUrl));
        if (operation !== operationRef.current) return;
        const readyWorkspace = {
          ...emptyInpaintWorkspace(),
          source: { type: "asset", asset: uploaded, crop },
          sourceStatus: "ready" as const,
        };
        onChange(readyWorkspace);
        onUploadReady(readyWorkspace);
      } catch (error) {
        if (operation !== operationRef.current) return;
        onChange({
          ...emptyInpaintWorkspace(),
          sourceStatus: "error",
          sourceError:
            error instanceof Error ? error.message : "원본 업로드에 실패했습니다.",
        });
      }
    },
    [onChange, onUploadReady, value.maskAsset],
  );

  const clear = () => {
    if (
      value.maskAsset &&
      !window.confirm("원본과 저장된 마스크를 인페인트 카드에서 제거할까요?")
    ) {
      return;
    }
    operationRef.current += 1;
    setSelectionError("");
    if (value.source?.type === "asset" && value.source.asset.url.startsWith("blob:")) {
      URL.revokeObjectURL(value.source.asset.url);
    }
    onChange(emptyInpaintWorkspace());
  };

  const source = value.source;
  const previewUrl = source
    ? source.type === "asset"
      ? source.asset.url
      : outputUrl(source.output.url ?? source.output.id)
    : "";
  const crop = source?.crop;
  const busy = value.sourceStatus === "preparing" || value.sourceStatus === "uploading";

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void selectFile(file);
        }}
      />

      {!source ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDraggingOver(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setDraggingOver(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDraggingOver(false);
            const file = event.dataTransfer.files[0];
            if (file) void selectFile(file);
          }}
          className={cn(
            "panel-grid flex min-h-40 w-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background/30 px-6 py-7 text-center transition hover:border-primary/35 hover:bg-primary/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            draggingOver && "border-primary/60 bg-primary/[0.06]",
          )}
        >
          {busy ? (
            <LoaderCircle className="mb-3 size-6 animate-spin text-pink-300" />
          ) : draggingOver ? (
            <UploadCloud className="mb-3 size-6 text-pink-300" />
          ) : (
            <ImagePlus className="mb-3 size-6 text-pink-300" />
          )}
          <span className="text-sm font-medium">
            {busy ? "인페인트 원본 준비 중" : "이미지를 놓거나 클릭해서 추가"}
          </span>
          <span className="mt-1 text-xs text-muted-foreground">PNG, JPG, WebP · 1장</span>
        </button>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-background/30">
          <div className="relative aspect-video bg-black/40">
            <Image
              src={previewUrl}
              alt="인페인트 원본"
              fill
              unoptimized
              className="object-contain"
            />
            {maskPreviewUrl ? (
              <Image
                src={maskPreviewUrl}
                alt=""
                aria-hidden
                fill
                unoptimized
                className="pointer-events-none object-contain opacity-[0.45]"
              />
            ) : null}
            {busy ? (
              <div className="absolute inset-0 grid place-items-center bg-black/55">
                <LoaderCircle className="size-6 animate-spin text-pink-300" />
              </div>
            ) : null}
          </div>
          <div className="space-y-3 p-3">
            <div className="flex items-start justify-between gap-3 text-xs">
              <div>
                <p className="font-medium">{crop ? `${crop.width} × ${crop.height}` : "크기 확인 중"}</p>
                <p className="mt-1 text-muted-foreground">출력 크기는 원본에 고정됩니다.</p>
              </div>
              <div className="flex gap-1">
                <Button type="button" size="icon" variant="ghost" onClick={() => inputRef.current?.click()} title="원본 교체">
                  <Replace />
                </Button>
                <Button type="button" size="icon" variant="ghost" onClick={clear} title="인페인트 제거">
                  <Trash2 />
                </Button>
              </div>
            </div>
            <Button id="inpaint-mask-edit" type="button" className="w-full" variant="soft" disabled={value.sourceStatus !== "ready"} onClick={onEditMask}>
              <Paintbrush /> 마스크 편집
            </Button>
          </div>
        </div>
      )}

      {selectionError || (value.sourceStatus === "error" && value.sourceError) ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-400/25 bg-red-400/[0.06] px-3 py-2 text-xs text-red-200">
          <span>{selectionError || value.sourceError}</span>
          <div className="flex shrink-0 gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={clear}>
              해제
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>
              다시 선택
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

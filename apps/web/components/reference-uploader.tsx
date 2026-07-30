"use client";

import * as React from "react";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReferenceAsset } from "@/lib/types";
import { uploadAsset } from "@/lib/api";
import { cn, uniqueId } from "@/lib/utils";

interface ReferenceUploaderProps {
  assets: ReferenceAsset[];
  onChange: (assets: ReferenceAsset[]) => void;
  disabled?: boolean;
}

export function ReferenceUploader({
  assets,
  onChange,
  disabled,
}: ReferenceUploaderProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const assetsRef = React.useRef(assets);
  const [draggingOver, setDraggingOver] = React.useState(false);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);

  React.useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  const commit = React.useCallback(
    (next: ReferenceAsset[]) => {
      assetsRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const addFiles = React.useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (!files.length) return;

      const pending = files.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
        optimisticId: uniqueId("upload"),
      }));
      commit([
        ...assetsRef.current,
        ...pending.map(
          ({ file, previewUrl, optimisticId }): ReferenceAsset => ({
            id: optimisticId,
            name: file.name,
            url: previewUrl,
            size: file.size,
            status: "uploading",
          }),
        ),
      ]);

      await Promise.all(
        pending.map(async ({ file, previewUrl, optimisticId }) => {
          try {
            const uploaded = await uploadAsset(file);
            commit(
              assetsRef.current.map((asset) =>
                asset.id === optimisticId ? uploaded : asset,
              ),
            );
            URL.revokeObjectURL(previewUrl);
          } catch (error) {
            commit(
              assetsRef.current.map((asset) =>
                asset.id === optimisticId
                  ? {
                      ...asset,
                      status: "error",
                      error:
                        error instanceof Error
                          ? error.message
                          : "업로드에 실패했습니다.",
                    }
                  : asset,
              ),
            );
          }
        }),
      );
    },
    [commit],
  );

  function move(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= assets.length) return;
    const reordered = [...assets];
    const [item] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, item);
    commit(reordered);
  }

  function remove(index: number) {
    const asset = assets[index];
    if (asset.url.startsWith("blob:")) URL.revokeObjectURL(asset.url);
    commit(assets.filter((_, itemIndex) => itemIndex !== index));
  }

  function retry(index: number) {
    remove(index);
    inputRef.current?.click();
  }

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          if (event.currentTarget.files) void addFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
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
          void addFiles(event.dataTransfer.files);
        }}
        className={cn(
          "panel-grid group flex min-h-36 w-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background/30 px-6 py-7 text-center transition hover:border-primary/35 hover:bg-primary/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-50",
          draggingOver &&
            "border-primary/60 bg-primary/[0.06]",
        )}
      >
        <span className="mb-3 grid size-11 place-items-center rounded-xl border border-primary/15 bg-primary/10 text-pink-300 transition group-hover:scale-105 group-hover:bg-primary/15">
          {draggingOver ? (
            <UploadCloud className="size-5" />
          ) : (
            <ImagePlus className="size-5" />
          )}
        </span>
        <span className="text-sm font-medium">
          이미지를 놓거나 클릭해서 추가
        </span>
        <span className="mt-1 text-xs text-muted-foreground">
          PNG, JPG, WebP · 여러 각도와 거리를 섞으면 재현력이 좋아집니다
        </span>
      </button>

      {assets.length ? (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              참조 순서는 학습 입력 순서에 반영됩니다.
            </p>
            <Badge variant="secondary">{assets.length}장</Badge>
          </div>
          <div
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
            aria-label="참조 이미지 목록"
          >
            {assets.map((asset, index) => (
              <div
                key={asset.id}
                draggable={asset.status === "ready"}
                tabIndex={0}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragIndex === null || dragIndex === index) return;
                  const reordered = [...assets];
                  const [item] = reordered.splice(dragIndex, 1);
                  reordered.splice(index, 0, item);
                  commit(reordered);
                  setDragIndex(null);
                }}
                onKeyDown={(event) => {
                  if (event.altKey && event.key === "ArrowLeft") {
                    event.preventDefault();
                    move(index, -1);
                  }
                  if (event.altKey && event.key === "ArrowRight") {
                    event.preventDefault();
                    move(index, 1);
                  }
                  if (event.key === "Delete") remove(index);
                }}
                className={cn(
                  "group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40",
                  dragIndex === index && "opacity-50",
                  asset.status === "error" && "border-red-500/40",
                )}
                aria-label={`${index + 1}번째 참조 이미지, ${asset.name}. Alt+화살표로 순서 변경, Delete로 제거`}
              >
                <Image
                  src={asset.url}
                  alt={asset.name}
                  fill
                  unoptimized
                  priority={index === 0}
                  sizes="(max-width: 640px) 50vw, 180px"
                  className="object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-2 pb-2 pt-8 opacity-0 transition group-hover:opacity-100 group-focus:opacity-100">
                  <div className="flex items-center">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 text-white/75 hover:bg-white/10 hover:text-white"
                      disabled={index === 0}
                      aria-label={`${asset.name} 왼쪽으로 이동`}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowLeft />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 text-white/75 hover:bg-white/10 hover:text-white"
                      disabled={index === assets.length - 1}
                      aria-label={`${asset.name} 오른쪽으로 이동`}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowRight />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 text-white/75 hover:bg-red-500/20 hover:text-red-200"
                    aria-label={`${asset.name} 제거`}
                    onClick={() => remove(index)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <span className="absolute left-2 top-2 grid size-6 place-items-center rounded-full bg-black/65 text-[10px] font-semibold text-white backdrop-blur">
                  {index + 1}
                </span>
                {asset.status === "uploading" ? (
                  <div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-sm">
                    <LoaderCircle className="size-5 animate-spin text-pink-300" />
                    <span className="sr-only">업로드 중</span>
                  </div>
                ) : null}
                {asset.status === "error" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 p-3 text-center">
                    <p className="line-clamp-3 text-[11px] text-red-200">
                      {asset.error}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="mt-2 text-white"
                      onClick={() => retry(index)}
                    >
                      <RotateCcw />
                      다시 선택
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

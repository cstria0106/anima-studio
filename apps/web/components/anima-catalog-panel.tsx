"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Gauge,
  GraduationCap,
  LoaderCircle,
  ServerCog,
  Sparkles,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  HuggingFaceAnimaFile,
  HuggingFaceAnimaProviderResponse,
  ModelDownload,
} from "@/lib/types";
import { findAnimaFileDownload } from "@/lib/anima-library";
import { cn } from "@/lib/utils";

interface AnimaCatalogPanelProps {
  value: HuggingFaceAnimaProviderResponse | null;
  downloads: ModelDownload[];
  loading: boolean;
  installingPath: string;
  onInstall(file: HuggingFaceAnimaFile): Promise<void>;
  onOpenManagedRuntime(): void;
}

const dependencyPaths = new Set([
  "split_files/text_encoders/qwen_3_06b_base.safetensors",
  "split_files/vae/qwen_image_vae.safetensors",
]);

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[index]}`;
}

function modelPresentation(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.includes("base-v1.0")) {
    return {
      title: "Anima Base v1.0",
      description: "Instant Reference LoRA 학습과 캐릭터 재현에 권장",
      badge: "Instant LoRA 권장",
      icon: GraduationCap,
    };
  }
  if (lower.includes("turbo")) {
    return {
      title: "Anima Turbo v1.0",
      description: "빠른 생성용 · 권장 CFG 1, 8–12 steps",
      badge: "빠른 생성",
      icon: Gauge,
    };
  }
  if (lower.includes("aesthetic-v1.1")) {
    return {
      title: "Anima Aesthetic v1.1",
      description: "최신 Aesthetic 계열의 기본 품질 모델",
      badge: "최신 Aesthetic",
      icon: Sparkles,
    };
  }
  if (lower.includes("aesthetic")) {
    return {
      title: filename.replace(".safetensors", ""),
      description: "이전 Aesthetic 버전",
      badge: "이전 버전",
      icon: Sparkles,
    };
  }
  return {
    title: filename.replace(".safetensors", ""),
    description: "실험·미리보기 모델",
    badge: "실험",
    icon: AlertTriangle,
  };
}

export function AnimaCatalogPanel({
  value,
  downloads,
  loading,
  installingPath,
  onInstall,
  onOpenManagedRuntime,
}: AnimaCatalogPanelProps) {
  const [pendingFile, setPendingFile] =
    React.useState<HuggingFaceAnimaFile | null>(null);
  const catalog = value?.catalog;
  const models =
    catalog?.files.filter((file) => file.kind === "diffusion_model") ?? [];
  const stableModels = models.filter((file) => !file.experimental);
  const experimentalModels = models.filter((file) => file.experimental);
  const dependencies =
    catalog?.files.filter((file) => dependencyPaths.has(file.path)) ?? [];

  const stateFor = React.useCallback(
    (file: HuggingFaceAnimaFile) =>
      catalog
        ? findAnimaFileDownload(downloads, catalog.revision, file)
        : undefined,
    [catalog, downloads],
  );

  const plannedFiles = pendingFile
    ? [
        pendingFile,
        ...dependencies.filter(
          (dependency) =>
            stateFor(dependency)?.state !== "completed",
        ),
      ]
    : [];
  const plannedBytes = plannedFiles.reduce(
    (total, file) => total + file.sizeBytes,
    0,
  );
  const pendingInstalled =
    pendingFile !== null && stateFor(pendingFile)?.state === "completed";

  return (
    <>
      <Card surface="flat">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>공식 저장소</Badge>
                <Badge variant="secondary">Hugging Face</Badge>
                {catalog ? (
                  <Badge variant="outline">
                    {catalog.revision.slice(0, 8)}
                  </Badge>
                ) : null}
              </div>
              <CardTitle className="text-lg">Anima 공식 모델</CardTitle>
              <p className="text-[13px] leading-5 text-muted-foreground">
                CircleStone Labs의 고정 revision과 Git LFS SHA-256을
                확인한 뒤 관리형 ComfyUI 모델 폴더에 설치합니다.
              </p>
            </div>
            {catalog ? (
              <Button asChild variant="outline" size="sm">
                <a
                  href={catalog.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  저장소
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex min-h-36 items-center justify-center gap-2 rounded-lg border border-border bg-muted/20 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              공식 모델 목록을 확인하고 있습니다.
            </div>
          ) : !value || !catalog ? (
            <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-[13px] text-destructive">
              Anima 공식 모델 목록을 불러오지 못했습니다.
            </div>
          ) : (
            <>
              {!value.provider.managedDownloads ? (
                <div className="flex flex-col gap-3 rounded-lg border border-warning/35 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">관리형 런타임 필요</p>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      {value.provider.reason}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onOpenManagedRuntime}
                  >
                    <ServerCog className="h-4 w-4" />
                    엔진 설정 열기
                  </Button>
                </div>
              ) : null}

              <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-[12px] leading-5 text-muted-foreground">
                이 가중치는 CircleStone Labs Non-Commercial License의
                적용을 받습니다. 모델 사용은 비상업적 용도로 제한되며,
                생성한 출력물은 라이선스 조건에 따라 상업적으로 사용할
                수 있습니다.
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {stableModels.map((file) => {
                  const presentation = modelPresentation(file.filename);
                  const Icon = presentation.icon;
                  const download = stateFor(file);
                  const active =
                    download &&
                    !["completed", "failed", "cancelled"].includes(
                      download.state,
                    );
                  const installed = download?.state === "completed";
                  return (
                    <div
                      key={file.path}
                      className="rounded-xl border border-border bg-card p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-muted/35">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">
                              {presentation.title}
                            </p>
                            <Badge
                              variant={
                                file.recommended ? "success" : "secondary"
                              }
                            >
                              {presentation.badge}
                            </Badge>
                          </div>
                          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                            {presentation.description}
                          </p>
                          <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
                            {file.filename} · {formatBytes(file.sizeBytes)}
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        className="mt-4 w-full"
                        variant={installed ? "outline" : "default"}
                        disabled={
                          !value.provider.managedDownloads ||
                          Boolean(active) ||
                          installingPath === file.path
                        }
                        onClick={() => setPendingFile(file)}
                      >
                        {installingPath === file.path || active ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : installed ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        {installed
                          ? "설치 확인"
                          : active
                            ? "다운로드 중"
                            : "모델과 공용 파일 설치"}
                      </Button>
                    </div>
                  );
                })}
              </div>

              {experimentalModels.length ? (
                <details className="rounded-xl border border-border bg-muted/15">
                  <summary className="flex min-h-11 cursor-pointer items-center px-4 py-3 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    실험·Preview 모델 {experimentalModels.length}개
                  </summary>
                  <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
                    {experimentalModels.map((file) => {
                      const download = stateFor(file);
                      const installed = download?.state === "completed";
                      const active =
                        download &&
                        !["completed", "failed", "cancelled"].includes(
                          download.state,
                        );
                      return (
                        <button
                          key={file.path}
                          type="button"
                          aria-label={`${file.filename} · ${
                            installed
                              ? "설치 확인"
                              : active
                                ? "다운로드 중"
                                : "다운로드"
                          }`}
                          className={cn(
                            "flex min-h-14 items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left text-[12px]",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          )}
                          disabled={
                            !value.provider.managedDownloads ||
                            Boolean(active)
                          }
                          onClick={() => setPendingFile(file)}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {file.filename}
                            </span>
                            <span className="text-muted-foreground">
                              {formatBytes(file.sizeBytes)}
                            </span>
                          </span>
                          {installed ? (
                            <CheckCircle2 className="h-4 w-4 text-success" />
                          ) : active ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </details>
              ) : null}

              <div className="rounded-lg border border-border bg-muted/15 p-3">
                <p className="text-[12px] font-medium">자동 설치되는 공용 파일</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {dependencies.map((file) => {
                    const state = stateFor(file)?.state;
                    const status =
                      state === "completed"
                        ? "설치됨"
                        : state &&
                            !["failed", "cancelled"].includes(state)
                          ? "다운로드 중"
                          : "설치 필요";
                    return (
                      <Badge
                        key={file.path}
                        variant={
                          state === "completed" ? "success" : "outline"
                        }
                      >
                        {file.kind === "text_encoder"
                          ? "Qwen Text Encoder"
                          : "Qwen Image VAE"}
                        {" · "}
                        {formatBytes(file.sizeBytes)}
                        {" · "}
                        {status}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingFile !== null}
        onOpenChange={(open) => {
          if (!open) setPendingFile(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingInstalled
                ? "Anima 모델 설치를 확인할까요?"
                : "Anima 모델을 다운로드할까요?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {pendingInstalled
                    ? "설치 파일을 검증해 누락된 모델·Text Encoder·VAE만 고정 revision에서 다시 다운로드합니다. 같은 이름의 파일 내용이 다르면 덮어쓰지 않고 충돌을 알립니다."
                    : "선택한 모델과 아직 설치되지 않은 Text Encoder·VAE를 고정 revision에서 다운로드합니다."}
                </p>
                <div className="rounded-lg border border-border bg-muted/25 p-3">
                  <p className="font-medium text-foreground">
                    {pendingFile?.filename}
                  </p>
                  <p className="mt-1">
                    이번 요청 최대 {formatBytes(plannedBytes)} ·{" "}
                    {plannedFiles.length}개 파일
                  </p>
                </div>
                <p>
                  계속하면{" "}
                  <a
                    href={catalog?.licenseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground underline underline-offset-4"
                  >
                    CircleStone Labs Non-Commercial License
                  </a>
                  를 확인하고 동의한 것으로 처리됩니다.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingFile) return;
                const selected = pendingFile;
                setPendingFile(null);
                void onInstall(selected);
              }}
            >
              {pendingInstalled
                ? "라이선스 확인 후 설치 검증"
                : "라이선스 확인 후 다운로드"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

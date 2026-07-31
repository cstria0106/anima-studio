"use client";

import * as React from "react";
import {
  Download,
  Gauge,
  GraduationCap,
  LoaderCircle,
  ServerCog,
  Sparkles,
  Trash2,
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
} from "@/lib/types";

interface AnimaCatalogPanelProps {
  value: HuggingFaceAnimaProviderResponse | null;
  loading: boolean;
  onInstall(file: HuggingFaceAnimaFile): Promise<void>;
  onRemove(installationId: string): Promise<void>;
  onOpenManagedRuntime(): void;
}

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
    return { title: "Anima Base", icon: GraduationCap };
  }
  if (lower.includes("turbo-v1.0")) {
    return { title: "Anima Turbo", icon: Gauge };
  }
  return { title: "Anima Aesthetic", icon: Sparkles };
}

export function AnimaCatalogPanel({
  value,
  loading,
  onInstall,
  onRemove,
  onOpenManagedRuntime,
}: AnimaCatalogPanelProps) {
  const [pendingInstall, setPendingInstall] =
    React.useState<HuggingFaceAnimaFile | null>(null);
  const [pendingRemoval, setPendingRemoval] =
    React.useState<HuggingFaceAnimaFile | null>(null);
  const catalog = value?.catalog;
  const models =
    catalog?.files.filter(
      (file) =>
        file.kind === "diffusion_model" &&
        file.recommended &&
        !file.experimental,
    ) ?? [];

  return (
    <>
      <Card surface="flat">
        <CardHeader>
          <CardTitle className="text-lg">Anima 공식 모델</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              불러오는 중
            </div>
          ) : !value || !catalog ? (
            <p className="rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">
              공식 모델 목록을 불러오지 못했습니다.
            </p>
          ) : (
            <>
              {!value.provider.managedDownloads ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/35 bg-warning/10 p-4">
                  <p className="text-sm">{value.provider.reason}</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onOpenManagedRuntime}
                  >
                    <ServerCog />
                    엔진 설정
                  </Button>
                </div>
              ) : null}

              <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs leading-5 text-muted-foreground">
                CircleStone Labs Non-Commercial License가 적용됩니다.
              </p>

              <div className="grid gap-3 lg:grid-cols-3">
                {models.map((file) => {
                  const presentation = modelPresentation(file.filename);
                  const Icon = presentation.icon;
                  const installing =
                    file.installationStatus === "installing";
                  const installed =
                    file.installationStatus === "installed";
                  return (
                    <div
                      key={file.path}
                      className="rounded-xl border border-border bg-card p-4"
                    >
                      <div className="flex items-start gap-3">
                        <Icon className="mt-0.5 size-5 shrink-0 text-pink-300" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">
                              {presentation.title}
                            </p>
                            <Badge variant="success">최신 권장</Badge>
                          </div>
                          <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
                            {file.filename} · {formatBytes(file.sizeBytes)}
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        className="mt-4 w-full"
                        variant={installed ? "destructive" : "default"}
                        disabled={
                          !value.provider.managedDownloads || installing
                        }
                        onClick={() => {
                          if (installed) setPendingRemoval(file);
                          else setPendingInstall(file);
                        }}
                      >
                        {installing ? (
                          <LoaderCircle className="animate-spin" />
                        ) : installed ? (
                          <Trash2 />
                        ) : (
                          <Download />
                        )}
                        {installing
                          ? `설치 중 ${Math.round(file.installationProgress ?? 0)}%`
                          : installed
                            ? "제거"
                            : "설치"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingInstall !== null}
        onOpenChange={(open) => {
          if (!open) setPendingInstall(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anima 모델을 설치할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              모델과 공용 Text Encoder·VAE를 설치합니다. 계속하면{" "}
              <a
                href={catalog?.licenseUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline underline-offset-4"
              >
                라이선스
              </a>
              를 확인하고 동의한 것으로 처리됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const file = pendingInstall;
                setPendingInstall(null);
                if (file) void onInstall(file);
              }}
            >
              설치
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>모델을 제거할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              선택한 모델 파일만 제거합니다. 공용 Text Encoder와 VAE는
              유지됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const installationId = pendingRemoval?.installationId;
                setPendingRemoval(null);
                if (installationId) void onRemove(installationId);
              }}
            >
              제거
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

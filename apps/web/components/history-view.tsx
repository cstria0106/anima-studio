"use client";

import * as React from "react";
import Image from "next/image";
import {
  Dices,
  Download,
  ImageIcon,
  LoaderCircle,
  Maximize2,
  Settings2,
  Trash2,
} from "lucide-react";
import { UpscaleSettingsDialog } from "@/components/upscale-settings-dialog";
import { ZoomableImageViewer } from "@/components/zoomable-image-viewer";
import {
  AlertDialog,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GenerationDraft, StudioJob } from "@/lib/types";
import { cn, formatDate, outputUrl } from "@/lib/utils";

export interface HistoryDetailDialogProps {
  job: StudioJob | null;
  detailLoading: boolean;
  activeOutputId: string;
  actionError: string;
  actionNotice: string;
  deleting: boolean;
  onOpenChange: (open: boolean) => void;
  onOutputChange: (id: string) => void;
  onLoadSettings: (settings: GenerationDraft) => void;
  onLoadSeed: (seed: number) => void;
  onUpscale: (
    job: StudioJob,
    settings: GenerationDraft["upscale"],
    outputId: string,
  ) => Promise<void>;
  onDelete: (outputId: string) => Promise<boolean>;
}

function statusLabel(status: StudioJob["status"]): string {
  if (status === "completed") return "완료";
  if (status === "running") return "생성 중";
  if (status === "queued") return "대기";
  if (status === "uploading") return "업로드";
  if (status === "failed") return "실패";
  if (status === "cancelled") return "취소";
  return "초안";
}

function SettingRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-xs">{value}</span>
    </div>
  );
}

export function HistoryDetailDialog({
  job,
  detailLoading,
  activeOutputId,
  actionError,
  actionNotice,
  deleting,
  onOpenChange,
  onOutputChange,
  onLoadSettings,
  onLoadSeed,
  onUpscale,
  onDelete,
}: HistoryDetailDialogProps) {
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [upscaleOpen, setUpscaleOpen] = React.useState(false);

  React.useEffect(() => {
    setDeleteOpen(false);
    setUpscaleOpen(false);
  }, [job?.id]);

  if (!job) return null;
  const output =
    job.outputs.find((item) => item.id === activeOutputId) ?? job.outputs[0];
  const canUpscale =
    job.status === "completed" &&
    job.settings.upscale.enabled === false &&
    output?.kind === "base";

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1400px] sm:rounded-xl sm:border"
        >
          <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-14 sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>생성 상세</DialogTitle>
              <Badge variant={job.status === "completed" ? "success" : "secondary"}>
                {statusLabel(job.status)}
              </Badge>
              <span className="font-mono text-[10px] text-muted-foreground">
                {job.id.slice(0, 8)}
              </span>
            </div>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 sm:px-5">
            {output ? (
              <Button size="sm" variant="outline" asChild>
                <a href={outputUrl(output.url ?? output.id)} download>
                  <Download /> 이미지 저장
                </a>
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                onLoadSettings(structuredClone(job.settings));
                onOpenChange(false);
              }}
            >
              <Settings2 /> 설정 불러오기
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                onLoadSeed(job.settings.sampling.seed);
                onOpenChange(false);
              }}
            >
              <Dices /> 시드 불러오기
            </Button>
            {canUpscale ? (
              <Button type="button" size="sm" onClick={() => setUpscaleOpen(true)}>
                <Maximize2 /> 업스케일
              </Button>
            ) : null}
            {output ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto text-red-300 hover:text-red-200"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 /> 이미지 삭제
              </Button>
            ) : null}
          </div>

          {actionError ? (
            <p className="mx-4 mt-3 rounded-md border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-xs text-red-200">
              {actionError}
            </p>
          ) : null}
          {actionNotice ? (
            <p className="mx-4 mt-3 rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-xs text-emerald-200">
              {actionNotice}
            </p>
          ) : null}

          <div className="relative grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] lg:overflow-hidden">
            <div className="flex min-h-[50dvh] min-w-0 flex-col gap-3 lg:min-h-0">
              <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-black/30">
                {output ? (
                  <ZoomableImageViewer
                    src={outputUrl(output.url ?? output.id)}
                    alt="생성 결과"
                  />
                ) : (
                  <div className="grid h-full min-h-80 place-items-center text-muted-foreground">
                    <ImageIcon className="size-8" />
                  </div>
                )}
              </div>
              {job.outputs.length > 1 ? (
                <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
                  {job.outputs.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={cn(
                        "relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border",
                        output?.id === item.id
                          ? "border-primary ring-2 ring-primary/30"
                          : "border-border",
                      )}
                      onClick={() => onOutputChange(item.id)}
                    >
                      <Image
                        src={outputUrl(item.url ?? item.id)}
                        alt="다른 생성 결과"
                        fill
                        sizes="80px"
                        className="object-cover"
                      />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="min-h-0 space-y-3 overflow-y-auto lg:pr-1">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">생성 정보</CardTitle>
                </CardHeader>
                <CardContent>
                  <SettingRow label="생성 시각" value={formatDate(job.createdAt)} />
                  <SettingRow label="시드" value={job.settings.sampling.seed} />
                  <SettingRow
                    label="크기"
                    value={`${job.settings.sampling.width} × ${job.settings.sampling.height}`}
                  />
                  <SettingRow label="스텝" value={job.settings.sampling.steps} />
                  <SettingRow label="CFG" value={job.settings.sampling.cfg} />
                  <SettingRow label="샘플러" value={job.settings.sampling.sampler} />
                  <SettingRow label="스케줄러" value={job.settings.sampling.scheduler} />
                  <SettingRow label="모델" value={job.settings.models.diffusion || "선택 안 함"} />
                  <SettingRow
                    label="업스케일"
                    value={
                      job.settings.upscale.enabled
                        ? `${job.settings.upscale.method} · ${job.settings.upscale.scale}×`
                        : "사용 안 함"
                    }
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">프롬프트</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-xs leading-5">
                  <div>
                    <p className="mb-1 text-[11px] text-muted-foreground">Positive</p>
                    <p className="whitespace-pre-wrap break-words">
                      {job.settings.prompts.positive || "입력 없음"}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] text-muted-foreground">Negative</p>
                    <p className="whitespace-pre-wrap break-words text-muted-foreground">
                      {job.settings.prompts.negative || "입력 없음"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {detailLoading ? (
              <div className="absolute inset-0 grid place-items-center bg-background/55 backdrop-blur-sm">
                <LoaderCircle className="size-7 animate-spin" />
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="max-w-md border-destructive/30">
          <AlertDialogHeader>
            <AlertDialogTitle>선택한 이미지 1개를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              복구할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={deleting || !output}
              onClick={() => {
                if (output) void onDelete(output.id).then(() => setDeleteOpen(false));
              }}
            >
              {deleting ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              {deleting ? "삭제 중" : "삭제"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UpscaleSettingsDialog
        open={upscaleOpen}
        initialSettings={job.settings.upscale}
        onOpenChange={setUpscaleOpen}
        onSubmit={(settings) =>
          output ? onUpscale(job, settings, output.id) : Promise.resolve()
        }
      />
    </>
  );
}

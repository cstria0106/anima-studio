"use client";

import * as React from "react";
import { Download, LoaderCircle, Trash2, Zap } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useSnapRefInstall } from "@/components/use-snapref-install";
import { removeModelInstallation } from "@/lib/api";

function formatMegabytes(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

export function SnapRefLibraryCard({
  onOptionsChanged,
}: {
  onOptionsChanged: () => void;
}) {
  const { value, error, install, reload } = useSnapRefInstall(onOptionsChanged);
  const [pending, setPending] = React.useState<"install" | "remove" | null>(
    null,
  );
  const [removeError, setRemoveError] = React.useState("");
  const adapter = value?.adapter;
  const installing = adapter?.installationStatus === "installing";
  const installed = adapter?.installationStatus === "installed";

  async function remove() {
    if (!adapter?.installationId) return;
    setRemoveError("");
    try {
      await removeModelInstallation(adapter.installationId);
      onOptionsChanged();
      await reload();
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : "SnapRef 제거 실패");
    }
  }

  return (
    <Card surface="flat">
      <CardHeader>
        <CardTitle className="text-lg">SnapRef</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <Zap className="mt-0.5 size-5 shrink-0 text-violet-300" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">SnapRef v2a</p>
              <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
                {adapter
                  ? `${adapter.filename} · ${formatMegabytes(adapter.sizeBytes)}`
                  : "불러오는 중"}
              </p>
            </div>
          </div>
          {installing ? (
            <div className="mt-4 space-y-1.5">
              <Progress value={adapter?.installationProgress ?? null} />
              <p className="text-[11px] tabular-nums text-muted-foreground">
                설치 중 {Math.round(adapter?.installationProgress ?? 0)}%
              </p>
            </div>
          ) : (
            <Button
              type="button"
              className="mt-4 w-full"
              variant={installed ? "destructive" : "default"}
              disabled={
                !value ||
                (!installed && !value.managedDownloads) ||
                (installed && !adapter?.installationId)
              }
              onClick={() => setPending(installed ? "remove" : "install")}
            >
              {!value ? (
                <LoaderCircle className="animate-spin" />
              ) : installed ? (
                <Trash2 />
              ) : (
                <Download />
              )}
              {installed ? "제거" : "설치"}
            </Button>
          )}
        </div>
        {value && !value.managedDownloads && !installed ? (
          <p className="text-xs text-muted-foreground">{value.reason}</p>
        ) : null}
        {error || removeError ? (
          <p role="alert" className="text-xs text-destructive">
            {error || removeError}
          </p>
        ) : null}
      </CardContent>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === "remove"
                ? "SnapRef 가중치를 제거할까요?"
                : "SnapRef 가중치를 설치할까요?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending === "remove" ? (
                "SnapRef 참조 방식은 다시 설치할 때까지 사용할 수 없습니다."
              ) : (
                <>
                  Hugging Face에서 고정된 SnapRef v2a 파일을 받아 LoRA 폴더에
                  설치합니다. 계속하면{" "}
                  <a
                    href={adapter?.licenseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline underline-offset-4"
                  >
                    라이선스
                  </a>
                  를 확인하고 동의한 것으로 처리됩니다.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = pending;
                setPending(null);
                if (action === "remove") void remove();
                else void install();
              }}
            >
              {pending === "remove" ? "제거" : "설치"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

"use client";

import * as React from "react";
import { ExternalLink, Sparkles } from "lucide-react";
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
import { getAppUpdate } from "@/lib/api";
import type { AppUpdateInfo } from "@/lib/types";

export function AppUpdateDialog() {
  const [update, setUpdate] = React.useState<AppUpdateInfo | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();

    void getAppUpdate({ signal: controller.signal })
      .then((result) => {
        if (!result.updateAvailable || !result.releaseUrl) return;
        setUpdate(result);
        setOpen(true);
      })
      .catch(() => {
        // An update check must never interrupt local app startup.
      });

    return () => controller.abort();
  }, []);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <div className="mb-1 grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="size-5" aria-hidden="true" />
          </div>
          <AlertDialogTitle>새 버전이 있습니다</AlertDialogTitle>
          <AlertDialogDescription>
            현재 버전은 {update?.currentVersion}, 최신 버전은{" "}
            {update?.latestVersion}입니다. 릴리즈 페이지에서 새 버전을
            다운로드할 수 있습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {update?.releaseNotes ? (
          <section className="min-h-0" aria-labelledby="app-release-notes-title">
            <h3 id="app-release-notes-title" className="mb-2 text-sm font-medium">
              변경 사항
            </h3>
            <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-3 text-[13px] leading-5 text-muted-foreground">
              {update.releaseNotes}
            </div>
          </section>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>나중에</AlertDialogCancel>
          {update?.releaseUrl ? (
            <AlertDialogAction asChild>
              <a href={update.releaseUrl} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" />
                릴리즈 페이지 열기
              </a>
            </AlertDialogAction>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

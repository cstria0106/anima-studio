"use client";

import { AlertTriangle, CircleStop, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ActionConfirmationProps {
  open: boolean;
  action: "stop" | "restart";
  pid?: number | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ActionConfirmation({
  open,
  action,
  pid,
  busy = false,
  onCancel,
  onConfirm,
}: ActionConfirmationProps) {
  const restart = action === "restart";
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onCancel();
      }}
    >
      <AlertDialogContent className="max-w-md border-destructive/30">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive/10 text-red-300">
            <AlertTriangle className="size-4" />
          </span>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ComfyUI를 강제로 {restart ? "재시작" : "정지"}할까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              실행 중인 sampling·학습·다운로드가 중단될 수 있습니다. 서버는
              PID, 실행 파일과 시작 시각이 일치하는 앱 소유 프로세스만
              종료합니다.
            </AlertDialogDescription>
            {pid ? (
              <p className="mt-1 rounded-md bg-surface-2 px-2 py-1 font-mono text-xs text-muted-foreground">
                대상 PID {pid}
              </p>
            ) : null}
          </AlertDialogHeader>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
            >
              취소
            </Button>
          </AlertDialogCancel>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={onConfirm}
            disabled={busy}
          >
            {restart ? <RotateCcw /> : <CircleStop />}
            {busy
              ? "요청 중"
              : `강제 ${restart ? "재시작" : "정지"}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

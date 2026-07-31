"use client";

import * as React from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  getComfyRuntime,
  getOperation,
  runComfyRuntimeAction,
} from "@/lib/api";
import {
  runtimeRecoveryAction,
  runtimeStartupDecision,
  type RuntimeRecoveryAction,
} from "@/lib/runtime-startup";
import type { LongOperation } from "@/lib/types";

const API_STARTUP_TIMEOUT_MS = 150_000;
const POLL_INTERVAL_MS = 1_000;

interface RuntimeStartupGateProps {
  onReady(): void;
  onOpenSettings(): void;
}

type GateState =
  | {
      kind: "loading";
      title: string;
      operation: LongOperation | null;
    }
  | {
      kind: "failed";
      title: string;
      message: string;
      action: RuntimeRecoveryAction | null;
    };

const actionLabels = {
  install: "엔진 설치",
  start: "시작",
  repair: "복구",
} as const;

const actionTitles = {
  install: "ComfyUI 엔진 설치 중",
  start: "ComfyUI 시작 중",
  repair: "ComfyUI 엔진 복구 중",
} as const;

export function RuntimeStartupGate({
  onReady,
  onOpenSettings,
}: RuntimeStartupGateProps) {
  const onReadyRef = React.useRef(onReady);
  React.useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<GateState>({
    kind: "loading",
    title: "ComfyUI 연결 중",
    operation: null,
  });

  React.useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let updateRequested = false;
    let operationId: string | null = null;
    const startedAt = Date.now();

    const schedule = () => {
      timer = window.setTimeout(() => void inspect(), POLL_INTERVAL_MS);
    };

    const fail = (
      message: string,
      action: RuntimeRecoveryAction | null = null,
    ) => {
      setState({
        kind: "failed",
        title: "ComfyUI를 준비하지 못했습니다",
        message,
        action,
      });
    };

    const inspect = async (): Promise<void> => {
      try {
        const runtime = await getComfyRuntime();
        if (cancelled) return;

        if (operationId || runtime.activeOperationId) {
          operationId = operationId ?? runtime.activeOperationId;
          const operation = operationId
            ? await getOperation(operationId).catch(() => null)
            : null;
          if (cancelled) return;
          if (operation?.status === "failed") {
            fail(operation.error ?? operation.message);
            return;
          }
          if (operation?.kind === "runtime_update") updateRequested = true;
          setState({
            kind: "loading",
            title: "ComfyUI 엔진 업데이트 중",
            operation,
          });
        }

        const decision = runtimeStartupDecision(runtime);
        if (decision.kind === "ready") {
          onReadyRef.current();
          return;
        }
        if (decision.kind === "update") {
          if (!updateRequested && !runtime.activeOperationId) {
            updateRequested = true;
            setState({
              kind: "loading",
              title: "ComfyUI 엔진 업데이트 중",
              operation: null,
            });
            let result;
            try {
              result = await runComfyRuntimeAction("update");
            } catch (error) {
              fail(
                error instanceof Error
                  ? error.message
                  : "ComfyUI 엔진 업데이트를 시작하지 못했습니다.",
              );
              return;
            }
            if (cancelled) return;
            operationId = result.operation?.id ?? null;
          }
          schedule();
          return;
        }
        if (
          decision.kind === "wait" ||
          (updateRequested &&
            runtime.installed &&
            runtime.autoStart &&
            runtime.state === "stopped")
        ) {
          if (!operationId && !runtime.activeOperationId) {
            setState({
              kind: "loading",
              title: "ComfyUI 시작 중",
              operation: null,
            });
          }
          schedule();
          return;
        }
        fail(decision.message, runtimeRecoveryAction(runtime));
      } catch (error) {
        if (cancelled) return;
        if (Date.now() - startedAt < API_STARTUP_TIMEOUT_MS) {
          setState({
            kind: "loading",
            title: "앱 서버 시작 중",
            operation: null,
          });
          schedule();
          return;
        }
        fail(
          error instanceof Error
            ? error.message
            : "로컬 앱 서버에 연결할 수 없습니다.",
        );
      }
    };

    void inspect();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [attempt]);

  const retry = () => {
    setState({
      kind: "loading",
      title: "다시 확인 중",
      operation: null,
    });
    setAttempt((current) => current + 1);
  };

  const runRecovery = async () => {
    if (state.kind !== "failed" || !state.action) return;
    const action = state.action;
    setState({
      kind: "loading",
      title: actionTitles[action],
      operation: null,
    });
    try {
      await runComfyRuntimeAction(action);
      setAttempt((current) => current + 1);
    } catch (error) {
      setState({
        kind: "failed",
        title: "ComfyUI를 준비하지 못했습니다",
        message:
          error instanceof Error ? error.message : "요청을 실행하지 못했습니다.",
        action,
      });
    }
  };

  const progress = state.kind === "loading" ? state.operation?.progress : null;

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <section className="w-full max-w-lg text-center">
        <header className="flex flex-col items-center pb-3">
          {state.kind === "loading" ? (
            <LoaderCircle className="size-6 animate-spin text-primary" />
          ) : (
            <div className="grid size-14 place-items-center rounded-2xl border border-border bg-surface-2">
              <AlertTriangle className="size-6 text-danger" />
            </div>
          )}
          <h1 className="mt-2 text-lg font-semibold">{state.title}</h1>
        </header>
        <div className="space-y-4">
          {state.kind === "loading" ? (
            <div role="status" aria-live="polite" className="space-y-2">
              <Progress value={progress ?? undefined} />
              {progress === null || progress === undefined ? null : (
                <p className="text-[11px] text-muted-foreground">
                  {Math.round(progress)}%
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p
                role="alert"
                className="break-words text-sm leading-6 text-muted-foreground"
              >
                {state.message}
              </p>
              <div className="flex flex-col justify-center gap-2 sm:flex-row">
                {state.action ? (
                  <Button type="button" onClick={() => void runRecovery()}>
                    {actionLabels[state.action]}
                  </Button>
                ) : null}
                <Button type="button" onClick={retry}>
                  다시 확인
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onOpenSettings}
                >
                  엔진 설정 열기
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

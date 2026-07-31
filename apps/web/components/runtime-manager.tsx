"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleStop,
  Copy,
  Download,
  HardDriveDownload,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  ServerCog,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react";
import { ActionConfirmation } from "@/components/action-confirmation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Field, SectionHeading } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  type CompletionNotificationPanelProps,
  useCompletionNotifications,
} from "@/components/completion-notifications";
import {
  getComfyRuntime,
  getOperation,
  getRuntimeLogs,
  operationEventsUrl,
  runComfyRuntimeAction,
  runtimeLogEventsUrl,
  updateComfyRuntime,
} from "@/lib/api";
import type {
  ComfyRuntime,
  LongOperation,
  RuntimeAction,
  RuntimeConfigUpdate,
  RuntimeLogEntry,
  RuntimeState,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface RuntimeManagerProps {
  onSystemRefresh: () => void;
  notificationController?: CompletionNotificationPanelProps["controller"];
}

const runtimeLabels: Record<RuntimeState, string> = {
  not_installed: "설치 필요",
  installing: "설치 중",
  stopped: "중지됨",
  starting: "시작 중",
  ready: "실행 중",
  stopping: "종료 중",
  updating: "업데이트 중",
  repairing: "복구 중",
  failed: "오류",
};

const transitionalStates = new Set<RuntimeState>([
  "installing",
  "starting",
  "stopping",
  "updating",
  "repairing",
]);

function statusVariant(
  state?: RuntimeState,
): "success" | "warning" | "destructive" | "secondary" {
  if (state === "ready") return "success";
  if (state === "failed") return "destructive";
  if (state && transitionalStates.has(state)) return "warning";
  return "secondary";
}

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let index = -1;
  do {
    size /= 1024;
    index += 1;
  } while (size >= 1024 && index < units.length - 1);
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[index]}`;
}

function formatTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("ko-KR", { hour12: false });
}

function logFromEvent(event: MessageEvent<string>): RuntimeLogEntry | null {
  try {
    const parsed = JSON.parse(event.data) as
      | RuntimeLogEntry
      | { entry?: RuntimeLogEntry };
    const value =
      parsed && typeof parsed === "object" && "entry" in parsed
        ? parsed.entry
        : parsed;
    if (!value || typeof value !== "object" || !("message" in value)) {
      return null;
    }
    return {
      id: value.id ?? `${Date.now()}-${Math.random()}`,
      timestamp: value.timestamp ?? new Date().toISOString(),
      stream:
        value.stream === "stderr" || value.stream === "system"
          ? value.stream
          : "stdout",
      ...(value.level ? { level: value.level } : {}),
      message: String(value.message),
    };
  } catch {
    if (!event.data) return null;
    return {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      stream: "stdout",
      message: event.data,
    };
  }
}

export function RuntimeManager({
  onSystemRefresh,
  notificationController,
}: RuntimeManagerProps) {
  const onSystemRefreshRef = React.useRef(onSystemRefresh);
  React.useEffect(() => {
    onSystemRefreshRef.current = onSystemRefresh;
  }, [onSystemRefresh]);
  const [runtime, setRuntime] = React.useState<ComfyRuntime | null>(null);
  const [config, setConfig] = React.useState<RuntimeConfigUpdate>({
    mode: "managed",
    externalUrl: null,
    autoStart: true,
    stopWithApi: true,
    port: null,
  });
  const [operation, setOperation] = React.useState<LongOperation | null>(null);
  const [logs, setLogs] = React.useState<RuntimeLogEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [activeAction, setActiveAction] =
    React.useState<RuntimeAction | null>(null);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [logError, setLogError] = React.useState("");
  const [logQuery, setLogQuery] = React.useState("");
  const [logPaused, setLogPaused] = React.useState(false);
  const [logLive, setLogLive] = React.useState(false);
  const [forceAction, setForceAction] = React.useState<
    "stop" | "restart" | null
  >(null);
  const logViewportRef = React.useRef<HTMLDivElement>(null);
  const localNotifications = useCompletionNotifications();
  const notifications = notificationController ?? localNotifications;

  const adoptRuntime = React.useCallback((next: ComfyRuntime) => {
    setRuntime(next);
    setConfig({
      mode: next.mode,
      externalUrl: next.externalUrl,
      autoStart: next.autoStart,
      stopWithApi: next.stopWithApi,
      port: next.port,
    });
  }, []);

  const refreshRuntime = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = await getComfyRuntime();
      adoptRuntime(next);
      setError("");
      if (next.activeOperationId) {
        getOperation(next.activeOperationId)
          .then(setOperation)
          .catch(() => undefined);
      }
    } catch (cause) {
      if (!silent) {
        setError(
          cause instanceof Error
            ? cause.message
            : "런타임 상태를 불러오지 못했습니다.",
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [adoptRuntime]);

  const refreshLogs = React.useCallback(async () => {
    try {
      const result = await getRuntimeLogs({ limit: 500 });
      setLogs(result.entries.slice(-1000));
      setLogError("");
    } catch (cause) {
      setLogError(
        cause instanceof Error
          ? cause.message
          : "ComfyUI 로그를 불러오지 못했습니다.",
      );
    }
  }, []);

  React.useEffect(() => {
    void refreshRuntime();
    void refreshLogs();
  }, [refreshLogs, refreshRuntime]);

  React.useEffect(() => {
    if (!runtime) return;
    const shouldPoll =
      transitionalStates.has(runtime.state) ||
      Boolean(runtime.activeOperationId) ||
      operation?.status === "running" ||
      operation?.status === "queued";
    if (!shouldPoll) return;
    const timer = window.setInterval(() => {
      void refreshRuntime(true);
      if (operation?.id) {
        getOperation(operation.id).then(setOperation).catch(() => undefined);
      }
    }, 1800);
    return () => window.clearInterval(timer);
  }, [operation?.id, operation?.status, refreshRuntime, runtime]);

  const runtimeMode = runtime?.mode;

  React.useEffect(() => {
    if (runtimeMode !== "managed") return;
    const source = new EventSource(runtimeLogEventsUrl());
    const handleLog = (event: MessageEvent<string>) => {
      setLogLive(true);
      if (logPaused) return;
      const entry = logFromEvent(event);
      if (!entry) return;
      setLogs((current) => {
        const last = current[current.length - 1];
        if (
          last &&
          last.id === entry.id &&
          last.timestamp === entry.timestamp &&
          last.message === entry.message
        ) {
          return current;
        }
        return [...current, entry].slice(-1000);
      });
    };
    source.onopen = () => {
      setLogLive(true);
      // Reload the persisted tail after every (re)connect so lines written
      // while EventSource was offline are restored before live tailing resumes.
      void refreshLogs();
    };
    source.onmessage = handleLog;
    source.addEventListener("log", handleLog as EventListener);
    source.onerror = () => setLogLive(false);
    return () => {
      source.close();
      setLogLive(false);
    };
  }, [logPaused, refreshLogs, runtimeMode]);

  React.useEffect(() => {
    if (!operation?.id || !["queued", "running"].includes(operation.status)) {
      return;
    }
    const source = new EventSource(operationEventsUrl(operation.id));
    const handleEvent = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as
          | LongOperation
          | {
              operation?: LongOperation;
              status?: LongOperation["status"];
              phase?: string;
              message?: string;
              progress?: number | null;
              createdAt?: string;
            };
        const next =
          parsed && typeof parsed === "object" && "operation" in parsed
            ? parsed.operation
            : parsed;
        if (next && typeof next === "object" && "status" in next) {
          if ("kind" in next && "metadata" in next) {
            setOperation(next as LongOperation);
          } else {
            setOperation((current) =>
              current
                ? {
                    ...current,
                    status: next.status ?? current.status,
                    phase: next.phase ?? current.phase,
                    message: next.message ?? current.message,
                    progress:
                      next.progress === undefined
                        ? current.progress
                        : next.progress,
                    updatedAt: next.createdAt ?? current.updatedAt,
                  }
                : current,
            );
          }
          if (
            next.status === "completed" ||
            next.status === "failed" ||
            next.status === "cancelled"
          ) {
            void refreshRuntime(true);
            onSystemRefreshRef.current();
          }
        }
      } catch {
        getOperation(operation.id).then(setOperation).catch(() => undefined);
      }
    };
    source.onmessage = handleEvent;
    source.addEventListener("operation", handleEvent as EventListener);
    return () => source.close();
  }, [operation?.id, operation?.status, refreshRuntime]);

  const notifyCompletion = notifications.notify;
  React.useEffect(() => {
    if (
      !operation ||
      !["completed", "failed", "cancelled"].includes(operation.status)
    ) {
      return;
    }
    notifyCompletion({
      id: `${operation.id}:${operation.status}`,
      title:
        operation.status === "completed"
          ? "Anima Studio 작업 완료"
          : operation.status === "failed"
            ? "Anima Studio 작업 실패"
            : "Anima Studio 작업 취소",
      body:
        operation.error ??
        operation.message ??
        `${operation.kind} 작업이 ${operation.status} 상태가 됐습니다.`,
      tone: operation.status === "completed" ? "success" : "error",
    });
  }, [notifyCompletion, operation]);

  const filteredLogs = React.useMemo(() => {
    const query = logQuery.trim().toLocaleLowerCase();
    if (!query) return logs;
    return logs.filter((entry) =>
      `${entry.stream} ${entry.level ?? ""} ${entry.message}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [logQuery, logs]);

  React.useEffect(() => {
    if (logPaused) return;
    const viewport = logViewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [filteredLogs.length, logPaused]);

  async function saveConfig() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await updateComfyRuntime({
        ...config,
        externalUrl:
          config.mode === "external"
            ? config.externalUrl?.trim() || null
            : null,
      });
      adoptRuntime(next);
      setNotice("런타임 연결 설정을 저장했습니다.");
      onSystemRefresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "설정을 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function performAction(action: RuntimeAction, force = false) {
    setActiveAction(action);
    setError("");
    setNotice("");
    try {
      const result = await runComfyRuntimeAction(action, {
        ...(force ? { force: true } : {}),
      });
      adoptRuntime(result.runtime);
      if (result.operation) setOperation(result.operation);
      setNotice(
        action === "install"
          ? "엔진 설치를 시작했습니다."
          : action === "start"
            ? "ComfyUI를 시작하고 있습니다."
            : action === "stop"
              ? "ComfyUI 종료를 요청했습니다."
              : action === "restart"
                ? "ComfyUI를 재시작하고 있습니다."
                : action === "update"
                  ? "새 엔진 슬롯 설치를 시작했습니다."
                  : "엔진 검증과 복구를 시작했습니다.",
      );
      onSystemRefresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "런타임 요청에 실패했습니다.",
      );
    } finally {
      setActiveAction(null);
    }
  }

  async function copyLogs() {
    await navigator.clipboard.writeText(
      filteredLogs
        .map(
          (entry) =>
            `${entry.timestamp ? `[${entry.timestamp}] ` : ""}${entry.stream}: ${entry.message}`,
        )
        .join("\n"),
    );
    setNotice("현재 표시된 로그를 클립보드에 복사했습니다.");
  }

  function downloadLogs() {
    const value = filteredLogs
      .map(
        (entry) =>
          `${entry.timestamp ? `[${entry.timestamp}] ` : ""}${entry.stream}: ${entry.message}`,
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([value], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `comfyui-${new Date().toISOString().replaceAll(":", "-")}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const busy =
    saving ||
    Boolean(activeAction) ||
    Boolean(runtime && transitionalStates.has(runtime.state));
  const managed = config.mode === "managed";

  return (
    <div className="space-y-5">
      <Card id="runtime-manager">
      <CardHeader>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <SectionHeading
            eyebrow={managed ? "Managed engine" : "External engine"}
            title={managed ? "ComfyUI 런타임" : "외부 ComfyUI 연결"}
            description={
              managed
                ? "앱 전용 ComfyUI의 설치, 실행과 로그를 이 화면에서 관리합니다."
                : "외부 ComfyUI의 상태와 로그를 확인합니다. 앱은 외부 프로세스를 설치하거나 종료하지 않습니다."
            }
          />
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant(runtime?.state)}>
              {runtime?.state && transitionalStates.has(runtime.state) ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : runtime?.state === "ready" ? (
                <CheckCircle2 className="size-3" />
              ) : null}
              {runtime ? runtimeLabels[runtime.state] : loading ? "확인 중" : "알 수 없음"}
            </Badge>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={() => void refreshRuntime()}
              disabled={loading}
              aria-label="런타임 상태 새로고침"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <div
            role="alert"
            className="flex gap-3 rounded-lg border border-red-400/20 bg-red-400/[0.06] p-3 text-xs text-red-100"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-300" />
            <p className="leading-5">{error}</p>
          </div>
        ) : null}
        {notice ? (
          <div className="flex gap-3 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.05] p-3 text-xs text-emerald-100">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
            <p className="leading-5">{notice}</p>
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)]">
          <div className="space-y-4 rounded-xl border border-border/70 bg-background/25 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="연결 모드"
                hint={managed ? "앱이 설치·실행" : "기존 서버에 연결"}
                htmlFor="runtime-mode"
              >
                <select
                  id="runtime-mode"
                  value={config.mode}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      mode: event.target.value as RuntimeConfigUpdate["mode"],
                    }))
                  }
                  className="h-10 w-full rounded-md border border-input bg-background/55 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  disabled={busy}
                >
                  <option value="managed">Managed · 자동 관리</option>
                  <option value="external">External · 기존 ComfyUI</option>
                </select>
              </Field>
              {managed ? (
                <Field
                  label="포트"
                  hint="비우면 자동 선택"
                  htmlFor="runtime-port"
                >
                  <Input
                    id="runtime-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={config.port ?? ""}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        port: event.target.value
                          ? Number(event.target.value)
                          : null,
                      }))
                    }
                    placeholder="8188–8199에서 자동 선택"
                    disabled={busy}
                  />
                </Field>
              ) : (
                <Field
                  label="외부 ComfyUI URL"
                  htmlFor="runtime-external-url"
                >
                  <Input
                    id="runtime-external-url"
                    value={config.externalUrl ?? ""}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        externalUrl: event.target.value,
                      }))
                    }
                    placeholder="http://127.0.0.1:8188"
                    disabled={busy}
                  />
                </Field>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/35 p-3">
                <span>
                  <span className="block text-xs font-medium">API 시작 시 실행</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    관리형 런타임 자동 시작
                  </span>
                </span>
                <Switch
                  checked={config.autoStart}
                  onCheckedChange={(autoStart) =>
                    setConfig((current) => ({ ...current, autoStart }))
                  }
                  disabled={!managed || busy}
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/35 p-3">
                <span>
                  <span className="block text-xs font-medium">API 종료 시 정지</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    앱이 시작한 프로세스만 종료
                  </span>
                </span>
                <Switch
                  checked={config.stopWithApi}
                  onCheckedChange={(stopWithApi) =>
                    setConfig((current) => ({ ...current, stopWithApi }))
                  }
                  disabled={!managed || busy}
                />
              </label>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={() => void saveConfig()}
                disabled={saving || Boolean(activeAction)}
              >
                {saving ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Save />
                )}
                연결 설정 저장
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              {
                label: "엔진",
                value: runtime?.bundleId ?? (runtime?.installed ? "설치됨" : "—"),
              },
              { label: "ComfyUI", value: runtime?.comfyVersion ?? "—" },
              {
                label: "GPU",
                value: runtime?.hardware?.gpuName ?? "확인되지 않음",
              },
              {
                label: "VRAM",
                value: formatBytes(runtime?.hardware?.vramBytes),
              },
              {
                label: "주소",
                value: runtime?.comfyUrl ?? "—",
              },
              {
                label: "PID",
                value: runtime?.pid ? String(runtime.pid) : "—",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="min-w-0 rounded-lg border border-border/65 bg-background/25 p-3"
              >
                <p className="text-[10px] text-muted-foreground">{item.label}</p>
                <p className="mt-1 truncate text-xs font-medium" title={item.value}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {runtime?.hardware?.warnings.length ? (
          <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.05] p-3">
            {runtime.hardware.warnings.map((warning) => (
              <p key={warning} className="text-xs leading-5 text-amber-100/80">
                {warning}
              </p>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void performAction("install")}
            disabled={
              !managed ||
              busy ||
              loading ||
              Boolean(runtime?.installed)
            }
          >
            {activeAction === "install" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <HardDriveDownload />
            )}
            엔진 설치
          </Button>
          <Button
            type="button"
            size="sm"
            variant="soft"
            onClick={() => void performAction("start")}
            disabled={
              !managed ||
              busy ||
              !runtime?.installed ||
              runtime.state === "ready"
            }
          >
            <Play />
            시작
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void performAction("stop")}
            disabled={!managed || busy || runtime?.state !== "ready"}
          >
            <CircleStop />
            정지
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void performAction("restart")}
            disabled={!managed || busy || runtime?.state !== "ready"}
          >
            <RotateCcw />
            재시작
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void performAction("update")}
            disabled={
              !managed ||
              busy ||
              !runtime?.installed ||
              runtime.state !== "stopped"
            }
          >
            <Download />
            업데이트
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void performAction("repair")}
            disabled={
              !managed ||
              busy ||
              !runtime?.installed ||
              runtime.state !== "stopped"
            }
          >
            <Wrench />
            복구
          </Button>
          {managed && runtime?.pid ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => setForceAction("stop")}
                disabled={busy || transitionalStates.has(runtime.state)}
              >
                <CircleStop />
                강제 정지
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => setForceAction("restart")}
                disabled={busy || transitionalStates.has(runtime.state)}
              >
                <RotateCcw />
                강제 재시작
              </Button>
            </>
          ) : null}
        </div>

        {operation ? (
          <div className="rounded-xl border border-primary/20 bg-primary/[0.05] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium">
                  {operation.phase || "작업 준비 중"}
                </p>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {operation.error ?? operation.message}
                </p>
              </div>
              <Badge
                variant={
                  operation.status === "completed"
                    ? "success"
                    : operation.status === "failed"
                      ? "destructive"
                      : "warning"
                }
              >
                {operation.status}
              </Badge>
            </div>
            <Progress value={operation.progress} className="mt-3" />
            <div className="mt-2 flex justify-between gap-3 text-[10px] text-muted-foreground">
              <span>{operation.progress === null ? "활동 중" : `${Math.round(operation.progress)}%`}</span>
              {operation.latestEvent?.bytesCompleted !== null &&
              operation.latestEvent?.bytesCompleted !== undefined ? (
                <span>
                  {formatBytes(operation.latestEvent.bytesCompleted)}
                  {operation.latestEvent.bytesTotal
                    ? ` / ${formatBytes(operation.latestEvent.bytesTotal)}`
                    : ""}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-border/75 bg-[#09090f]">
          <div className="flex flex-col gap-3 border-b border-border/65 p-3 md:flex-row md:items-center">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-violet-300" />
              <p className="text-xs font-medium">ComfyUI 로그</p>
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  logLive ? "bg-emerald-400" : "bg-muted-foreground/50",
                )}
                title={logLive ? "실시간 연결됨" : "실시간 연결 대기"}
              />
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2 md:justify-end">
              <Input
                value={logQuery}
                onChange={(event) => setLogQuery(event.target.value)}
                placeholder="로그 검색"
                className="h-8 min-w-0 max-w-xs font-mono text-[11px]"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => setLogPaused((value) => !value)}
                aria-label={logPaused ? "로그 실시간 표시 재개" : "로그 실시간 표시 일시정지"}
              >
                {logPaused ? <Play /> : <Pause />}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => void copyLogs()}
                aria-label="로그 복사"
              >
                <Copy />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={downloadLogs}
                aria-label="로그 다운로드"
              >
                <Download />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => setLogs([])}
                aria-label="표시된 로그 비우기"
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          <div
            ref={logViewportRef}
            className="h-72 overflow-auto p-3 font-mono text-[11px] leading-5"
            aria-live={logPaused ? "off" : "polite"}
          >
            {filteredLogs.length ? (
              filteredLogs.map((entry) => (
                <div
                  key={`${entry.id}-${entry.timestamp}-${entry.message}`}
                  className={cn(
                    "grid grid-cols-[4.5rem_3.5rem_minmax(0,1fr)] gap-2 border-b border-white/[0.025] py-0.5",
                    (entry.stream === "stderr" || entry.level === "error") &&
                      "text-red-300",
                    entry.level === "warning" && "text-amber-300",
                  )}
                >
                  <span className="text-muted-foreground/60">
                    {formatTime(entry.timestamp)}
                  </span>
                  <span className="text-muted-foreground">
                    {entry.stream}
                  </span>
                  <span className="whitespace-pre-wrap break-words">
                    {entry.message}
                  </span>
                </div>
              ))
            ) : (
              <div className="grid h-full place-items-center text-center text-muted-foreground">
                <div>
                  <ServerCog className="mx-auto mb-2 size-6 opacity-40" />
                  <p>
                    {logError
                      ? logError
                      : logQuery
                        ? "검색 결과가 없습니다."
                        : "ComfyUI를 시작하면 로그가 여기에 표시됩니다."}
                  </p>
                  {logError ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="mt-2"
                      onClick={() => void refreshLogs()}
                    >
                      <RefreshCw />
                      다시 불러오기
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
      </Card>
      <ActionConfirmation
        open={forceAction !== null}
        action={forceAction ?? "stop"}
        pid={runtime?.pid}
        busy={Boolean(activeAction)}
        onCancel={() => setForceAction(null)}
        onConfirm={() => {
          const action = forceAction;
          if (
            !action ||
            runtime?.mode !== "managed" ||
            !runtime.pid
          ) {
            setForceAction(null);
            return;
          }
          void (async () => {
            await performAction(action, true);
            setForceAction(null);
          })();
        }}
      />
    </div>
  );
}

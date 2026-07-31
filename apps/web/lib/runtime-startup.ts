import type {
  ComfyRuntime,
  LongOperation,
  RuntimeAction,
} from "@/lib/types";

export interface RuntimeStartupActivity {
  id: string;
  timestamp: string;
  message: string;
}

export type RuntimeRecoveryAction = Extract<
  RuntimeAction,
  "install" | "start" | "repair"
>;

export type RuntimeStartupDecision =
  | { kind: "ready" }
  | { kind: "wait" }
  | { kind: "update" }
  | { kind: "failed"; message: string };

const transitionalStates = new Set([
  "installing",
  "starting",
  "stopping",
  "updating",
  "repairing",
]);

const phaseLabels: Record<string, string> = {
  preflight: "설치 환경 확인 중",
  download: "필요한 파일 다운로드 중",
  extract: "다운로드한 파일 설치 중",
  provision: "Python 실행 환경 구성 중",
  quarantine: "기존 엔진 백업 중",
  complete: "엔진 설치 완료",
  completed: "엔진 설치 완료",
};

export function runtimeStartupPhaseLabel(
  operation: LongOperation | null,
): string | null {
  if (!operation) return null;
  return phaseLabels[operation.phase] ?? operation.message ?? null;
}

export function mergeRuntimeStartupActivity(
  current: readonly RuntimeStartupActivity[],
  incoming: readonly RuntimeStartupActivity[],
  limit = 12,
): RuntimeStartupActivity[] {
  const merged = [...current];
  const known = new Set(current.map((entry) => entry.id));
  for (const entry of incoming) {
    if (!entry.message.trim() || known.has(entry.id)) continue;
    known.add(entry.id);
    merged.push(entry);
  }
  return merged.slice(-limit);
}

export function runtimeStartupDecision(
  runtime: ComfyRuntime,
): RuntimeStartupDecision {
  if (runtime.ready) return { kind: "ready" };

  if (
    runtime.mode === "managed" &&
    runtime.bundleId !== null &&
    !runtime.installed
  ) {
    return { kind: "update" };
  }

  if (
    transitionalStates.has(runtime.state) ||
    runtime.activeOperationId !== null
  ) {
    return { kind: "wait" };
  }

  if (runtime.state === "failed") {
    return {
      kind: "failed",
      message: runtime.error ?? "ComfyUI를 시작하지 못했습니다.",
    };
  }

  if (runtime.mode === "external") {
    return {
      kind: "failed",
      message:
        runtime.error ??
        `외부 ComfyUI에 연결할 수 없습니다: ${runtime.comfyUrl}`,
    };
  }

  if (!runtime.installed) {
    return {
      kind: "failed",
      message: "관리형 ComfyUI 엔진을 먼저 설치해야 합니다.",
    };
  }

  return {
    kind: "failed",
    message:
      runtime.error ??
      (runtime.autoStart
        ? "ComfyUI가 준비 상태가 되지 않았습니다."
        : "ComfyUI 자동 시작이 꺼져 있어 엔진이 정지되어 있습니다."),
  };
}

export function runtimeRecoveryAction(
  runtime: ComfyRuntime,
): RuntimeRecoveryAction | null {
  if (runtime.mode !== "managed") return null;
  if (!runtime.installed) return "install";
  if (runtime.state === "failed") return "repair";
  if (runtime.state === "stopped") return "start";
  return null;
}

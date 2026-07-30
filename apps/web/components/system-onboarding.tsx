"use client";

import * as React from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Circle,
  ImagePlus,
  LoaderCircle,
  Play,
  Puzzle,
  RefreshCw,
  ServerCog,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type {
  CapabilitiesResponse,
  ComfyRuntime,
  OnboardingStatus,
  OnboardingStepId,
  OnboardingUpdate,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const DISMISSED_KEY = "anima-studio:onboarding-dismissed:v1";

const stepPresentation: Record<
  OnboardingStepId,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    pendingMessage: string;
    completeMessage: string;
  }
> = {
  welcome: {
    label: "Studio 둘러보기",
    icon: BookOpen,
    pendingMessage: "생성 흐름과 데이터 저장 위치를 먼저 확인하세요.",
    completeMessage: "Studio의 기본 생성 흐름을 확인했습니다.",
  },
  runtime: {
    label: "ComfyUI 런타임",
    icon: ServerCog,
    pendingMessage: "관리형 ComfyUI를 설치·실행하거나 외부 서버를 연결하세요.",
    completeMessage: "ComfyUI가 연결되어 실행 준비를 마쳤습니다.",
  },
  models: {
    label: "모델과 필수 노드",
    icon: Puzzle,
    pendingMessage: "기반 모델과 워크플로우에 필요한 노드를 준비하세요.",
    completeMessage: "모델과 필수 노드 계약을 확인했습니다.",
  },
  character: {
    label: "캐릭터 프로필",
    icon: ImagePlus,
    pendingMessage: "참조 이미지와 프롬프트를 캐릭터 프로필로 저장하세요.",
    completeMessage: "재사용 가능한 캐릭터 프로필이 준비됐습니다.",
  },
  test_generation: {
    label: "첫 테스트 생성",
    icon: Sparkles,
    pendingMessage: "작은 기본 이미지를 한 장 생성해 전체 구성을 검증하세요.",
    completeMessage: "완료된 생성 결과를 확인했습니다.",
  },
};

export interface SystemOnboardingProps {
  runtime: ComfyRuntime | null;
  capabilities: CapabilitiesResponse | null;
  status: OnboardingStatus | null;
  busy?: boolean;
  onInstall: () => void;
  onStart: () => void;
  onRefresh: () => void;
  onOpenDependencies: () => void;
  onOpenModels: () => void;
  onNavigateToCreate: () => void;
  onUpdate: (patch: OnboardingUpdate) => Promise<void>;
}

export function SystemOnboarding({
  runtime,
  capabilities,
  status,
  busy = false,
  onInstall,
  onStart,
  onRefresh,
  onOpenDependencies,
  onOpenModels,
  onNavigateToCreate,
  onUpdate,
}: SystemOnboardingProps) {
  const [fallbackDismissed, setFallbackDismissed] = React.useState(true);
  const [expanded, setExpanded] = React.useState(false);
  const [updating, setUpdating] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    setFallbackDismissed(
      window.localStorage.getItem(DISMISSED_KEY) === "true",
    );
  }, []);

  React.useEffect(() => {
    if (status) {
      window.localStorage.setItem(DISMISSED_KEY, String(status.dismissed));
      setFallbackDismissed(status.dismissed);
    }
  }, [status]);

  const steps =
    status?.steps ??
    (Object.keys(stepPresentation) as OnboardingStepId[]).map((id) => ({
      id,
      label: stepPresentation[id].label,
      complete: false,
      blocking: id === "runtime" || id === "models",
      message: "",
      actionHref: "",
    }));
  const completed = steps.filter((step) => step.complete).length;
  const ready = status?.complete ?? false;
  const dismissed = status?.dismissed ?? fallbackDismissed;

  async function update(patch: OnboardingUpdate) {
    setUpdating(true);
    setError("");
    try {
      await onUpdate(patch);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "시작 준비 상태를 저장하지 못했습니다.",
      );
    } finally {
      setUpdating(false);
    }
  }

  async function dismiss() {
    window.localStorage.setItem(DISMISSED_KEY, "true");
    setFallbackDismissed(true);
    setExpanded(false);
    await update({ dismissed: true });
  }

  function actionFor(id: OnboardingStepId): {
    label: string;
    action: () => void;
  } | null {
    if (id === "welcome") {
      return {
        label: "확인 완료",
        action: () => void update({ completedSteps: ["welcome"] }),
      };
    }
    if (id === "runtime") {
      if (runtime?.mode !== "external" && !runtime?.installed) {
        return { label: "설치", action: onInstall };
      }
      if (runtime?.mode !== "external" && !runtime?.ready) {
        return { label: "시작", action: onStart };
      }
      return { label: "다시 검사", action: onRefresh };
    }
    if (id === "models") {
      return capabilities && !capabilities.ready
        ? { label: "누락 항목 해결", action: onOpenDependencies }
        : { label: "모델 확인", action: onOpenModels };
    }
    return {
      label: id === "character" ? "프로필 만들기" : "생성 화면 열기",
      action: onNavigateToCreate,
    };
  }

  if (dismissed && !expanded) {
    return (
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/55 px-4 py-3 text-left transition-colors hover:bg-card/80"
        onClick={() => setExpanded(true)}
      >
        <span className="flex items-center gap-3">
          {ready ? (
            <CheckCircle2 className="size-4 text-emerald-300" />
          ) : (
            <Play className="size-4 text-pink-300" />
          )}
          <span>
            <span className="block text-xs font-medium">시작 준비 도우미</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              {ready
                ? "모든 준비 단계를 완료했습니다."
                : `${completed}/${steps.length} 단계 완료 · 클릭해서 계속`}
            </span>
          </span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </button>
    );
  }

  return (
    <section
      aria-labelledby="onboarding-title"
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant={ready ? "success" : "warning"}>
              {ready ? "Ready" : "First run"}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {completed}/{steps.length} 완료
            </span>
          </div>
          <h2 id="onboarding-title" className="mt-2 text-base font-semibold">
            첫 이미지 생성 준비
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            서버에 저장된 준비 상태를 기준으로 설치부터 첫 생성까지 안내합니다.
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={() => void dismiss()}
          disabled={updating}
          aria-label="시작 준비 도우미 접기"
        >
          <X />
        </Button>
      </div>

      <Progress value={(completed / steps.length) * 100} className="mt-4" />

      <div className="mt-4 grid gap-2 lg:grid-cols-5">
        {steps.map((step) => {
          const presentation = stepPresentation[step.id];
          const Icon = presentation.icon;
          const action = step.complete ? null : actionFor(step.id);
          return (
            <div
              key={step.id}
              className={cn(
                "rounded-lg border p-3",
                step.complete
                  ? "border-emerald-400/15 bg-emerald-400/[0.04]"
                  : step.blocking
                    ? "border-amber-400/15 bg-amber-400/[0.04]"
                    : "border-border/65 bg-background/25",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <Icon className="size-4 text-muted-foreground" />
                {!status ? (
                  <LoaderCircle className="size-4 animate-spin text-pink-300" />
                ) : step.complete ? (
                  <CheckCircle2 className="size-4 text-emerald-300" />
                ) : (
                  <Circle
                    className={cn(
                      "size-4",
                      step.blocking
                        ? "text-amber-300"
                        : "text-muted-foreground",
                    )}
                  />
                )}
              </div>
              <p className="mt-3 text-xs font-medium">{presentation.label}</p>
              <p className="mt-1 min-h-12 text-[10px] leading-4 text-muted-foreground">
                {step.complete
                  ? presentation.completeMessage
                  : presentation.pendingMessage}
              </p>
              {action ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-2 h-7 px-2 text-[10px]"
                  onClick={action.action}
                  disabled={busy || updating}
                >
                  {action.label}
                  <ChevronRight />
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-[10px] text-red-300">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {!ready ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void dismiss()}
            disabled={updating}
          >
            나중에
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          onClick={onRefresh}
          disabled={busy || updating}
        >
          <RefreshCw />
          전체 준비 상태 다시 검사
        </Button>
      </div>
    </section>
  );
}

"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  LibraryBig,
  RefreshCw,
  Server,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { GenerationControls } from "@/components/generation-controls";
import { HistoryView } from "@/components/history-view";
import { JobPanel } from "@/components/job-panel";
import { LibraryView } from "@/components/library-view";
import { MobileExecutionDock } from "@/components/mobile-execution-dock";
import { ModelLoraControls } from "@/components/model-lora-controls";
import { PromptEditor } from "@/components/prompt-editor";
import { ReferenceUploader } from "@/components/reference-uploader";
import { SettingsView } from "@/components/settings-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/field";
import {
  cleanupStorage,
  createJob,
  getCapabilities,
  getHealth,
  getOnboarding,
  getOptions,
  getStorage,
  updateOnboarding,
} from "@/lib/api";
import {
  type CapabilitiesResponse,
  DEFAULT_DRAFT,
  EMPTY_OPTIONS,
  type GenerationDraft,
  type HealthResponse,
  type OnboardingStatus,
  type OnboardingUpdate,
  type StudioJob,
  type StudioOptions,
  type StorageCleanupResult,
  type StorageCleanupTarget,
  type StorageInventory,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useCompletionNotifications } from "@/components/completion-notifications";
import {
  buildPreflightIssues,
  clearModelAndLoraSelections,
  type PreflightIssue,
} from "@/lib/studio-ux";

const DRAFT_KEY = "anima-studio:creation-draft:v1";
const MODEL_SELECTION_RESET_KEY =
  "anima-studio:model-selection-defaults-cleared:v1";
const LEGACY_UI_STORAGE_CLEANUP_KEY =
  "anima-studio:legacy-ui-storage-cleaned:v1";
const LEGACY_UI_STORAGE_KEYS = [
  "anima-studio:sidebar-collapsed:v1",
  "anima-studio:character-profiles:v1",
  "anima-studio:model-packs:v1",
] as const;

function restoreDraft(): GenerationDraft {
  if (typeof window === "undefined") return DEFAULT_DRAFT;
  const resetModelSelections =
    window.localStorage.getItem(MODEL_SELECTION_RESET_KEY) !== "true";
  const finish = (draft: GenerationDraft) => {
    if (!resetModelSelections) return draft;
    const cleared = clearModelAndLoraSelections(draft);
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(cleared));
    window.localStorage.setItem(MODEL_SELECTION_RESET_KEY, "true");
    return cleared;
  };
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return finish(structuredClone(DEFAULT_DRAFT));
    const saved = JSON.parse(raw) as Partial<GenerationDraft>;
    return finish({
      ...DEFAULT_DRAFT,
      ...saved,
      referenceAssets: (saved.referenceAssets ?? []).filter(
        (asset) =>
          asset.status === "ready" &&
          Boolean(asset.id) &&
          !asset.url?.startsWith("blob:"),
      ),
      prompts: { ...DEFAULT_DRAFT.prompts, ...saved.prompts },
      models: { ...DEFAULT_DRAFT.models, ...saved.models },
      sampling: { ...DEFAULT_DRAFT.sampling, ...saved.sampling },
      instantLora: {
        ...DEFAULT_DRAFT.instantLora,
        ...saved.instantLora,
      },
      tagging: { ...DEFAULT_DRAFT.tagging, ...saved.tagging },
      upscale: { ...DEFAULT_DRAFT.upscale, ...saved.upscale },
      loras: saved.loras ?? [],
    });
  } catch {
    return finish(structuredClone(DEFAULT_DRAFT));
  }
}

function CreateWorkspace({
  draft,
  onDraftChange,
  options,
  optionsLoading,
  health,
  capabilities,
  activeJob,
  onJobUpdate,
  onGenerate,
  onLoadJobSettings,
  onRepeatJob,
  onNewSeedJob,
  onEditJobPrompt,
  submitting,
}: {
  draft: GenerationDraft;
  onDraftChange: (draft: GenerationDraft) => void;
  options: StudioOptions;
  optionsLoading: boolean;
  health: HealthResponse | null;
  capabilities: CapabilitiesResponse | null;
  activeJob: StudioJob | null;
  onJobUpdate: (job: StudioJob) => void;
  onGenerate: () => void;
  onLoadJobSettings: (job: StudioJob) => void;
  onRepeatJob: (job: StudioJob) => Promise<void>;
  onNewSeedJob: (job: StudioJob) => Promise<void>;
  onEditJobPrompt: (job: StudioJob) => void;
  submitting: boolean;
}) {
  const readyAssets = draft.referenceAssets.filter(
    (asset) => asset.status === "ready",
  );
  const preflightIssues = React.useMemo(
    () =>
      buildPreflightIssues({
        draft,
        options,
        optionsLoading,
        health,
        capabilities,
      }),
    [capabilities, draft, health, options, optionsLoading],
  );
  const validationMessage = preflightIssues[0]?.message ?? "";
  const selectionIssue =
    preflightIssues.find(
      (issue) => issue.stepId === "models" && Boolean(issue.fieldId),
    ) ??
    preflightIssues.find(
      (issue) =>
        issue.stepId === "models" && issue.code !== "options_loading",
    );
  const canGenerate = preflightIssues.length === 0;

  const resolveIssue = React.useCallback((issue: PreflightIssue) => {
    const section = document.getElementById(
      "create-section-" + issue.stepId,
    );
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      const field = issue.fieldId
        ? document.getElementById(issue.fieldId)
        : section;
      const details = field?.closest("details");
      if (details instanceof HTMLDetailsElement) details.open = true;
      field?.focus();
      field?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 180);
  }, []);

  return (
    <div className="animate-fade-in">
      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Card id="create-section-reference">
            <CardHeader className="pb-3">
              <SectionHeading
                title="참조 이미지"
                action={
                  readyAssets.length ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-success">
                      <CheckCircle2 className="size-3.5" />
                      {readyAssets.length}장
                    </span>
                  ) : null
                }
              />
            </CardHeader>
            <CardContent>
              <ReferenceUploader
                assets={draft.referenceAssets}
                onChange={(referenceAssets) =>
                  onDraftChange({ ...draft, referenceAssets })
                }
              />
            </CardContent>
          </Card>

          <Card id="create-section-prompt">
            <CardHeader className="pb-3">
              <SectionHeading title="프롬프트" />
            </CardHeader>
            <CardContent>
              <PromptEditor
                value={draft.prompts}
                loras={draft.loras}
                autoTags={activeJob?.autoTags}
                onChange={(prompts) => onDraftChange({ ...draft, prompts })}
              />
            </CardContent>
          </Card>

          <Card id="create-section-models">
            <CardHeader className="pb-3">
              <SectionHeading
                title="모델과 LoRA"
                action={
                  optionsLoading ? (
                    <RefreshCw className="size-4 animate-spin text-muted-foreground" />
                  ) : null
                }
              />
            </CardHeader>
            <CardContent>
              <ModelLoraControls
                models={draft.models}
                loras={draft.loras}
                options={options}
                loading={optionsLoading}
                validationWarning={selectionIssue?.message}
                validationFieldId={selectionIssue?.fieldId}
                onModelsChange={(models) =>
                  onDraftChange({ ...draft, models })
                }
                onLorasChange={(loras) =>
                  onDraftChange({ ...draft, loras })
                }
                onInsertTriggers={(words) =>
                  onDraftChange({
                    ...draft,
                    prompts: {
                      ...draft.prompts,
                      positive: [
                        draft.prompts.positive.replace(/,\s*$/, ""),
                        ...words,
                      ]
                        .filter(Boolean)
                        .join(", ")
                        .concat(", "),
                    },
                  })
                }
              />
            </CardContent>
          </Card>

          <Card id="create-section-generation">
            <CardHeader className="pb-3">
              <SectionHeading title="생성 설정" />
            </CardHeader>
            <CardContent>
              <GenerationControls
                value={draft}
                options={options}
                onChange={onDraftChange}
              />
            </CardContent>
          </Card>
        </div>

        <JobPanel
          job={activeJob}
          health={health}
          capabilities={capabilities}
          submitting={submitting}
          canGenerate={canGenerate}
          validationMessage={validationMessage}
          preflightIssues={preflightIssues}
          onResolveIssue={resolveIssue}
          onGenerate={onGenerate}
          onJobUpdate={onJobUpdate}
          onLoadSettings={onLoadJobSettings}
          onRepeat={onRepeatJob}
          onNewSeed={onNewSeedJob}
          onEditPrompt={onEditJobPrompt}
        />
        <MobileExecutionDock
          job={activeJob}
          health={health}
          submitting={submitting}
          canGenerate={canGenerate}
          validationMessage={validationMessage}
          preflightIssues={preflightIssues}
          onResolveIssue={resolveIssue}
          onGenerate={onGenerate}
          onJobUpdate={onJobUpdate}
        />
      </div>
    </div>
  );
}

export function StudioShell() {
  const libraryTriggerRef = React.useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = React.useRef<HTMLButtonElement>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [systemStatusOpen, setSystemStatusOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<GenerationDraft>(DEFAULT_DRAFT);
  const [hydrated, setHydrated] = React.useState(false);
  const [health, setHealth] = React.useState<HealthResponse | null>(null);
  const [capabilities, setCapabilities] =
    React.useState<CapabilitiesResponse | null>(null);
  const [options, setOptions] = React.useState<StudioOptions>(EMPTY_OPTIONS);
  const [storage, setStorage] = React.useState<StorageInventory | null>(null);
  const [storageLoading, setStorageLoading] = React.useState(true);
  const [storageError, setStorageError] = React.useState("");
  const [onboarding, setOnboarding] =
    React.useState<OnboardingStatus | null>(null);
  const [loadingSystem, setLoadingSystem] = React.useState(true);
  const [systemError, setSystemError] = React.useState("");
  const [activeJob, setActiveJob] = React.useState<StudioJob | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [toast, setToast] = React.useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const completionNotifications = useCompletionNotifications();
  const notifyCompletion = completionNotifications.notify;
  const onboardingCompletionJob = React.useRef("");

  React.useEffect(() => {
    if (!activeJob || !["completed", "failed"].includes(activeJob.status)) {
      return;
    }
    notifyCompletion({
      id: activeJob.id + ":" + activeJob.status,
      title:
        activeJob.status === "completed"
          ? "Anima 이미지 생성 완료"
          : "Anima 이미지 생성 실패",
      body:
        activeJob.status === "completed"
          ? "Seed " +
            activeJob.settings.sampling.seed +
            " 결과가 준비되었습니다."
          : activeJob.error ?? "작업 상세에서 오류를 확인해주세요.",
      tone: activeJob.status === "completed" ? "success" : "error",
    });
    if (
      activeJob.status === "completed" &&
      onboardingCompletionJob.current !== activeJob.id
    ) {
      onboardingCompletionJob.current = activeJob.id;
      void getOnboarding().then(setOnboarding).catch(() => undefined);
    }
  }, [activeJob, notifyCompletion]);

  React.useEffect(() => {
    setDraft(restoreDraft());
    if (
      window.localStorage.getItem(LEGACY_UI_STORAGE_CLEANUP_KEY) !== "true"
    ) {
      for (const key of LEGACY_UI_STORAGE_KEYS) {
        window.localStorage.removeItem(key);
      }
      window.localStorage.setItem(LEGACY_UI_STORAGE_CLEANUP_KEY, "true");
    }
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!toast || toast.type === "error") return;
    const timer = window.setTimeout(() => {
      setToast((current) => (current === toast ? null : current));
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  React.useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const serializable = {
        ...draft,
        referenceAssets: draft.referenceAssets.filter(
          (asset) => asset.status === "ready" && !asset.url.startsWith("blob:"),
        ),
      };
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(serializable));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draft, hydrated]);

  const refreshSystem = React.useCallback(async () => {
    setLoadingSystem(true);
    setSystemError("");
    setStorageLoading(true);
    setStorageError("");
    const [
      healthResult,
      capabilityResult,
      optionsResult,
      storageResult,
      onboardingResult,
    ] = await Promise.allSettled([
      getHealth(),
      getCapabilities(),
      getOptions(),
      getStorage(),
      getOnboarding(),
    ]);

    if (healthResult.status === "fulfilled") setHealth(healthResult.value);
    else setHealth(null);
    if (capabilityResult.status === "fulfilled") {
      setCapabilities(capabilityResult.value);
    } else {
      setCapabilities(null);
    }
    if (optionsResult.status === "fulfilled") {
      setOptions(optionsResult.value);
      setDraft((current) => ({
        ...current,
        sampling: {
          ...current.sampling,
          sampler:
            optionsResult.value.samplers.includes(current.sampling.sampler) ||
            !optionsResult.value.samplers.length
              ? current.sampling.sampler
              : optionsResult.value.samplers[0],
          scheduler:
            optionsResult.value.schedulers.includes(
              current.sampling.scheduler,
            ) || !optionsResult.value.schedulers.length
              ? current.sampling.scheduler
              : optionsResult.value.schedulers[0],
        },
      }));
    }
    if (storageResult.status === "fulfilled") {
      setStorage(storageResult.value);
    } else {
      setStorage(null);
      setStorageError(
        storageResult.reason instanceof Error
          ? storageResult.reason.message
          : "저장 공간 정보를 불러오지 못했습니다.",
      );
    }
    setOnboarding(
      onboardingResult.status === "fulfilled"
        ? onboardingResult.value
        : null,
    );

    const failures = [
      healthResult,
      capabilityResult,
      optionsResult,
      onboardingResult,
    ].filter(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult[];
    if (failures.length) {
      setSystemError(
        failures[0].reason instanceof Error
          ? failures[0].reason.message
          : "서버 정보를 불러오지 못했습니다.",
      );
    }
    setStorageLoading(false);
    setLoadingSystem(false);
  }, []);

  const refreshStorageInventory = React.useCallback(async () => {
    setStorageLoading(true);
    setStorageError("");
    try {
      setStorage(await getStorage());
    } catch (error) {
      setStorageError(
        error instanceof Error
          ? error.message
          : "저장 공간 정보를 불러오지 못했습니다.",
      );
    } finally {
      setStorageLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshSystem();
    const interval = window.setInterval(() => {
      getHealth().then(setHealth).catch(() => setHealth(null));
    }, 15000);
    return () => window.clearInterval(interval);
  }, [refreshSystem]);

  async function handleGenerate() {
    setSubmitting(true);
    try {
      const job = await createJob(draft);
      setActiveJob(job);
      setToast({
        type: "success",
        message: "작업을 ComfyUI 대기열에 추가했습니다.",
      });
    } catch (error) {
      setToast({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "생성 작업을 시작하지 못했습니다.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitJobDraft(
    nextDraft: GenerationDraft,
    message: string,
  ) {
    setSubmitting(true);
    try {
      const job = await createJob(nextDraft);
      setActiveJob(job);
      setToast({ type: "success", message });
    } finally {
      setSubmitting(false);
    }
  }

  async function repeatJob(job: StudioJob) {
    await submitJobDraft(
      structuredClone(job.settings),
      "같은 설정으로 작업을 다시 추가했습니다.",
    );
  }

  async function newSeedJob(job: StudioJob) {
    await submitJobDraft(
      {
        ...structuredClone(job.settings),
        sampling: {
          ...job.settings.sampling,
          seedMode: "random",
        },
      },
      "시드만 바꾼 작업을 추가했습니다.",
    );
  }

  function editJobPrompt(job: StudioJob) {
    setDraft({
      ...structuredClone(job.settings),
      sampling: {
        ...job.settings.sampling,
        seedMode: "fixed",
      },
    });
    setToast({
      type: "success",
      message:
        "Seed " +
        job.settings.sampling.seed +
        "을 고정했습니다. 프롬프트를 수정하세요.",
    });
    window.setTimeout(() => {
      document.getElementById("positive-prompt")?.focus();
      document
        .getElementById("positive-prompt")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function loadSettings(settings: GenerationDraft) {
    setDraft(structuredClone(settings));
    setToast({
      type: "success",
      message: "히스토리 설정을 생성 화면에 불러왔습니다.",
    });
  }

  function clearDraft() {
    window.localStorage.removeItem(DRAFT_KEY);
    setDraft(structuredClone(DEFAULT_DRAFT));
    setToast({ type: "success", message: "작성 중인 초안을 초기화했습니다." });
  }

  async function handleStorageCleanup(
    targets: StorageCleanupTarget[],
    dryRun: boolean,
  ): Promise<StorageCleanupResult> {
    const result = await cleanupStorage(targets, dryRun);
    await refreshStorageInventory();
    if (!dryRun) {
      setToast({
        type: "success",
        message:
          result.results.filter((item) => item.deleted).length +
          "개 항목을 정리했습니다.",
      });
    }
    return result;
  }

  async function handleOnboardingUpdate(patch: OnboardingUpdate) {
    setOnboarding(await updateOnboarding(patch));
  }

  function openSettingsFromLibrary() {
    setLibraryOpen(false);
    window.setTimeout(() => setSettingsOpen(true), 0);
  }

  const connected =
    health?.comfyui || (health?.ok && health.comfyui !== false);

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#studio-main"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-none transition-transform focus:translate-y-0 focus:ring-2 focus:ring-ring"
      >
        본문으로 건너뛰기
      </a>

      <HistoryView
        mobileOpen={historyOpen}
        onMobileOpenChange={setHistoryOpen}
        activeJob={activeJob}
        onLoadSettings={loadSettings}
        onRepeatJob={repeatJob}
        onNewSeedJob={newSeedJob}
        onEditJobPrompt={editJobPrompt}
        onTrackJob={(job) => {
          setActiveJob(job);
          setToast({
            type: "success",
            message:
              "Seed " +
              job.settings.sampling.seed +
              "로 업스케일 작업을 시작했습니다.",
          });
        }}
      />

      <div className="xl:pl-80">
        <header className="glass-surface sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border px-3 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="xl:hidden"
              onClick={() => setHistoryOpen(true)}
              aria-label="히스토리 열기"
              title="History"
            >
              <History />
            </Button>
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground xl:hidden">
              <Sparkles className="size-4" />
            </span>
            <span className="truncate text-sm font-semibold">Anima Studio</span>
          </div>

          <div className="flex items-center gap-1.5">
            {activeJob &&
            ["uploading", "queued", "running"].includes(activeJob.status) ? (
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById("execution-dock")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="hidden min-h-9 items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-2.5 text-xs text-primary outline-none transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring 2xl:inline-flex"
              >
                <Clock3 className="size-3.5" />
                <span className="hidden sm:inline">
                  {activeJob.stage ?? "생성 중"}
                </span>
              </button>
            ) : null}

            <Popover
              open={systemStatusOpen}
              onOpenChange={setSystemStatusOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label={
                    "시스템 상태: " +
                    (connected ? "ComfyUI 연결됨" : "연결 끊김")
                  }
                  title="시스템 상태"
                >
                  <Server className="text-muted-foreground" />
                  <span
                    className={cn(
                      "absolute right-1.5 top-1.5 size-2 rounded-full ring-2 ring-background",
                      connected ? "bg-success" : "bg-danger",
                    )}
                  />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">
                      {connected ? "ComfyUI 연결됨" : "연결 끊김"}
                    </p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {health?.comfyUrl ?? "http://127.0.0.1:8188"}
                    </p>
                  </div>
                  <Badge variant={connected ? "success" : "destructive"}>
                    {connected ? "정상" : "오프라인"}
                  </Badge>
                </div>
                <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">필수 노드</span>
                    <span>
                      {capabilities?.ready
                        ? "호환됨"
                        : capabilities
                          ? capabilities.missingNodes.length +
                            "개 확인 필요"
                          : "확인 중"}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={loadingSystem}
                    onClick={() => void refreshSystem()}
                  >
                    <RefreshCw
                      className={cn(loadingSystem && "animate-spin")}
                    />
                    다시 확인
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="flex-1"
                    onClick={() => {
                      setSettingsOpen(true);
                      setSystemStatusOpen(false);
                    }}
                  >
                    설정 열기
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <Button
              ref={libraryTriggerRef}
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setLibraryOpen(true)}
              aria-label="Library 열기"
              title="Library"
            >
              <LibraryBig />
            </Button>
            <Button
              ref={settingsTriggerRef}
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings 열기"
              title="Settings"
            >
              <Settings />
            </Button>
          </div>
        </header>

        <main
          id="studio-main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1800px] px-3 py-4 pb-28 outline-none sm:px-4 lg:px-6 lg:py-6 2xl:pb-6"
        >
          <CreateWorkspace
            draft={draft}
            onDraftChange={setDraft}
            options={options}
            optionsLoading={loadingSystem}
            health={health}
            capabilities={capabilities}
            activeJob={activeJob}
            onJobUpdate={setActiveJob}
            onGenerate={handleGenerate}
            onLoadJobSettings={(job) => loadSettings(job.settings)}
            onRepeatJob={repeatJob}
            onNewSeedJob={newSeedJob}
            onEditJobPrompt={editJobPrompt}
            submitting={submitting}
          />
        </main>
      </div>

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent
          className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1400px] sm:rounded-xl sm:border"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            libraryTriggerRef.current?.focus();
          }}
        >
          <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-14 sm:px-6">
            <DialogTitle>Library</DialogTitle>
            <DialogDescription className="sr-only">
              모델을 설치하거나 제거합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
            <LibraryView
              onOpenManagedRuntime={openSettingsFromLibrary}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent
          className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1400px] sm:rounded-xl sm:border"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            settingsTriggerRef.current?.focus();
          }}
        >
          <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-14 sm:px-6">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription className="sr-only">
              엔진, 모델, 저장공간 설정을 관리합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
            <SettingsView
              health={health}
              capabilities={capabilities}
              options={options}
              loading={loadingSystem}
              error={systemError}
              onRefresh={() => void refreshSystem()}
              onClearDraft={clearDraft}
              onboarding={onboarding}
              onOnboardingUpdate={handleOnboardingUpdate}
              onNavigateToCreate={() => setSettingsOpen(false)}
              notificationController={completionNotifications}
              storage={storage}
              storageLoading={storageLoading}
              storageError={storageError}
              onStorageRefresh={() => void refreshStorageInventory()}
              onStorageCleanup={handleStorageCleanup}
            />
          </div>
        </DialogContent>
      </Dialog>

      {toast ? (
        <div
          role={toast.type === "error" ? "alert" : "status"}
          className={cn(
            "fixed bottom-24 left-4 right-4 z-[70] flex max-w-sm animate-fade-in items-start gap-3 rounded-xl border bg-popover/95 p-4 text-[13px] shadow-dialog backdrop-blur-xl sm:left-auto sm:right-5 2xl:bottom-5",
            toast.type === "error"
              ? "border-danger/30"
              : "border-success/25",
          )}
        >
          {toast.type === "error" ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          )}
          <p className="leading-5">{toast.message}</p>
          <button
            type="button"
            className="ml-auto grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setToast(null)}
            aria-label="알림 닫기"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

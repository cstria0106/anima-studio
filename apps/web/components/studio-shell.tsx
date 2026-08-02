"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Github,
  History,
  LibraryBig,
  RefreshCw,
  Server,
  Settings,
  X,
} from "lucide-react";
import { GenerationControls } from "@/components/generation-controls";
import { HistoryView } from "@/components/history-view";
import { InstantReferenceControls } from "@/components/instant-reference-controls";
import { JobPanel } from "@/components/job-panel";
import { LibraryView } from "@/components/library-view";
import { MobileExecutionDock } from "@/components/mobile-execution-dock";
import { ModelLoraControls } from "@/components/model-lora-controls";
import { PromptEditor } from "@/components/prompt-editor";
import { ReferenceUploader } from "@/components/reference-uploader";
import { RuntimeStartupGate } from "@/components/runtime-startup-gate";
import { SettingsView } from "@/components/settings-view";
import {
  normalizeGenerationDraft,
  useUiPreferences,
} from "@/components/ui-preferences-provider";
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
  getJob,
  getJobs,
  getOptions,
  getStorage,
} from "@/lib/api";
import {
  type CapabilitiesResponse,
  DEFAULT_DRAFT,
  EMPTY_OPTIONS,
  type GenerationDraft,
  type HealthResponse,
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
  loadSeedIntoDraft,
  type PreflightIssue,
} from "@/lib/studio-ux";

function CreateWorkspace({
  draft,
  onDraftChange,
  options,
  optionsLoading,
  health,
  capabilities,
  activeJob,
  queueJobs,
  onJobUpdate,
  onGenerate,
  onLoadJobSettings,
  onLoadJobSeed,
  onOpenJobDetail,
  submitting,
}: {
  draft: GenerationDraft;
  onDraftChange: (draft: GenerationDraft) => void;
  options: StudioOptions;
  optionsLoading: boolean;
  health: HealthResponse | null;
  capabilities: CapabilitiesResponse | null;
  activeJob: StudioJob | null;
  queueJobs: StudioJob[];
  onJobUpdate: (job: StudioJob) => void;
  onGenerate: () => void;
  onLoadJobSettings: (job: StudioJob) => void;
  onLoadJobSeed: (job: StudioJob) => void;
  onOpenJobDetail: (job: StudioJob, outputId?: string) => void;
  submitting: boolean;
}) {
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

  React.useEffect(() => {
    function generateFromShortcut(event: KeyboardEvent) {
      if (
        event.key !== "Enter" ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        event.repeat ||
        event.isComposing
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (canGenerate && !submitting) onGenerate();
    }

    window.addEventListener("keydown", generateFromShortcut, true);
    return () =>
      window.removeEventListener("keydown", generateFromShortcut, true);
  }, [canGenerate, onGenerate, submitting]);

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
        <div className="space-y-4">
          <Card id="create-section-prompt">
            <CardHeader className="pb-3">
              <SectionHeading title="프롬프트" />
            </CardHeader>
            <CardContent>
              <PromptEditor
                value={draft.prompts}
                onChange={(prompts) => onDraftChange({ ...draft, prompts })}
              />
            </CardContent>
          </Card>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card id="create-section-reference">
              <CardHeader className="pb-3">
                <SectionHeading title="참조 이미지" />
              </CardHeader>
              <CardContent className="space-y-5">
                <ReferenceUploader
                  assets={draft.referenceAssets}
                  onChange={(referenceAssets) =>
                    onDraftChange({ ...draft, referenceAssets })
                  }
                />
                <InstantReferenceControls
                  value={draft}
                  onChange={onDraftChange}
                />
              </CardContent>
            </Card>

            <Card id="create-section-models">
              <CardHeader className="pb-3">
                <SectionHeading
                  title="모델"
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
                />
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="space-y-4">
          <JobPanel
            job={activeJob}
            queueJobs={queueJobs}
            capabilities={capabilities}
            submitting={submitting}
            canGenerate={canGenerate}
            validationMessage={validationMessage}
            preflightIssues={preflightIssues}
            onResolveIssue={resolveIssue}
            onGenerate={onGenerate}
            onJobUpdate={onJobUpdate}
            onLoadSettings={onLoadJobSettings}
            onLoadSeed={onLoadJobSeed}
            onOpenDetail={onOpenJobDetail}
          />

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
        <MobileExecutionDock
          job={activeJob}
          queueJobs={queueJobs}
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
  const {
    preferences,
    ready: preferencesReady,
    updatePreferences,
  } = useUiPreferences();
  const draftInitialized = React.useRef(false);
  const libraryTriggerRef = React.useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = React.useRef<HTMLButtonElement>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyCollapsed, setHistoryCollapsed] = React.useState(false);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [systemStatusOpen, setSystemStatusOpen] = React.useState(false);
  const [startupGateOpen, setStartupGateOpen] = React.useState(true);
  const [draft, setDraft] = React.useState<GenerationDraft>(DEFAULT_DRAFT);
  const [hydrated, setHydrated] = React.useState(false);
  const [health, setHealth] = React.useState<HealthResponse | null>(null);
  const [capabilities, setCapabilities] =
    React.useState<CapabilitiesResponse | null>(null);
  const [options, setOptions] = React.useState<StudioOptions>(EMPTY_OPTIONS);
  const [storage, setStorage] = React.useState<StorageInventory | null>(null);
  const [storageLoading, setStorageLoading] = React.useState(true);
  const [storageError, setStorageError] = React.useState("");
  const [loadingSystem, setLoadingSystem] = React.useState(true);
  const [systemError, setSystemError] = React.useState("");
  const [activeJob, setActiveJob] = React.useState<StudioJob | null>(null);
  const [trackedJobs, setTrackedJobs] = React.useState<StudioJob[]>([]);
  const [historyDetailRequest, setHistoryDetailRequest] = React.useState<{
    id: number;
    job: StudioJob;
    outputId?: string;
  } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [toast, setToast] = React.useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const completionNotifications = useCompletionNotifications();
  const notifyCompletion = completionNotifications.notify;

  const updateTrackedJob = React.useCallback((job: StudioJob) => {
    setTrackedJobs((current) => {
      const exists = current.some((item) => item.id === job.id);
      return exists
        ? current.map((item) => (item.id === job.id ? job : item))
        : [...current, job];
    });
    setActiveJob((current) => (current?.id === job.id ? job : current));
  }, []);

  const trackSubmittedJob = React.useCallback((job: StudioJob) => {
    setTrackedJobs((current) => {
      const exists = current.some((item) => item.id === job.id);
      return exists
        ? current.map((item) => (item.id === job.id ? job : item))
        : [...current, job];
    });
    setActiveJob((current) =>
      current && ["uploading", "queued", "running"].includes(current.status)
        ? current
        : job,
    );
  }, []);

  React.useEffect(() => {
    for (const job of trackedJobs) {
      if (!["completed", "failed"].includes(job.status)) continue;
      notifyCompletion({
        id: job.id + ":" + job.status,
        title:
          job.status === "completed"
            ? "Anima 이미지 생성 완료"
            : "Anima 이미지 생성 실패",
        body:
          job.status === "completed"
            ? "Seed " +
              job.settings.sampling.seed +
              " 결과가 준비되었습니다."
            : job.error ?? "작업 상세에서 오류를 확인해주세요.",
        tone: job.status === "completed" ? "success" : "error",
      });
    }
  }, [notifyCompletion, trackedJobs]);

  React.useEffect(() => {
    let stopped = false;
    Promise.all([
      getJobs({ status: "uploading" }),
      getJobs({ status: "queued" }),
      getJobs({ status: "running" }),
    ])
      .then((results) => {
        if (stopped) return;
        const restored = results.flatMap((result) => result.jobs);
        setTrackedJobs((current) => {
          const restoredIds = new Set(restored.map((job) => job.id));
          return [
            ...restored,
            ...current.filter((job) => !restoredIds.has(job.id)),
          ];
        });
        setActiveJob(
          (current) =>
            current ??
            restored.find((job) => job.status === "running") ??
            restored[0] ??
            null,
        );
      })
      .catch(() => {
        // The regular system refresh will surface connection problems.
      });
    return () => {
      stopped = true;
    };
  }, []);

  const backgroundJobIds = trackedJobs
    .filter(
      (job) =>
        job.id !== activeJob?.id &&
        ["uploading", "queued", "running"].includes(job.status),
    )
    .map((job) => job.id)
    .join("\n");

  React.useEffect(() => {
    if (!backgroundJobIds) return;
    let stopped = false;
    let refreshing = false;

    const refresh = async () => {
      if (refreshing || stopped) return;
      refreshing = true;
      const results = await Promise.allSettled(
        backgroundJobIds.split("\n").map((id) => getJob(id)),
      );
      if (!stopped) {
        for (const result of results) {
          if (result.status === "fulfilled") updateTrackedJob(result.value);
        }
      }
      refreshing = false;
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 3_500);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [backgroundJobIds, updateTrackedJob]);

  React.useEffect(() => {
    if (
      activeJob &&
      ["uploading", "queued", "running"].includes(activeJob.status)
    ) {
      return;
    }
    const nextJob =
      trackedJobs.find((job) => job.status === "running") ??
      trackedJobs.find((job) =>
        ["uploading", "queued"].includes(job.status),
      );
    if (nextJob && nextJob.id !== activeJob?.id) setActiveJob(nextJob);
  }, [activeJob, trackedJobs]);

  React.useEffect(() => {
    if (!preferencesReady || draftInitialized.current) return;
    draftInitialized.current = true;
    setDraft(normalizeGenerationDraft(preferences.draft));
    setHydrated(true);
  }, [preferences.draft, preferencesReady]);

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
      updatePreferences({ draft: serializable });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draft, hydrated, updatePreferences]);

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
    ] = await Promise.allSettled([
      getHealth(),
      getCapabilities(),
      getOptions(),
      getStorage(),
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
    const failures = [
      healthResult,
      capabilityResult,
      optionsResult,
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
      trackSubmittedJob(job);
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
      trackSubmittedJob(job);
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

  function loadSettings(settings: GenerationDraft) {
    setDraft(structuredClone(settings));
    setToast({
      type: "success",
      message: "히스토리 설정을 생성 화면에 불러왔습니다.",
    });
  }

  function loadSeed(seed: number) {
    setDraft((current) => loadSeedIntoDraft(current, seed));
    setToast({
      type: "success",
      message: `Seed ${seed}를 생성 설정에 불러왔습니다.`,
    });
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
        message: `${result.results.filter((item) => item.deleted).length}개 항목을 정리했습니다.`,
      });
    }
    return result;
  }

  function openSettingsFromLibrary() {
    setLibraryOpen(false);
    window.setTimeout(() => setSettingsOpen(true), 0);
  }

  const connected =
    health?.comfyui || (health?.ok && health.comfyui !== false);

  if (startupGateOpen) {
    return (
      <RuntimeStartupGate
        onReady={() => {
          setStartupGateOpen(false);
          void refreshSystem();
        }}
        onOpenSettings={() => {
          setStartupGateOpen(false);
          setSettingsOpen(true);
        }}
      />
    );
  }

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
        desktopCollapsed={historyCollapsed}
        onDesktopCollapsedChange={setHistoryCollapsed}
        activeJob={activeJob}
        trackedJobs={trackedJobs}
        detailRequest={historyDetailRequest}
        onLoadSettings={loadSettings}
        onLoadSeed={loadSeed}
        onRepeatJob={repeatJob}
        onDeleteJob={(jobId) => {
          setTrackedJobs((current) =>
            current.filter((job) => job.id !== jobId),
          );
          setActiveJob((current) =>
            current?.id === jobId ? null : current,
          );
        }}
        onTrackJob={(job) => {
          setActiveJob(job);
          updateTrackedJob(job);
          setToast({
            type: "success",
            message:
              "Seed " +
              job.settings.sampling.seed +
              "로 업스케일 작업을 시작했습니다.",
          });
        }}
      />

      <div
        className={cn(
          "transition-[padding] duration-200",
          historyCollapsed ? "xl:pl-0" : "xl:pl-80",
        )}
      >
        <div
          className="glass-surface sticky top-3 z-40 ml-auto mr-3 flex w-fit items-center gap-1.5 rounded-xl border border-border p-1.5 shadow-lg sm:mr-4 lg:mr-6"
          aria-label="스튜디오 도구"
        >
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

            <Popover
              open={systemStatusOpen}
              onOpenChange={setSystemStatusOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={
                    "시스템 상태: " +
                    (connected ? "ComfyUI 연결됨" : "연결 끊김")
                  }
                  title="시스템 상태"
                >
                  <Server className="text-muted-foreground" />
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
            <Button asChild size="icon" variant="ghost">
              <a
                href="https://github.com/cstria0106/anima-studio"
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub 저장소 열기"
                title="GitHub"
              >
                <Github />
              </a>
            </Button>
        </div>

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
            queueJobs={trackedJobs}
            onJobUpdate={updateTrackedJob}
            onGenerate={handleGenerate}
            onLoadJobSettings={(job) => loadSettings(job.settings)}
            onLoadJobSeed={(job) => loadSeed(job.settings.sampling.seed)}
            onOpenJobDetail={(job, outputId) =>
              setHistoryDetailRequest((current) => ({
                id: (current?.id ?? 0) + 1,
                job,
                outputId,
              }))
            }
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
              onOptionsChanged={() => void refreshSystem()}
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
              엔진, 알림, 저장공간 설정을 관리합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-6">
            <SettingsView
              error={systemError}
              onRefresh={() => void refreshSystem()}
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

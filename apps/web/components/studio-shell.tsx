"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  ImagePlus,
  LibraryBig,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Server,
  Settings,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import {
  CreativePresetBar,
  LOCAL_MODEL_PACKS_KEY,
  LOCAL_PROFILES_KEY,
  readLocalPresetList,
  writeLocalPresetList,
} from "@/components/creative-presets";
import {
  CreateStepNav,
  CreateStepSection,
  type CreateStepDefinition,
} from "@/components/create-step-nav";
import { GenerationControls } from "@/components/generation-controls";
import { HistoryView } from "@/components/history-view";
import { JobPanel } from "@/components/job-panel";
import { LibraryView } from "@/components/library-view";
import { MobileExecutionDock } from "@/components/mobile-execution-dock";
import { ModelLoraControls } from "@/components/model-lora-controls";
import { PromptEditor } from "@/components/prompt-editor";
import { ReferenceUploader } from "@/components/reference-uploader";
import { SettingsView } from "@/components/settings-view";
import { VariationMatrix } from "@/components/variation-matrix";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/field";
import {
  cleanupStorage,
  createCharacterProfile,
  createJob,
  createModelPack,
  createVariationMatrix,
  deleteCharacterProfile,
  deleteModelPack,
  exportPortableSettings,
  getCapabilities,
  getCharacterProfiles,
  getComfyRuntime,
  getHealth,
  getModelPacks,
  getOnboarding,
  getOptions,
  getStorage,
  importPortableSettings,
  previewPortableSettings,
  setCharacterProfileRepresentative,
  updateCharacterProfile,
  updateModelPack,
  updateOnboarding,
} from "@/lib/api";
import {
  type CapabilitiesResponse,
  type CharacterProfile,
  DEFAULT_DRAFT,
  EMPTY_OPTIONS,
  type GenerationDraft,
  type HealthResponse,
  type ModelDownload,
  type ModelPack,
  type OnboardingStatus,
  type OnboardingUpdate,
  type RuntimeHardware,
  type StudioJob,
  type StudioOptions,
  type StorageCleanupResult,
  type StorageCleanupTarget,
  type StorageInventory,
  type VariationMatrixRequest,
} from "@/lib/types";
import { cn, uniqueId } from "@/lib/utils";
import { ResourceEstimate } from "@/components/resource-estimate";
import {
  useCompletionNotifications,
} from "@/components/completion-notifications";
import {
  buildPreflightIssues,
  clearModelAndLoraSelections,
  estimateWorkload,
  isCharacterProfileDirty,
  isModelPackDirty,
  type CreateStepId,
  type PreflightIssue,
  type WorkloadEstimate,
} from "@/lib/studio-ux";

type Tab = "create" | "history" | "library" | "settings";

const DRAFT_KEY = "anima-studio:creation-draft:v1";
const MODEL_SELECTION_RESET_KEY =
  "anima-studio:model-selection-defaults-cleared:v1";
const SIDEBAR_COLLAPSED_KEY = "anima-studio:sidebar-collapsed:v1";
const CREATE_STEP_IDS: CreateStepId[] = [
  "reference",
  "prompt",
  "models",
  "generation",
];

const navItems: Array<{
  id: Tab;
  label: string;
  description: string;
  icon: typeof ImagePlus;
}> = [
  {
    id: "create",
    label: "Create",
    description: "새 이미지 만들기",
    icon: WandSparkles,
  },
  {
    id: "history",
    label: "History",
    description: "결과와 설정",
    icon: History,
  },
  {
    id: "library",
    label: "Library",
    description: "모델 다운로드",
    icon: LibraryBig,
  },
  {
    id: "settings",
    label: "Settings",
    description: "연결 및 호환성",
    icon: Settings,
  },
];

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

function StudioNavigation({
  activeTab,
  collapsed = false,
  onSelect,
  onToggleCollapsed,
}: {
  activeTab: Tab;
  collapsed?: boolean;
  onSelect: (tab: Tab) => void;
  onToggleCollapsed?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "flex h-12 items-center px-2",
          collapsed ? "justify-center" : "gap-3",
        )}
      >
        <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-primary text-primary-foreground shadow-[0_0_20px_-8px_hsl(var(--primary)/.75)]">
          <Sparkles className="size-4" />
        </span>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">
              Anima Studio
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Local character lab
            </p>
          </div>
        ) : null}
      </div>

      <nav className="mt-8 space-y-1" aria-label="주 메뉴">
        {navItems.map((item) => {
          const Icon = item.icon;
          const selected = activeTab === item.id;
          return (
            <button
              type="button"
              key={item.id}
              aria-current={selected ? "page" : undefined}
              aria-label={collapsed ? `${item.label}: ${item.description}` : undefined}
              title={collapsed ? item.label : undefined}
              onClick={() => onSelect(item.id)}
              className={cn(
                "group flex min-h-11 w-full items-center rounded-lg text-left outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                collapsed ? "justify-center px-2" : "gap-3 px-3",
                selected && "bg-accent text-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors",
                  selected && "bg-primary/10 text-primary",
                )}
              >
                <Icon className="size-4" />
              </span>
              {!collapsed ? (
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {onToggleCollapsed ? (
        <Button
          type="button"
          variant="ghost"
          className={cn(
            "mt-auto min-h-11",
            collapsed ? "w-full px-0" : "w-full justify-start",
          )}
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          title={collapsed ? "사이드바 펼치기" : undefined}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          {!collapsed ? "사이드바 접기" : null}
        </Button>
      ) : null}
    </div>
  );
}

function CreateWorkspace({
  draft,
  onDraftChange,
  profiles,
  modelPacks,
  activeProfileId,
  activeModelPackId,
  presetsLoading,
  onSelectProfile,
  onSaveProfile,
  onUpdateProfile,
  onDeleteProfile,
  onSelectModelPack,
  onSaveModelPack,
  onUpdateModelPack,
  onDeleteModelPack,
  options,
  optionsLoading,
  health,
  capabilities,
  activeJob,
  hardware,
  onJobUpdate,
  onGenerate,
  onCreateVariations,
  onVariationsCreated,
  onLoadJobSettings,
  onRepeatJob,
  onNewSeedJob,
  onEditJobPrompt,
  onSetRepresentative,
  submitting,
}: {
  draft: GenerationDraft;
  onDraftChange: (draft: GenerationDraft) => void;
  profiles: CharacterProfile[];
  modelPacks: ModelPack[];
  activeProfileId: string;
  activeModelPackId: string;
  presetsLoading: boolean;
  onSelectProfile: (id: string) => void;
  onSaveProfile: (name: string) => Promise<void>;
  onUpdateProfile: () => Promise<void>;
  onDeleteProfile: () => Promise<void>;
  onSelectModelPack: (id: string) => void;
  onSaveModelPack: (name: string) => Promise<void>;
  onUpdateModelPack: () => Promise<void>;
  onDeleteModelPack: () => Promise<void>;
  options: StudioOptions;
  optionsLoading: boolean;
  health: HealthResponse | null;
  capabilities: CapabilitiesResponse | null;
  activeJob: StudioJob | null;
  hardware: RuntimeHardware | null;
  onJobUpdate: (job: StudioJob) => void;
  onGenerate: () => void;
  onCreateVariations: (
    request: VariationMatrixRequest,
  ) => Promise<StudioJob[]>;
  onVariationsCreated: (jobs: StudioJob[]) => void;
  onLoadJobSettings: (job: StudioJob) => void;
  onRepeatJob: (job: StudioJob) => Promise<void>;
  onNewSeedJob: (job: StudioJob) => Promise<void>;
  onEditJobPrompt: (job: StudioJob) => void;
  onSetRepresentative: (job: StudioJob) => Promise<void>;
  submitting: boolean;
}) {
  const [activeStep, setActiveStep] =
    React.useState<CreateStepId>("reference");
  const [pendingWorkload, setPendingWorkload] =
    React.useState<WorkloadEstimate | null>(null);
  const workloadDecision =
    React.useRef<((confirmed: boolean) => void) | null>(null);
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
    preflightIssues.find((issue) =>
      [
        "diffusion_missing",
        "clip_missing",
        "vae_missing",
        "lora_missing",
      ].includes(issue.code),
    )?.message ?? "";
  const canGenerate = preflightIssues.length === 0;
  const activeProfile = profiles.find(
    (profile) => profile.id === activeProfileId,
  );
  const activeModelPack = modelPacks.find(
    (pack) => pack.id === activeModelPackId,
  );
  const profileDirty = isCharacterProfileDirty(draft, activeProfile);
  const modelPackDirty = isModelPackDirty(draft, activeModelPack);

  const workloadFor = React.useCallback(
    (jobCount = 1) =>
      estimateWorkload(
        {
          width: draft.sampling.width,
          height: draft.sampling.height,
          batchSize: draft.sampling.batchSize,
          trainingSteps: draft.instantLora.trainingSteps,
          samplingSteps: draft.sampling.steps,
          upscaleSteps: draft.upscale.enabled ? draft.upscale.steps : 0,
          upscaleScale: draft.upscale.scale,
          referenceCount: readyAssets.length,
          upscaleEnabled: draft.upscale.enabled,
          jobCount,
        },
        hardware,
      ),
    [
      draft.instantLora.trainingSteps,
      draft.sampling.batchSize,
      draft.sampling.height,
      draft.sampling.steps,
      draft.sampling.width,
      draft.upscale.enabled,
      draft.upscale.scale,
      draft.upscale.steps,
      hardware,
      readyAssets.length,
    ],
  );

  const confirmWorkload = React.useCallback(
    (jobCount: number) => {
      const estimate = workloadFor(jobCount);
      if (estimate.risk !== "high") return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        workloadDecision.current?.(false);
        workloadDecision.current = resolve;
        setPendingWorkload(estimate);
      });
    },
    [workloadFor],
  );
  const currentWorkload = React.useMemo(() => workloadFor(1), [workloadFor]);

  const settleWorkloadConfirmation = React.useCallback(
    (confirmed: boolean) => {
      const resolve = workloadDecision.current;
      workloadDecision.current = null;
      setPendingWorkload(null);
      resolve?.(confirmed);
    },
    [],
  );

  React.useEffect(
    () => () => {
      workloadDecision.current?.(false);
      workloadDecision.current = null;
    },
    [],
  );

  const issuesFor = React.useCallback(
    (stepId: CreateStepId) =>
      preflightIssues.filter((issue) => issue.stepId === stepId),
    [preflightIssues],
  );
  const steps = React.useMemo<CreateStepDefinition[]>(
    () => [
      {
        id: "reference",
        label: "참조",
        state: issuesFor("reference").length
          ? "error"
          : readyAssets.length
            ? "complete"
            : activeStep === "reference"
              ? "current"
              : "idle",
      },
      {
        id: "prompt",
        label: "프롬프트",
        state:
          draft.prompts.positive.trim() || draft.prompts.natural.trim()
            ? "complete"
            : activeStep === "prompt"
              ? "current"
              : "idle",
      },
      {
        id: "models",
        label: "모델",
        state: issuesFor("models").length
          ? "error"
          : draft.models.diffusion &&
              draft.models.clip &&
              draft.models.vae
            ? "complete"
            : activeStep === "models"
              ? "current"
              : "idle",
      },
      {
        id: "generation",
        label: "생성",
        state: issuesFor("generation").length
          ? "error"
          : canGenerate
            ? "complete"
            : activeStep === "generation"
              ? "current"
              : "idle",
      },
    ],
    [
      activeStep,
      canGenerate,
      draft.models.clip,
      draft.models.diffusion,
      draft.models.vae,
      draft.prompts.natural,
      draft.prompts.positive,
      issuesFor,
      readyAssets.length,
    ],
  );

  const selectStep = React.useCallback((stepId: CreateStepId) => {
    setActiveStep(stepId);
    window.requestAnimationFrame(() => {
      document
        .getElementById(`create-step-${stepId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const resolveIssue = React.useCallback(
    (issue: PreflightIssue) => {
      selectStep(issue.stepId);
      const fieldId = issue.fieldId;
      if (!fieldId) return;
      window.setTimeout(() => {
        const field = document.getElementById(fieldId);
        field?.focus();
        field?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 260);
    },
    [selectStep],
  );

  React.useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    if (!media.matches || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const stepId = visible?.target.getAttribute(
          "data-create-step",
        ) as CreateStepId | null;
        if (stepId) setActiveStep(stepId);
      },
      { rootMargin: "-132px 0px -55% 0px", threshold: [0.15, 0.35, 0.65] },
    );
    for (const stepId of CREATE_STEP_IDS) {
      const element = document.getElementById(`create-step-${stepId}`);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-primary">
              캐릭터 작업실
            </p>
            <Badge variant="outline">Anima</Badge>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            캐릭터 이미지 만들기
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            참조 세트로 즉석 LoRA를 학습하고, 프롬프트와 생성 설정을 한 화면에서
            조정하세요.
          </p>
        </div>
      </div>

      <CreateStepNav
        steps={steps}
        activeStep={activeStep}
        onSelect={selectStep}
      />

      <CreativePresetBar
        draft={draft}
        profiles={profiles}
        modelPacks={modelPacks}
        activeProfileId={activeProfileId}
        activeModelPackId={activeModelPackId}
        loading={presetsLoading}
        onSelectProfile={onSelectProfile}
        onSaveProfile={onSaveProfile}
        onUpdateProfile={onUpdateProfile}
        onDeleteProfile={onDeleteProfile}
        onSelectModelPack={onSelectModelPack}
        onSaveModelPack={onSaveModelPack}
        onUpdateModelPack={onUpdateModelPack}
        onDeleteModelPack={onDeleteModelPack}
        profileDirty={profileDirty}
        modelPackDirty={modelPackDirty}
        onRevertProfile={() => onSelectProfile(activeProfileId)}
        onRevertModelPack={() => onSelectModelPack(activeModelPackId)}
      />

      {selectionIssue ? (
        <div
          role="alert"
          className="mb-5 flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-xs leading-5 text-amber-100"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <div>
            <p className="font-medium">저장된 선택을 교체해야 합니다.</p>
            <p className="mt-0.5 text-amber-100/70">{selectionIssue}</p>
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <CreateStepSection
            id="reference"
            label="참조 이미지"
            state={steps[0].state}
            active={activeStep === "reference"}
            onOpen={() => selectStep("reference")}
          >
            <Card>
              <CardHeader>
                <SectionHeading
                  eyebrow="01 · 참조"
                  title="참조 이미지"
                  description="서로 다른 거리와 각도의 이미지를 2–6장 사용하는 것을 권장합니다."
                  action={
                    readyAssets.length ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-success">
                        <CheckCircle2 className="size-3.5" />
                        업로드됨
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
          </CreateStepSection>

          <CreateStepSection
            id="prompt"
            label="프롬프트"
            state={steps[1].state}
            active={activeStep === "prompt"}
            onOpen={() => selectStep("prompt")}
          >
            <Card>
              <CardHeader>
                <SectionHeading
                  eyebrow="02 · 프롬프트"
                  title="프롬프트"
                  description="기본 품질 태그, 사용자 긍정, 자연어를 서버가 순서대로 결합합니다. 완료 후 자동 태그는 결과에서 선택해 추가할 수 있습니다."
                />
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
          </CreateStepSection>

          <CreateStepSection
            id="models"
            label="모델과 LoRA"
            state={steps[2].state}
            active={activeStep === "models"}
            onOpen={() => selectStep("models")}
          >
            <Card>
              <CardHeader>
                <SectionHeading
                  eyebrow="03 · 모델"
                  title="모델과 LoRA"
                  description="현재 연결된 ComfyUI에 설치된 항목만 표시됩니다."
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
                  validationWarning={selectionIssue || undefined}
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
          </CreateStepSection>

          <CreateStepSection
            id="generation"
            label="생성 설정"
            state={steps[3].state}
            active={activeStep === "generation"}
            onOpen={() => selectStep("generation")}
          >
            <Card>
              <CardHeader>
                <SectionHeading
                  eyebrow="04 · 생성"
                  title="생성 설정"
                  description="자주 쓰는 값은 위에, 학습·태깅·CFG·업스케일 옵션은 접힌 영역에 배치했습니다."
                />
              </CardHeader>
              <CardContent>
                <GenerationControls
                  value={draft}
                  options={options}
                  onChange={onDraftChange}
                />
                <div className="mt-4">
                  <ResourceEstimate
                    hardware={hardware}
                    workload={{
                      width: draft.sampling.width,
                      height: draft.sampling.height,
                      batchSize: draft.sampling.batchSize,
                      trainingSteps: draft.instantLora.trainingSteps,
                      samplingSteps: draft.sampling.steps,
                      upscaleSteps: draft.upscale.enabled
                        ? draft.upscale.steps
                        : 0,
                      upscaleScale: draft.upscale.scale,
                      referenceCount: readyAssets.length,
                      upscaleEnabled: draft.upscale.enabled,
                    }}
                  />
                </div>
                <div className="mt-4">
                  <VariationMatrix
                    draft={draft}
                    disabled={!canGenerate || submitting}
                    disabledReason={validationMessage}
                    onBeforeSubmit={confirmWorkload}
                    onSubmit={onCreateVariations}
                    onJobsCreated={onVariationsCreated}
                  />
                </div>
              </CardContent>
            </Card>
          </CreateStepSection>
        </div>

        <JobPanel
          job={activeJob}
          health={health}
          capabilities={capabilities}
          submitting={submitting}
          canGenerate={canGenerate}
          validationMessage={validationMessage}
          preflightIssues={preflightIssues}
          workload={currentWorkload}
          onResolveIssue={resolveIssue}
          onGenerate={() => {
            void confirmWorkload(1).then((confirmed) => {
              if (confirmed) onGenerate();
            });
          }}
          onJobUpdate={onJobUpdate}
          onLoadSettings={onLoadJobSettings}
          onRepeat={onRepeatJob}
          onNewSeed={onNewSeedJob}
          onEditPrompt={onEditJobPrompt}
          onSetRepresentative={onSetRepresentative}
          activeProfileName={
            profiles.find((profile) => profile.id === activeProfileId)?.name
          }
        />
        <MobileExecutionDock
          job={activeJob}
          health={health}
          submitting={submitting}
          canGenerate={canGenerate}
          validationMessage={validationMessage}
          preflightIssues={preflightIssues}
          workload={currentWorkload}
          onResolveIssue={resolveIssue}
          onGenerate={() => {
            void confirmWorkload(1).then((confirmed) => {
              if (confirmed) onGenerate();
            });
          }}
          onJobUpdate={onJobUpdate}
        />
      </div>

      <AlertDialog
        open={pendingWorkload !== null}
        onOpenChange={(open) => {
          if (!open && pendingWorkload) settleWorkloadConfirmation(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>고부하 작업을 실행할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              현재 설정은 GPU 메모리, 출력 수 또는 예상 시간 기준을 넘습니다.
              아래 내용을 확인한 뒤 실행하세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingWorkload ? (
            <div className="space-y-3 rounded-lg border border-warning/25 bg-warning/[0.06] p-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">작업 / 결과</dt>
                  <dd className="mt-0.5 font-medium">
                    {pendingWorkload.jobCount}개 /{" "}
                    {pendingWorkload.totalOutputCount}장
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">총 출력 면적</dt>
                  <dd className="mt-0.5 font-medium">
                    {pendingWorkload.totalOutputMegapixels.toFixed(1)} MP
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">추정 VRAM</dt>
                  <dd className="mt-0.5 font-medium">
                    {pendingWorkload.estimatedVramGiB.toFixed(1)} GB
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">예상 시간 상한</dt>
                  <dd className="mt-0.5 font-medium">
                    {Math.ceil(pendingWorkload.upperSeconds / 60)}분
                  </dd>
                </div>
              </dl>
              <ul className="space-y-1 text-xs leading-5 text-warning">
                {pendingWorkload.reasons.map((reason) => (
                  <li key={reason}>• {reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => settleWorkloadConfirmation(false)}
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settleWorkloadConfirmation(true)}
            >
              확인 후 실행
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function StudioShell() {
  const [activeTab, setActiveTab] = React.useState<Tab>("create");
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [systemStatusOpen, setSystemStatusOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<GenerationDraft>(DEFAULT_DRAFT);
  const [hydrated, setHydrated] = React.useState(false);
  const [health, setHealth] = React.useState<HealthResponse | null>(null);
  const [capabilities, setCapabilities] =
    React.useState<CapabilitiesResponse | null>(null);
  const [options, setOptions] = React.useState<StudioOptions>(EMPTY_OPTIONS);
  const [runtimeHardware, setRuntimeHardware] =
    React.useState<RuntimeHardware | null>(null);
  const [storage, setStorage] = React.useState<StorageInventory | null>(null);
  const [storageLoading, setStorageLoading] = React.useState(true);
  const [storageError, setStorageError] = React.useState("");
  const [onboarding, setOnboarding] =
    React.useState<OnboardingStatus | null>(null);
  const [loadingSystem, setLoadingSystem] = React.useState(true);
  const [systemError, setSystemError] = React.useState("");
  const [activeJob, setActiveJob] = React.useState<StudioJob | null>(null);
  const [profiles, setProfiles] = React.useState<CharacterProfile[]>([]);
  const [modelPacks, setModelPacks] = React.useState<ModelPack[]>([]);
  const [activeProfileId, setActiveProfileId] = React.useState("");
  const [activeModelPackId, setActiveModelPackId] = React.useState("");
  const [presetsLoading, setPresetsLoading] = React.useState(true);
  const [profileStorage, setProfileStorage] = React.useState<"api" | "local">(
    "api",
  );
  const [modelPackStorage, setModelPackStorage] = React.useState<
    "api" | "local"
  >("api");
  const [submitting, setSubmitting] = React.useState(false);
  const [toast, setToast] = React.useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [pendingPresetDelete, setPendingPresetDelete] = React.useState<{
    kind: "profile" | "modelPack";
    id: string;
    name: string;
  } | null>(null);
  const [deletingPreset, setDeletingPreset] = React.useState(false);
  const completionNotifications = useCompletionNotifications();
  const notifyCompletion = completionNotifications.notify;
  const onboardingCompletionJob = React.useRef("");

  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [activeTab]);

  React.useEffect(() => {
    if (!activeJob || !["completed", "failed"].includes(activeJob.status)) {
      return;
    }
    notifyCompletion({
      id: `${activeJob.id}:${activeJob.status}`,
      title:
        activeJob.status === "completed"
          ? "Anima 이미지 생성 완료"
          : "Anima 이미지 생성 실패",
      body:
        activeJob.status === "completed"
          ? `Seed ${activeJob.settings.sampling.seed} 결과가 준비되었습니다.`
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
    setSidebarCollapsed(
      window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
    );
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
    const controller = new AbortController();
    setPresetsLoading(true);
    Promise.allSettled([
      getCharacterProfiles(controller.signal),
      getModelPacks(controller.signal),
    ])
      .then(([profileResult, packResult]) => {
        if (profileResult.status === "fulfilled") {
          setProfiles(profileResult.value);
          setProfileStorage("api");
        } else {
          setProfiles(
            readLocalPresetList<CharacterProfile>(LOCAL_PROFILES_KEY),
          );
          setProfileStorage("local");
        }
        if (packResult.status === "fulfilled") {
          setModelPacks(packResult.value);
          setModelPackStorage("api");
        } else {
          setModelPacks(
            readLocalPresetList<ModelPack>(LOCAL_MODEL_PACKS_KEY),
          );
          setModelPackStorage("local");
        }
      })
      .finally(() => setPresetsLoading(false));
    return () => controller.abort();
  }, [hydrated]);

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
    ] =
      await Promise.allSettled([
        getHealth(),
        getCapabilities(),
        getOptions(),
        getStorage(),
        getOnboarding(),
      ]);
    void getComfyRuntime()
      .then((runtime) => setRuntimeHardware(runtime.hardware))
      .catch(() => setRuntimeHardware(null));

    if (healthResult.status === "fulfilled") setHealth(healthResult.value);
    else setHealth(null);
    if (capabilityResult.status === "fulfilled")
      setCapabilities(capabilityResult.value);
    else setCapabilities(null);
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
      setToast({ type: "success", message: "작업을 ComfyUI 대기열에 추가했습니다." });
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

  function profileInput(name: string) {
    return {
      name,
      draft: structuredClone(draft),
    };
  }

  function modelPackInput(name: string) {
    return {
      name,
      models: structuredClone(draft.models),
      loras: structuredClone(draft.loras),
    };
  }

  function commitLocalProfiles(next: CharacterProfile[]) {
    setProfiles(next);
    writeLocalPresetList(LOCAL_PROFILES_KEY, next);
  }

  function commitLocalModelPacks(next: ModelPack[]) {
    setModelPacks(next);
    writeLocalPresetList(LOCAL_MODEL_PACKS_KEY, next);
  }

  async function saveProfile(name: string) {
    try {
      let profile: CharacterProfile;
      if (profileStorage === "api") {
        profile = await createCharacterProfile(profileInput(name));
        setProfiles((current) => [profile, ...current]);
      } else {
        const now = new Date().toISOString();
        profile = {
          id: uniqueId("profile"),
          ...profileInput(name),
          createdAt: now,
          updatedAt: now,
        };
        commitLocalProfiles([profile, ...profiles]);
      }
      setActiveProfileId(profile.id);
      void getOnboarding().then(setOnboarding).catch(() => undefined);
      setToast({ type: "success", message: `“${name}” 캐릭터를 저장했습니다.` });
    } catch (error) {
      setToast({
        type: "error",
        message:
          error instanceof Error ? error.message : "캐릭터를 저장하지 못했습니다.",
      });
    }
  }

  async function updateProfile() {
    const current = profiles.find((profile) => profile.id === activeProfileId);
    if (!current) return;
    try {
      if (profileStorage === "api") {
        const updated = await updateCharacterProfile(
          current.id,
          profileInput(current.name),
        );
        setProfiles((values) =>
          values.map((profile) =>
            profile.id === updated.id ? updated : profile,
          ),
        );
      } else {
        commitLocalProfiles(
          profiles.map((profile) =>
            profile.id === current.id
              ? {
                  ...profile,
                  ...profileInput(profile.name),
                  updatedAt: new Date().toISOString(),
                }
              : profile,
          ),
        );
      }
      setToast({
        type: "success",
        message: `“${current.name}”에 현재 설정을 저장했습니다.`,
      });
    } catch (error) {
      setToast({
        type: "error",
        message:
          error instanceof Error ? error.message : "프로필을 갱신하지 못했습니다.",
      });
    }
  }

  async function removeProfile() {
    const current = profiles.find((profile) => profile.id === activeProfileId);
    if (!current) return;
    setPendingPresetDelete({
      kind: "profile",
      id: current.id,
      name: current.name,
    });
  }

  function selectProfile(id: string) {
    setActiveProfileId(id);
    if (!id) return;
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    setDraft((current) => ({
      ...current,
      referenceAssets: structuredClone(profile.draft.referenceAssets),
      prompts: structuredClone(profile.draft.prompts),
      instantLora: structuredClone(profile.draft.instantLora),
      tagging: structuredClone(profile.draft.tagging),
    }));
    setToast({
      type: "success",
      message: `“${profile.name}” 캐릭터 설정을 불러왔습니다.`,
    });
  }

  async function saveModelPack(name: string) {
    try {
      let pack: ModelPack;
      if (modelPackStorage === "api") {
        pack = await createModelPack(modelPackInput(name));
        setModelPacks((current) => [pack, ...current]);
      } else {
        const now = new Date().toISOString();
        pack = {
          id: uniqueId("model-pack"),
          ...modelPackInput(name),
          createdAt: now,
          updatedAt: now,
        };
        commitLocalModelPacks([pack, ...modelPacks]);
      }
      setActiveModelPackId(pack.id);
      setToast({ type: "success", message: `“${name}” 모델 팩을 저장했습니다.` });
    } catch (error) {
      setToast({
        type: "error",
        message:
          error instanceof Error ? error.message : "모델 팩을 저장하지 못했습니다.",
      });
    }
  }

  async function updateSelectedModelPack() {
    const current = modelPacks.find((pack) => pack.id === activeModelPackId);
    if (!current) return;
    try {
      if (modelPackStorage === "api") {
        const updated = await updateModelPack(
          current.id,
          modelPackInput(current.name),
        );
        setModelPacks((values) =>
          values.map((pack) => (pack.id === updated.id ? updated : pack)),
        );
      } else {
        commitLocalModelPacks(
          modelPacks.map((pack) =>
            pack.id === current.id
              ? {
                  ...pack,
                  ...modelPackInput(pack.name),
                  updatedAt: new Date().toISOString(),
                }
              : pack,
          ),
        );
      }
      setToast({
        type: "success",
        message: `“${current.name}” 모델 팩을 갱신했습니다.`,
      });
    } catch (error) {
      setToast({
        type: "error",
        message:
          error instanceof Error ? error.message : "모델 팩을 갱신하지 못했습니다.",
      });
    }
  }

  async function removeModelPack() {
    const current = modelPacks.find((pack) => pack.id === activeModelPackId);
    if (!current) return;
    setPendingPresetDelete({
      kind: "modelPack",
      id: current.id,
      name: current.name,
    });
  }

  async function confirmPresetDelete() {
    const pending = pendingPresetDelete;
    if (!pending || deletingPreset) return;
    setDeletingPreset(true);
    try {
      if (pending.kind === "profile") {
        if (profileStorage === "api") {
          await deleteCharacterProfile(pending.id);
          setProfiles((values) =>
            values.filter((profile) => profile.id !== pending.id),
          );
        } else {
          commitLocalProfiles(
            profiles.filter((profile) => profile.id !== pending.id),
          );
        }
        setActiveProfileId("");
        setToast({
          type: "success",
          message: "캐릭터 프로필을 삭제했습니다.",
        });
      } else {
        if (modelPackStorage === "api") {
          await deleteModelPack(pending.id);
          setModelPacks((values) =>
            values.filter((pack) => pack.id !== pending.id),
          );
        } else {
          commitLocalModelPacks(
            modelPacks.filter((pack) => pack.id !== pending.id),
          );
        }
        setActiveModelPackId("");
        setToast({ type: "success", message: "모델 팩을 삭제했습니다." });
      }
      setPendingPresetDelete(null);
    } catch (error) {
      setToast({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : pending.kind === "profile"
              ? "프로필을 삭제하지 못했습니다."
              : "모델 팩을 삭제하지 못했습니다.",
      });
    } finally {
      setDeletingPreset(false);
    }
  }

  function selectModelPack(id: string) {
    setActiveModelPackId(id);
    if (!id) return;
    const pack = modelPacks.find((item) => item.id === id);
    if (!pack) return;
    const hydratedLoras = pack.loras.map((lora) => {
      const normalizedPath = lora.path.replaceAll("\\", "/").toLowerCase();
      const installed = options.loras.find((option) => {
        const optionPath = option.value.replaceAll("\\", "/").toLowerCase();
        return (
          optionPath === normalizedPath ||
          option.name.replaceAll("\\", "/").toLowerCase() === normalizedPath
        );
      });
      return {
        ...lora,
        triggerWords: installed?.triggerWords?.length
          ? installed.triggerWords
          : lora.triggerWords,
        ...(installed?.thumbnailUrl || lora.thumbnailUrl
          ? { thumbnailUrl: installed?.thumbnailUrl ?? lora.thumbnailUrl }
          : {}),
      };
    });
    setDraft((current) => ({
      ...current,
      models: structuredClone(pack.models),
      loras: structuredClone(hydratedLoras),
    }));
    setToast({
      type: "success",
      message: `“${pack.name}” 모델 구성을 적용했습니다.`,
    });
  }

  async function submitJobDraft(nextDraft: GenerationDraft, message: string) {
    setSubmitting(true);
    try {
      const job = await createJob(nextDraft);
      setActiveJob(job);
      setActiveTab("create");
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
    setActiveTab("create");
    setToast({
      type: "success",
      message: `Seed ${job.settings.sampling.seed}을 고정했습니다. 프롬프트를 수정하세요.`,
    });
    window.setTimeout(() => {
      document.getElementById("positive-prompt")?.focus();
      document
        .getElementById("positive-prompt")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  async function submitVariations(request: VariationMatrixRequest) {
    const result = await createVariationMatrix(request);
    return result.jobs;
  }

  function variationsCreated(jobs: StudioJob[]) {
    if (jobs[0]) setActiveJob(jobs[0]);
    setToast({
      type: "success",
      message: `${jobs.length}개 변형 작업을 대기열에 추가했습니다.`,
    });
  }

  async function setRepresentative(job: StudioJob) {
    const profile = profiles.find((item) => item.id === activeProfileId);
    const output =
      job.outputs.find(
        (item) => item.kind === "upscale" || item.kind === "upscaled",
      ) ?? job.outputs[0];
    if (!profile) throw new Error("먼저 캐릭터 프로필을 선택해주세요.");
    if (!output) throw new Error("대표 이미지로 지정할 결과가 없습니다.");
    if (profileStorage === "api") {
      const updated = await setCharacterProfileRepresentative(
        profile.id,
        output.id,
      );
      setProfiles((values) =>
        values.map((item) => (item.id === updated.id ? updated : item)),
      );
    } else {
      commitLocalProfiles(
        profiles.map((item) =>
          item.id === profile.id
            ? {
                ...item,
                representativeOutputId: output.id,
                representativeUrl: output.url ?? `/api/outputs/${output.id}`,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
    }
    setToast({
      type: "success",
      message: `“${profile.name}” 대표 이미지를 변경했습니다.`,
    });
  }

  function loadSettings(settings: GenerationDraft) {
    setDraft(settings);
    setActiveTab("create");
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
        message: `${result.results.filter((item) => item.deleted).length}개 항목을 정리했습니다.`,
      });
    }
    return result;
  }

  async function handlePortableExport() {
    const characterProfileIds = profiles.map((profile) => profile.id);
    const modelPackIds = modelPacks.map((pack) => pack.id);
    if (!characterProfileIds.length && !modelPackIds.length) {
      throw new Error("내보낼 캐릭터 프로필 또는 모델 팩이 없습니다.");
    }
    return exportPortableSettings(characterProfileIds, modelPackIds);
  }

  async function handlePortablePreview(document: unknown) {
    return previewPortableSettings(document);
  }

  async function handlePortableImport(document: unknown) {
    setPresetsLoading(true);
    try {
      await importPortableSettings(document);
      const [nextProfiles, nextModelPacks] = await Promise.all([
        getCharacterProfiles(),
        getModelPacks(),
      ]);
      setProfiles(nextProfiles);
      setModelPacks(nextModelPacks);
      setProfileStorage("api");
      setModelPackStorage("api");
      await Promise.all([
        refreshStorageInventory(),
        getOnboarding().then(setOnboarding),
      ]);
      setToast({
        type: "success",
        message: "설정 번들을 가져오고 프로필·모델 팩 목록을 갱신했습니다.",
      });
    } finally {
      setPresetsLoading(false);
    }
  }

  async function handleOnboardingUpdate(patch: OnboardingUpdate) {
    setOnboarding(await updateOnboarding(patch));
  }

  async function addDownloadedLora(download: ModelDownload) {
    const metadataPath =
      typeof download.metadata.comfyModelPath === "string"
        ? download.metadata.comfyModelPath
        : typeof download.metadata.relativePath === "string"
          ? download.metadata.relativePath
          : "";
    const path =
      metadataPath ||
      [download.relativeDir, download.filename].filter(Boolean).join("/");
    setDraft((current) => {
      if (current.loras.some((lora) => lora.path === path)) return current;
      return {
        ...current,
        loras: [
          ...current.loras,
          {
            id: `download_${download.id}`,
            name: download.modelName || download.filename,
            path,
            enabled: true,
            modelStrength: 1,
            clipStrength: 1,
            triggerWords: download.triggerWords,
          },
        ],
      };
    });
    setActiveTab("create");
    await refreshSystem();
    setToast({
      type: "success",
      message: `${download.modelName} LoRA를 현재 생성 설정에 추가했습니다.`,
    });
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

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          className="w-[min(86vw,320px)] p-4 lg:hidden"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>주 메뉴</SheetTitle>
            <SheetDescription>
              Anima Studio 화면을 선택합니다.
            </SheetDescription>
          </SheetHeader>
          <StudioNavigation
            activeTab={activeTab}
            onSelect={(tab) => {
              setActiveTab(tab);
              setSidebarOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>

      <aside
        className={cn(
          "glass-surface fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border p-3 transition-[width] duration-200 lg:flex",
          sidebarCollapsed ? "w-[72px]" : "w-64",
        )}
      >
        <StudioNavigation
          activeTab={activeTab}
          collapsed={sidebarCollapsed}
          onSelect={setActiveTab}
          onToggleCollapsed={() => {
            const next = !sidebarCollapsed;
            setSidebarCollapsed(next);
            window.localStorage.setItem(
              SIDEBAR_COLLAPSED_KEY,
              String(next),
            );
          }}
        />
      </aside>

      <div
        className={cn(
          "transition-[padding] duration-200",
          sidebarCollapsed ? "lg:pl-[72px]" : "lg:pl-64",
        )}
      >
        <header className="glass-surface sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border px-4 lg:px-7">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="메뉴 열기"
            >
              <Menu />
            </Button>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <span>Anima Studio</span>
              <span>/</span>
              <span className="text-foreground">
                {navItems.find((item) => item.id === activeTab)?.label}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeJob &&
            ["uploading", "queued", "running"].includes(activeJob.status) ? (
              <button
                type="button"
                onClick={() => setActiveTab("create")}
                className="inline-flex min-h-9 items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 text-xs text-primary outline-none transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Clock3 className="size-3.5" />
                {activeJob.stage ?? "생성 중"}
              </button>
            ) : null}
            <Popover open={systemStatusOpen} onOpenChange={setSystemStatusOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`시스템 상태: ${connected ? "ComfyUI 연결됨" : "연결 끊김"}`}
                >
                  <Server className="text-muted-foreground sm:hidden" />
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      connected ? "bg-success" : "bg-danger",
                    )}
                  />
                  <span className="hidden sm:inline">시스템 상태</span>
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
                          ? `${capabilities.missingNodes.length}개 확인 필요`
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
                      setActiveTab("settings");
                      setSystemStatusOpen(false);
                    }}
                  >
                    설정 열기
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </header>

        <main
          id="studio-main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1560px] px-4 py-6 outline-none lg:px-7 lg:py-8"
        >
          {activeTab === "create" ? (
            <div className="space-y-5">
              <CreateWorkspace
                draft={draft}
                onDraftChange={setDraft}
                profiles={profiles}
                modelPacks={modelPacks}
                activeProfileId={activeProfileId}
                activeModelPackId={activeModelPackId}
                presetsLoading={presetsLoading}
                onSelectProfile={selectProfile}
                onSaveProfile={saveProfile}
                onUpdateProfile={updateProfile}
                onDeleteProfile={removeProfile}
                onSelectModelPack={selectModelPack}
                onSaveModelPack={saveModelPack}
                onUpdateModelPack={updateSelectedModelPack}
                onDeleteModelPack={removeModelPack}
                options={options}
                optionsLoading={loadingSystem}
                health={health}
                capabilities={capabilities}
                activeJob={activeJob}
                hardware={runtimeHardware}
                onJobUpdate={setActiveJob}
                onGenerate={handleGenerate}
                onCreateVariations={submitVariations}
                onVariationsCreated={variationsCreated}
                onLoadJobSettings={(job) => loadSettings(job.settings)}
                onRepeatJob={repeatJob}
                onNewSeedJob={newSeedJob}
                onEditJobPrompt={editJobPrompt}
                onSetRepresentative={setRepresentative}
                submitting={submitting}
              />
            </div>
          ) : activeTab === "history" ? (
            <HistoryView
              onLoadSettings={loadSettings}
              onRepeatJob={repeatJob}
              onNewSeedJob={newSeedJob}
              onEditJobPrompt={editJobPrompt}
              onSetRepresentative={setRepresentative}
              activeProfileName={
                profiles.find((profile) => profile.id === activeProfileId)?.name
              }
              onTrackJob={(job) => {
                setActiveJob(job);
                setActiveTab("create");
                setToast({
                  type: "success",
                  message: `Seed ${job.settings.sampling.seed}로 업스케일 작업을 시작했습니다.`,
                });
              }}
            />
          ) : activeTab === "library" ? (
            <LibraryView
              onAddLora={addDownloadedLora}
              onOpenManagedRuntime={() => setActiveTab("settings")}
            />
          ) : (
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
              onNavigateToCreate={() => setActiveTab("create")}
              notificationController={completionNotifications}
              storage={storage}
              storageLoading={storageLoading}
              storageError={storageError}
              onStorageRefresh={() => void refreshStorageInventory()}
              onStorageCleanup={handleStorageCleanup}
              onExportPortable={handlePortableExport}
              onPreviewPortable={handlePortablePreview}
              onImportPortable={handlePortableImport}
            />
          )}
        </main>
      </div>

      <AlertDialog
        open={pendingPresetDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingPreset) setPendingPresetDelete(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingPresetDelete?.kind === "profile"
                ? "캐릭터 프로필을 삭제할까요?"
                : "모델 팩을 삭제할까요?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingPresetDelete?.name}”을 삭제합니다. 생성 초안과 기존 작업
              히스토리는 변경되지 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingPreset}>
              취소
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingPreset}
              onClick={() => void confirmPresetDelete()}
            >
              {deletingPreset ? "삭제 중" : "삭제"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {toast ? (
        <div
          role={toast.type === "error" ? "alert" : "status"}
          className={cn(
            "fixed bottom-24 left-4 right-4 z-[70] flex max-w-sm animate-fade-in items-start gap-3 rounded-xl border bg-popover/95 p-4 text-[13px] shadow-dialog backdrop-blur-xl sm:left-auto sm:right-5 xl:bottom-5",
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

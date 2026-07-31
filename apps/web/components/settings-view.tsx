"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  FolderCog,
  LayoutDashboard,
  Link2,
  RefreshCw,
  RotateCcw,
  Server,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import {
  CompletionNotificationPanel,
  type CompletionNotificationPanelProps,
} from "@/components/completion-notifications";
import { DependencyRemedies } from "@/components/dependency-remedies";
import { RuntimeManager } from "@/components/runtime-manager";
import { StorageDashboard } from "@/components/storage-dashboard";
import { SystemOnboarding } from "@/components/system-onboarding";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, SectionHeading } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  rememberSettingsSection,
  SETTINGS_SECTION_STORAGE_KEY,
  type SettingsSection,
} from "@/lib/studio-ux";
import type {
  CapabilitiesResponse,
  HealthResponse,
  OnboardingStatus,
  OnboardingUpdate,
  StorageCleanupResult,
  StorageCleanupTarget,
  StorageInventory,
  StudioOptions,
} from "@/lib/types";

interface SettingsViewProps {
  health: HealthResponse | null;
  capabilities: CapabilitiesResponse | null;
  options: StudioOptions;
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onClearDraft: () => void;
  onboarding: OnboardingStatus | null;
  onOnboardingUpdate: (patch: OnboardingUpdate) => Promise<void>;
  onNavigateToCreate: () => void;
  notificationController?: CompletionNotificationPanelProps["controller"];
  storage: StorageInventory | null;
  storageLoading?: boolean;
  storageError?: string;
  onStorageRefresh: () => void;
  onStorageCleanup: (
    targets: StorageCleanupTarget[],
    dryRun: boolean,
  ) => Promise<StorageCleanupResult>;
}

const sections: Array<{
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "overview", label: "개요", icon: LayoutDashboard },
  { id: "runtime", label: "엔진·로그", icon: ServerCog },
  { id: "models", label: "모델·노드", icon: SlidersHorizontal },
  { id: "storage", label: "저장공간·데이터", icon: Database },
];

function isSettingsSection(value: string | null): value is SettingsSection {
  return sections.some((section) => section.id === value);
}

export function SettingsView({
  health,
  capabilities,
  options,
  loading,
  error,
  onRefresh,
  onClearDraft,
  onboarding,
  onOnboardingUpdate,
  onNavigateToCreate,
  notificationController,
  storage,
  storageLoading,
  storageError,
  onStorageRefresh,
  onStorageCleanup,
}: SettingsViewProps) {
  const [copied, setCopied] = React.useState(false);
  const [section, setSection] = React.useState<SettingsSection>("overview");
  const comfyUrl =
    capabilities?.comfyUrl ?? health?.comfyUrl ?? "http://127.0.0.1:8188";
  const connected = Boolean(
    health?.comfyui || (health?.ok && health.comfyui !== false),
  );
  const firstCapabilityIssue =
    capabilities?.missingNodes[0] ?? capabilities?.incompatibleNodes?.[0];

  React.useEffect(() => {
    const saved = window.localStorage.getItem(SETTINGS_SECTION_STORAGE_KEY);
    if (isSettingsSection(saved)) setSection(saved);
  }, []);

  function selectSection(next: string) {
    if (!isSettingsSection(next)) return;
    setSection(next);
    rememberSettingsSection(next);
  }

  function openSection(next: SettingsSection, targetId?: string) {
    selectSection(next);
    if (!targetId) return;
    window.setTimeout(() => {
      document
        .getElementById(targetId)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(comfyUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <h1 className="text-2xl font-semibold tracking-tight">설정</h1>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
          전체 다시 검사
        </Button>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex gap-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] p-4 text-sm text-red-100"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-300" />
          <div>
            <p className="font-medium">API 서버에 연결할 수 없습니다.</p>
            <p className="mt-1 text-xs text-red-200/70">{error}</p>
          </div>
        </div>
      ) : null}

      <Tabs value={section} onValueChange={selectSection}>
        <TabsList
          aria-label="설정 섹션"
          className="grid h-auto w-full grid-cols-2 gap-1 p-1 md:grid-cols-4"
        >
          {sections.map(({ id, label, icon: Icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              className="min-h-11 gap-2 px-3"
            >
              <Icon className="size-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent
          value="overview"
          forceMount
          className="mt-5 space-y-5 data-[state=inactive]:hidden"
        >
          <SystemOnboarding
            runtime={null}
            capabilities={capabilities}
            status={onboarding}
            busy={loading}
            onUpdate={onOnboardingUpdate}
            onInstall={() => openSection("runtime", "runtime-manager")}
            onStart={() => openSection("runtime", "runtime-manager")}
            onRefresh={onRefresh}
            onOpenDependencies={() =>
              openSection("models", "dependency-remedies")
            }
            onOpenModels={() => openSection("models", "installed-resources")}
            onNavigateToCreate={onNavigateToCreate}
          />

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="inline-flex items-center gap-2">
                    <Server className="size-4 text-primary" />
                    시스템 상태
                  </CardTitle>
                  <Badge variant={connected ? "success" : "destructive"}>
                    {connected ? "연결됨" : "오프라인"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border bg-secondary/35 p-3">
                  <p className="text-xs text-muted-foreground">대기 작업</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {health?.queue?.pending ?? "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/35 p-3">
                  <p className="text-xs text-muted-foreground">실행 작업</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {health?.queue?.running ?? "—"}
                  </p>
                </div>
                <div className="col-span-2 flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/35 p-3">
                  <span className="min-w-0">
                    <span className="block text-xs text-muted-foreground">
                      ComfyUI 주소
                    </span>
                    <span className="mt-1 block truncate font-mono text-xs">
                      {comfyUrl}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={copyUrl}
                    aria-label="ComfyUI URL 복사"
                  >
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="inline-flex items-center gap-2">
                    {connected && capabilities?.ready ? (
                      <CheckCircle2 className="size-4 text-emerald-300" />
                    ) : (
                      <AlertTriangle className="size-4 text-amber-300" />
                    )}
                    우선 해결 항목
                  </CardTitle>
                  <Badge
                    variant={
                      connected && capabilities?.ready ? "success" : "warning"
                    }
                  >
                    {connected && capabilities?.ready
                      ? "준비 완료"
                      : "확인 필요"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {error ? (
                  <>
                    <p className="text-sm font-medium">API 연결 복구</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Studio API 상태를 먼저 복구한 뒤 시스템을 다시 검사하세요.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-4"
                      onClick={onRefresh}
                    >
                      <RefreshCw />
                      다시 검사
                    </Button>
                  </>
                ) : !connected ? (
                  <>
                    <p className="text-sm font-medium">ComfyUI 엔진 연결</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      엔진을 실행하거나 외부 ComfyUI 주소를 확인해야 생성할 수
                      있습니다.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-4"
                      onClick={() =>
                        openSection("runtime", "runtime-manager")
                      }
                    >
                      <ServerCog />
                      엔진 설정 열기
                    </Button>
                  </>
                ) : !capabilities?.ready ? (
                  <>
                    <p className="text-sm font-medium">
                      {firstCapabilityIssue?.label ??
                        firstCapabilityIssue?.classType ??
                        "필수 노드와 모델 확인"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {firstCapabilityIssue?.reason ??
                        "현재 워크플로우 계약에 필요한 항목을 확인하세요."}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-4"
                      onClick={() =>
                        openSection("models", "dependency-remedies")
                      }
                    >
                      <ShieldCheck />
                      해결 방법 보기
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium">
                      이미지 생성 준비가 끝났습니다.
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      엔진, 필수 노드와 선택한 리소스가 모두 정상입니다.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-4"
                      onClick={onNavigateToCreate}
                    >
                      생성 화면 열기
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {notificationController ? (
            <Card>
              <CardHeader>
                <SectionHeading title="완료 알림" />
              </CardHeader>
              <CardContent>
                <CompletionNotificationPanel
                  controller={notificationController}
                />
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent
          value="runtime"
          forceMount
          className="mt-5 data-[state=inactive]:hidden"
        >
          <RuntimeManager
            onSystemRefresh={onRefresh}
            notificationController={notificationController}
          />
        </TabsContent>

        <TabsContent
          value="models"
          forceMount
          className="mt-5 space-y-5 data-[state=inactive]:hidden"
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <Card id="comfy-connection">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="inline-flex items-center gap-2">
                    <Server className="size-4 text-primary" />
                    ComfyUI 연결
                  </CardTitle>
                  <Badge variant={connected ? "success" : "destructive"}>
                    {connected ? "연결됨" : "오프라인"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="ComfyUI URL" hint="API 서버가 사용하는 연결 주소">
                  <div className="flex gap-2">
                    <Input
                      value={comfyUrl}
                      readOnly
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={copyUrl}
                      aria-label="ComfyUI URL 복사"
                    >
                      {copied ? <Check /> : <Copy />}
                    </Button>
                    <Button asChild type="button" size="icon" variant="outline">
                      <a
                        href={comfyUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="ComfyUI 열기"
                      >
                        <ExternalLink />
                      </a>
                    </Button>
                  </div>
                </Field>
              </CardContent>
            </Card>

            <Card id="dependency-remedies">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="inline-flex items-center gap-2">
                    <ShieldCheck className="size-4 text-violet-300" />
                    워크플로우 호환성
                  </CardTitle>
                  <Badge variant={capabilities?.ready ? "success" : "warning"}>
                    {capabilities?.ready ? "준비 완료" : "확인 필요"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <DependencyRemedies
                  ready={Boolean(capabilities?.ready)}
                  issues={capabilities?.missingNodes ?? []}
                  checking={loading}
                  onRetry={onRefresh}
                  onOpenRuntime={() =>
                    openSection("runtime", "runtime-manager")
                  }
                />
              </CardContent>
            </Card>
          </div>

          <Card id="installed-resources">
            <CardHeader>
              <SectionHeading title="설치된 리소스" />
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  icon: FolderCog,
                  label: "Diffusion models",
                  value: options.diffusionModels.length,
                },
                {
                  icon: Link2,
                  label: "Text encoders",
                  value: options.clips.length,
                },
                { icon: Database, label: "VAE", value: options.vaes.length },
                { icon: ShieldCheck, label: "LoRA", value: options.loras.length },
              ].map(({ icon: Icon, label, value }) => (
                <div
                  key={label}
                  className="flex items-center gap-3 rounded-lg border border-border bg-secondary/35 p-4"
                >
                  <span className="grid size-9 place-items-center rounded-lg bg-secondary text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums">
                      {value}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="storage"
          forceMount
          className="mt-5 space-y-5 data-[state=inactive]:hidden"
        >
          <StorageDashboard
            inventory={storage}
            loading={storageLoading}
            error={storageError}
            onRefresh={onStorageRefresh}
            onCleanup={onStorageCleanup}
          />

          <Card>
            <CardHeader>
              <SectionHeading title="브라우저 생성 초안" />
            </CardHeader>
            <CardContent className="flex justify-end">
              <Button type="button" variant="outline" onClick={onClearDraft}>
                <RotateCcw />
                로컬 초안 지우기
              </Button>
            </CardContent>
          </Card>

        </TabsContent>
      </Tabs>
    </div>
  );
}

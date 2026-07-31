"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  ExternalLink,
  FolderOpen,
  ImageOff,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

import { AnimaCatalogPanel } from "@/components/anima-catalog-panel";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  clearCivitaiToken,
  createCivitaiModelInstallation,
  getCivitaiProvider,
  getCivitaiLoraInstallations,
  getHuggingFaceAnimaCatalog,
  installHuggingFaceAnima,
  inspectCivitaiModel,
  modelInstallationEventsUrl,
  removeModelInstallation,
  setCivitaiToken,
} from "@/lib/api";
import type {
  CivitaiModelInspection,
  CivitaiProviderStatus,
  CivitaiVersion,
  HuggingFaceAnimaFile,
  HuggingFaceAnimaProviderResponse,
  ModelDestination,
  ModelInstallTask,
  ManagedModelInstallation,
} from "@/lib/types";
import { rememberSettingsSection } from "@/lib/studio-ux";
import { cn } from "@/lib/utils";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

interface LibraryViewProps {
  onOpenManagedRuntime: () => void;
  onOptionsChanged: () => void;
}

type CivitaiDestination = Extract<
  ModelDestination,
  "loras" | "diffusion_models" | "checkpoints"
>;

interface CivitaiInstallationPreview {
  thumbnailUrl: string | null;
  sensitive: boolean;
}

const BLUR_KEY = "anima-studio:blur-sensitive-previews:v1";

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unit]}`;
}

function formatInstalledAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function modelIsSensitive(model: CivitaiModelInspection) {
  const rating = model.contentRating?.toLocaleLowerCase() ?? "";
  return (
    model.host === "civitai.red" ||
    (Boolean(rating) && !["safe", "sfw", "none", "0"].includes(rating))
  );
}

function compatibleFiles(version: CivitaiVersion | undefined) {
  return (
    version?.files.filter((file) => {
      const name = file.name.toLocaleLowerCase();
      const format = file.format?.toLocaleLowerCase() ?? "";
      return name.endsWith(".safetensors") || format.includes("safe");
    }) ?? []
  );
}

function CivitaiInstallationThumbnail({
  name,
  preview,
  blurSensitive,
}: {
  name: string;
  preview: CivitaiInstallationPreview | undefined;
  blurSensitive: boolean;
}) {
  const [failed, setFailed] = React.useState(false);
  const [revealed, setRevealed] = React.useState(false);
  const hidden = Boolean(preview?.sensitive && blurSensitive && !revealed);

  React.useEffect(() => {
    setFailed(false);
    setRevealed(false);
  }, [preview?.thumbnailUrl]);

  return (
    <div className="relative aspect-[16/9] overflow-hidden bg-secondary/50">
      {preview?.thumbnailUrl && !failed ? (
        <img
          src={preview.thumbnailUrl}
          alt={`${name} 미리보기`}
          className={cn(
            "size-full object-cover transition duration-200",
            hidden && "scale-110 blur-2xl",
          )}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="grid size-full place-items-center bg-secondary/40">
          {preview ? (
            <ImageOff className="size-6 text-muted-foreground" />
          ) : (
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          )}
        </div>
      )}
      {hidden ? (
        <button
          type="button"
          className="absolute inset-0 grid place-items-center bg-black/30 text-xs text-white"
          onClick={() => setRevealed(true)}
        >
          <span className="rounded-full bg-black/60 px-3 py-2">
            <Eye className="mr-1 inline size-4" />
            미리보기 표시
          </span>
        </button>
      ) : null}
    </div>
  );
}

export function LibraryView({
  onOpenManagedRuntime,
  onOptionsChanged,
}: LibraryViewProps) {
  const [provider, setProvider] =
    React.useState<CivitaiProviderStatus | null>(null);
  const [animaProvider, setAnimaProvider] =
    React.useState<HuggingFaceAnimaProviderResponse | null>(null);
  const [civitaiLoras, setCivitaiLoras] = React.useState<
    ManagedModelInstallation[]
  >([]);
  const [civitaiPreviews, setCivitaiPreviews] = React.useState<
    Record<string, CivitaiInstallationPreview>
  >({});
  const [modelUrl, setModelUrl] = React.useState("");
  const [token, setToken] = React.useState("");
  const [inspection, setInspection] =
    React.useState<CivitaiModelInspection | null>(null);
  const [inspectionOpen, setInspectionOpen] = React.useState(false);
  const [versionId, setVersionId] = React.useState<number | null>(null);
  const [fileId, setFileId] = React.useState<number | null>(null);
  const [destination, setDestination] =
    React.useState<CivitaiDestination>("loras");
  const [relativeDir, setRelativeDir] = React.useState("");
  const [blurSensitive, setBlurSensitive] = React.useState(true);
  const [previewRevealed, setPreviewRevealed] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [inspecting, setInspecting] = React.useState(false);
  const [savingToken, setSavingToken] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [pendingCivitaiRemoval, setPendingCivitaiRemoval] =
    React.useState<string | null>(null);
  const eventSources = React.useRef(new Set<EventSource>());
  const previewRequestId = React.useRef(0);

  const loadProviders = React.useCallback(async () => {
    setLoading(true);
    const [civitai, anima, loras] = await Promise.allSettled([
      getCivitaiProvider(),
      getHuggingFaceAnimaCatalog(),
      getCivitaiLoraInstallations(),
    ]);
    if (civitai.status === "fulfilled") setProvider(civitai.value);
    if (anima.status === "fulfilled") setAnimaProvider(anima.value);
    if (loras.status === "fulfilled") {
      const installations = loras.value;
      setCivitaiLoras(installations);
      const requestId = previewRequestId.current + 1;
      previewRequestId.current = requestId;
      const grouped = new Map<string, ManagedModelInstallation[]>();
      for (const installation of installations) {
        const key = `${installation.providerModelId}:${installation.providerVersionId}`;
        grouped.set(key, [...(grouped.get(key) ?? []), installation]);
      }
      void Promise.all(
        [...grouped.values()].map(async (matches) => {
          const installation = matches[0]!;
          try {
            const model = await inspectCivitaiModel(
              installation.sourceUrl ??
                `https://civitai.com/models/${installation.providerModelId}?modelVersionId=${installation.providerVersionId}`,
            );
            const version = model.versions.find(
              (item) => String(item.id) === installation.providerVersionId,
            );
            const preview = {
              thumbnailUrl: version?.thumbnailUrl ?? model.thumbnailUrl,
              sensitive: modelIsSensitive(model),
            };
            return matches.map((match) => [match.id, preview] as const);
          } catch {
            return matches.map(
              (match) =>
                [
                  match.id,
                  { thumbnailUrl: null, sensitive: false },
                ] as const,
            );
          }
        }),
      ).then((entries) => {
        if (previewRequestId.current !== requestId) return;
        setCivitaiPreviews(Object.fromEntries(entries.flat()));
      });
    }
    const failure =
      civitai.status === "rejected"
        ? civitai.reason
        : anima.status === "rejected"
          ? anima.reason
          : loras.status === "rejected"
            ? loras.reason
          : null;
    setError(
      failure instanceof Error
        ? failure.message
        : failure
          ? "모델 라이브러리를 불러오지 못했습니다."
          : "",
    );
    setLoading(false);
  }, []);

  React.useEffect(() => {
    const saved = window.localStorage.getItem(BLUR_KEY);
    if (saved !== null) setBlurSensitive(saved !== "false");
    void loadProviders();
  }, [loadProviders]);

  React.useEffect(() => {
    window.localStorage.setItem(BLUR_KEY, String(blurSensitive));
  }, [blurSensitive]);

  React.useEffect(
    () => () => {
      for (const source of eventSources.current) source.close();
      eventSources.current.clear();
    },
    [],
  );

  const selectedVersion = React.useMemo(
    () => inspection?.versions.find((version) => version.id === versionId),
    [inspection, versionId],
  );
  const files = React.useMemo(
    () => compatibleFiles(selectedVersion),
    [selectedVersion],
  );
  const selectedFile = files.find((file) => file.id === fileId);
  const destinationOptions = (provider?.destinations ?? []).filter(
    (option) =>
      option.kind === "loras" ||
      option.kind === "diffusion_models" ||
      option.kind === "checkpoints",
  );
  const managedDownloadReady =
    provider?.available === true &&
    provider.managedDownloads === true;
  const previewHidden =
    Boolean(inspection) &&
    modelIsSensitive(inspection!) &&
    blurSensitive &&
    !previewRevealed;

  const refreshInspection = React.useCallback(async () => {
    if (!modelUrl.trim()) return;
    const model = await inspectCivitaiModel(modelUrl.trim());
    setInspection(model);
  }, [modelUrl]);

  const watch = React.useCallback(
    (task: ModelInstallTask, target: "anima" | CivitaiDestination) => {
      const source = new EventSource(
        modelInstallationEventsUrl(task.installationId),
      );
      eventSources.current.add(source);
      source.addEventListener("installation", (event) => {
        const next = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as ModelInstallTask;
        if (next.status === "installing") {
          if (target === "anima") {
            setAnimaProvider((current) =>
              current
                ? {
                    ...current,
                    catalog: {
                      ...current.catalog,
                      files: current.catalog.files.map((file) =>
                        file.installationId === task.installationId
                          ? {
                              ...file,
                              installationProgress: next.progress,
                            }
                          : file,
                      ),
                    },
                  }
                : current,
            );
          } else {
            setInspection((current) =>
              current
                ? {
                    ...current,
                    versions: current.versions.map((version) => ({
                      ...version,
                      files: version.files.map((file) =>
                        file.installationId === task.installationId
                          ? {
                              ...file,
                              installationProgress: next.progress,
                            }
                          : file,
                      ),
                    })),
                  }
                : current,
            );
          }
          return;
        }
        source.close();
        eventSources.current.delete(source);
        if (next.status === "failed") {
          setError(next.error ?? "모델 설치에 실패했습니다.");
        } else {
          setNotice("모델을 설치했습니다.");
          if (target === "loras") setInspectionOpen(false);
          onOptionsChanged();
        }
        void loadProviders();
        if (target !== "anima") void refreshInspection();
      });
      source.onerror = () => {
        source.close();
        eventSources.current.delete(source);
        void loadProviders();
        if (target !== "anima") void refreshInspection();
      };
    },
    [loadProviders, onOptionsChanged, refreshInspection],
  );

  async function saveToken() {
    if (!token.trim()) return;
    setSavingToken(true);
    setError("");
    try {
      setProvider(await setCivitaiToken(token.trim()));
      setToken("");
      setNotice("Civitai 토큰을 저장했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "토큰 저장 실패");
    } finally {
      setSavingToken(false);
    }
  }

  async function removeToken() {
    setSavingToken(true);
    setError("");
    try {
      setProvider(await clearCivitaiToken());
      setToken("");
      setNotice("Civitai 토큰을 삭제했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "토큰 삭제 실패");
    } finally {
      setSavingToken(false);
    }
  }

  async function inspect() {
    if (!modelUrl.trim()) return;
    setInspecting(true);
    setError("");
    setNotice("");
    try {
      const model = await inspectCivitaiModel(modelUrl.trim());
      setInspection(model);
      const version =
        model.versions.find(
          (item) => item.id === model.requestedVersionId,
        ) ?? model.versions[0];
      setVersionId(version?.id ?? null);
      const versionFiles = compatibleFiles(version);
      setFileId(
        (versionFiles.find((file) => file.primary) ?? versionFiles[0])
          ?.id ?? null,
      );
      const option = destinationOptions.find((item) =>
        model.type.toLowerCase().includes("lora")
          ? item.kind === "loras"
          : item.kind === "diffusion_models" ||
            item.kind === "checkpoints",
      );
      setDestination(
        (option?.id as CivitaiDestination | undefined) ??
          (model.type.toLowerCase().includes("lora")
            ? "loras"
            : "diffusion_models"),
      );
      setPreviewRevealed(false);
      setInspectionOpen(true);
    } catch (cause) {
      setInspection(null);
      setInspectionOpen(false);
      setError(
        cause instanceof Error ? cause.message : "모델 확인에 실패했습니다.",
      );
    } finally {
      setInspecting(false);
    }
  }

  function chooseVersion(id: number) {
    setVersionId(id);
    const version = inspection?.versions.find((item) => item.id === id);
    const versionFiles = compatibleFiles(version);
    setFileId(
      (versionFiles.find((file) => file.primary) ?? versionFiles[0])?.id ??
        null,
    );
    setPreviewRevealed(false);
  }

  function markCivitaiInstalling(task: ModelInstallTask) {
    setInspection((current) =>
      current
        ? {
            ...current,
            versions: current.versions.map((version) => ({
              ...version,
              files: version.files.map((file) =>
                version.id === versionId && file.id === fileId
                  ? {
                      ...file,
                      installationId: task.installationId,
                      installationStatus: "installing",
                      installationProgress: task.progress,
                    }
                  : file,
              ),
            })),
          }
        : current,
    );
  }

  async function installCivitai() {
    if (!inspection || !selectedVersion || !selectedFile) return;
    setError("");
    try {
      const task = await createCivitaiModelInstallation({
        modelId: inspection.modelId,
        modelVersionId: selectedVersion.id,
        fileId: selectedFile.id,
        sourceUrl: inspection.sourceUrl,
        destinationRootId: destination,
        relativeDir: relativeDir.trim(),
      });
      markCivitaiInstalling(task);
      watch(task, destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "설치 시작 실패");
    }
  }

  async function installAnima(file: HuggingFaceAnimaFile) {
    if (!animaProvider) return;
    setError("");
    try {
      const task = await installHuggingFaceAnima({
        revision: animaProvider.catalog.revision,
        path: file.path,
        includeDependencies: true,
        acceptedLicense: true,
      });
      setAnimaProvider((current) =>
        current
          ? {
              ...current,
              catalog: {
                ...current.catalog,
                files: current.catalog.files.map((item) =>
                  item.path === file.path
                    ? {
                        ...item,
                        installationId: task.installationId,
                        installationStatus: "installing",
                        installationProgress: task.progress,
                      }
                    : item,
                ),
              },
            }
          : current,
      );
      watch(task, "anima");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "설치 시작 실패");
    }
  }

  async function removeInstallation(
    installationId: string,
    target: "anima" | "civitai",
  ) {
    setError("");
    try {
      await removeModelInstallation(installationId);
      setNotice("모델을 제거했습니다.");
      await loadProviders();
      if (target === "civitai") await refreshInspection();
      onOptionsChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "모델 제거 실패");
    }
  }

  return (
    <div className="animate-fade-in space-y-5">
      {error ? (
        <div
          role="alert"
          className="flex gap-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] p-4 text-xs text-red-100"
        >
          <AlertTriangle className="size-4 shrink-0 text-red-300" />
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="flex gap-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.05] p-4 text-xs text-emerald-100"
        >
          <CheckCircle2 className="size-4 shrink-0 text-emerald-300" />
          {notice}
        </div>
      ) : null}

      <Tabs defaultValue="anima" className="w-full">
        <div className="flex items-center justify-between gap-3">
          <TabsList className="grid min-w-0 flex-1 grid-cols-2 sm:max-w-[420px]">
            <TabsTrigger value="anima">Anima 공식</TabsTrigger>
            <TabsTrigger value="civitai">
              Civitai
              {civitaiLoras.length ? (
                <Badge variant="secondary" className="ml-2">
                  {civitaiLoras.length}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="shrink-0"
            aria-label="새로고침"
            onClick={() => void loadProviders()}
            disabled={loading}
          >
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
        </div>

        <TabsContent value="anima">
          <AnimaCatalogPanel
            value={animaProvider}
            loading={loading}
            onInstall={installAnima}
            onRemove={(id) => removeInstallation(id, "anima")}
            onOpenManagedRuntime={() => {
              rememberSettingsSection("runtime");
              onOpenManagedRuntime();
            }}
          />
        </TabsContent>

        <TabsContent value="civitai" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>새 모델 다운로드</CardTitle>
              <p className="text-xs leading-5 text-muted-foreground">
                Civitai 모델 URL을 확인한 뒤 버전과 파일을 선택하세요.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={modelUrl}
                  onChange={(event) => setModelUrl(event.target.value)}
                  placeholder="https://civitai.com/models/..."
                  aria-label="Civitai 모델 URL"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void inspect();
                  }}
                />
                <Button
                  type="button"
                  className="sm:min-w-24"
                  onClick={() => void inspect()}
                  disabled={!modelUrl.trim() || inspecting}
                >
                  {inspecting ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Search />
                  )}
                  확인
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle>다운로드한 LoRA</CardTitle>
                <p className="text-xs leading-5 text-muted-foreground">
                  설치한 모델을 미리보고 관리할 수 있습니다.
                </p>
              </div>
              <Badge variant="secondary">{civitaiLoras.length}</Badge>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  설치된 LoRA를 불러오는 중…
                </div>
              ) : civitaiLoras.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {civitaiLoras.map((lora) => (
                    <article
                      key={lora.id}
                      className="group overflow-hidden rounded-xl border border-border/70 bg-background/30 transition-colors hover:border-border"
                    >
                      <CivitaiInstallationThumbnail
                        name={lora.modelName}
                        preview={civitaiPreviews[lora.id]}
                        blurSensitive={blurSensitive}
                      />
                      <div className="p-2.5">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate text-sm font-medium" title={lora.modelName}>
                              {lora.modelName}
                            </h3>
                            <p className="mt-1 truncate text-[11px] text-muted-foreground">
                              {lora.versionName}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="-mr-2 -mt-2 size-8 shrink-0 hover:text-red-300"
                            aria-label={`${lora.modelName} 제거`}
                            onClick={() => setPendingCivitaiRemoval(lora.id)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        <div className="mt-2.5 space-y-2 border-t border-border/60 pt-2 text-[10px] text-muted-foreground/80">
                          <div className="flex items-center gap-1.5">
                            <FolderOpen className="size-3 shrink-0" />
                            <span className="min-w-0 flex-1 truncate" title={lora.filename}>
                              {lora.relativeDir
                                ? `loras/${lora.relativeDir}`
                                : "loras"}
                            </span>
                            <span className="hidden shrink-0 lg:inline">
                              {formatInstalledAt(lora.installedAt)}
                            </span>
                          </div>
                          {lora.sourceUrl ? (
                            <a
                              href={lora.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 text-pink-300 transition-colors hover:text-pink-200"
                              aria-label={`${lora.modelName} Civitai 원본 페이지 열기`}
                            >
                              <ExternalLink className="size-3 shrink-0" />
                              <span className="truncate">Civitai 원본 페이지</span>
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
                  Civitai에서 다운로드한 LoRA가 없습니다.
                </p>
              )}
            </CardContent>
          </Card>

          <Card surface="inset">
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div className="flex gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-background/60">
                  <KeyRound className="size-4 text-pink-300" />
                </div>
                <div className="space-y-1.5">
                  <CardTitle>Civitai 연결 설정</CardTitle>
                  <p className="text-xs leading-5 text-muted-foreground">
                    제한된 모델과 미리보기에 접근할 API 토큰을 관리합니다.
                  </p>
                </div>
              </div>
              <Badge variant={provider?.tokenConfigured ? "success" : "outline"}>
                {provider?.tokenConfigured ? "연결됨" : "미설정"}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  type="password"
                  autoComplete="off"
                  placeholder="Civitai API token"
                  aria-label="Civitai API token"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void saveToken()}
                  disabled={!token.trim() || savingToken}
                >
                  {savingToken ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <KeyRound />
                  )}
                  저장
                </Button>
                {provider?.tokenConfigured ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void removeToken()}
                    disabled={savingToken}
                  >
                    <Trash2 />
                    삭제
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={inspectionOpen} onOpenChange={setInspectionOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-3xl gap-0 overflow-y-auto p-0">
          <DialogHeader className="border-b border-border/70 px-5 py-4 pr-14">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{inspection?.name ?? "Civitai 모델 확인"}</DialogTitle>
              {inspection ? (
                <Badge variant="secondary">{inspection.type}</Badge>
              ) : null}
            </div>
          </DialogHeader>

          {inspection ? (
            <div className="space-y-4 p-5">
              <div className="grid gap-5 sm:grid-cols-[200px_minmax(0,1fr)]">
                <div className="relative aspect-[4/5] overflow-hidden rounded-lg border border-border bg-secondary/40">
                  {selectedVersion?.thumbnailUrl ?? inspection.thumbnailUrl ? (
                    <div
                      role="img"
                      aria-label={`${inspection.name} 미리보기`}
                      className={cn(
                        "size-full bg-cover bg-center",
                        previewHidden && "scale-110 blur-2xl",
                      )}
                      style={{
                        backgroundImage: `url("${(
                          selectedVersion?.thumbnailUrl ??
                          inspection.thumbnailUrl ??
                          ""
                        ).replaceAll('"', "%22")}")`,
                      }}
                    />
                  ) : (
                    <div className="grid size-full place-items-center">
                      <ImageOff className="size-7 text-muted-foreground" />
                    </div>
                  )}
                  {previewHidden ? (
                    <button
                      type="button"
                      className="absolute inset-0 grid place-items-center bg-black/35 text-xs text-white"
                      onClick={() => setPreviewRevealed(true)}
                    >
                      <span className="rounded-full bg-black/55 px-3 py-2">
                        <Eye className="mr-1 inline size-4" />
                        미리보기 표시
                      </span>
                    </button>
                  ) : null}
                </div>

                <div className="space-y-4">
                  {modelIsSensitive(inspection) ? (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setBlurSensitive((current) => !current);
                          setPreviewRevealed(false);
                        }}
                      >
                        미리보기 보호 {blurSensitive ? "켜짐" : "꺼짐"}
                      </Button>
                    </div>
                  ) : null}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="버전" htmlFor="library-model-version">
                      <select
                        id="library-model-version"
                        value={versionId ?? ""}
                        onChange={(event) => chooseVersion(Number(event.target.value))}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {inspection.versions.map((version) => (
                          <option key={version.id} value={version.id}>
                            {version.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="파일" htmlFor="library-model-file">
                      <select
                        id="library-model-file"
                        value={fileId ?? ""}
                        onChange={(event) => setFileId(Number(event.target.value))}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {files.map((file) => (
                          <option key={file.id} value={file.id}>
                            {file.name} · {formatBytes(file.sizeBytes)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="저장 위치" htmlFor="library-destination">
                      <select
                        id="library-destination"
                        value={destination}
                        onChange={(event) =>
                          setDestination(event.target.value as CivitaiDestination)
                        }
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {destinationOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="하위 폴더" htmlFor="library-relative-dir">
                      <Input
                        id="library-relative-dir"
                        value={relativeDir}
                        onChange={(event) => setRelativeDir(event.target.value)}
                      />
                    </Field>
                  </div>

                  {selectedFile ? (
                    <Button
                      type="button"
                      className="w-full"
                      variant={
                        selectedFile.installationStatus === "installed"
                          ? "destructive"
                          : "default"
                      }
                      disabled={
                        selectedFile.installationStatus === "installing" ||
                        (selectedFile.installationStatus !== "installed" &&
                          !managedDownloadReady)
                      }
                      onClick={() => {
                        if (
                          selectedFile.installationStatus === "installed" &&
                          selectedFile.installationId
                        ) {
                          setPendingCivitaiRemoval(selectedFile.installationId);
                        } else {
                          void installCivitai();
                        }
                      }}
                    >
                      {selectedFile.installationStatus === "installing" ? (
                        <LoaderCircle className="animate-spin" />
                      ) : selectedFile.installationStatus === "installed" ? (
                        <Trash2 />
                      ) : (
                        <Download />
                      )}
                      {selectedFile.installationStatus === "installing"
                        ? `설치 중 ${Math.round(selectedFile.installationProgress ?? 0)}%`
                        : selectedFile.installationStatus === "installed"
                          ? "제거"
                          : "설치"}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingCivitaiRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCivitaiRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>모델을 제거할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              설치된 파일의 SHA-256이 일치할 때만 안전하게 제거합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = pendingCivitaiRemoval;
                setPendingCivitaiRemoval(null);
                if (id) void removeInstallation(id, "civitai");
              }}
            >
              제거
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  ImageOff,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldAlert,
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
  clearCivitaiToken,
  createCivitaiModelInstallation,
  getCivitaiProvider,
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
} from "@/lib/types";
import { rememberSettingsSection } from "@/lib/studio-ux";
import { cn } from "@/lib/utils";

interface LibraryViewProps {
  onOpenManagedRuntime: () => void;
}

type CivitaiDestination = Extract<
  ModelDestination,
  "loras" | "diffusion_models" | "checkpoints"
>;

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

export function LibraryView({
  onOpenManagedRuntime,
}: LibraryViewProps) {
  const [provider, setProvider] =
    React.useState<CivitaiProviderStatus | null>(null);
  const [animaProvider, setAnimaProvider] =
    React.useState<HuggingFaceAnimaProviderResponse | null>(null);
  const [modelUrl, setModelUrl] = React.useState("");
  const [token, setToken] = React.useState("");
  const [inspection, setInspection] =
    React.useState<CivitaiModelInspection | null>(null);
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

  const loadProviders = React.useCallback(async () => {
    setLoading(true);
    const [civitai, anima] = await Promise.allSettled([
      getCivitaiProvider(),
      getHuggingFaceAnimaCatalog(),
    ]);
    if (civitai.status === "fulfilled") setProvider(civitai.value);
    if (anima.status === "fulfilled") setAnimaProvider(anima.value);
    const failure =
      civitai.status === "rejected"
        ? civitai.reason
        : anima.status === "rejected"
          ? anima.reason
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
    provider.managedDownloads === true &&
    provider.restartRequired !== true;
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
    (task: ModelInstallTask, target: "anima" | "civitai") => {
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
        }
        void loadProviders();
        if (target === "civitai") void refreshInspection();
      });
      source.onerror = () => {
        source.close();
        eventSources.current.delete(source);
        void loadProviders();
        if (target === "civitai") void refreshInspection();
      };
    },
    [loadProviders, refreshInspection],
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
    } catch (cause) {
      setInspection(null);
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
      watch(task, "civitai");
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "모델 제거 실패");
    }
  }

  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          모델 라이브러리
        </h1>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="새로고침"
          onClick={() => void loadProviders()}
          disabled={loading}
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
      </div>

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

      <Card>
        <CardHeader>
          <CardTitle>Civitai</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              type="password"
              autoComplete="off"
              placeholder="Civitai API token"
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
                토큰 삭제
              </Button>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={modelUrl}
              onChange={(event) => setModelUrl(event.target.value)}
              placeholder="https://civitai.com/models/..."
              onKeyDown={(event) => {
                if (event.key === "Enter") void inspect();
              }}
            />
            <Button
              type="button"
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

          {inspection?.host === "civitai.red" ? (
            <div className="flex gap-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-4 text-xs text-amber-100">
              <ShieldAlert className="size-4 shrink-0" />
              제한 없는 콘텐츠가 포함될 수 있습니다.
            </div>
          ) : null}

          {inspection ? (
            <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
              <div className="relative aspect-[4/5] overflow-hidden rounded-lg border border-border bg-secondary/40">
                {selectedVersion?.thumbnailUrl ??
                inspection.thumbnailUrl ? (
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
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{inspection.name}</h2>
                  <Badge variant="secondary">{inspection.type}</Badge>
                  {modelIsSensitive(inspection) ? (
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
                  ) : null}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="버전" htmlFor="library-model-version">
                    <select
                      id="library-model-version"
                      value={versionId ?? ""}
                      onChange={(event) =>
                        chooseVersion(Number(event.target.value))
                      }
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
                      onChange={(event) =>
                        setFileId(Number(event.target.value))
                      }
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
                        setDestination(
                          event.target.value as CivitaiDestination,
                        )
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
                      placeholder="characters/anima"
                    />
                  </Field>
                </div>

                {selectedFile ? (
                  <Button
                    type="button"
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
                        setPendingCivitaiRemoval(
                          selectedFile.installationId,
                        );
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
                      ? `설치 중 ${Math.round(
                          selectedFile.installationProgress ?? 0,
                        )}%`
                      : selectedFile.installationStatus === "installed"
                        ? "제거"
                        : "설치"}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

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

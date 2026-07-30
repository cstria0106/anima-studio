"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FolderDown,
  ImageOff,
  KeyRound,
  LibraryBig,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ServerCog,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AnimaCatalogPanel } from "@/components/anima-catalog-panel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, SectionHeading } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  clearCivitaiToken,
  controlModelDownload,
  createModelDownload,
  getCivitaiProvider,
  getHuggingFaceAnimaCatalog,
  getModelDownloads,
  installHuggingFaceAnima,
  inspectCivitaiModel,
  modelDownloadEventsUrl,
  setCivitaiToken,
} from "@/lib/api";
import {
  hasNewlySettledAnimaDownload,
  shouldShowSeparateCivitaiRemedy,
} from "@/lib/anima-library";
import type {
  CivitaiModelInspection,
  CivitaiProviderStatus,
  CivitaiVersion,
  HuggingFaceAnimaFile,
  HuggingFaceAnimaProviderResponse,
  ModelDestination,
  ModelDownload,
  ModelDownloadState,
} from "@/lib/types";
import { rememberSettingsSection } from "@/lib/studio-ux";
import { cn } from "@/lib/utils";

interface LibraryViewProps {
  onAddLora: (download: ModelDownload) => void;
  onOpenManagedRuntime: () => void;
}

type CivitaiDestination = Extract<
  ModelDestination,
  "loras" | "diffusion_models" | "checkpoints"
>;

const BLUR_KEY = "anima-studio:blur-sensitive-previews:v1";

const downloadLabels: Record<ModelDownloadState, string> = {
  resolving: "정보 확인",
  queued: "대기 중",
  downloading: "다운로드",
  paused: "일시정지",
  verifying: "해시 검증",
  indexing: "목록 갱신",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
};

const activeStates = new Set<ModelDownloadState>([
  "resolving",
  "queued",
  "downloading",
  "verifying",
  "indexing",
]);

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unit - 1]}`;
}

function stripMarkup(value: string | null) {
  if (!value) return "";
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function modelIsSensitive(model: CivitaiModelInspection) {
  const rating = model.contentRating?.toLocaleLowerCase() ?? "";
  return (
    model.host === "civitai.red" ||
    (Boolean(rating) && !["safe", "sfw", "none", "0"].includes(rating))
  );
}

function compatibleFiles(version: CivitaiVersion | undefined) {
  if (!version) return [];
  return version.files.filter((file) => {
    const name = file.name.toLocaleLowerCase();
    const format = file.format?.toLocaleLowerCase() ?? "";
    return name.endsWith(".safetensors") || format.includes("safe");
  });
}

function downloadProgress(download: ModelDownload) {
  if (download.state === "completed") return 100;
  if (!download.bytesTotal || download.bytesTotal <= 0) return null;
  return Math.min(
    100,
    Math.max(0, (download.bytesCompleted / download.bytesTotal) * 100),
  );
}

function statusVariant(
  state: ModelDownloadState,
): "success" | "warning" | "destructive" | "secondary" {
  if (state === "completed") return "success";
  if (state === "failed") return "destructive";
  if (activeStates.has(state)) return "warning";
  return "secondary";
}

function previewFromDownload(download: ModelDownload) {
  const value =
    download.metadata.thumbnailUrl ??
    download.metadata.previewUrl ??
    download.metadata.imageUrl;
  return typeof value === "string" ? value : null;
}

export function LibraryView({
  onAddLora,
  onOpenManagedRuntime,
}: LibraryViewProps) {
  const [provider, setProvider] =
    React.useState<CivitaiProviderStatus | null>(null);
  const [animaProvider, setAnimaProvider] =
    React.useState<HuggingFaceAnimaProviderResponse | null>(null);
  const [downloads, setDownloads] = React.useState<ModelDownload[]>([]);
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
  const [creatingDownload, setCreatingDownload] = React.useState(false);
  const [installingAnimaPath, setInstallingAnimaPath] =
    React.useState("");
  const [pendingDownloadId, setPendingDownloadId] = React.useState("");
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const downloadsRef = React.useRef<ModelDownload[]>([]);

  React.useEffect(() => {
    downloadsRef.current = downloads;
  }, [downloads]);

  const loadDownloads = React.useCallback(async (silent = false) => {
    try {
      const result = await getModelDownloads();
      const refreshAnima = hasNewlySettledAnimaDownload(
        downloadsRef.current,
        result.downloads,
      );
      downloadsRef.current = result.downloads;
      setDownloads(result.downloads);
      if (refreshAnima) {
        try {
          setAnimaProvider(await getHuggingFaceAnimaCatalog());
        } catch {
          // The completed download row remains authoritative. A later manual
          // refresh can retry provider metadata without hiding installed state.
        }
      }
      if (!silent) setError("");
    } catch (cause) {
      if (!silent) {
        setError(
          cause instanceof Error
            ? cause.message
            : "다운로드 목록을 불러오지 못했습니다.",
        );
      }
    }
  }, []);

  const loadLibrary = React.useCallback(async () => {
    setLoading(true);
    const [providerResult, animaResult, downloadsResult] =
      await Promise.allSettled([
        getCivitaiProvider(),
        getHuggingFaceAnimaCatalog(),
        getModelDownloads(),
      ]);
    if (providerResult.status === "fulfilled") {
      setProvider(providerResult.value);
    }
    if (downloadsResult.status === "fulfilled") {
      setDownloads(downloadsResult.value.downloads);
    }
    if (animaResult.status === "fulfilled") {
      setAnimaProvider(animaResult.value);
    }
    const failure =
      providerResult.status === "rejected"
        ? providerResult.reason
        : animaResult.status === "rejected"
          ? animaResult.reason
          : downloadsResult.status === "rejected"
            ? downloadsResult.reason
            : null;
    setError(
      failure
        ? failure instanceof Error
          ? failure.message
          : "모델 라이브러리를 불러오지 못했습니다."
        : "",
    );
    setLoading(false);
  }, []);

  React.useEffect(() => {
    const saved = window.localStorage.getItem(BLUR_KEY);
    if (saved !== null) setBlurSensitive(saved !== "false");
    void loadLibrary();
  }, [loadLibrary]);

  React.useEffect(() => {
    window.localStorage.setItem(BLUR_KEY, String(blurSensitive));
  }, [blurSensitive]);

  const activeDownloadIds = React.useMemo(
    () =>
      downloads
        .filter((download) => activeStates.has(download.state))
        .map((download) => download.id),
    [downloads],
  );
  const activeDownloadKey = activeDownloadIds.join(",");

  React.useEffect(() => {
    const ids = activeDownloadKey ? activeDownloadKey.split(",") : [];
    if (!ids.length) return;
    const timer = window.setInterval(() => {
      void loadDownloads(true);
    }, 2500);
    const sources = ids.map((id) => {
      const source = new EventSource(modelDownloadEventsUrl(id));
      source.onmessage = () => void loadDownloads(true);
      source.addEventListener(
        "download",
        (() => void loadDownloads(true)) as EventListener,
      );
      return source;
    });
    return () => {
      window.clearInterval(timer);
      sources.forEach((source) => source.close());
    };
  }, [activeDownloadKey, loadDownloads]);

  const selectedVersion = React.useMemo(
    () => inspection?.versions.find((version) => version.id === versionId),
    [inspection, versionId],
  );
  const files = React.useMemo(
    () => compatibleFiles(selectedVersion),
    [selectedVersion],
  );
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
  const selectedFile = files.find((file) => file.id === fileId);

  async function saveToken() {
    if (!token.trim()) return;
    setSavingToken(true);
    setError("");
    try {
      const next = await setCivitaiToken(token.trim());
      setProvider(next);
      setToken("");
      setNotice("Civitai 토큰을 암호화해 저장했습니다.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "토큰을 저장하지 못했습니다.",
      );
    } finally {
      setSavingToken(false);
    }
  }

  async function removeToken() {
    setSavingToken(true);
    setError("");
    try {
      const next = await clearCivitaiToken();
      setProvider(next);
      setToken("");
      setNotice("저장된 Civitai 토큰을 삭제했습니다.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "토큰을 삭제하지 못했습니다.",
      );
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
      const initialVersion =
        model.versions.find(
          (version) => version.id === model.requestedVersionId,
        ) ?? model.versions[0];
      setVersionId(initialVersion?.id ?? null);
      const initialFiles = compatibleFiles(initialVersion);
      const initialFile =
        initialFiles.find((file) => file.primary) ?? initialFiles[0];
      setFileId(initialFile?.id ?? null);
      const compatibleDestination = destinationOptions.find((option) =>
        model.type.toLocaleLowerCase().includes("lora")
          ? option.kind === "loras"
          : option.kind === "diffusion_models" ||
            option.kind === "checkpoints",
      );
      setDestination(
        (compatibleDestination?.id as CivitaiDestination | undefined) ??
          (model.type.toLocaleLowerCase().includes("lora")
            ? "loras"
            : "diffusion_models"),
      );
      setPreviewRevealed(false);
    } catch (cause) {
      setInspection(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Civitai 모델 정보를 확인하지 못했습니다.",
      );
    } finally {
      setInspecting(false);
    }
  }

  function chooseVersion(id: number) {
    setVersionId(id);
    const version = inspection?.versions.find((item) => item.id === id);
    const nextFiles = compatibleFiles(version);
    setFileId(
      (nextFiles.find((file) => file.primary) ?? nextFiles[0])?.id ?? null,
    );
  }

  async function startDownload() {
    if (!inspection || !selectedVersion || !selectedFile) return;
    setCreatingDownload(true);
    setError("");
    setNotice("");
    try {
      const download = await createModelDownload({
        modelId: inspection.modelId,
        modelVersionId: selectedVersion.id,
        fileId: selectedFile.id,
        sourceUrl: inspection.sourceUrl,
        destinationRootId: destination,
        relativeDir: relativeDir.trim(),
      });
      setDownloads((current) => [
        download,
        ...current.filter((item) => item.id !== download.id),
      ]);
      setNotice(`${download.filename} 다운로드를 대기열에 추가했습니다.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "모델 다운로드를 시작하지 못했습니다.",
      );
    } finally {
      setCreatingDownload(false);
    }
  }

  async function installAnima(file: HuggingFaceAnimaFile) {
    if (!animaProvider) return;
    setInstallingAnimaPath(file.path);
    setError("");
    setNotice("");
    try {
      const result = await installHuggingFaceAnima({
        revision: animaProvider.catalog.revision,
        path: file.path,
        includeDependencies: true,
        acceptedLicense: true,
      });
      setDownloads((current) => {
        const changed = new Map(
          result.downloads.map((download) => [download.id, download]),
        );
        return [
          ...result.downloads,
          ...current.filter((download) => !changed.has(download.id)),
        ];
      });
      const reused = result.alreadyInstalled.length;
      setNotice(
        reused
          ? `${file.filename} 설치를 준비했습니다. 공용 파일 ${reused}개는 이미 설치되어 있습니다.`
          : `${file.filename}과 공용 파일을 다운로드 대기열에 추가했습니다.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Anima 공식 모델 설치를 시작하지 못했습니다.",
      );
    } finally {
      setInstallingAnimaPath("");
    }
  }

  async function control(
    download: ModelDownload,
    action: "pause" | "resume" | "cancel" | "retry",
  ) {
    setPendingDownloadId(download.id);
    setError("");
    try {
      const next = await controlModelDownload(download.id, action);
      setDownloads((current) =>
        current.map((item) => (item.id === next.id ? next : item)),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "다운로드 상태를 변경하지 못했습니다.",
      );
    } finally {
      setPendingDownloadId("");
    }
  }

  const previewHidden =
    Boolean(inspection) &&
    modelIsSensitive(inspection!) &&
    blurSensitive &&
    !previewRevealed;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            모델 관리
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            모델 라이브러리
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Anima 공식 모델과 Civitai 리소스를 검증해 관리형 ComfyUI 모델
            폴더에 설치합니다.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void loadLibrary()}
          disabled={loading}
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
          새로고침
        </Button>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex gap-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] p-4 text-xs text-red-100"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-300" />
          <p className="leading-5">{error}</p>
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="flex gap-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.05] p-4 text-xs text-emerald-100"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
          <p className="leading-5">{notice}</p>
        </div>
      ) : null}

      <AnimaCatalogPanel
        value={animaProvider}
        downloads={downloads}
        loading={loading}
        installingPath={installingAnimaPath}
        onInstall={installAnima}
        onOpenManagedRuntime={() => {
          rememberSettingsSection("runtime");
          onOpenManagedRuntime();
        }}
      />

      {shouldShowSeparateCivitaiRemedy(
        provider?.managedDownloads,
        animaProvider?.provider.managedDownloads,
      ) ? (
        <div
          role="note"
          className="flex flex-col justify-between gap-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4 sm:flex-row sm:items-center"
        >
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-amber-400/15 bg-amber-400/[0.06] text-amber-200">
              <ServerCog className="size-5" />
            </span>
            <div>
              <p className="text-sm font-medium text-amber-100">
                Civitai 다운로드를 사용할 수 없습니다.
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-100/70">
                {provider?.reason ??
                  "관리형 런타임과 LoRA Manager 상태를 확인한 뒤 다시 시도하세요."}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 shrink-0"
            onClick={() => {
              rememberSettingsSection("runtime");
              onOpenManagedRuntime();
            }}
          >
            관리형 런타임 설정
            <ArrowRight />
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <SectionHeading
              title="Civitai 연결"
              description="토큰은 서버에 write-only로 전달되며 화면이나 로그에서 다시 표시되지 않습니다."
            />
            <Badge
              variant={
                provider?.available
                  ? provider.tokenConfigured
                    ? "success"
                    : "warning"
                  : "secondary"
              }
            >
              <KeyRound className="size-3" />
              {provider?.tokenConfigured
                ? "토큰 설정됨"
                : provider?.available
                  ? "공개 모델만"
                  : "연결 확인 필요"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Civitai API token"
              autoComplete="off"
              className="font-mono"
            />
            <Button
              type="button"
              onClick={() => void saveToken()}
              disabled={!token.trim() || savingToken}
            >
              {savingToken ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <KeyRound />
              )}
              토큰 저장
            </Button>
            {provider?.tokenConfigured ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void removeToken()}
                disabled={savingToken}
              >
                <Trash2 />
                삭제
              </Button>
            ) : null}
          </div>
          {provider?.reason ? (
            <p className="text-xs text-amber-200/75">{provider.reason}</p>
          ) : null}
          {provider?.restartRequired ? (
            <p className="text-xs text-amber-200/75">
              변경한 토큰을 관리형 LoRA Manager에 적용하려면 ComfyUI를
              재시작하세요.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <SectionHeading
              eyebrow="URL import"
              title="모델 URL 확인"
              description="civitai.com 또는 civitai.red의 /models/{id} 주소를 붙여넣으세요."
            />
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={modelUrl}
                onChange={(event) => setModelUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void inspect();
                }}
                placeholder="https://civitai.com/models/..."
                className="font-mono text-xs"
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
                모델 확인
              </Button>
            </div>

            {modelUrl.toLocaleLowerCase().includes("civitai.red") ||
            inspection?.host === "civitai.red" ? (
              <div className="flex items-start gap-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-4">
                <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-300" />
                <div>
                  <p className="text-sm font-medium text-amber-100">
                    civitai.red에는 제한 없는 콘텐츠가 포함될 수 있습니다.
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-100/65">
                    민감한 미리보기 가림이 기본으로 켜져 있습니다. 파일의 이용
                    조건과 콘텐츠를 다운로드 전에 직접 확인하세요.
                  </p>
                </div>
              </div>
            ) : null}

            {inspection ? (
              <div className="space-y-5">
                <div className="grid gap-4 rounded-xl border border-border/70 bg-background/30 p-4 md:grid-cols-[180px_minmax(0,1fr)]">
                  <div className="relative aspect-[4/5] overflow-hidden rounded-lg border border-border/70 bg-secondary/40">
                    {inspection.thumbnailUrl ? (
                      <div
                        role="img"
                        aria-label={`${inspection.name} 미리보기`}
                        className={cn(
                          "size-full bg-cover bg-center transition duration-300",
                          previewHidden && "scale-110 blur-2xl",
                        )}
                        style={{
                          backgroundImage: `url("${inspection.thumbnailUrl.replaceAll('"', "%22")}")`,
                        }}
                      />
                    ) : (
                      <div className="grid size-full place-items-center text-muted-foreground">
                        <ImageOff className="size-7" />
                      </div>
                    )}
                    {previewHidden ? (
                      <button
                        type="button"
                        className="absolute inset-0 grid place-items-center bg-black/35 text-xs font-medium text-white backdrop-blur-sm"
                        onClick={() => setPreviewRevealed(true)}
                      >
                        <span className="rounded-full border border-white/25 bg-black/40 px-3 py-1.5">
                          <Eye className="mr-1.5 inline size-3.5" />
                          미리보기 표시
                        </span>
                      </button>
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">{inspection.name}</h2>
                      <Badge variant="secondary">{inspection.type}</Badge>
                      <Badge variant="outline">{inspection.host}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {inspection.creator
                        ? `by ${inspection.creator}`
                        : `Model #${inspection.modelId}`}
                    </p>
                    <p className="mt-4 line-clamp-4 text-xs leading-5 text-muted-foreground">
                      {stripMarkup(inspection.description) ||
                        "모델 설명이 제공되지 않았습니다."}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs">
                      {inspection.contentRating ? (
                        <span className="rounded-full bg-secondary px-2.5 py-1 text-muted-foreground">
                          {inspection.contentRating}
                        </span>
                      ) : null}
                      {inspection.license ? (
                        <span className="rounded-full bg-secondary px-2.5 py-1 text-muted-foreground">
                          라이선스 정보 있음
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="모델 버전" htmlFor="library-model-version">
                    <select
                      id="library-model-version"
                      value={versionId ?? ""}
                      onChange={(event) => chooseVersion(Number(event.target.value))}
                      className="h-10 w-full rounded-md border border-input bg-background/55 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      {inspection.versions.map((version) => (
                        <option key={version.id} value={version.id}>
                          {version.name}
                          {version.baseModel ? ` · ${version.baseModel}` : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="파일"
                    htmlFor="library-model-file"
                    errorId="library-model-file-error"
                    error={
                      selectedVersion && !files.length
                        ? "지원되는 .safetensors 파일이 없습니다."
                        : undefined
                    }
                  >
                    <select
                      id="library-model-file"
                      aria-describedby={
                        selectedVersion && !files.length
                          ? "library-model-file-error"
                          : undefined
                      }
                      value={fileId ?? ""}
                      onChange={(event) => setFileId(Number(event.target.value))}
                      className="h-10 w-full rounded-md border border-input bg-background/55 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                      disabled={!files.length}
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
                      className="h-10 w-full rounded-md border border-input bg-background/55 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      {destinationOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="하위 폴더"
                    hint="선택 사항"
                    htmlFor="library-relative-dir"
                  >
                    <Input
                      id="library-relative-dir"
                      value={relativeDir}
                      onChange={(event) => setRelativeDir(event.target.value)}
                      placeholder="characters/anima"
                    />
                  </Field>
                </div>

                {selectedVersion ? (
                  <div className="flex flex-col justify-between gap-4 rounded-lg border border-border/65 bg-background/25 p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                      <p className="text-xs font-medium">
                        {selectedFile?.name ?? "파일을 선택하세요"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedVersion.earlyAccessEndsAt
                          ? `Early access 종료: ${new Date(selectedVersion.earlyAccessEndsAt).toLocaleString("ko-KR")}`
                          : selectedVersion.trainedWords.length
                            ? `Trigger: ${selectedVersion.trainedWords.slice(0, 5).join(", ")}`
                            : "다운로드 후 SHA-256 검증과 모델 목록 갱신을 수행합니다."}
                      </p>
                    </div>
                    <Button
                      type="button"
                      className="shrink-0"
                      onClick={() => void startDownload()}
                      disabled={
                        !selectedFile ||
                        !managedDownloadReady ||
                        !destinationOptions.some(
                          (option) => option.id === destination,
                        ) ||
                        creatingDownload
                      }
                    >
                      {creatingDownload ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Download />
                      )}
                      다운로드
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-background/20 p-8 text-center">
                <div>
                  <LibraryBig className="mx-auto size-8 text-muted-foreground/45" />
                  <p className="mt-3 text-sm font-medium">모델 URL을 확인하세요.</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    버전, 파일 크기, 기반 모델과 trigger words를 다운로드 전에
                    보여드립니다.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>미리보기 보호</CardTitle>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  민감한 모델 이미지를 기본으로 가립니다.
                </p>
              </div>
              <Switch
                checked={blurSensitive}
                onCheckedChange={setBlurSensitive}
                aria-label="민감한 미리보기 가리기"
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-3 rounded-lg border border-border/65 bg-background/30 p-3">
              {blurSensitive ? (
                <EyeOff className="mt-0.5 size-4 shrink-0 text-pink-300" />
              ) : (
                <Eye className="mt-0.5 size-4 shrink-0 text-amber-300" />
              )}
              <p className="text-xs leading-5 text-muted-foreground">
                {blurSensitive
                  ? "민감하거나 civitai.red에서 가져온 이미지는 클릭하기 전까지 흐리게 표시됩니다."
                  : "민감한 미리보기가 바로 표시됩니다. 이 설정은 이 브라우저에 저장됩니다."}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <SectionHeading
              eyebrow="Download queue"
              title="다운로드"
              description="중단된 작업은 이어받을 수 있고 완료 전 파일 해시를 검증합니다."
            />
            <Badge variant="secondary">{downloads.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {downloads.length ? (
            <div className="space-y-3">
              {downloads.map((download) => {
                const progress = downloadProgress(download);
                const preview = previewFromDownload(download);
                const pending = pendingDownloadId === download.id;
                const active = activeStates.has(download.state);
                const providerReady =
                  download.provider === "huggingface"
                    ? animaProvider?.provider.managedDownloads === true
                    : managedDownloadReady;
                return (
                  <div
                    key={download.id}
                    className="grid gap-4 rounded-xl border border-border/70 bg-background/25 p-4 md:grid-cols-[56px_minmax(0,1fr)_auto]"
                  >
                    <div className="size-14 overflow-hidden rounded-lg border border-border/70 bg-secondary/40">
                      {preview ? (
                        <div
                          aria-hidden="true"
                          className={cn(
                            "size-full bg-cover bg-center",
                            blurSensitive && "blur-lg",
                          )}
                          style={{
                            backgroundImage: `url("${preview.replaceAll('"', "%22")}")`,
                          }}
                        />
                      ) : (
                        <span className="grid size-full place-items-center">
                          <FolderDown className="size-5 text-muted-foreground" />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {download.modelName}
                        </p>
                        <Badge variant={statusVariant(download.state)}>
                          {active ? (
                            <LoaderCircle className="size-3 animate-spin" />
                          ) : null}
                          {downloadLabels[download.state]}
                        </Badge>
                        <Badge variant="outline">
                          {download.provider === "huggingface"
                            ? "Hugging Face"
                            : "Civitai"}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {download.versionName} · {download.filename}
                      </p>
                      <Progress
                        value={progress}
                        className="mt-3"
                        aria-label={`${download.filename} 다운로드 진행률`}
                      />
                      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          {formatBytes(download.bytesCompleted)}
                          {download.bytesTotal
                            ? ` / ${formatBytes(download.bytesTotal)}`
                            : ""}
                        </span>
                        <span>
                          {download.bytesPerSecond
                            ? `${formatBytes(download.bytesPerSecond)}/s`
                            : download.error ?? download.destinationRootId}
                        </span>
                      </div>
                    </div>
                    <div
                      className="flex items-center gap-1 md:justify-end"
                      role="group"
                      aria-label={`${download.filename} 다운로드 작업`}
                    >
                      {download.state === "downloading" ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => void control(download, "pause")}
                          disabled={pending}
                          aria-label={`${download.modelName} 일시정지`}
                        >
                          <Pause />
                        </Button>
                      ) : null}
                      {download.state === "paused" ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => void control(download, "resume")}
                          disabled={pending || !providerReady}
                          aria-label={`${download.modelName} 다시 시작`}
                        >
                          <Play />
                        </Button>
                      ) : null}
                      {active || download.state === "paused" ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => void control(download, "cancel")}
                          disabled={pending}
                          aria-label={`${download.modelName} 취소`}
                        >
                          <X />
                        </Button>
                      ) : null}
                      {download.state === "failed" ||
                      download.state === "cancelled" ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => void control(download, "retry")}
                          disabled={pending || !providerReady}
                          aria-label={`${download.modelName} 다시 시도`}
                        >
                          <RotateCcw />
                        </Button>
                      ) : null}
                      {download.state === "completed" &&
                      download.destinationRootId === "loras" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="soft"
                          onClick={() => onAddLora(download)}
                        >
                          <Plus />
                          현재 설정에 추가
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-border bg-background/20 p-8 text-center">
              <div>
                <FolderDown className="mx-auto size-7 text-muted-foreground/45" />
                <p className="mt-3 text-sm font-medium">
                  다운로드 작업이 없습니다.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  모델 URL을 확인한 뒤 원하는 버전과 파일을 선택하세요.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

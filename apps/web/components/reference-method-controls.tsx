"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  GraduationCap,
  LoaderCircle,
  Zap,
} from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
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
import { Button } from "@/components/ui/button";
import { CommittedNumberField } from "@/components/ui/committed-number-field";
import { Field } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { useSnapRefInstall } from "@/components/use-snapref-install";
import {
  MAX_SNAPREF_REFERENCES,
  snapRefAdapterOptions,
} from "@/lib/studio-ux";
import type { GenerationDraft, StudioOptions } from "@/lib/types";
import { cn } from "@/lib/utils";

const PREFERRED_ADAPTER = "snapref_v2a.safetensors";

const METHODS: Array<{
  value: GenerationDraft["reference"]["method"];
  label: string;
  description: string;
  icon: typeof Zap;
}> = [
  {
    value: "snapref",
    label: "SnapRef",
    description: "학습 없이 바로 참조",
    icon: Zap,
  },
  {
    value: "instant_lora",
    label: "Instant LoRA",
    description: "참조 이미지로 LoRA 학습",
    icon: GraduationCap,
  },
];

const MODES: Array<{
  value: GenerationDraft["reference"]["snapref"]["mode"];
  name: string;
}> = [
  { value: "character_style", name: "캐릭터 + 화풍" },
  { value: "character", name: "캐릭터만" },
];

function formatMegabytes(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

function adapterLabel(path: string) {
  return (path.split(/[\\/]/).at(-1) ?? path).replace(/\.safetensors$/i, "");
}

/** Picks the stable bf16 v2a file when several SnapRef weights exist. */
function preferredAdapter(adapters: Array<{ value: string }>) {
  return (
    adapters.find(
      (option) =>
        option.value.split(/[\\/]/).at(-1)?.toLowerCase() === PREFERRED_ADAPTER,
    ) ?? adapters[0]
  )?.value;
}

function SnapRefInstallCard({ onInstalled }: { onInstalled: () => void }) {
  const { value, error, install } = useSnapRefInstall(onInstalled);
  const [confirming, setConfirming] = React.useState(false);
  const adapter = value?.adapter;
  const installing = adapter?.installationStatus === "installing";

  return (
    <div
      id="snapref-adapter"
      tabIndex={-1}
      className="space-y-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.05] p-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-medium">SnapRef 가중치가 필요합니다</p>
          <p className="text-[11px] text-muted-foreground">
            snapref v2a{adapter ? ` · ${formatMegabytes(adapter.sizeBytes)}` : ""}
          </p>
        </div>
      </div>

      {installing ? (
        <div className="space-y-1.5">
          <Progress value={adapter?.installationProgress ?? null} />
          <p className="text-[11px] text-muted-foreground tabular-nums">
            설치 중 {Math.round(adapter?.installationProgress ?? 0)}%
          </p>
        </div>
      ) : value && !value.managedDownloads ? (
        <p className="text-[11px] leading-5 text-muted-foreground">
          {value.reason} 직접 연결한 ComfyUI라면{" "}
          <span className="font-mono">models/loras</span>에{" "}
          <span className="font-mono">{PREFERRED_ADAPTER}</span>를 넣어 주세요.
        </p>
      ) : (
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={!value}
          onClick={() => setConfirming(true)}
        >
          {value ? <Download /> : <LoaderCircle className="animate-spin" />}
          설치
        </Button>
      )}

      {error ? (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      ) : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>SnapRef 가중치를 설치할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              Hugging Face에서 고정된 SnapRef v2a 파일
              {adapter ? `(${formatMegabytes(adapter.sizeBytes)})` : ""}을 받아
              LoRA 폴더에 설치합니다. 계속하면{" "}
              <a
                href={adapter?.licenseUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline underline-offset-4"
              >
                라이선스
              </a>
              를 확인하고 동의한 것으로 처리됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => void install()}>
              설치
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface ReferenceMethodControlsProps {
  value: GenerationDraft;
  options: StudioOptions;
  onChange: (value: GenerationDraft) => void;
  onOptionsChanged: () => void;
}

export function ReferenceMethodControls({
  value,
  options,
  onChange,
  onOptionsChanged,
}: ReferenceMethodControlsProps) {
  const { reference } = value;
  const adapters = React.useMemo(
    () => snapRefAdapterOptions(options.loras),
    [options.loras],
  );
  const readyReferences = value.referenceAssets.filter(
    (asset) => asset.status === "ready",
  ).length;
  const patchReference = (patch: Partial<GenerationDraft["reference"]>) =>
    onChange({ ...value, reference: { ...reference, ...patch } });
  const patchSnapRef = (
    patch: Partial<GenerationDraft["reference"]["snapref"]>,
  ) => patchReference({ snapref: { ...reference.snapref, ...patch } });

  // Keep the selection on an installed adapter, e.g. right after installing
  // one or when the previously chosen file was removed.
  const selectedInstalled = adapters.some(
    (option) => option.value === reference.snapref.adapter,
  );
  const fallbackAdapter = preferredAdapter(adapters);
  React.useEffect(() => {
    if (
      reference.method === "snapref" &&
      !selectedInstalled &&
      fallbackAdapter
    ) {
      onChange({
        ...value,
        reference: {
          ...reference,
          snapref: { ...reference.snapref, adapter: fallbackAdapter },
        },
      });
    }
  }, [fallbackAdapter, onChange, reference, selectedInstalled, value]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="참조 방식">
        {METHODS.map((method) => {
          const selected = reference.method === method.value;
          const Icon = method.icon;
          return (
            <button
              key={method.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-primary/55 bg-primary/10 text-foreground"
                  : "border-border/70 bg-background/30 text-muted-foreground hover:border-primary/30 hover:text-foreground",
              )}
              onClick={() => patchReference({ method: method.value })}
            >
              <Icon className="size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-xs font-medium">{method.label}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {method.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {reference.method === "snapref" ? (
        adapters.length === 0 ? (
          <SnapRefInstallCard onInstalled={onOptionsChanged} />
        ) : (
          <div className="space-y-4 rounded-lg border border-border/70 bg-black/20 p-3">
            {adapters.length === 1 ? (
              <p className="flex items-center gap-2 text-xs font-medium">
                <CheckCircle2 className="size-4 text-emerald-300" />
                {adapterLabel(adapters[0]!.value)}
              </p>
            ) : (
              <Field label="SnapRef 가중치" htmlFor="snapref-adapter">
                <SearchableSelect
                  id="snapref-adapter"
                  value={reference.snapref.adapter}
                  options={adapters}
                  onChange={(adapter) => patchSnapRef({ adapter })}
                  placeholder="SnapRef 가중치 선택"
                />
              </Field>
            )}
            <Field label="참조 범위" htmlFor="snapref-mode">
              <SearchableSelect
                id="snapref-mode"
                value={reference.snapref.mode}
                options={MODES}
                onChange={(mode) =>
                  patchSnapRef({
                    mode: mode as GenerationDraft["reference"]["snapref"]["mode"],
                  })
                }
                placeholder="참조 범위 선택"
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <CommittedNumberField
                label="강도"
                value={reference.snapref.strength}
                onChange={(strength) => patchSnapRef({ strength })}
                min={0}
                max={2}
                step={0.05}
                hint="1 = 기본"
              />
              <CommittedNumberField
                label="Fidelity"
                value={reference.snapref.fidelity}
                onChange={(fidelity) => patchSnapRef({ fidelity })}
                min={0}
                max={1}
                step={0.05}
                hint="낮을수록 프롬프트 우선"
              />
            </div>
            {readyReferences > MAX_SNAPREF_REFERENCES ? (
              <p className="text-[11px] text-destructive">
                SnapRef는 참조 이미지를 최대 {MAX_SNAPREF_REFERENCES}장까지
                사용합니다.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                프롬프트에는 장면만 적으세요. 캐릭터 외형은 참조 이미지에서
                가져옵니다.
              </p>
            )}
          </div>
        )
      ) : null}
    </div>
  );
}

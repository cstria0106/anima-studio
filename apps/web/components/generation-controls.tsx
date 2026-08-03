"use client";

import { CURATED_IMAGE_PRESETS } from "@anima/shared";
import {
  ChevronDown,
  Dices,
  Maximize2,
  Settings2,
} from "lucide-react";
import { useState } from "react";
import { ImageSizeDialog } from "@/components/image-size-dialog";
import { SearchableSelect } from "@/components/searchable-select";
import { UpscaleSettingsFields } from "@/components/upscale-settings-fields";
import { Field } from "@/components/ui/field";
import { CommittedNumberField } from "@/components/ui/committed-number-field";
import { Switch } from "@/components/ui/switch";
import type { GenerationDraft, ModelOption, StudioOptions } from "@/lib/types";

interface GenerationControlsProps {
  value: GenerationDraft;
  options: StudioOptions;
  onChange: (value: GenerationDraft) => void;
}

function optionsFromStrings(values: string[]): ModelOption[] {
  return values.map((value) => ({ name: value, value }));
}

export function GenerationControls({
  value,
  options,
  onChange,
}: GenerationControlsProps) {
  const { sampling, upscale } = value;
  const [upscaleOpen, setUpscaleOpen] = useState(false);
  const patchSampling = (patch: Partial<GenerationDraft["sampling"]>) =>
    onChange({ ...value, sampling: { ...sampling, ...patch } });
  const patchUpscale = (patch: Partial<GenerationDraft["upscale"]>) =>
    onChange({ ...value, upscale: { ...upscale, ...patch } });
  const setUpscaleEnabled = (enabled: boolean) => {
    setUpscaleOpen(enabled);
    patchUpscale({ enabled });
  };

  const curatedKeys = new Set(
    CURATED_IMAGE_PRESETS.map(({ width, height }) => `${width}x${height}`),
  );
  const extraPresets = options.presets.filter(
    ({ width, height }, index, presets) => {
      const key = `${width}x${height}`;
      return (
        !curatedKeys.has(key) &&
        presets.findIndex(
          (preset) =>
            preset.width === width && preset.height === height,
        ) === index
      );
    },
  );
  return (
    <div className="space-y-5">
      <div>
        <ImageSizeDialog
          width={sampling.width}
          height={sampling.height}
          extraPresets={extraPresets}
          onChange={(size) => patchSampling(size)}
        />
      </div>

      <CommittedNumberField
        label={
          <span className="inline-flex items-center gap-2">
            <Dices className="size-3.5 text-pink-300" />
            시드
          </span>
        }
        hint={
          <label className="flex items-center gap-2">
            랜덤
            <Switch
              checked={sampling.seedMode === "random"}
              onCheckedChange={(random) =>
                patchSampling({ seedMode: random ? "random" : "fixed" })
              }
              aria-label="랜덤 시드"
            />
          </label>
        }
        value={sampling.seed}
        min={0}
        max={Number.MAX_SAFE_INTEGER}
        disabled={sampling.seedMode === "random"}
        onChange={(seed) => patchSampling({ seed })}
      />

      <details className="group rounded-lg border border-border/70 bg-background/30">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
          <span className="inline-flex items-center gap-2 text-xs font-medium">
            <Settings2 className="size-4 text-pink-300" />
            고급
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
        </summary>
        <div className="grid gap-4 border-t border-border/60 p-4 md:grid-cols-2 2xl:grid-cols-1">
          <Field label="샘플러" htmlFor="sampler">
            <SearchableSelect
              id="sampler"
              value={sampling.sampler}
              options={optionsFromStrings(options.samplers)}
              onChange={(sampler) => patchSampling({ sampler })}
              placeholder="샘플러 선택"
            />
          </Field>
          <Field label="스케줄러" htmlFor="scheduler">
            <SearchableSelect
              id="scheduler"
              value={sampling.scheduler}
              options={optionsFromStrings(options.schedulers)}
              onChange={(scheduler) => patchSampling({ scheduler })}
              placeholder="스케줄러 선택"
            />
          </Field>
          <CommittedNumberField
            label="Batch"
            value={sampling.batchSize}
            onChange={(batchSize) => patchSampling({ batchSize })}
            min={1}
            max={64}
          />
          <CommittedNumberField
            label="Steps"
            value={sampling.steps}
            onChange={(steps) => patchSampling({ steps })}
            min={1}
            max={10000}
          />
          <CommittedNumberField
            label="CFG"
            value={sampling.cfg}
            onChange={(cfg) => patchSampling({ cfg })}
            min={0}
            max={100}
            step={0.1}
          />
          <CommittedNumberField
            label="Denoise"
            value={sampling.denoise}
            onChange={(denoise) => patchSampling({ denoise })}
            min={0}
            max={1}
            step={0.01}
          />
          <CommittedNumberField
            label="CFG 적용 시작"
            value={sampling.cfgStart}
            onChange={(cfgStart) => patchSampling({ cfgStart })}
            min={0}
            max={1}
            step={0.01}
            hint="0–1"
          />
          <CommittedNumberField
            label="CFG 적용 종료"
            value={sampling.cfgEnd}
            onChange={(cfgEnd) => patchSampling({ cfgEnd })}
            min={0}
            max={1}
            step={0.01}
            hint="0–1"
          />
        </div>
      </details>

      <details
        open={upscale.enabled && upscaleOpen}
        onToggle={(event) =>
          setUpscaleOpen(upscale.enabled && event.currentTarget.open)
        }
        className="group rounded-lg border border-border/70 bg-background/30"
      >
        <summary
          className={`flex list-none items-center gap-3 px-4 py-3 ${
            upscale.enabled ? "cursor-pointer" : "cursor-default"
          }`}
          onClick={(event) => {
            if (!upscale.enabled) event.preventDefault();
          }}
        >
          <span className="inline-flex items-center gap-2 text-xs font-medium">
            <Maximize2 className="size-4 text-violet-300" />
            업스케일
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {upscale.enabled ? `${upscale.scale}×` : "꺼짐"}
          </span>
          <Switch
            checked={upscale.enabled}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={setUpscaleEnabled}
            aria-label="업스케일 활성화"
          />
          <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
        </summary>
        <div className="grid gap-4 border-t border-border/60 p-4 md:grid-cols-2 2xl:grid-cols-1">
          {upscale.enabled ? (
            <UpscaleSettingsFields
              value={upscale}
              methods={options.upscaleMethods}
              onChange={(nextUpscale) =>
                onChange({ ...value, upscale: nextUpscale })
              }
            />
          ) : null}
        </div>
      </details>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/30 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium">LoRA Optimizer</p>
        </div>
        <Switch
          checked={value.loraOptimizer.enabled}
          onCheckedChange={(enabled) =>
            onChange({ ...value, loraOptimizer: { enabled } })
          }
          aria-label="LoRA Optimizer 사용"
        />
      </div>
    </div>
  );
}

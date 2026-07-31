"use client";

import { CURATED_IMAGE_PRESETS } from "@anima/shared";
import {
  ChevronDown,
  Dices,
  Expand,
  RotateCw,
  Settings2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  const { sampling, instantLora, tagging, upscale } = value;
  const patchSampling = (patch: Partial<GenerationDraft["sampling"]>) =>
    onChange({ ...value, sampling: { ...sampling, ...patch } });
  const patchInstant = (patch: Partial<GenerationDraft["instantLora"]>) =>
    onChange({ ...value, instantLora: { ...instantLora, ...patch } });
  const patchTagging = (patch: Partial<GenerationDraft["tagging"]>) =>
    onChange({ ...value, tagging: { ...tagging, ...patch } });
  const patchUpscale = (patch: Partial<GenerationDraft["upscale"]>) =>
    onChange({ ...value, upscale: { ...upscale, ...patch } });

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
  const selectedExtraPreset = extraPresets.find(
    (preset) =>
      preset.width === sampling.width && preset.height === sampling.height,
  );

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Expand className="size-4 text-violet-300" />
            <p className="text-sm font-medium">이미지 크기</p>
          </div>
          <Badge variant="secondary">
            {sampling.width} × {sampling.height}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CURATED_IMAGE_PRESETS.map((preset) => {
            const selected =
              preset.width === sampling.width &&
              preset.height === sampling.height;
            return (
              <Button
                key={`${preset.width}-${preset.height}`}
                type="button"
                size="sm"
                variant={selected ? "soft" : "outline"}
                className="h-auto justify-start px-3 py-2.5 text-left"
                onClick={() =>
                  patchSampling({
                    width: preset.width,
                    height: preset.height,
                  })
                }
              >
                <span className="min-w-0">
                  <span className="block truncate">{preset.label}</span>
                  <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                    {preset.width} × {preset.height}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
        {extraPresets.length ? (
          <Field label="기타 크기" htmlFor="additional-image-size">
            <SearchableSelect
              id="additional-image-size"
              value={
                selectedExtraPreset
                  ? `${selectedExtraPreset.width}x${selectedExtraPreset.height}`
                  : ""
              }
              options={extraPresets.map((preset) => ({
                name: `${preset.label} · ${preset.width} × ${preset.height}`,
                value: `${preset.width}x${preset.height}`,
              }))}
              onChange={(size) => {
                const preset = extraPresets.find(
                  ({ width, height }) => `${width}x${height}` === size,
                );
                if (preset) {
                  patchSampling({
                    width: preset.width,
                    height: preset.height,
                  });
                }
              }}
              placeholder="ComfyUI 추가 크기"
            />
          </Field>
        ) : null}
        <div className="grid grid-cols-3 gap-3">
          <CommittedNumberField
            label="Width"
            value={sampling.width}
            onChange={(width) =>
              patchSampling({ width: Math.round(width / 8) * 8 })
            }
            min={64}
            max={8192}
            step={8}
          />
          <CommittedNumberField
            label="Height"
            value={sampling.height}
            onChange={(height) =>
              patchSampling({ height: Math.round(height / 8) * 8 })
            }
            min={64}
            max={8192}
            step={8}
          />
          <CommittedNumberField
            label="Batch"
            value={sampling.batchSize}
            onChange={(batchSize) => patchSampling({ batchSize })}
            min={1}
            max={64}
          />
        </div>
      </div>

      <div className="grid gap-4 rounded-lg border border-border/70 bg-background/35 p-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <div className="sm:col-span-2">
          <div className="mb-2 flex h-5 items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-xs font-medium">
              <Dices className="size-3.5 text-pink-300" />
              시드
            </span>
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {sampling.seedMode === "random" ? "랜덤" : "고정"}
              <Switch
                checked={sampling.seedMode === "random"}
                onCheckedChange={(random) =>
                  patchSampling({ seedMode: random ? "random" : "fixed" })
                }
                aria-label="랜덤 시드"
              />
            </label>
          </div>
          <CommittedNumberField
            label="시드 값"
            value={sampling.seed}
            min={0}
            max={Number.MAX_SAFE_INTEGER}
            disabled={sampling.seedMode === "random"}
            onChange={(seed) => patchSampling({ seed })}
          />
        </div>
      </div>

      <details className="group rounded-lg border border-border/70 bg-background/30">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
          <span className="inline-flex items-center gap-2 text-xs font-medium">
            <Settings2 className="size-4 text-pink-300" />
            Sampler · Scheduler
          </span>
          <span className="ml-auto mr-3 max-w-[45%] truncate text-[10px] text-muted-foreground">
            {sampling.sampler} · {sampling.scheduler}
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
        </summary>
        <div className="grid gap-4 border-t border-border/60 p-4 md:grid-cols-2">
          <Field label="Sampler" htmlFor="sampler">
            <SearchableSelect
              id="sampler"
              value={sampling.sampler}
              options={optionsFromStrings(options.samplers)}
              onChange={(sampler) => patchSampling({ sampler })}
              placeholder="Sampler 선택"
            />
          </Field>
          <Field label="Scheduler" htmlFor="scheduler">
            <SearchableSelect
              id="scheduler"
              value={sampling.scheduler}
              options={optionsFromStrings(options.schedulers)}
              onChange={(scheduler) => patchSampling({ scheduler })}
              placeholder="Scheduler 선택"
            />
          </Field>
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

      <details className="group rounded-lg border border-border/70 bg-background/30">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
          <span className="inline-flex items-center gap-2 text-xs font-medium">
            <Sparkles className="size-4 text-violet-300" />
            Instant Reference LoRA
          </span>
          <span className="ml-auto mr-3 text-[10px] text-muted-foreground">
            {instantLora.trainingSteps} steps · dim {instantLora.dimension}
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
        </summary>
        <div className="space-y-5 border-t border-border/60 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <CommittedNumberField
              label="Model strength"
              value={instantLora.modelStrength}
              onChange={(modelStrength) => patchInstant({ modelStrength })}
              min={-10}
              max={10}
              step={0.05}
            />
            <CommittedNumberField
              label="CLIP strength"
              value={instantLora.clipStrength}
              onChange={(clipStrength) => patchInstant({ clipStrength })}
              min={-10}
              max={10}
              step={0.05}
            />
            <CommittedNumberField
              label="Training steps"
              value={instantLora.trainingSteps}
              onChange={(trainingSteps) => patchInstant({ trainingSteps })}
              min={0}
              max={100000}
            />
            <CommittedNumberField
              label="Learning rate"
              value={instantLora.learningRate}
              onChange={(learningRate) => patchInstant({ learningRate })}
              min={0}
              max={1}
              step="any"
            />
            <CommittedNumberField
              label="Network dim"
              value={instantLora.dimension}
              onChange={(dimension) => patchInstant({ dimension })}
              min={0}
              max={1024}
            />
            <CommittedNumberField
              label="Network alpha"
              value={instantLora.alpha}
              onChange={(alpha) => patchInstant({ alpha })}
              min={0}
              max={1024}
            />
          </div>
          <div className="grid gap-3 rounded-lg border border-border/60 bg-card/40 p-3 md:grid-cols-2">
            {[
              [
                "Latent cache",
                instantLora.cache,
                (checked: boolean) => patchInstant({ cache: checked }),
              ],
              [
                "Text encoder cache",
                instantLora.cacheTextEncoderOutputs,
                (checked: boolean) =>
                  patchInstant({ cacheTextEncoderOutputs: checked }),
              ],
              [
                "Gradient checkpointing",
                instantLora.gradientCheckpointing,
                (checked: boolean) =>
                  patchInstant({ gradientCheckpointing: checked }),
              ],
              [
                "강제 재학습",
                instantLora.forceRetrain,
                (checked: boolean) =>
                  patchInstant({ forceRetrain: checked }),
              ],
            ].map(([label, checked, handler]) => (
              <div
                key={String(label)}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-xs text-muted-foreground">
                  {String(label)}
                </span>
                <Switch
                  checked={Boolean(checked)}
                  onCheckedChange={handler as (checked: boolean) => void}
                  aria-label={String(label)}
                />
              </div>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <CommittedNumberField
              label="Training seed"
              value={instantLora.seed}
              onChange={(seed) => patchInstant({ seed })}
              min={-1}
              max={2147483647}
            />
            <CommittedNumberField
              label="Training batch"
              value={instantLora.batchSize}
              onChange={(batchSize) => patchInstant({ batchSize })}
              min={0}
              max={256}
              hint="0 = 자동"
            />
            <Field
              label="학습 해상도"
              hint="빈 값 = 자동"
              htmlFor="instant-lora-resolution"
            >
              <Input
                id="instant-lora-resolution"
                value={instantLora.resolution}
                onChange={(event) =>
                  patchInstant({ resolution: event.target.value })
                }
                placeholder="예: 1024"
              />
            </Field>
          </div>
        </div>
      </details>

      <details className="group rounded-lg border border-border/70 bg-background/30">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
          <span className="inline-flex items-center gap-2 text-xs font-medium">
            <Wand2 className="size-4 text-sky-300" />
            자동 태깅
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
        </summary>
        <div className="space-y-4 border-t border-border/60 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <CommittedNumberField
              label="General threshold"
              value={tagging.threshold}
              onChange={(threshold) => patchTagging({ threshold })}
              min={0}
              max={1}
              step={0.01}
            />
            <CommittedNumberField
              label="Character threshold"
              value={tagging.characterThreshold}
              onChange={(characterThreshold) =>
                patchTagging({ characterThreshold })
              }
              min={0}
              max={1}
              step={0.01}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="앞에 붙일 태그" htmlFor="tagging-prepend">
              <Input
                id="tagging-prepend"
                value={tagging.prependTags}
                onChange={(event) =>
                  patchTagging({ prependTags: event.target.value })
                }
              />
            </Field>
            <Field label="뒤에 붙일 태그" htmlFor="tagging-append">
              <Input
                id="tagging-append"
                value={tagging.appendTags}
                onChange={(event) =>
                  patchTagging({ appendTags: event.target.value })
                }
              />
            </Field>
            <Field label="제외 태그" htmlFor="tagging-exclude">
              <Input
                id="tagging-exclude"
                value={tagging.excludeTags}
                onChange={(event) =>
                  patchTagging({ excludeTags: event.target.value })
                }
                placeholder="tag_a, tag_b"
              />
            </Field>
            <Field label="치환 규칙" htmlFor="tagging-replace">
              <Input
                id="tagging-replace"
                value={tagging.replaceTags}
                onChange={(event) =>
                  patchTagging({ replaceTags: event.target.value })
                }
                placeholder="old:new"
              />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
            <span className="text-xs text-muted-foreground">
              태그 밑줄 제거
            </span>
            <Switch
              checked={tagging.removeUnderscore}
              onCheckedChange={(removeUnderscore) =>
                patchTagging({ removeUnderscore })
              }
              aria-label="태그 밑줄 제거"
            />
          </div>
        </div>
      </details>

      <details className="group rounded-lg border border-border/70 bg-background/30">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
          <span className="inline-flex items-center gap-2 text-xs font-medium">
            <RotateCw className="size-4 text-violet-300" />
            업스케일
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {upscale.enabled ? `${upscale.scale}×` : "꺼짐"}
          </span>
          <Switch
            checked={upscale.enabled}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={(enabled) => patchUpscale({ enabled })}
            aria-label="업스케일 활성화"
          />
          <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
        </summary>
        <div className="grid gap-4 border-t border-border/60 p-4 md:grid-cols-2">
          {upscale.enabled ? (
            <>
            <Field label="방식" htmlFor="upscale-method">
              <SearchableSelect
                id="upscale-method"
                value={upscale.method}
                options={optionsFromStrings(
                  options.upscaleMethods.length
                    ? options.upscaleMethods
                    : [
                        "nearest-exact",
                        "bilinear",
                        "area",
                        "bicubic",
                        "bislerp",
                      ],
                )}
                onChange={(method) => patchUpscale({ method })}
                placeholder="업스케일 방식"
              />
            </Field>
            <CommittedNumberField
              label="배율"
              value={upscale.scale}
              onChange={(scale) => patchUpscale({ scale })}
              min={0.01}
              max={8}
              step={0.05}
            />
            <CommittedNumberField
              label="2차 Steps"
              value={upscale.steps}
              onChange={(steps) => patchUpscale({ steps })}
              min={1}
              max={10000}
            />
            <CommittedNumberField
              label="2차 Denoise"
              value={upscale.denoise}
              onChange={(denoise) => patchUpscale({ denoise })}
              min={0}
              max={1}
              step={0.01}
            />
            </>
          ) : null}
        </div>
      </details>
    </div>
  );
}

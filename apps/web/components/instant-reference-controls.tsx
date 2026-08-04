"use client";

import { ChevronDown, Sparkles, Wand2 } from "lucide-react";
import { CommittedNumberField } from "@/components/ui/committed-number-field";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StrengthSlider } from "@/components/ui/strength-slider";
import { Switch } from "@/components/ui/switch";
import type { GenerationDraft } from "@/lib/types";

interface InstantReferenceControlsProps {
  value: GenerationDraft;
  onChange: (value: GenerationDraft) => void;
}

export function InstantReferenceStrengthControls({
  value,
  onChange,
}: InstantReferenceControlsProps) {
  const active = value.referenceAssets.some(
    (asset) => asset.status === "ready",
  );
  const patchInstant = (patch: Partial<GenerationDraft["instantLora"]>) =>
    onChange({
      ...value,
      instantLora: { ...value.instantLora, ...patch },
    });

  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-black/20 p-3">
      <StrengthSlider
        id="instant-lora-model-strength"
        label="Model"
        value={value.instantLora.modelStrength}
        onChange={(modelStrength) => patchInstant({ modelStrength })}
        disabled={!active}
      />
      <StrengthSlider
        id="instant-lora-clip-strength"
        label="CLIP"
        value={value.instantLora.clipStrength}
        onChange={(clipStrength) => patchInstant({ clipStrength })}
        disabled={!active}
      />
    </div>
  );
}

export function InstantReferenceControls({
  value,
  onChange,
}: InstantReferenceControlsProps) {
  const { instantLora, tagging } = value;
  const active = value.referenceAssets.some(
    (asset) => asset.status === "ready",
  );
  const patchInstant = (patch: Partial<GenerationDraft["instantLora"]>) =>
    onChange({ ...value, instantLora: { ...instantLora, ...patch } });
  const patchTagging = (patch: Partial<GenerationDraft["tagging"]>) =>
    onChange({ ...value, tagging: { ...tagging, ...patch } });

  return (
    <details className="group rounded-lg border border-border/70 bg-background/30">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
        <span className="inline-flex items-center gap-2 text-xs font-medium">
          <Sparkles className="size-4 text-violet-300" />
          학습 설정
          {!active ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
              참조 없음 · 비활성
            </span>
          ) : null}
        </span>
        <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
      </summary>

      <fieldset
        disabled={!active}
        className="space-y-5 border-t border-border/60 p-4 disabled:opacity-50"
      >
        <div className="grid gap-4 md:grid-cols-2">
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

        <div className="grid gap-3 md:grid-cols-2">
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
              (checked: boolean) => patchInstant({ forceRetrain: checked }),
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

        <section className="space-y-4 border-t border-border/60 pt-5">
          <h3 className="inline-flex items-center gap-2 text-xs font-medium">
            <Wand2 className="size-4 text-sky-300" />
            자동 태깅
          </h3>
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
          <div className="flex items-center justify-between">
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
        </section>
      </fieldset>
    </details>
  );
}

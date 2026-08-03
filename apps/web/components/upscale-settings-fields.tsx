"use client";

import * as React from "react";
import { SearchableSelect } from "@/components/searchable-select";
import { CommittedNumberField } from "@/components/ui/committed-number-field";
import { Field } from "@/components/ui/field";
import type { GenerationDraft, ModelOption } from "@/lib/types";

export const DEFAULT_UPSCALE_METHODS = [
  "nearest-exact",
  "bilinear",
  "area",
  "bicubic",
  "bislerp",
];

interface UpscaleSettingsFieldsProps {
  value: GenerationDraft["upscale"];
  methods?: string[];
  disabled?: boolean;
  onChange: (value: GenerationDraft["upscale"]) => void;
}

function optionsFromStrings(values: string[]): ModelOption[] {
  return values.map((value) => ({ name: value, value }));
}

export function UpscaleSettingsFields({
  value,
  methods = DEFAULT_UPSCALE_METHODS,
  disabled,
  onChange,
}: UpscaleSettingsFieldsProps) {
  const methodId = `upscale-method-${React.useId()}`;
  const patch = (next: Partial<GenerationDraft["upscale"]>) =>
    onChange({ ...value, ...next });

  return (
    <>
      <Field label="방식" htmlFor={methodId}>
        <SearchableSelect
          id={methodId}
          value={value.method}
          options={optionsFromStrings(
            methods.length ? methods : DEFAULT_UPSCALE_METHODS,
          )}
          onChange={(method) => patch({ method })}
          placeholder="업스케일 방식"
          disabled={disabled}
        />
      </Field>
      <CommittedNumberField
        label="배율"
        value={value.scale}
        onChange={(scale) => patch({ scale })}
        min={0.01}
        max={8}
        step="any"
        disabled={disabled}
      />
      <CommittedNumberField
        label="2차 Steps"
        value={value.steps}
        onChange={(steps) => patch({ steps: Math.round(steps) })}
        min={1}
        max={10000}
        disabled={disabled}
      />
      <CommittedNumberField
        label="2차 Denoise"
        value={value.denoise}
        onChange={(denoise) => patch({ denoise })}
        min={0}
        max={1}
        step={0.01}
        disabled={disabled}
      />
    </>
  );
}

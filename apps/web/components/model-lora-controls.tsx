"use client";

import * as React from "react";
import Image from "next/image";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Box,
  Check,
  ImageIcon,
  Plus,
  Search,
  Sparkle,
  Tags,
  Trash2,
} from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommittedNumberField } from "@/components/ui/committed-number-field";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type {
  GenerationDraft,
  LoraOption,
  LoraSelection,
  StudioOptions,
} from "@/lib/types";
import { cn, uniqueId } from "@/lib/utils";

interface ModelLoraControlsProps {
  models: GenerationDraft["models"];
  loras: LoraSelection[];
  options: StudioOptions;
  loading?: boolean;
  onModelsChange: (models: GenerationDraft["models"]) => void;
  onLorasChange: (loras: LoraSelection[]) => void;
  onInsertTriggers: (words: string[]) => void;
  validationWarning?: string;
}

function LoraFinder({
  options,
  selected,
  onAdd,
}: {
  options: LoraOption[];
  selected: LoraSelection[];
  onAdd: (option: LoraOption) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const filtered = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return options
      .filter(
        (option) =>
          !selected.some((item) => item.path === option.value) &&
          (!normalized ||
            `${option.name} ${option.value} ${option.triggerWords?.join(" ")}`
              .toLowerCase()
              .includes(normalized)),
      )
      .slice(0, 12);
  }, [options, query, selected]);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="pl-9"
        placeholder="설치된 LoRA 검색…"
        aria-label="LoRA 검색"
        aria-expanded={open}
        aria-controls="lora-options"
      />
      {open ? (
        <div
          id="lora-options"
          className="absolute inset-x-0 top-[calc(100%+8px)] z-40 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover/95 p-1.5 shadow-2xl backdrop-blur-xl"
        >
          {filtered.length ? (
            filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                className="flex w-full items-center gap-3 rounded-md p-2 text-left outline-none transition hover:bg-accent focus-visible:bg-accent"
                onClick={() => {
                  onAdd(option);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <div className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground">
                  {option.thumbnailUrl ? (
                    <Image
                      src={option.thumbnailUrl}
                      alt=""
                      fill
                      unoptimized
                      sizes="40px"
                      className="object-cover"
                    />
                  ) : (
                    <Sparkle className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{option.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {option.triggerWords?.length
                      ? option.triggerWords.join(", ")
                      : option.value}
                  </p>
                </div>
                <Plus className="size-4 text-pink-300" />
              </button>
            ))
          ) : (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              {options.length
                ? "추가할 수 있는 LoRA가 없습니다."
                : "ComfyUI에서 LoRA 목록을 불러오지 못했습니다."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ModelLoraControls({
  models,
  loras,
  options,
  loading,
  onModelsChange,
  onLorasChange,
  onInsertTriggers,
  validationWarning,
}: ModelLoraControlsProps) {
  function addLora(option: LoraOption) {
    onLorasChange([
      ...loras,
      {
        id: uniqueId("lora"),
        name: option.name,
        path: option.value,
        enabled: true,
        modelStrength: 1,
        clipStrength: 1,
        triggerWords: option.triggerWords ?? [],
        thumbnailUrl: option.thumbnailUrl,
      },
    ]);
  }

  function updateLora(id: string, patch: Partial<LoraSelection>) {
    onLorasChange(
      loras.map((lora) => (lora.id === id ? { ...lora, ...patch } : lora)),
    );
  }

  function moveLora(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= loras.length) return;
    const next = [...loras];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    onLorasChange(next);
  }

  return (
    <div className="space-y-6">
      {validationWarning ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5 text-[11px] leading-5 text-amber-100"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
          <span>{validationWarning}</span>
        </div>
      ) : null}
      <div className="grid gap-4">
        <Field
          label={
            <span className="inline-flex items-center gap-1.5">
              <Box className="size-3.5 text-pink-300" />
              Diffusion model
            </span>
          }
          htmlFor="diffusion-model"
          hint={loading ? "불러오는 중…" : `${options.diffusionModels.length}개`}
        >
          <SearchableSelect
            id="diffusion-model"
            value={models.diffusion}
            options={options.diffusionModels}
            onChange={(diffusion) => onModelsChange({ ...models, diffusion })}
            placeholder="기반 모델 선택"
            disabled={loading}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Text encoder / CLIP" htmlFor="clip-model">
            <SearchableSelect
              id="clip-model"
              value={models.clip}
              options={options.clips}
              onChange={(clip) => onModelsChange({ ...models, clip })}
              placeholder="CLIP 선택"
              disabled={loading}
            />
          </Field>
          <Field label="VAE" htmlFor="vae-model">
            <SearchableSelect
              id="vae-model"
              value={models.vae}
              options={options.vaes}
              onChange={(vae) => onModelsChange({ ...models, vae })}
              placeholder="VAE 선택"
              disabled={loading}
            />
          </Field>
        </div>
      </div>

      <div className="h-px bg-border/70" />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Style LoRA</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              위에서 아래 순서로 적용됩니다.
            </p>
          </div>
          <Badge variant="secondary">{loras.length}</Badge>
        </div>

        <LoraFinder
          options={options.loras}
          selected={loras}
          onAdd={addLora}
        />

        {loras.length ? (
          <div className="space-y-2">
            {loras.map((lora, index) => (
              <div
                key={lora.id}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.altKey && event.key === "ArrowUp") {
                    event.preventDefault();
                    moveLora(index, -1);
                  }
                  if (event.altKey && event.key === "ArrowDown") {
                    event.preventDefault();
                    moveLora(index, 1);
                  }
                }}
                className={cn(
                  "rounded-lg border border-border/75 bg-background/35 p-3 outline-none transition focus-visible:ring-2 focus-visible:ring-primary/30",
                  !lora.enabled && "opacity-55",
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground">
                    {lora.thumbnailUrl ? (
                      <Image
                        src={lora.thumbnailUrl}
                        alt=""
                        fill
                        unoptimized
                        sizes="44px"
                        className="object-cover"
                      />
                    ) : (
                      <ImageIcon className="size-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{lora.name}</p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {lora.path}
                    </p>
                  </div>
                  <Switch
                    checked={lora.enabled}
                    onCheckedChange={(enabled) =>
                      updateLora(lora.id, { enabled })
                    }
                    aria-label={`${lora.name} 활성화`}
                  />
                </div>

                <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                  <CommittedNumberField
                    id={`lora-model-strength-${lora.id}`}
                    label="Model"
                    step={0.05}
                    min={-10}
                    max={10}
                    value={lora.modelStrength}
                    inputClassName="h-9"
                    onChange={(modelStrength) =>
                      updateLora(lora.id, { modelStrength })
                    }
                  />
                  <CommittedNumberField
                    id={`lora-clip-strength-${lora.id}`}
                    label="CLIP"
                    step={0.05}
                    min={-10}
                    max={10}
                    value={lora.clipStrength}
                    inputClassName="h-9"
                    onChange={(clipStrength) =>
                      updateLora(lora.id, { clipStrength })
                    }
                  />
                  <div className="flex items-end gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`${lora.name} 위로 이동`}
                      disabled={index === 0}
                      onClick={() => moveLora(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`${lora.name} 아래로 이동`}
                      disabled={index === loras.length - 1}
                      onClick={() => moveLora(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="hover:text-red-300"
                      aria-label={`${lora.name} 제거`}
                      onClick={() =>
                        onLorasChange(loras.filter((item) => item.id !== lora.id))
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                {lora.triggerWords.length ? (
                  <div className="mt-3 flex items-center gap-2">
                    <Tags className="size-3.5 shrink-0 text-muted-foreground" />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-[11px] text-pink-200 hover:underline"
                      onClick={() => onInsertTriggers(lora.triggerWords)}
                    >
                      {lora.triggerWords.join(", ")}
                    </button>
                    <Check className="size-3 text-muted-foreground" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
            <p className="text-xs text-muted-foreground">
              Style LoRA는 선택 사항입니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

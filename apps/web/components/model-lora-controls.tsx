"use client";

import * as React from "react";
import Image from "next/image";
import {
  AlertTriangle,
  Box,
  ImageIcon,
  Plus,
  Search,
  Sparkle,
  Trash2,
} from "lucide-react";
import { HoverThumbnailPreview } from "@/components/hover-thumbnail-preview";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type {
  GenerationDraft,
  LoraOption,
  LoraSelection,
  StudioOptions,
} from "@/lib/types";
import { uniqueId } from "@/lib/utils";

interface ModelLoraControlsProps {
  models: GenerationDraft["models"];
  loras: LoraSelection[];
  options: StudioOptions;
  loading?: boolean;
  onModelsChange: (models: GenerationDraft["models"]) => void;
  onLorasChange: (loras: LoraSelection[]) => void;
  validationWarning?: string;
  validationFieldId?: string;
}

function LoraThumbnail({
  src,
  size,
  fallback,
}: {
  src?: string;
  size: number;
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => setFailed(false), [src]);

  if (!src || failed) return fallback;
  return (
    <Image
      src={src}
      alt=""
      fill
      unoptimized
      sizes={`${size}px`}
      className="object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function StrengthSlider({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [showValue, setShowValue] = React.useState(false);
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const min = -1;
  const max = 1;
  const position = ((value - min) / (max - min)) * 100;
  const tooltipPosition = Math.min(94, Math.max(6, position));

  React.useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  function showKeyboardValue() {
    setShowValue(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowValue(false), 900);
  }

  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-1.5">
      <label
        htmlFor={id}
        className="text-[9px] font-medium text-muted-foreground"
      >
        {label}
      </label>
      <div className="relative">
        {showValue ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute bottom-full z-20 mb-1 -translate-x-1/2 rounded-md border border-white/10 bg-popover/95 px-2 py-1 text-[11px] font-semibold tabular-nums text-popover-foreground shadow-glass backdrop-blur-xl"
            style={{ left: `${tooltipPosition}%` }}
          >
            {value.toFixed(2)}
          </div>
        ) : null}
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={0.05}
          value={value}
          aria-valuetext={value.toFixed(2)}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-md [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md"
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          onPointerDown={() => {
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
            setShowValue(true);
          }}
          onPointerUp={() => setShowValue(false)}
          onPointerCancel={() => setShowValue(false)}
          onKeyDown={(event) => {
            if (
              event.key === "ArrowLeft" ||
              event.key === "ArrowRight" ||
              event.key === "ArrowUp" ||
              event.key === "ArrowDown" ||
              event.key === "Home" ||
              event.key === "End" ||
              event.key === "PageUp" ||
              event.key === "PageDown"
            ) {
              showKeyboardValue();
            }
          }}
          onBlur={() => setShowValue(false)}
        />
      </div>
      <output
        htmlFor={id}
        className="number-input text-right text-[9px] font-medium text-foreground"
      >
        {value.toFixed(2)}
      </output>
    </div>
  );
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
                <HoverThumbnailPreview
                  src={option.thumbnailUrl}
                  className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground"
                >
                  <LoraThumbnail
                    src={option.thumbnailUrl}
                    size={40}
                    fallback={<Sparkle className="size-4" />}
                  />
                </HoverThumbnailPreview>
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
  validationWarning,
}: ModelLoraControlsProps) {
  const [loraStrengthsLinked, setLoraStrengthsLinked] =
    React.useState(false);
  const loraOptionsByPath = React.useMemo(
    () =>
      new Map(
        options.loras.map((option) => [
          option.value.replaceAll("\\", "/").toLowerCase(),
          option,
        ]),
      ),
    [options.loras],
  );

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
        useTriggerWords: true,
        thumbnailUrl: option.thumbnailUrl,
        sourceUrl: option.sourceUrl,
      },
    ]);
  }

  function updateLora(id: string, patch: Partial<LoraSelection>) {
    onLorasChange(
      loras.map((lora) => (lora.id === id ? { ...lora, ...patch } : lora)),
    );
  }

  function setStrengthsLinked(linked: boolean) {
    setLoraStrengthsLinked(linked);
    if (linked) {
      onLorasChange(
        loras.map((lora) => ({
          ...lora,
          clipStrength: lora.modelStrength,
        })),
      );
    }
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
          hint={loading ? "불러오는 중…" : undefined}
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
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">LoRA</h3>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium text-muted-foreground">
              Model · CLIP 연동
            </span>
            <Switch
              size="sm"
              checked={loraStrengthsLinked}
              onCheckedChange={setStrengthsLinked}
              aria-label="LoRA Model 및 CLIP 강도 연동"
              title={
                loraStrengthsLinked
                  ? "Model과 CLIP 강도를 따로 조절"
                  : "Model과 CLIP 강도를 함께 조절"
              }
            />
          </div>
        </div>

        <LoraFinder
          options={options.loras}
          selected={loras}
          onAdd={addLora}
        />

        {loras.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {loras.map((lora) => {
              const currentOption = loraOptionsByPath.get(
                lora.path.replaceAll("\\", "/").toLowerCase(),
              );
              const thumbnailUrl =
                currentOption?.thumbnailUrl ?? lora.thumbnailUrl;
              const sourceUrl = currentOption?.sourceUrl ?? lora.sourceUrl;
              return (
                <div
                  key={lora.id}
                  className="overflow-hidden rounded-xl border border-border/75 bg-background/35"
                >
                  <HoverThumbnailPreview
                    src={thumbnailUrl}
                    className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden bg-muted text-muted-foreground"
                  >
                    {sourceUrl ? (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="absolute inset-0 grid place-items-center outline-none transition after:pointer-events-none after:absolute after:inset-0 after:ring-inset after:transition hover:after:ring-2 hover:after:ring-pink-300/70 focus-visible:after:ring-2 focus-visible:after:ring-pink-300"
                        aria-label={`${lora.name} Civitai 원본 페이지 열기`}
                        title="Civitai 원본 페이지 열기"
                      >
                        <LoraThumbnail
                          src={thumbnailUrl}
                          size={360}
                          fallback={<ImageIcon className="size-8" />}
                        />
                      </a>
                    ) : (
                      <LoraThumbnail
                        src={thumbnailUrl}
                        size={360}
                        fallback={<ImageIcon className="size-8" />}
                      />
                    )}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/65 to-transparent px-3 pb-3 pt-10 text-white">
                      <p className="truncate text-sm font-semibold drop-shadow-sm">
                        {lora.name}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-white/70">
                        {lora.path}
                      </p>
                      {lora.triggerWords.length ? (
                        <div
                          className="pointer-events-auto mt-1.5 flex max-w-full cursor-pointer items-center gap-1.5 rounded border border-white/10 bg-black/50 px-1.5 py-0.5 text-[9px] text-pink-100 backdrop-blur-sm transition hover:border-white/25 hover:bg-black/70"
                          title={lora.triggerWords.join(", ")}
                          onClick={(event) => {
                            if ((event.target as Element).closest("button")) {
                              return;
                            }
                            updateLora(lora.id, {
                              useTriggerWords: !lora.useTriggerWords,
                            });
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {lora.triggerWords.join(", ")}
                          </span>
                          <Switch
                            size="sm"
                            checked={lora.useTriggerWords}
                            onCheckedChange={(useTriggerWords) =>
                              updateLora(lora.id, { useTriggerWords })
                            }
                            aria-label={`${lora.name} 키워드 사용`}
                            title={
                              lora.useTriggerWords
                                ? "생성 시 키워드 삽입 끄기"
                                : "생성 시 키워드 삽입 켜기"
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="absolute right-2 top-2 size-8 bg-black/60 text-white/75 backdrop-blur-sm hover:bg-red-500/80 hover:text-white sm:size-8"
                      aria-label={`${lora.name} 제거`}
                      onClick={() =>
                        onLorasChange(
                          loras.filter((item) => item.id !== lora.id),
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </HoverThumbnailPreview>

                  <div className="space-y-1 px-2.5 py-2">
                    {loraStrengthsLinked ? (
                      <StrengthSlider
                        id={`lora-linked-strength-${lora.id}`}
                        label="강도"
                        value={lora.modelStrength}
                        onChange={(strength) =>
                          updateLora(lora.id, {
                            modelStrength: strength,
                            clipStrength: strength,
                          })
                        }
                      />
                    ) : (
                      <>
                        <StrengthSlider
                          id={`lora-model-strength-${lora.id}`}
                          label="Model"
                          value={lora.modelStrength}
                          onChange={(modelStrength) =>
                            updateLora(lora.id, { modelStrength })
                          }
                        />
                        <StrengthSlider
                          id={`lora-clip-strength-${lora.id}`}
                          label="CLIP"
                          value={lora.clipStrength}
                          onChange={(clipStrength) =>
                            updateLora(lora.id, { clipStrength })
                          }
                        />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import Image from "next/image";
import {
  BookmarkPlus,
  Boxes,
  Check,
  ChevronDown,
  LoaderCircle,
  PencilLine,
  Save,
  Trash2,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  CharacterProfile,
  GenerationDraft,
  ModelPack,
} from "@/lib/types";
import { outputUrl } from "@/lib/utils";

export const LOCAL_PROFILES_KEY = "anima-studio:character-profiles:v1";
export const LOCAL_MODEL_PACKS_KEY = "anima-studio:model-packs:v1";

export function readLocalPresetList<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

export function writeLocalPresetList<T>(key: string, values: T[]) {
  window.localStorage.setItem(key, JSON.stringify(values));
}

interface CreativePresetBarProps {
  draft: GenerationDraft;
  profiles: CharacterProfile[];
  modelPacks: ModelPack[];
  activeProfileId: string;
  activeModelPackId: string;
  loading?: boolean;
  onSelectProfile: (id: string) => void;
  onSaveProfile: (name: string) => Promise<void>;
  onUpdateProfile: () => Promise<void>;
  onDeleteProfile: () => Promise<void>;
  onSelectModelPack: (id: string) => void;
  onSaveModelPack: (name: string) => Promise<void>;
  onUpdateModelPack: () => Promise<void>;
  onDeleteModelPack: () => Promise<void>;
  profileDirty?: boolean;
  modelPackDirty?: boolean;
  onRevertProfile?: () => void;
  onRevertModelPack?: () => void;
}

function PresetSelect({
  id,
  value,
  label,
  emptyLabel,
  options,
  icon: Icon,
  onChange,
}: {
  id: string;
  value: string;
  label: string;
  emptyLabel: string;
  options: Array<{ id: string; name: string }>;
  icon: typeof UserRound;
  onChange: (id: string) => void;
}) {
  return (
    <label htmlFor={id} className="block min-w-0 flex-1">
      <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </span>
      <span className="relative block">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full appearance-none truncate rounded-md border border-input bg-background/55 pl-3 pr-9 text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
        >
          <option value="">{emptyLabel}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </span>
    </label>
  );
}

function SavePreset({
  kind,
  active,
  busy,
  onSave,
  onUpdate,
  onDelete,
}: {
  kind: "character" | "model";
  active: boolean;
  busy: boolean;
  onSave: (name: string) => Promise<void>;
  onUpdate: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const label = kind === "character" ? "캐릭터" : "모델 팩";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    await onSave(nextName);
    setName("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`${label} 프리셋 관리`}
        >
          <BookmarkPlus />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
          <form onSubmit={submit} className="space-y-2">
            <label
              htmlFor={`new-${kind}-preset`}
              className="text-[11px] font-medium"
            >
              현재 설정을 새 {label}으로 저장
            </label>
            <div className="flex gap-2">
              <Input
                id={`new-${kind}-preset`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={kind === "character" ? "예: 네코 겨울 의상" : "예: Anima 기본 팩"}
                autoFocus
              />
              <Button
                type="submit"
                size="icon"
                disabled={busy || !name.trim()}
                aria-label="새 프리셋 저장"
              >
                {busy ? <LoaderCircle className="animate-spin" /> : <Save />}
              </Button>
            </div>
          </form>
          {active ? (
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/70 pt-3">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  void onUpdate();
                }}
              >
                <PencilLine />
                덮어쓰기
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-red-200 hover:bg-red-400/10 hover:text-red-100"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  void onDelete();
                }}
              >
                <Trash2 />
                삭제
              </Button>
            </div>
          ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function CreativePresetBar({
  draft,
  profiles,
  modelPacks,
  activeProfileId,
  activeModelPackId,
  loading,
  onSelectProfile,
  onSaveProfile,
  onUpdateProfile,
  onDeleteProfile,
  onSelectModelPack,
  onSaveModelPack,
  onUpdateModelPack,
  onDeleteModelPack,
  profileDirty = false,
  modelPackDirty = false,
  onRevertProfile,
  onRevertModelPack,
}: CreativePresetBarProps) {
  const [busy, setBusy] = React.useState(false);
  const activeProfile = profiles.find(
    (profile) => profile.id === activeProfileId,
  );

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="캐릭터와 모델 프리셋"
      className="mb-5 overflow-visible rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <div className="flex min-w-0 flex-1 items-end gap-2">
          {activeProfile?.representativeUrl ? (
            <div className="relative mb-px size-10 shrink-0 overflow-hidden rounded-lg border border-primary/25 bg-muted">
              <Image
                src={outputUrl(activeProfile.representativeUrl)}
                alt=""
                fill
                unoptimized
                sizes="40px"
                className="object-cover"
              />
            </div>
          ) : null}
          <PresetSelect
            id="character-profile"
            value={activeProfileId}
            label="캐릭터 프로필"
            emptyLabel={
              loading
                ? "프로필 불러오는 중…"
                : profiles.length
                  ? "프로필 선택"
                  : "저장된 프로필 없음"
            }
            options={profiles}
            icon={UserRound}
            onChange={onSelectProfile}
          />
          <SavePreset
            kind="character"
            active={Boolean(activeProfileId)}
            busy={busy}
            onSave={(name) => run(() => onSaveProfile(name))}
            onUpdate={() => run(onUpdateProfile)}
            onDelete={() => run(onDeleteProfile)}
          />
        </div>

        <div className="hidden h-10 w-px bg-border/80 lg:block" />

        <div className="flex min-w-0 flex-1 items-end gap-2">
          <PresetSelect
            id="model-pack"
            value={activeModelPackId}
            label="모델 구성 팩"
            emptyLabel={
              loading
                ? "모델 팩 불러오는 중…"
                : modelPacks.length
                  ? "모델 팩 선택"
                  : "저장된 모델 팩 없음"
            }
            options={modelPacks}
            icon={Boxes}
            onChange={onSelectModelPack}
          />
          <SavePreset
            kind="model"
            active={Boolean(activeModelPackId)}
            busy={busy}
            onSave={(name) => run(() => onSaveModelPack(name))}
            onUpdate={() => run(onUpdateModelPack)}
            onDelete={() => run(onDeleteModelPack)}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <Badge variant="outline">
          {draft.referenceAssets.length} reference
        </Badge>
        <Badge variant="outline">{draft.loras.length} LoRA</Badge>
        {activeProfileId || activeModelPackId ? (
          <>
            <span className="inline-flex items-center gap-1 text-success">
              <Check className="size-3" />
              선택한 프리셋을 현재 초안에 적용했습니다.
            </span>
            {profileDirty ? (
              <span className="inline-flex items-center gap-1.5">
                <Badge variant="warning">캐릭터 수정됨</Badge>
                {onRevertProfile ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    onClick={onRevertProfile}
                  >
                    캐릭터 되돌리기
                  </button>
                ) : null}
              </span>
            ) : null}
            {modelPackDirty ? (
              <span className="inline-flex items-center gap-1.5">
                <Badge variant="warning">모델 팩 수정됨</Badge>
                {onRevertModelPack ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    onClick={onRevertModelPack}
                  >
                    모델 팩 되돌리기
                  </button>
                ) : null}
              </span>
            ) : null}
          </>
        ) : (
          <span>반복 작업은 캐릭터와 모델 구성을 각각 저장해 두세요.</span>
        )}
      </div>
    </section>
  );
}

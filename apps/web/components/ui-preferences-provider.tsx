"use client";

import * as React from "react";
import { globalUpscaleSettingsSchema } from "@anima/shared";
import { ApiError, getUiPreferences, updateUiPreferences } from "@/lib/api";
import {
  DEFAULT_DRAFT,
  type GenerationDraft,
  type GlobalUpscaleSettings,
  type SettingsSection,
  type UiPreferences,
} from "@/lib/types";
import { clearModelAndLoraSelections } from "@/lib/studio-ux";

const LEGACY_KEYS = {
  draft: "anima-studio:creation-draft:v1",
  modelSelectionReset:
    "anima-studio:model-selection-defaults-cleared:v1",
  blurSensitive: "anima-studio:blur-sensitive-previews:v1",
  completionNotifications:
    "anima-studio:completion-notifications:v1",
  settingsSection: "anima-studio:settings-section:v1",
  cleanup: "anima-studio:legacy-ui-storage-cleaned:v1",
  sidebar: "anima-studio:sidebar-collapsed:v1",
  characterProfiles: "anima-studio:character-profiles:v1",
  modelPacks: "anima-studio:model-packs:v1",
} as const;

interface UiPreferencesContextValue {
  preferences: UiPreferences;
  ready: boolean;
  updatePreferences(patch: Partial<UiPreferences>): void;
}

const UiPreferencesContext = React.createContext<
  UiPreferencesContextValue | undefined
>(undefined);

const UI_PREFERENCES_STARTUP_RETRY_MS = 1_000;

function waitForUiPreferencesRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, UI_PREFERENCES_STARTUP_RETRY_MS);
    const handleAbort = () => {
      window.clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

export async function loadUiPreferencesWithStartupRetry(
  load: (signal: AbortSignal) => Promise<UiPreferences>,
  signal: AbortSignal,
  wait: (signal: AbortSignal) => Promise<void> = waitForUiPreferencesRetry,
): Promise<UiPreferences> {
  while (true) {
    try {
      return await load(signal);
    } catch (error) {
      if (
        signal.aborted ||
        !(error instanceof ApiError) ||
        error.status !== 503
      ) {
        throw error;
      }
      await wait(signal);
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeGlobalUpscaleSettings(
  value: unknown,
): GlobalUpscaleSettings {
  const parsed = globalUpscaleSettingsSchema.safeParse(record(value));
  return parsed.success
    ? parsed.data
    : globalUpscaleSettingsSchema.parse({});
}

export function resolveGlobalUpscaleSettings(
  preferences: UiPreferences,
): GlobalUpscaleSettings {
  return normalizeGlobalUpscaleSettings(
    preferences.upscaleSettings ?? preferences.draft?.upscale,
  );
}

export function normalizeGenerationDraft(
  value: unknown,
  resetModelSelections = false,
): GenerationDraft {
  const saved = record(value) as Partial<GenerationDraft>;
  const draft: GenerationDraft = {
    ...DEFAULT_DRAFT,
    ...saved,
    referenceAssets: Array.isArray(saved.referenceAssets)
      ? saved.referenceAssets.filter(
          (asset) =>
            asset &&
            typeof asset === "object" &&
            asset.status === "ready" &&
            Boolean(asset.id) &&
            !asset.url?.startsWith("blob:"),
        )
      : [],
    prompts: { ...DEFAULT_DRAFT.prompts, ...record(saved.prompts) },
    models: { ...DEFAULT_DRAFT.models, ...record(saved.models) },
    sampling: { ...DEFAULT_DRAFT.sampling, ...record(saved.sampling) },
    instantLora: {
      ...DEFAULT_DRAFT.instantLora,
      ...record(saved.instantLora),
    },
    loraOptimizer: {
      ...DEFAULT_DRAFT.loraOptimizer,
      ...record(saved.loraOptimizer),
    },
    tagging: { ...DEFAULT_DRAFT.tagging, ...record(saved.tagging) },
    upscale: { ...DEFAULT_DRAFT.upscale, ...record(saved.upscale) },
    loras: Array.isArray(saved.loras)
      ? saved.loras
          .filter(
            (lora) => lora && typeof lora === "object" && Boolean(lora.id),
          )
          .map((lora) => ({
            ...lora,
            triggerWords: Array.isArray(lora.triggerWords)
              ? lora.triggerWords
              : [],
            useTriggerWords: lora.useTriggerWords !== false,
          }))
      : [],
  };
  return resetModelSelections
    ? clearModelAndLoraSelections(draft)
    : draft;
}

function isSettingsSection(value: string | null): value is SettingsSection {
  return value === "overview" || value === "runtime" || value === "storage";
}

function readLegacyPreferences(): {
  preferences: UiPreferences;
  found: boolean;
} {
  try {
    const preferences: UiPreferences = {};
    const draft = window.localStorage.getItem(LEGACY_KEYS.draft);
    if (draft) {
      try {
        preferences.draft = normalizeGenerationDraft(
          JSON.parse(draft) as unknown,
          window.localStorage.getItem(LEGACY_KEYS.modelSelectionReset) !==
            "true",
        );
      } catch {
        // Ignore an invalid legacy draft and keep the application defaults.
      }
    }
    const blurSensitive = window.localStorage.getItem(
      LEGACY_KEYS.blurSensitive,
    );
    if (blurSensitive !== null) {
      preferences.blurSensitive = blurSensitive !== "false";
    }
    const notifications = window.localStorage.getItem(
      LEGACY_KEYS.completionNotifications,
    );
    if (notifications !== null) {
      preferences.completionNotificationsEnabled = notifications === "true";
    }
    const settingsSection = window.localStorage.getItem(
      LEGACY_KEYS.settingsSection,
    );
    if (isSettingsSection(settingsSection)) {
      preferences.settingsSection = settingsSection;
    }
    const found = Object.values(LEGACY_KEYS).some(
      (key) => window.localStorage.getItem(key) !== null,
    );
    return { preferences, found };
  } catch {
    return { preferences: {}, found: false };
  }
}

function clearLegacyPreferences(): void {
  try {
    for (const key of Object.values(LEGACY_KEYS)) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // The database remains authoritative when browser storage is unavailable.
  }
}

export function UiPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preferences, setPreferences] = React.useState<UiPreferences>({});
  const [ready, setReady] = React.useState(false);
  const writeQueue = React.useRef(Promise.resolve());

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const legacy = readLegacyPreferences();
      try {
        const stored = await loadUiPreferencesWithStartupRetry(
          getUiPreferences,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const migration = Object.fromEntries(
          Object.entries(legacy.preferences).filter(
            ([key]) => stored[key as keyof UiPreferences] === undefined,
          ),
        ) as Partial<UiPreferences>;
        const merged = { ...legacy.preferences, ...stored };
        setPreferences(merged);
        setReady(true);
        if (Object.keys(migration).length > 0) {
          await updateUiPreferences(migration);
          if (controller.signal.aborted) return;
        }
        if (legacy.found) clearLegacyPreferences();
      } catch {
        if (controller.signal.aborted) return;
        setPreferences(legacy.preferences);
        setReady(true);
      }
    })();
    return () => controller.abort();
  }, []);

  const updatePreferences = React.useCallback(
    (patch: Partial<UiPreferences>) => {
      setPreferences((current) => ({ ...current, ...patch }));
      writeQueue.current = writeQueue.current
        .then(() => updateUiPreferences(patch))
        .then(() => undefined)
        .catch((error: unknown) => {
          console.error("UI preferences could not be saved.", error);
        });
    },
    [],
  );

  const value = React.useMemo(
    () => ({ preferences, ready, updatePreferences }),
    [preferences, ready, updatePreferences],
  );

  return (
    <UiPreferencesContext.Provider value={value}>
      {children}
    </UiPreferencesContext.Provider>
  );
}

export function useUiPreferences(): UiPreferencesContextValue {
  const value = React.useContext(UiPreferencesContext);
  if (!value) {
    throw new Error("useUiPreferences must be used within UiPreferencesProvider.");
  }
  return value;
}

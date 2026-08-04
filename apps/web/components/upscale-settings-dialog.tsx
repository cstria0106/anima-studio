"use client";

import * as React from "react";
import { LoaderCircle, Maximize2 } from "lucide-react";
import {
  resolveGlobalUpscaleSettings,
  useUiPreferences,
} from "@/components/ui-preferences-provider";
import { UpscaleSettingsFields } from "@/components/upscale-settings-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GenerationDraft } from "@/lib/types";

interface UpscaleSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (settings: GenerationDraft["upscale"]) => Promise<void>;
}

export function UpscaleSettingsDialog({
  open,
  onOpenChange,
  onSubmit,
}: UpscaleSettingsDialogProps) {
  const { preferences, updatePreferences } = useUiPreferences();
  const initialSettings = React.useMemo(
    () => resolveGlobalUpscaleSettings(preferences),
    [preferences],
  );
  const [settings, setSettings] = React.useState<GenerationDraft["upscale"]>({
    ...initialSettings,
    enabled: true,
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setSettings({ ...initialSettings, enabled: true });
    setSubmitting(false);
    setError("");
  }, [initialSettings, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (submitting) return;
    onOpenChange(nextOpen);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(settings);
      updatePreferences({
        upscaleSettings: {
          method: settings.method,
          scale: settings.scale,
          steps: settings.steps,
          denoise: settings.denoise,
        },
      });
      setSubmitting(false);
      onOpenChange(false);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "업스케일 작업을 시작하지 못했습니다.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto p-0"
        showClose={!submitting}
        onEscapeKeyDown={(event) => {
          if (submitting) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (submitting) event.preventDefault();
        }}
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader className="border-b border-border/70 px-5 pb-4 pt-5 pr-14">
            <DialogTitle className="inline-flex items-center gap-2">
              <Maximize2 className="size-4 text-violet-300" />
              업스케일 설정
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            <UpscaleSettingsFields
              value={settings}
              disabled={submitting}
              onChange={setSettings}
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="mx-5 mb-4 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-xs leading-5 text-red-200"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter className="border-t border-border/70 px-5 py-4">
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => handleOpenChange(false)}
            >
              취소
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Maximize2 />
              )}
              {submitting ? "시작 중" : "업스케일 시작"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

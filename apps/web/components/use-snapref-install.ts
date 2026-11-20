"use client";

import * as React from "react";
import {
  getSnapRefAdapter,
  installSnapRefAdapter,
  modelInstallationEventsUrl,
} from "@/lib/api";
import type { ModelInstallTask, SnapRefProviderResponse } from "@/lib/types";

/**
 * Loads the pinned SnapRef adapter's install state, starts its installation,
 * and follows progress until the file is in the LoRA folder.
 */
export function useSnapRefInstall(onInstalled: () => void) {
  const [value, setValue] = React.useState<SnapRefProviderResponse | null>(
    null,
  );
  const [error, setError] = React.useState("");
  const sourceRef = React.useRef<EventSource | null>(null);
  const onInstalledRef = React.useRef(onInstalled);
  onInstalledRef.current = onInstalled;

  const setProgress = React.useCallback(
    (task: Pick<ModelInstallTask, "installationId" | "progress">) =>
      setValue((current) =>
        current
          ? {
              ...current,
              adapter: {
                ...current.adapter,
                installationId: task.installationId,
                installationStatus: "installing",
                installationProgress: task.progress,
              },
            }
          : current,
      ),
    [],
  );

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await getSnapRefAdapter(signal);
      setValue(next);
      return next;
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(
          cause instanceof Error
            ? cause.message
            : "SnapRef 설치 상태를 불러오지 못했습니다.",
        );
      }
      return null;
    }
  }, []);

  const watch = React.useCallback(
    (installationId: string) => {
      sourceRef.current?.close();
      const source = new EventSource(modelInstallationEventsUrl(installationId));
      sourceRef.current = source;
      source.addEventListener("installation", (event) => {
        const task = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as ModelInstallTask;
        if (task.status === "installing") {
          setProgress(task);
          return;
        }
        source.close();
        if (sourceRef.current === source) sourceRef.current = null;
        if (task.status === "failed") {
          setError(task.error ?? "SnapRef 설치에 실패했습니다.");
        } else {
          onInstalledRef.current();
        }
        void load();
      });
      // EventSource reconnects on its own after transient stream failures.
      source.onerror = () => undefined;
    },
    [load, setProgress],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then((next) => {
      const adapter = next?.adapter;
      if (adapter?.installationStatus === "installing" && adapter.installationId) {
        watch(adapter.installationId);
      }
    });
    return () => {
      controller.abort();
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [load, watch]);

  const install = React.useCallback(async () => {
    setError("");
    try {
      const task = await installSnapRefAdapter();
      if (task.status === "installing") {
        setProgress(task);
        watch(task.installationId);
      } else {
        onInstalledRef.current();
        await load();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "SnapRef 설치 시작 실패");
    }
  }, [load, setProgress, watch]);

  return { value, error, install, reload: load };
}

"use client";

import * as React from "react";
import {
  AlertTriangle,
  BellRing,
  Database,
  ServerCog,
} from "lucide-react";
import {
  CompletionNotificationPanel,
  type CompletionNotificationPanelProps,
} from "@/components/completion-notifications";
import { RuntimeManager } from "@/components/runtime-manager";
import { StorageDashboard } from "@/components/storage-dashboard";
import { SectionHeading } from "@/components/ui/field";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  rememberSettingsSection,
  SETTINGS_SECTION_STORAGE_KEY,
  type SettingsSection,
} from "@/lib/studio-ux";
import type {
  StorageCleanupResult,
  StorageCleanupTarget,
  StorageInventory,
} from "@/lib/types";

interface SettingsViewProps {
  error?: string;
  onRefresh: () => void;
  notificationController?: CompletionNotificationPanelProps["controller"];
  storage: StorageInventory | null;
  storageLoading?: boolean;
  storageError?: string;
  onStorageRefresh: () => void;
  onStorageCleanup: (
    targets: StorageCleanupTarget[],
    dryRun: boolean,
  ) => Promise<StorageCleanupResult>;
}

const sections: Array<{
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "overview", label: "일반", icon: BellRing },
  { id: "runtime", label: "엔진", icon: ServerCog },
  { id: "storage", label: "저장공간", icon: Database },
];

function isSettingsSection(value: string | null): value is SettingsSection {
  return sections.some((section) => section.id === value);
}

export function SettingsView({
  error,
  onRefresh,
  notificationController,
  storage,
  storageLoading,
  storageError,
  onStorageRefresh,
  onStorageCleanup,
}: SettingsViewProps) {
  const [section, setSection] = React.useState<SettingsSection>("overview");
  React.useEffect(() => {
    const saved = window.localStorage.getItem(SETTINGS_SECTION_STORAGE_KEY);
    if (isSettingsSection(saved)) setSection(saved);
  }, []);

  function selectSection(next: string) {
    if (!isSettingsSection(next)) return;
    setSection(next);
    rememberSettingsSection(next);
  }

  return (
    <div className="flex h-full min-h-0 animate-fade-in flex-col gap-6">
      {error ? (
        <div
          role="alert"
          className="flex gap-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] p-4 text-sm text-red-100"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-300" />
          <div>
            <p className="font-medium">API 서버에 연결할 수 없습니다.</p>
            <p className="mt-1 text-xs text-red-200/70">{error}</p>
          </div>
        </div>
      ) : null}

      <Tabs
        value={section}
        onValueChange={selectSection}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList
          aria-label="설정 섹션"
          className="grid h-auto w-full shrink-0 grid-cols-2 gap-1 p-1 md:grid-cols-3"
        >
          {sections.map(({ id, label, icon: Icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              className="min-h-11 gap-2 px-3"
            >
              <Icon className="size-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent
          value="overview"
          forceMount
          className="mt-5 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
        >
          {notificationController ? (
            <section className="space-y-4">
              <SectionHeading title="완료 알림" />
              <CompletionNotificationPanel
                controller={notificationController}
              />
            </section>
          ) : null}
        </TabsContent>

        <TabsContent
          value="runtime"
          forceMount
          className="mt-5 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
        >
          <RuntimeManager
            onSystemRefresh={onRefresh}
            notificationController={notificationController}
          />
        </TabsContent>

        <TabsContent
          value="storage"
          forceMount
          className="mt-5 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
        >
          <StorageDashboard
            inventory={storage}
            loading={storageLoading}
            error={storageError}
            onRefresh={onStorageRefresh}
            onCleanup={onStorageCleanup}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

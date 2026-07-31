"use client";

import * as React from "react";
import {
  AlertTriangle,
  BellRing,
  Database,
  ExternalLink,
  Info,
  RefreshCw,
  ServerCog,
} from "lucide-react";
import {
  CompletionNotificationPanel,
  type CompletionNotificationPanelProps,
} from "@/components/completion-notifications";
import { RuntimeManager } from "@/components/runtime-manager";
import { StorageDashboard } from "@/components/storage-dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  AppInfo,
  AppUpdateInfo,
  StorageCleanupResult,
  StorageCleanupTarget,
  StorageInventory,
} from "@/lib/types";
import { getAppInfo, getAppUpdate } from "@/lib/api";

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
  const [appInfo, setAppInfo] = React.useState<AppInfo | null>(null);
  const [appUpdate, setAppUpdate] = React.useState<AppUpdateInfo | null>(null);
  const [appInfoError, setAppInfoError] = React.useState("");
  const [checkingUpdate, setCheckingUpdate] = React.useState(false);

  const refreshAppInfo = React.useCallback(async () => {
    setCheckingUpdate(true);
    setAppInfoError("");
    const [info, update] = await Promise.allSettled([
      getAppInfo(),
      getAppUpdate(),
    ]);
    if (info.status === "fulfilled") setAppInfo(info.value);
    else setAppInfoError("앱 정보를 불러오지 못했습니다.");
    if (update.status === "fulfilled") setAppUpdate(update.value);
    setCheckingUpdate(false);
  }, []);

  React.useEffect(() => {
    const saved = window.localStorage.getItem(SETTINGS_SECTION_STORAGE_KEY);
    if (isSettingsSection(saved)) setSection(saved);
    void refreshAppInfo();
  }, [refreshAppInfo]);

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
          <div className="space-y-6">
            <section className="space-y-4">
              <SectionHeading title="앱 정보" />
              <Card>
                <CardContent className="space-y-4 p-5 text-sm">
                  {appInfoError ? (
                    <p className="text-danger">{appInfoError}</p>
                  ) : appInfo ? (
                    <dl className="grid gap-3 sm:grid-cols-[9rem_1fr]">
                      <dt className="text-muted-foreground">현재 버전</dt>
                      <dd>{appInfo.version}</dd>
                      <dt className="text-muted-foreground">데이터 경로</dt>
                      <dd className="break-all font-mono text-xs">{appInfo.dataPath}</dd>
                      <dt className="text-muted-foreground">업데이트</dt>
                      <dd>
                        {appUpdate?.updateAvailable
                          ? `새 버전 ${appUpdate.latestVersion} 사용 가능`
                          : appUpdate?.latestVersion
                            ? `최신 버전 (${appUpdate.latestVersion})`
                            : "확인할 수 없음 (오프라인 사용 가능)"}
                      </dd>
                    </dl>
                  ) : (
                    <p className="text-muted-foreground">앱 정보를 불러오는 중입니다.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={checkingUpdate}
                      onClick={() => void refreshAppInfo()}
                    >
                      <RefreshCw className={checkingUpdate ? "animate-spin" : ""} />
                      업데이트 확인
                    </Button>
                    {appUpdate?.releaseUrl ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={appUpdate.releaseUrl} target="_blank" rel="noreferrer">
                          <ExternalLink /> 릴리스 페이지
                        </a>
                      </Button>
                    ) : null}
                    {appInfo ? (
                      <Button asChild size="sm" variant="ghost">
                        <a href={appInfo.license.url} target="_blank" rel="noreferrer">
                          <Info /> MIT 및 제3자 라이선스
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </section>
          {notificationController ? (
            <section className="space-y-4">
              <SectionHeading title="완료 알림" />
              <CompletionNotificationPanel
                controller={notificationController}
              />
            </section>
          ) : null}
          </div>
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

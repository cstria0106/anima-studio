"use client";

import * as React from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  FileImage,
  HardDrive,
  LoaderCircle,
  LockKeyhole,
  Package,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type {
  StorageCleanupResult,
  StorageCleanupTarget,
  StorageInventory,
  StorageItem,
  StorageItemKind,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export interface StorageDashboardProps {
  inventory: StorageInventory | null;
  loading?: boolean;
  error?: string;
  onRefresh: () => void;
  onCleanup: (
    targets: StorageCleanupTarget[],
    dryRun: boolean,
  ) => Promise<StorageCleanupResult>;
}

const MAX_SELECTION = 100;

const KIND_DETAILS: Record<
  StorageItemKind,
  { label: string; itemLabel: string; icon: typeof Archive }
> = {
  asset: { label: "참조 이미지", itemLabel: "참조", icon: FileImage },
  output: { label: "생성 결과", itemLabel: "결과", icon: Archive },
  instant_lora: { label: "Instant LoRA", itemLabel: "LoRA", icon: Sparkles },
  model_download: { label: "관리형 모델", itemLabel: "모델", icon: Package },
};

function targetKey(target: StorageCleanupTarget) {
  return `${target.kind}:${target.id}`;
}

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (value < 1024) return `${value.toLocaleString()} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let index = -1;
  do {
    size /= 1024;
    index += 1;
  } while (size >= 1024 && index < units.length - 1);
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatDate(value: string | null) {
  if (!value) return "날짜 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function StorageDashboard({
  inventory,
  loading = false,
  error,
  onRefresh,
  onCleanup,
}: StorageDashboardProps) {
  const [selected, setSelected] = React.useState<StorageCleanupTarget[]>([]);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const [actionError, setActionError] = React.useState("");
  const [message, setMessage] = React.useState("");

  const sortedItems = React.useMemo(
    () =>
      [...(inventory?.items ?? [])].sort((left, right) => {
        if (!left.createdAt && !right.createdAt) {
          return left.name.localeCompare(right.name, "ko");
        }
        if (!left.createdAt) return 1;
        if (!right.createdAt) return -1;
        return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      }),
    [inventory],
  );
  const selectedKeys = React.useMemo(
    () => new Set(selected.map(targetKey)),
    [selected],
  );
  const selectedBytes = sortedItems
    .filter((item) => selectedKeys.has(targetKey(item)))
    .reduce((total, item) => total + item.byteSize, 0);

  React.useEffect(() => {
    if (!inventory) return;
    const eligible = new Set(
      inventory.items.filter((item) => item.cleanupEligible).map(targetKey),
    );
    setSelected((current) =>
      current.filter((target) => eligible.has(targetKey(target))),
    );
  }, [inventory]);

  function resetAction() {
    setDeleteOpen(false);
    setMessage("");
  }

  function toggle(item: StorageItem) {
    if (!item.cleanupEligible) return;
    setActionError("");
    resetAction();
    const target = { kind: item.kind, id: item.id };
    const key = targetKey(target);
    setSelected((current) => {
      if (current.some((value) => targetKey(value) === key)) {
        return current.filter((value) => targetKey(value) !== key);
      }
      if (current.length >= MAX_SELECTION) {
        setActionError(`한 번에 최대 ${MAX_SELECTION}개까지 선택할 수 있습니다.`);
        return current;
      }
      return [...current, target];
    });
  }

  function selectEligible() {
    resetAction();
    setActionError("");
    setSelected(
      sortedItems
        .filter((item) => item.cleanupEligible)
        .slice(0, MAX_SELECTION)
        .map(({ kind, id }) => ({ kind, id })),
    );
  }

  async function removeSelected() {
    if (!selected.length) return;
    setWorking(true);
    setActionError("");
    try {
      const result = await onCleanup(selected, false);
      setSelected([]);
      setDeleteOpen(false);
      setMessage(
        `${result.results.filter((item) => item.deleted).length}개 항목을 삭제해 ${formatBytes(result.reclaimedBytes)}를 확보했습니다.`,
      );
      onRefresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "선택 항목을 삭제하지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section
      aria-labelledby="storage-dashboard-title"
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <HardDrive className="size-4 text-violet-300" />
          <h2 id="storage-dashboard-title" className="text-[15px] font-semibold">
            저장 공간
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">{formatBytes(inventory?.totalBytes)}</span>
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={onRefresh}
            disabled={loading || working}
            aria-label="저장 공간 새로고침"
          >
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-4 flex gap-2 text-xs text-red-200">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(inventory?.categories ?? []).map((category) => {
          const details = KIND_DETAILS[category.kind];
          const Icon = details.icon;
          return (
            <div key={category.kind} className="border-y border-border/60 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-xs font-medium">
                  <Icon className="size-3.5 text-muted-foreground" />
                  {details.label}
                </span>
                <Badge variant="secondary">{category.itemCount.toLocaleString()}개</Badge>
              </div>
              <p className="mt-2 text-sm font-semibold">{formatBytes(category.byteSize)}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <p className="text-[10px] text-muted-foreground">
          {selected.length}/{MAX_SELECTION}개 선택 · {formatBytes(selectedBytes)}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              resetAction();
              setSelected([]);
            }}
            disabled={!selected.length || working}
          >
            선택 해제
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={selectEligible}
            disabled={loading || working || !sortedItems.some((item) => item.cleanupEligible)}
          >
            정리 가능 항목 선택
          </Button>
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {loading && !inventory ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            저장 공간 확인 중
          </div>
        ) : sortedItems.length ? (
          sortedItems.map((item) => {
            const checked = selectedKeys.has(targetKey(item));
            const details = KIND_DETAILS[item.kind];
            return (
              <label
                key={targetKey(item)}
                className={cn(
                  "flex gap-3 border-b border-border/55 py-3",
                  item.cleanupEligible ? "cursor-pointer" : "cursor-not-allowed opacity-75",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-pink-500"
                  checked={checked}
                  disabled={!item.cleanupEligible || working}
                  onChange={() => toggle(item)}
                  aria-label={`${item.name} 선택`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{item.name}</span>
                      <span className="mt-1 flex gap-3 text-[10px] text-muted-foreground">
                        <span>{formatBytes(item.byteSize)}</span>
                        <span>{formatDate(item.createdAt)}</span>
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {item.dependencies.length ? (
                        <Badge variant="outline">사용 중 {item.dependencies.length}개</Badge>
                      ) : null}
                      <Badge variant={item.cleanupEligible ? "secondary" : "outline"}>
                        {!item.cleanupEligible ? <LockKeyhole className="size-3" /> : null}
                        {details.itemLabel} · {item.cleanupEligible ? "정리 가능" : "보호"}
                      </Badge>
                    </span>
                  </span>
                  {item.cleanupReason ? (
                    <span className="mt-2 block text-[10px] text-amber-100/75">
                      {item.cleanupReason}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })
        ) : (
          <div className="py-8 text-center text-xs text-muted-foreground">관리 중인 파일이 없습니다.</div>
        )}
      </div>

      {actionError ? (
        <p role="alert" className="mt-3 flex shrink-0 items-center gap-2 text-xs text-red-200">
          <AlertTriangle className="size-4 shrink-0" />
          {actionError}
        </p>
      ) : null}

      {message ? (
        <p className="mt-3 flex shrink-0 items-center gap-2 text-xs text-emerald-200">
          <CheckCircle2 className="size-4 shrink-0" />
          {message}
        </p>
      ) : null}

      <div className="mt-4 flex shrink-0 justify-end">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={!selected.length || working}
          onClick={() => {
            setActionError("");
            setDeleteOpen(true);
          }}
        >
          <Trash2 />
          선택 항목 삭제
        </Button>
      </div>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !working) setDeleteOpen(false);
        }}
      >
        <AlertDialogContent className="max-w-md border-destructive/30">
          <AlertDialogHeader>
            <AlertDialogTitle>선택 항목을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              선택한 {selected.length}개 항목({formatBytes(selectedBytes)})을 삭제합니다.
              삭제한 파일은 복구할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError ? (
            <p role="alert" className="flex items-center gap-2 text-xs text-red-200">
              <AlertTriangle className="size-4 shrink-0" />
              {actionError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" size="sm" variant="outline" disabled={working}>
                취소
              </Button>
            </AlertDialogCancel>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={working}
              onClick={() => void removeSelected()}
            >
              {working ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              {working ? "삭제 중" : "삭제"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </section>
  );
}

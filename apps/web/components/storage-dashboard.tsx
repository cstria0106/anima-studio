"use client";

import * as React from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  FileImage,
  HardDrive,
  LoaderCircle,
  LockKeyhole,
  Package,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  StorageCleanupResult,
  StorageCleanupTarget,
  StorageDependency,
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
  asset: {
    label: "참조 이미지",
    itemLabel: "참조",
    icon: FileImage,
  },
  output: {
    label: "생성 결과",
    itemLabel: "결과",
    icon: Archive,
  },
  preview: {
    label: "디노이즈 미리보기",
    itemLabel: "미리보기",
    icon: Database,
  },
  model_download: {
    label: "관리형 모델",
    itemLabel: "모델",
    icon: Package,
  },
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

function dependencyKindLabel(kind: StorageDependency["kind"]) {
  if (kind === "job") return "작업";
  if (kind === "character_profile") return "캐릭터";
  return "모델 팩";
}

export function StorageDashboard({
  inventory,
  loading = false,
  error,
  onRefresh,
  onCleanup,
}: StorageDashboardProps) {
  const [selected, setSelected] = React.useState<StorageCleanupTarget[]>([]);
  const [review, setReview] = React.useState<StorageCleanupResult | null>(null);
  const [confirmation, setConfirmation] = React.useState("");
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [working, setWorking] = React.useState<"review" | "delete" | null>(
    null,
  );
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
        return (
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime()
        );
      }),
    [inventory],
  );

  const selectedKeys = React.useMemo(
    () => new Set(selected.map(targetKey)),
    [selected],
  );
  const selectedItems = React.useMemo(
    () => sortedItems.filter((item) => selectedKeys.has(targetKey(item))),
    [selectedKeys, sortedItems],
  );
  const selectedBytes = selectedItems.reduce(
    (total, item) => total + item.byteSize,
    0,
  );
  const reviewedProtected =
    review?.results.filter((result) => !result.eligible) ?? [];
  const reviewedEligible =
    review?.results.filter((result) => result.eligible) ?? [];
  const confirmed =
    Boolean(review?.dryRun) &&
    reviewedEligible.length > 0 &&
    acknowledged &&
    confirmation.trim() === "삭제";

  React.useEffect(() => {
    if (!inventory) return;
    const eligibleKeys = new Set(
      inventory.items
        .filter((item) => item.cleanupEligible)
        .map(targetKey),
    );
    setSelected((current) =>
      current.filter((target) => eligibleKeys.has(targetKey(target))),
    );
  }, [inventory]);

  function resetReview() {
    setReview(null);
    setConfirmation("");
    setAcknowledged(false);
    setMessage("");
  }

  function toggle(item: StorageItem) {
    if (!item.cleanupEligible) return;
    setActionError("");
    resetReview();
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
    setActionError("");
    resetReview();
    setSelected(
      sortedItems
        .filter((item) => item.cleanupEligible)
        .slice(0, MAX_SELECTION)
        .map(({ kind, id }) => ({ kind, id })),
    );
  }

  async function reviewSelected() {
    if (!selected.length) return;
    setWorking("review");
    setActionError("");
    setMessage("");
    setReview(null);
    try {
      const result = await onCleanup(selected, true);
      setReview(result);
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "선택 항목을 검토하지 못했습니다.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function removeSelected() {
    if (!confirmed) return;
    setWorking("delete");
    setActionError("");
    setMessage("");
    try {
      const result = await onCleanup(selected, false);
      setReview(result);
      const deleted = result.results.filter((item) => item.deleted);
      const protectedCount = result.results.length - deleted.length;
      setMessage(
        `${deleted.length}개 항목을 삭제해 ${formatBytes(
          result.reclaimedBytes,
        )}를 확보했습니다.${
          protectedCount
            ? ` 실행 직전 보호된 ${protectedCount}개 항목은 유지했습니다.`
            : ""
        }`,
      );
      setSelected([]);
      setConfirmation("");
      setAcknowledged(false);
      onRefresh();
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "선택 항목을 삭제하지 못했습니다.",
      );
    } finally {
      setWorking(null);
    }
  }

  return (
    <section
      aria-labelledby="storage-dashboard-title"
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-violet-300" />
            <h2 id="storage-dashboard-title" className="text-[15px] font-semibold">
              저장 공간
            </h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            서버가 관리하는 파일을 오래된 순서로 보여줍니다. 작업·프로필·모델
            팩이 참조하는 항목은 보호되며 선택할 수 없습니다.
          </p>
        </div>
        <div className="flex items-start gap-3">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">관리 데이터 합계</p>
            <p className="mt-0.5 text-sm font-semibold">
              {formatBytes(inventory?.totalBytes)}
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={onRefresh}
            disabled={loading || working !== null}
            aria-label="저장 공간 새로고침"
          >
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-4 flex gap-2 rounded-lg border border-red-400/20 bg-red-400/[0.06] p-3 text-xs text-red-100"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-300" />
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(inventory?.categories ?? []).map((category) => {
          const details = KIND_DETAILS[category.kind];
          const Icon = details.icon;
          return (
            <div
              key={category.kind}
              className="rounded-lg border border-border/65 bg-background/30 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-xs font-medium">
                  <Icon className="size-3.5 text-muted-foreground" />
                  {details.label}
                </span>
                <Badge variant="secondary">
                  {category.itemCount.toLocaleString()}개
                </Badge>
              </div>
              <p className="mt-2 text-sm font-semibold">
                {formatBytes(category.byteSize)}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-medium">개별 항목</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            오래된 항목부터 표시 · {selected.length}/{MAX_SELECTION}개 선택 ·{" "}
            {formatBytes(selectedBytes)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              resetReview();
              setSelected([]);
            }}
            disabled={!selected.length || working !== null}
          >
            선택 해제
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={selectEligible}
            disabled={
              loading ||
              working !== null ||
              !sortedItems.some((item) => item.cleanupEligible)
            }
          >
            오래된 정리 가능 항목 선택
          </Button>
        </div>
      </div>

      <div className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
        {loading && !inventory ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-border/60 p-8 text-xs text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            저장 공간을 확인하고 있습니다.
          </div>
        ) : sortedItems.length ? (
          sortedItems.map((item) => {
            const checked = selectedKeys.has(targetKey(item));
            const details = KIND_DETAILS[item.kind];
            return (
              <label
                key={targetKey(item)}
                className={cn(
                  "flex gap-3 rounded-lg border p-3 transition-colors",
                  item.cleanupEligible
                    ? "cursor-pointer border-border/65 bg-background/30 hover:bg-background/45"
                    : "cursor-not-allowed border-border/45 bg-background/15",
                  checked && "border-red-400/25 bg-red-400/[0.05]",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-pink-500"
                  checked={checked}
                  disabled={!item.cleanupEligible || working !== null}
                  onChange={() => toggle(item)}
                  aria-label={`${item.name} 선택`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">
                        {item.name}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                        <span>{formatBytes(item.byteSize)}</span>
                        <span>{formatDate(item.createdAt)}</span>
                      </span>
                    </span>
                    <Badge
                      variant={item.cleanupEligible ? "secondary" : "outline"}
                    >
                      {!item.cleanupEligible ? (
                        <LockKeyhole className="size-3" />
                      ) : null}
                      {details.itemLabel}
                      {item.cleanupEligible ? " · 정리 가능" : " · 보호"}
                    </Badge>
                  </span>
                  {item.cleanupReason ? (
                    <span className="mt-2 block rounded-md bg-amber-400/[0.06] px-2 py-1.5 text-[10px] leading-4 text-amber-100/75">
                      {item.cleanupReason}
                    </span>
                  ) : null}
                  {item.dependencies.length ? (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {item.dependencies.map((dependency) => (
                        <Badge
                          key={`${dependency.kind}:${dependency.id}`}
                          variant="outline"
                          title={dependency.id}
                        >
                          {dependencyKindLabel(dependency.kind)} ·{" "}
                          {dependency.label}
                        </Badge>
                      ))}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-border/60 p-8 text-center text-xs text-muted-foreground">
            관리 중인 파일이 없습니다.
          </div>
        )}
      </div>

      {actionError ? (
        <p
          role="alert"
          className="mt-4 flex items-center gap-2 text-xs text-red-200"
        >
          <AlertTriangle className="size-4 shrink-0" />
          {actionError}
        </p>
      ) : null}

      {review ? (
        <div
          className={cn(
            "mt-4 rounded-lg border p-4",
            review.dryRun
              ? "border-amber-400/20 bg-amber-400/[0.05]"
              : "border-emerald-400/20 bg-emerald-400/[0.05]",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium">
              {review.dryRun ? "삭제 전 검토 결과" : "정리 결과"}
            </p>
            <span className="text-[10px] text-muted-foreground">
              {reviewedEligible.length}개 정리 가능 · {reviewedProtected.length}
              개 보호
            </span>
          </div>

          {reviewedProtected.length ? (
            <div className="mt-3 rounded-md border border-amber-400/20 bg-amber-400/[0.06] p-3">
              <p className="flex items-center gap-2 text-[11px] font-medium text-amber-100">
                <LockKeyhole className="size-3.5" />
                검토 중 보호된 항목은 삭제하지 않습니다
              </p>
              <ul className="mt-2 space-y-1 text-[10px] leading-4 text-amber-100/70">
                {reviewedProtected.map((item) => (
                  <li key={targetKey(item)}>
                    {KIND_DETAILS[item.kind].itemLabel} · {item.id}
                    {item.reason ? ` — ${item.reason}` : ""}
                    {item.dependencies.length
                      ? ` (${item.dependencies
                          .map((dependency) => dependency.label)
                          .join(", ")})`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {review.dryRun ? (
            <>
              <p className="mt-3 text-[10px] leading-4 text-amber-100/70">
                정리 가능한 {reviewedEligible.length}개 항목, 약{" "}
                {formatBytes(
                  reviewedEligible.reduce(
                    (total, item) => total + item.byteSize,
                    0,
                  ),
                )}
                를 삭제합니다. 이 작업은 자동 복구되지 않습니다.
              </p>
              <label className="mt-3 flex items-start gap-2 text-[11px] text-amber-100/80">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-red-400"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                검토 결과와 보호 항목, 복구 불가 여부를 확인했습니다.
              </label>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder='계속하려면 "삭제" 입력'
                  aria-label="삭제 확인 문구"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={!confirmed || working !== null}
                  onClick={() => void removeSelected()}
                >
                  {working === "delete" ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Trash2 />
                  )}
                  선택 항목 삭제
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={resetReview}
                  disabled={working !== null}
                >
                  취소
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Archive className="size-3.5" />
            {selected.length
              ? `${selected.length}개 항목을 서버에서 먼저 검토합니다.`
              : "정리 가능한 개별 항목을 선택하세요."}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!selected.length || working !== null}
            onClick={() => void reviewSelected()}
          >
            {working === "review" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Trash2 />
            )}
            선택 항목 검토
          </Button>
        </div>
      )}

      {message ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-emerald-200">
          <CheckCircle2 className="size-4 shrink-0" />
          {message}
        </p>
      ) : null}
    </section>
  );
}

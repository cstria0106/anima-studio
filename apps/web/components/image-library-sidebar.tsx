"use client";

import * as React from "react";
import Image from "next/image";
import {
  ChevronDown,
  ChevronRight,
  ChevronsUp,
  Dices,
  Download,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Images,
  Inbox,
  LoaderCircle,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
  Search,
  Settings2,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { HistoryDetailDialog } from "@/components/history-view";
import { UpscaleSettingsDialog } from "@/components/upscale-settings-dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  createLibraryFolder,
  deleteLibraryFolder,
  deleteLibraryImages,
  getJob,
  getLibraryFolders,
  getLibraryImages,
  moveLibraryImages,
  updateLibraryFolder,
  upscaleJob,
} from "@/lib/api";
import {
  selectLibraryContextTarget,
  selectLibraryItem,
} from "@/lib/library-selection";
import {
  DEFAULT_DRAFT,
  type GenerationDraft,
  type LibraryFolder,
  type LibraryImage,
  type StudioJob,
} from "@/lib/types";
import { cn, formatDate, outputUrl } from "@/lib/utils";

type FolderView = "all" | "unfiled" | string;
type DragPayload =
  | { type: "images"; ids: string[]; imageId: string }
  | { type: "folder"; ids: string[]; folderId: string };

interface HistoryViewProps {
  onLoadSettings: (settings: GenerationDraft) => void;
  onLoadSeed: (seed: number) => void;
  onTrackJob: (job: StudioJob) => void;
  activeJob?: StudioJob | null;
  trackedJobs?: StudioJob[];
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  desktopCollapsed: boolean;
  onDesktopCollapsedChange: (collapsed: boolean) => void;
  desktopWidth: number;
  onDesktopWidthChange: (width: number, commit: boolean) => void;
  detailRequest?: {
    id: number;
    job: StudioJob;
    outputId?: string;
  } | null;
  onRepeatJob?: (job: StudioJob) => Promise<void>;
  onDeleteJob?: (jobId: string) => void;
}

interface VisibleFolder extends LibraryFolder {
  depth: number;
  hasChildren: boolean;
}

function visibleFolders(
  folders: LibraryFolder[],
  expanded: ReadonlySet<string>,
): VisibleFolder[] {
  const children = new Map<string | null, LibraryFolder[]>();
  for (const folder of folders) {
    const group = children.get(folder.parentId) ?? [];
    group.push(folder);
    children.set(folder.parentId, group);
  }
  for (const group of children.values()) {
    group.sort((left, right) =>
      left.name.localeCompare(right.name, "ko", { sensitivity: "base" }),
    );
  }
  const result: VisibleFolder[] = [];
  const stack = [...(children.get(null) ?? [])]
    .reverse()
    .map((folder) => ({ folder, depth: 0 }));
  while (stack.length > 0) {
    const next = stack.pop()!;
    const nested = children.get(next.folder.id) ?? [];
    result.push({
      ...next.folder,
      depth: next.depth,
      hasChildren: nested.length > 0,
    });
    if (expanded.has(next.folder.id)) {
      for (let index = nested.length - 1; index >= 0; index -= 1) {
        stack.push({ folder: nested[index]!, depth: next.depth + 1 });
      }
    }
  }
  return result;
}

function folderDescendantCount(folders: LibraryFolder[], id: string): number {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    const group = children.get(folder.parentId) ?? [];
    group.push(folder.id);
    children.set(folder.parentId, group);
  }
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(children.get(next) ?? []));
  }
  return seen.size;
}

function folderIsWithin(
  folders: LibraryFolder[],
  rootId: string,
  candidateId: string,
): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let currentId: string | null = candidateId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    if (currentId === rootId) return true;
    seen.add(currentId);
    currentId = byId.get(currentId)?.parentId ?? null;
  }
  return false;
}

function clampSidebarWidth(value: number): number {
  return Math.min(560, Math.max(280, Math.round(value)));
}

export function HistoryView({
  onLoadSettings,
  onLoadSeed,
  onTrackJob,
  trackedJobs = [],
  mobileOpen,
  onMobileOpenChange,
  desktopCollapsed,
  onDesktopCollapsedChange,
  desktopWidth,
  onDesktopWidthChange,
  detailRequest,
}: HistoryViewProps) {
  const [folders, setFolders] = React.useState<LibraryFolder[]>([]);
  const [images, setImages] = React.useState<LibraryImage[]>([]);
  const [view, setView] = React.useState<FolderView>("all");
  const [query, setQuery] = React.useState("");
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState("");
  const [expandedIds, setExpandedIds] = React.useState<string[]>([]);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [anchorId, setAnchorId] = React.useState<string | null>(null);
  const [detailJob, setDetailJob] = React.useState<StudioJob | null>(null);
  const [activeOutputId, setActiveOutputId] = React.useState("");
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState("");
  const [actionNotice, setActionNotice] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [deleteIds, setDeleteIds] = React.useState<string[]>([]);
  const [upscaleTarget, setUpscaleTarget] = React.useState<{
    job: StudioJob;
    outputId: string;
  } | null>(null);
  const [folderDelete, setFolderDelete] = React.useState<LibraryFolder | null>(
    null,
  );
  const [folderEdit, setFolderEdit] = React.useState<{
    mode: "create" | "rename";
    parentId: string | null;
    folder?: LibraryFolder;
  } | null>(null);
  const [folderName, setFolderName] = React.useState("");
  const [folderSaving, setFolderSaving] = React.useState(false);
  const [menu, setMenu] = React.useState<{
    type: "image" | "folder";
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [dragging, setDragging] = React.useState<DragPayload | null>(null);
  const [touchPoint, setTouchPoint] = React.useState<{ x: number; y: number } | null>(
    null,
  );
  const [dropKey, setDropKey] = React.useState("");
  const requestId = React.useRef(0);
  const suppressClick = React.useRef(false);
  const touchTimer = React.useRef<number | null>(null);
  const touchPointerId = React.useRef<number | null>(null);
  const touchActive = React.useRef(false);
  const expandTimer = React.useRef<{ key: string; timer: number } | null>(null);
  const detailRequestId = React.useRef(0);
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const expandedSet = React.useMemo(() => new Set(expandedIds), [expandedIds]);
  const tree = React.useMemo(
    () => visibleFolders(folders, expandedSet),
    [expandedSet, folders],
  );

  const clearSelection = React.useCallback(() => {
    setSelectedIds([]);
    setAnchorId(null);
  }, []);

  const loadFolders = React.useCallback(async () => {
    setFolders(await getLibraryFolders());
  }, []);

  const loadImages = React.useCallback(
    async (cursor = "") => {
      const currentRequest = ++requestId.current;
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      setError("");
      try {
        const result = await getLibraryImages({
          folder: view,
          ...(query.trim() ? { query: query.trim() } : {}),
          ...(cursor ? { cursor } : {}),
        });
        if (currentRequest !== requestId.current) return;
        setImages((current) =>
          cursor
            ? [
                ...current,
                ...result.images.filter(
                  (image) => !current.some((item) => item.id === image.id),
                ),
              ]
            : result.images,
        );
        setNextCursor(result.nextCursor);
      } catch (loadError) {
        if (currentRequest !== requestId.current) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "이미지 라이브러리를 불러오지 못했습니다.",
        );
      } finally {
        if (currentRequest === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [query, view],
  );

  React.useEffect(() => {
    void loadFolders().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "폴더를 불러오지 못했습니다.");
    });
  }, [loadFolders]);

  React.useEffect(() => {
    clearSelection();
    const timer = window.setTimeout(() => void loadImages(), 180);
    return () => window.clearTimeout(timer);
  }, [clearSelection, loadImages]);

  const completedFingerprint = trackedJobs
    .filter((job) => job.status === "completed")
    .flatMap((job) => job.outputs.map((output) => output.id))
    .sort()
    .join("|");
  React.useEffect(() => {
    if (!completedFingerprint) return;
    void Promise.all([loadImages(), loadFolders()]);
  }, [completedFingerprint, loadFolders, loadImages]);

  React.useEffect(() => {
    if (!detailRequest || detailRequest.id === detailRequestId.current) return;
    detailRequestId.current = detailRequest.id;
    setDetailJob(detailRequest.job);
    setActiveOutputId(
      detailRequest.outputId ?? detailRequest.job.outputs[0]?.id ?? "",
    );
  }, [detailRequest]);

  React.useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const openImage = React.useCallback(async (image: LibraryImage) => {
    setDetailLoading(true);
    setActionError("");
    setActionNotice("");
    setActiveOutputId(image.id);
    try {
      setDetailJob(await getJob(image.jobId));
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : "생성 상세를 불러오지 못했습니다.",
      );
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function selectImage(
    imageId: string,
    event: Pick<React.MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">,
  ) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const next = selectLibraryItem(
      { selectedIds, anchorId },
      images.map((image) => image.id),
      imageId,
      { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey },
    );
    setSelectedIds(next.selectedIds);
    setAnchorId(next.anchorId);
  }

  function contextImage(image: LibraryImage, x: number, y: number) {
    const next = selectLibraryContextTarget(
      { selectedIds, anchorId },
      image.id,
    );
    setSelectedIds(next.selectedIds);
    setAnchorId(next.anchorId);
    setMenu({ type: "image", id: image.id, x, y });
  }

  function downloadImages(targetIds: string[]) {
    setMenu(null);
    const query = new URLSearchParams();
    for (const id of targetIds) query.append("id", id);
    const anchor = document.createElement("a");
    anchor.href = `/api/library/images/download?${query}`;
    anchor.click();
  }

  async function runImageAction(
    image: LibraryImage,
    action: (job: StudioJob) => void,
  ) {
    setMenu(null);
    setError("");
    try {
      action(await getJob(image.jobId));
    } catch (actionFailure) {
      setError(
        actionFailure instanceof Error
          ? actionFailure.message
          : "이미지 작업을 실행하지 못했습니다.",
      );
    }
  }

  function openUpscale(job: StudioJob, image: LibraryImage) {
    const output = job.outputs.find((item) => item.id === image.id);
    if (
      job.status !== "completed" ||
      job.settings.upscale.enabled ||
      output?.kind !== "base"
    ) {
      throw new Error("이 이미지는 업스케일할 수 없습니다.");
    }
    setUpscaleTarget({ job, outputId: image.id });
  }

  const refreshLibrary = React.useCallback(async () => {
    await Promise.all([loadImages(), loadFolders()]);
  }, [loadFolders, loadImages]);

  async function performDeleteImages(targetIds: string[]) {
    setDeleting(true);
    setError("");
    try {
      const result = await deleteLibraryImages(targetIds);
      const deleted = new Set(result.deletedIds);
      setImages((current) => current.filter((image) => !deleted.has(image.id)));
      setSelectedIds((current) => current.filter((id) => !deleted.has(id)));
      if (detailJob && deleted.has(activeOutputId)) {
        const remaining = detailJob.outputs.filter(
          (output) => !deleted.has(output.id),
        );
        setDetailJob(remaining.length ? { ...detailJob, outputs: remaining } : null);
        setActiveOutputId(remaining[0]?.id ?? "");
      }
      setDeleteIds([]);
      await loadFolders();
      return result.deletedIds.length > 0;
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "이미지를 삭제하지 못했습니다.",
      );
      return false;
    } finally {
      setDeleting(false);
    }
  }

  async function confirmDeleteImages() {
    return performDeleteImages(deleteIds);
  }

  async function saveFolder() {
    if (!folderEdit) return;
    setFolderSaving(true);
    setError("");
    try {
      if (folderEdit.mode === "create") {
        const created = await createLibraryFolder(folderName, folderEdit.parentId);
        if (created.parentId) {
          setExpandedIds((current) => [...new Set([...current, created.parentId!])]);
        }
      } else if (folderEdit.folder) {
        await updateLibraryFolder(folderEdit.folder.id, { name: folderName });
      }
      setFolderEdit(null);
      setFolderName("");
      await loadFolders();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "폴더를 저장하지 못했습니다.",
      );
    } finally {
      setFolderSaving(false);
    }
  }

  async function confirmDeleteFolder() {
    if (!folderDelete) return;
    setFolderSaving(true);
    setError("");
    try {
      await deleteLibraryFolder(folderDelete.id);
      const removedCurrentView =
        view !== "all" &&
        view !== "unfiled" &&
        folderIsWithin(folders, folderDelete.id, view);
      if (removedCurrentView) {
        setView("unfiled");
      }
      setFolderDelete(null);
      await loadFolders();
      if (!removedCurrentView) await loadImages();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "폴더를 삭제하지 못했습니다.",
      );
    } finally {
      setFolderSaving(false);
    }
  }

  const drop = React.useCallback(async (payload: DragPayload, target: string) => {
    setError("");
    try {
      if (payload.type === "images") {
        if (target === "root" || target === "all") return;
        const folderId = target === "unfiled" ? null : target;
        await moveLibraryImages(payload.ids, folderId);
        clearSelection();
      } else {
        if (target === "unfiled" || target === "all") return;
        const parentId = target === "root" ? null : target;
        if (parentId === payload.folderId) return;
        if (
          parentId &&
          folderIsWithin(folders, payload.folderId, parentId)
        ) {
          setError("폴더를 자기 자신이나 하위 폴더 안으로 이동할 수 없습니다.");
          return;
        }
        await updateLibraryFolder(payload.folderId, { parentId });
      }
      await refreshLibrary();
    } catch (dropError) {
      setError(
        dropError instanceof Error ? dropError.message : "항목을 이동하지 못했습니다.",
      );
    }
  }, [clearSelection, folders, refreshLibrary]);

  function startImageDrag(image: LibraryImage): DragPayload {
    const ids = selectedSet.has(image.id) ? selectedIds : [image.id];
    if (!selectedSet.has(image.id)) {
      setSelectedIds([image.id]);
      setAnchorId(image.id);
    }
    const payload: DragPayload = { type: "images", ids, imageId: image.id };
    setDragging(payload);
    return payload;
  }

  function startFolderDrag(folderId: string): DragPayload {
    const payload: DragPayload = { type: "folder", ids: [folderId], folderId };
    setDragging(payload);
    return payload;
  }

  function beginTouch(event: React.PointerEvent, payload: () => DragPayload) {
    if (event.pointerType !== "touch") return;
    if (touchTimer.current !== null) window.clearTimeout(touchTimer.current);
    touchPointerId.current = event.pointerId;
    const point = { x: event.clientX, y: event.clientY };
    touchTimer.current = window.setTimeout(() => {
      touchTimer.current = null;
      touchActive.current = true;
      suppressClick.current = true;
      setDragging(payload());
      setTouchPoint(point);
      navigator.vibrate?.(20);
    }, 280);
  }

  const scheduleExpand = React.useCallback((key: string) => {
    if (
      key === "root" ||
      key === "all" ||
      key === "unfiled" ||
      expandedSet.has(key) ||
      expandTimer.current?.key === key
    ) {
      return;
    }
    if (expandTimer.current) window.clearTimeout(expandTimer.current.timer);
    expandTimer.current = {
      key,
      timer: window.setTimeout(() => {
        setExpandedIds((current) => [...new Set([...current, key])]);
        expandTimer.current = null;
      }, 450),
    };
  }, [expandedSet]);

  const cancelScheduledExpand = React.useCallback((key?: string) => {
    if (!expandTimer.current || (key && expandTimer.current.key !== key)) return;
    window.clearTimeout(expandTimer.current.timer);
    expandTimer.current = null;
  }, []);

  React.useEffect(() => {
    if (!dragging || touchPointerId.current === null) return;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== touchPointerId.current) return;
      event.preventDefault();
      setTouchPoint({ x: event.clientX, y: event.clientY });
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-library-drop]");
      const key = target?.dataset.libraryDrop ?? "";
      setDropKey(key);
      if (key) scheduleExpand(key);
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== touchPointerId.current) return;
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-library-drop]");
      const key = target?.dataset.libraryDrop;
      if (key) void drop(dragging, key);
      setDragging(null);
      setTouchPoint(null);
      setDropKey("");
      cancelScheduledExpand();
      touchPointerId.current = null;
      touchActive.current = false;
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [cancelScheduledExpand, dragging, drop, scheduleExpand]);

  function cancelTouch() {
    if (touchTimer.current !== null) {
      window.clearTimeout(touchTimer.current);
      touchTimer.current = null;
    }
    if (!touchActive.current) touchPointerId.current = null;
  }

  function dropProps(key: string) {
    return {
      "data-library-drop": key,
      onDragOver: (event: React.DragEvent) => {
        if (!dragging) return;
        event.preventDefault();
        setDropKey(key);
        scheduleExpand(key);
      },
      onDragLeave: () => {
        cancelScheduledExpand(key);
        setDropKey((current) => (current === key ? "" : current));
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        if (dragging) void drop(dragging, key);
        setDragging(null);
        setDropKey("");
        cancelScheduledExpand();
      },
    };
  }

  function openFolderMenu(folder: LibraryFolder, x: number, y: number) {
    setMenu({ type: "folder", id: folder.id, x, y });
  }

  function openFolderEditor(
    mode: "create" | "rename",
    parentId: string | null,
    folder?: LibraryFolder,
  ) {
    setFolderEdit({ mode, parentId, ...(folder ? { folder } : {}) });
    setFolderName(folder?.name ?? "");
    setMenu(null);
  }

  function folderTree() {
    return (
      <div className="border-b border-border bg-background/98">
        <div
          {...dropProps("root")}
          className={cn(
            "flex h-10 items-center gap-1 px-2",
            dropKey === "root" && dragging?.type === "folder" && "bg-primary/15",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 px-1.5 text-xs font-medium">
            <FolderOpen className="size-3.5" />
            폴더
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setExpandedIds([])}
            aria-label="모든 폴더 접기"
            title="모든 폴더 접기"
          >
            <ChevronsUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => openFolderEditor("create", null)}
            aria-label="새 폴더"
          >
            <FolderPlus />
          </Button>
        </div>
        <div className="max-h-[38dvh] overflow-y-auto px-2 pb-2" role="tree">
            <button
              type="button"
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-accent",
                view === "all" && "bg-accent text-foreground",
              )}
              onClick={() => setView("all")}
            >
              <Images className="size-3.5" />
              <span className="flex-1 truncate">모든 이미지</span>
              <span className="text-[10px] text-muted-foreground">
                {folders.reduce((sum, folder) => sum + folder.directImageCount, 0)}
              </span>
            </button>
            <button
              type="button"
              {...dropProps("unfiled")}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-accent",
                view === "unfiled" && "bg-accent text-foreground",
                dropKey === "unfiled" && dragging?.type === "images" && "bg-primary/20",
              )}
              onClick={() => setView("unfiled")}
            >
              <Inbox className="size-3.5" />
              <span className="flex-1 truncate">미분류</span>
            </button>
            {tree.map((folder) => {
              const expanded = expandedSet.has(folder.id);
              return (
                <div
                  key={folder.id}
                  role="treeitem"
                  aria-level={folder.depth + 1}
                  aria-expanded={folder.hasChildren ? expanded : undefined}
                  aria-selected={view === folder.id}
                  draggable
                  {...dropProps(folder.id)}
                  onDragStart={(event) => {
                    const payload = startFolderDrag(folder.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropKey("");
                    cancelScheduledExpand();
                  }}
                  onPointerDown={(event) =>
                    beginTouch(event, () => startFolderDrag(folder.id))
                  }
                  onPointerUp={cancelTouch}
                  onPointerCancel={cancelTouch}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openFolderMenu(folder, event.clientX, event.clientY);
                  }}
                  className={cn(
                    "relative flex h-8 items-center rounded-md text-xs hover:bg-accent",
                    view === folder.id && "bg-accent text-foreground",
                    dropKey === folder.id && "bg-primary/20",
                  )}
                  style={{ paddingLeft: Math.min(folder.depth, 10) * 12 }}
                  title={folder.name}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left"
                    onClick={() => setView(folder.id)}
                  >
                    {view === folder.id ? (
                      <FolderOpen className="size-3.5 shrink-0" />
                    ) : (
                      <Folder className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate">{folder.name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {folder.totalImageCount}
                    </span>
                  </button>
                  {folder.hasChildren ? (
                    <button
                      type="button"
                      className="mr-1 grid size-6 shrink-0 place-items-center rounded hover:bg-background/60"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedIds((current) =>
                          current.includes(folder.id)
                            ? current.filter((id) => id !== folder.id)
                            : [...current, folder.id],
                        );
                      }}
                      aria-label={expanded ? "하위 폴더 접기" : "하위 폴더 펼치기"}
                    >
                      {expanded ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
      </div>
    );
  }

  function imageGrid() {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border p-3">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 pl-8 text-xs"
                placeholder="프롬프트, 모델, 시드, 파일명"
                aria-label="이미지 검색"
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-9"
              disabled={loading}
              onClick={() => void refreshLibrary()}
              aria-label="라이브러리 새로고침"
            >
              <RefreshCw className={cn(loading && "animate-spin")} />
            </Button>
          </div>
          {selectedIds.length ? (
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{selectedIds.length}개 선택됨</span>
              <button type="button" className="hover:text-foreground" onClick={clearSelection}>
                선택 해제
              </button>
            </div>
          ) : null}
          {error ? <p className="mt-2 text-[11px] text-red-300">{error}</p> : null}
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto p-3 pb-14"
          onClick={(event) => {
            if (event.target === event.currentTarget) clearSelection();
          }}
          onScroll={(event) => {
            if (!nextCursor || loadingMore) return;
            const target = event.currentTarget;
            if (target.scrollHeight - target.scrollTop - target.clientHeight < 220) {
              void loadImages(nextCursor);
            }
          }}
        >
          {loading ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="aspect-[4/5] animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : images.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
              {images.map((image) => {
                const selected = selectedSet.has(image.id);
                return (
                  <div
                    key={image.id}
                    draggable
                    tabIndex={0}
                    className={cn(
                      "group relative min-w-0 overflow-hidden rounded-xl border bg-card/80 text-left outline-none transition",
                      selected
                        ? "border-primary ring-2 ring-primary/35"
                        : "border-white/[0.09] hover:border-primary/40",
                    )}
                    onClick={(event) => selectImage(image.id, event)}
                    onDoubleClick={() => void openImage(image)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void openImage(image);
                      if (event.key === "Delete") {
                        const next = selectLibraryContextTarget(
                          { selectedIds, anchorId },
                          image.id,
                        );
                        setDeleteIds(next.selectedIds);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      contextImage(image, event.clientX, event.clientY);
                    }}
                    onDragStart={(event) => {
                      const payload = startImageDrag(image);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", JSON.stringify(payload));
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropKey("");
                      cancelScheduledExpand();
                    }}
                    onPointerDown={(event) =>
                      beginTouch(event, () => startImageDrag(image))
                    }
                    onPointerUp={cancelTouch}
                    onPointerCancel={cancelTouch}
                    aria-selected={selected}
                  >
                    <div className="relative aspect-[4/5] overflow-hidden bg-muted">
                      <Image
                        src={outputUrl(image.url)}
                        alt={image.filename}
                        fill
                        sizes="180px"
                        className="object-cover"
                        draggable={false}
                      />
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-2.5 pb-2 pt-8 text-[10px] text-white/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.9)]">
                        {formatDate(image.createdAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-12 text-center text-xs text-muted-foreground">
              {query ? "검색 결과가 없습니다." : "이 폴더에 이미지가 없습니다."}
            </div>
          )}
          {loadingMore ? (
            <div className="flex justify-center py-4 text-muted-foreground">
              <LoaderCircle className="animate-spin" />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const content = (
    <div className="flex h-full min-h-0 flex-col bg-background/95">
      {folderTree()}
      {imageGrid()}
    </div>
  );

  const menuFolder = menu?.type === "folder" ? folders.find((f) => f.id === menu.id) : null;
  const menuImageIds =
    menu?.type === "image"
      ? selectedSet.has(menu.id)
        ? selectedIds
        : [menu.id]
      : [];
  const menuImage =
    menuImageIds.length === 1
      ? images.find((image) => image.id === menuImageIds[0]) ?? null
      : null;

  return (
    <>
      <aside
        className={cn(
          "glass-surface fixed inset-y-0 left-0 z-40 hidden border-r border-border transition-transform duration-200 xl:block",
          desktopCollapsed && "-translate-x-full",
        )}
        style={{ width: desktopWidth }}
      >
        {content}
        <div
          role="separator"
          aria-label="라이브러리 사이드바 너비 조절"
          aria-orientation="vertical"
          tabIndex={0}
          className="absolute inset-y-0 -right-1 z-50 w-2 cursor-col-resize outline-none hover:bg-primary/30 focus:bg-primary/40"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const startX = event.clientX;
            const startWidth = desktopWidth;
            const handle = event.currentTarget;
            const move = (moveEvent: PointerEvent) => {
              onDesktopWidthChange(
                clampSidebarWidth(startWidth + moveEvent.clientX - startX),
                false,
              );
            };
            const finish = (upEvent: PointerEvent) => {
              const width = clampSidebarWidth(startWidth + upEvent.clientX - startX);
              onDesktopWidthChange(width, true);
              handle.removeEventListener("pointermove", move);
              handle.removeEventListener("pointerup", finish);
              handle.removeEventListener("pointercancel", finish);
            };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", finish);
            handle.addEventListener("pointercancel", finish);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const amount = event.shiftKey ? 32 : 16;
            const next = clampSidebarWidth(
              desktopWidth + (event.key === "ArrowRight" ? amount : -amount),
            );
            onDesktopWidthChange(next, true);
          }}
        />
      </aside>

      <Button
        type="button"
        size="icon"
        variant="outline"
        className="fixed bottom-4 left-4 z-40 hidden size-10 rounded-full bg-background shadow-lg xl:inline-flex"
        onClick={() => onDesktopCollapsedChange(!desktopCollapsed)}
        aria-label={desktopCollapsed ? "라이브러리 펼치기" : "라이브러리 접기"}
      >
        {desktopCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      </Button>

      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent
          aria-describedby={undefined}
          side="left"
          className="w-[min(100vw,400px)] p-0 sm:max-w-[400px] xl:hidden"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>이미지 라이브러리</SheetTitle>
          </SheetHeader>
          {content}
        </SheetContent>
      </Sheet>

      {menu ? (
        <div
          role="menu"
          className="fixed z-[100] min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl [&_svg]:size-3.5 [&_svg]:shrink-0"
          style={{
            left: Math.max(8, Math.min(menu.x, window.innerWidth - 180)),
            top: Math.max(8, Math.min(menu.y, window.innerHeight - 330)),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {menu.type === "image" ? (
            <>
              {menuImage ? (
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    setMenu(null);
                    void openImage(menuImage);
                  }}
                >
                  <SquareArrowOutUpRight /> 열기
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent"
                onClick={() =>
                  downloadImages(selectedSet.has(menu.id) ? selectedIds : [menu.id])
                }
              >
                <Download /> 이미지 저장
              </button>
              {menuImage ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent"
                    onClick={() =>
                      void runImageAction(menuImage, (job) =>
                        onLoadSettings(structuredClone(job.settings)),
                      )
                    }
                  >
                    <Settings2 /> 설정 불러오기
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent"
                    onClick={() =>
                      void runImageAction(menuImage, (job) =>
                        onLoadSeed(job.settings.sampling.seed),
                      )
                    }
                  >
                    <Dices /> 시드 불러오기
                  </button>
                  {menuImage.kind === "base" ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent"
                      onClick={() =>
                        void runImageAction(menuImage, (job) =>
                          openUpscale(job, menuImage),
                        )
                      }
                    >
                      <Maximize2 /> 업스케일
                    </button>
                  ) : null}
                </>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-red-300 hover:bg-accent"
                onClick={() => {
                  setDeleteIds(selectedSet.has(menu.id) ? selectedIds : [menu.id]);
                  setMenu(null);
                }}
              >
                <Trash2 /> 삭제
              </button>
            </>
          ) : menuFolder ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent"
                onClick={() => openFolderEditor("create", menuFolder.id)}
              >
                <FolderPlus /> 하위 폴더 만들기
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent"
                onClick={() => openFolderEditor("rename", menuFolder.parentId, menuFolder)}
              >
                <Pencil /> 이름 변경
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-red-300 hover:bg-accent"
                onClick={() => {
                  setFolderDelete(menuFolder);
                  setMenu(null);
                }}
              >
                <Trash2 /> 삭제
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {dragging && touchPoint ? (
        <div
          className="pointer-events-none fixed z-[110] flex items-center gap-2 rounded-lg border border-primary/50 bg-background/95 px-3 py-2 text-xs shadow-xl"
          style={{ left: touchPoint.x + 12, top: touchPoint.y + 12 }}
        >
          <GripVertical />
          {dragging.type === "images" ? `${dragging.ids.length}개 이미지` : "폴더"}
        </div>
      ) : null}

      <HistoryDetailDialog
        job={detailJob}
        detailLoading={detailLoading}
        activeOutputId={activeOutputId}
        actionError={actionError}
        actionNotice={actionNotice}
        deleting={deleting}
        onOpenChange={(open) => {
          if (!open) setDetailJob(null);
        }}
        onOutputChange={setActiveOutputId}
        onLoadSettings={onLoadSettings}
        onLoadSeed={onLoadSeed}
        onUpscale={async (job, settings, outputId) => {
          setActionError("");
          try {
            const nextJob = await upscaleJob(job.id, settings, outputId);
            onTrackJob(nextJob);
            setActionNotice("업스케일 작업을 시작했습니다.");
          } catch (upscaleError) {
            setActionError(
              upscaleError instanceof Error
                ? upscaleError.message
                : "업스케일을 시작하지 못했습니다.",
            );
          }
        }}
        onDelete={(outputId) => performDeleteImages([outputId])}
      />

      <UpscaleSettingsDialog
        open={Boolean(upscaleTarget)}
        initialSettings={
          upscaleTarget?.job.settings.upscale ?? DEFAULT_DRAFT.upscale
        }
        onOpenChange={(open) => {
          if (!open) setUpscaleTarget(null);
        }}
        onSubmit={async (settings) => {
          if (!upscaleTarget) return;
          const nextJob = await upscaleJob(
            upscaleTarget.job.id,
            settings,
            upscaleTarget.outputId,
          );
          onTrackJob(nextJob);
        }}
      />

      <AlertDialog open={deleteIds.length > 0} onOpenChange={(open) => !open && setDeleteIds([])}>
        <AlertDialogContent className="max-w-md border-destructive/30">
          <AlertDialogHeader>
            <AlertDialogTitle>선택한 이미지 {deleteIds.length}개를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              복구할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDeleteImages()}
            >
              {deleting ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              {deleting ? "삭제 중" : "삭제"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(folderEdit)} onOpenChange={(open) => !open && setFolderEdit(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{folderEdit?.mode === "rename" ? "폴더 이름 변경" : "새 폴더"}</DialogTitle>
            <DialogDescription>같은 위치에서 중복되지 않는 이름을 입력하세요.</DialogDescription>
          </DialogHeader>
          <Input
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && folderName.trim()) void saveFolder();
            }}
            autoFocus
            maxLength={80}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFolderEdit(null)}>
              취소
            </Button>
            <Button type="button" disabled={!folderName.trim() || folderSaving} onClick={() => void saveFolder()}>
              {folderSaving ? <LoaderCircle className="animate-spin" /> : null}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(folderDelete)} onOpenChange={(open) => !open && setFolderDelete(null)}>
        <AlertDialogContent className="max-w-md border-destructive/30">
          <AlertDialogHeader>
            <AlertDialogTitle>{folderDelete?.name} 폴더를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              하위 폴더 {folderDelete ? folderDescendantCount(folders, folderDelete.id) : 0}개를 삭제하고 이미지 {folderDelete?.totalImageCount ?? 0}개는 미분류로 이동합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={folderSaving}>취소</AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={folderSaving} onClick={() => void confirmDeleteFolder()}>
              {folderSaving ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              폴더 삭제
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

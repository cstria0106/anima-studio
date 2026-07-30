"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileJson,
  HardDriveDownload,
  Image as ImageIcon,
  LoaderCircle,
  Package,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  PortableImportIssue,
  PortableImportPreview,
} from "@/lib/types";

const MAX_IMPORT_BYTES = 96 * 1024 * 1024;

export interface PortableSettingsTransferProps {
  onExport?: () => Promise<unknown>;
  onPreview?: (
    document: unknown,
    file: File,
  ) => Promise<PortableImportPreview>;
  onImport?: (document: unknown, file: File) => Promise<void>;
}

const ISSUE_KIND_LABEL: Record<PortableImportIssue["kind"], string> = {
  node: "노드",
  model: "모델",
  asset: "자산",
  bundle: "번들",
  endpoint: "연결",
};

function formatBytes(value: number) {
  if (value < 1024) return `${value.toLocaleString()} B`;
  const units = ["KB", "MB", "GB"];
  let size = value;
  let index = -1;
  do {
    size /= 1024;
    index += 1;
  } while (size >= 1024 && index < units.length - 1);
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`;
}

export function PortableSettingsTransfer({
  onExport,
  onPreview,
  onImport,
}: PortableSettingsTransferProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [candidate, setCandidate] = React.useState<{
    file: File;
    document: unknown;
    preview: PortableImportPreview;
  } | null>(null);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [working, setWorking] = React.useState<
    "export" | "preview" | "import" | null
  >(null);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");

  async function exportSettings() {
    if (!onExport) return;
    setWorking("export");
    setError("");
    setMessage("");
    try {
      const document = await onExport();
      const blob =
        document instanceof Blob
          ? document
          : new Blob([JSON.stringify(document, null, 2)], {
              type: "application/json",
            });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `anima-studio-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("이식 가능한 설정 파일을 내보냈습니다.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "설정 파일을 내보내지 못했습니다.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function selectFile(file: File | undefined) {
    setError("");
    setMessage("");
    setCandidate(null);
    setAcknowledged(false);
    if (!file) return;
    if (!onPreview) {
      setError(
        "서버 미리보기 검사가 연결되지 않아 가져오기를 시작할 수 없습니다.",
      );
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setError("Portable 번들은 정확히 96 MiB 이하여야 합니다.");
      return;
    }
    setWorking("preview");
    try {
      const document = JSON.parse(await file.text()) as unknown;
      if (!document || typeof document !== "object") {
        throw new Error("설정 파일의 최상위 값은 객체여야 합니다.");
      }
      const preview = await onPreview(document, file);
      setCandidate({ file, document, preview });
      if (!preview.valid) {
        setError(
          "서버 검사에서 유효하지 않은 번들로 판정했습니다. 이 파일은 가져올 수 없습니다.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "유효한 JSON 설정 파일이 아닙니다.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function importSettings() {
    if (
      !onImport ||
      !candidate?.preview.valid ||
      !acknowledged ||
      working !== null
    ) {
      return;
    }
    setWorking("import");
    setError("");
    setMessage("");
    try {
      await onImport(candidate.document, candidate.file);
      setMessage(
        "설정을 불러왔습니다. 자동 생성과 런타임 시작은 실행하지 않았습니다.",
      );
      setCandidate(null);
      setAcknowledged(false);
      if (inputRef.current) inputRef.current.value = "";
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "설정 파일을 불러오지 못했습니다.",
      );
    } finally {
      setWorking(null);
    }
  }

  const missing = candidate?.preview.missing ?? [];

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2">
            <FileJson className="size-4 text-pink-300" />
            <h2 className="text-[15px] font-semibold">설정 가져오기·내보내기</h2>
            <Badge variant="secondary">Portable JSON</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            토큰과 개인 절대 경로를 제외하고 프로필, 모델 팩과 참조 이미지를
            옮깁니다. 최대 96 MiB이며 적용 전에 서버에서 중복 자산과 누락
            항목을 검사합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void exportSettings()}
            disabled={!onExport || working !== null}
            title={!onExport ? "내보내기 핸들러 연결 필요" : undefined}
          >
            {working === "export" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Download />
            )}
            내보내기
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={!onPreview || !onImport || working !== null}
            title={
              !onPreview
                ? "서버 미리보기 검사 연결 필요"
                : !onImport
                  ? "가져오기 핸들러 연결 필요"
                  : undefined
            }
          >
            {working === "preview" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Upload />
            )}
            {working === "preview" ? "서버 검사 중" : "파일 선택"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void selectFile(event.target.files?.[0])}
          />
        </div>
      </div>

      {!onExport || !onPreview || !onImport ? (
        <p className="mt-3 rounded-md border border-border/60 bg-background/25 px-3 py-2 text-[10px] text-muted-foreground">
          {!onPreview
            ? "가져오기는 서버 미리보기 검사가 연결된 뒤 사용할 수 있습니다."
            : "Portable 설정의 내보내기 또는 가져오기 핸들러 연결이 필요합니다."}
        </p>
      ) : null}

      {candidate ? (
        <div className="mt-4 rounded-lg border border-amber-400/15 bg-amber-400/[0.05] p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-medium">{candidate.file.name}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                파일 {formatBytes(candidate.file.size)} · 서버 검사 완료
              </p>
            </div>
            <Badge variant={candidate.preview.valid ? "success" : "destructive"}>
              {candidate.preview.valid ? "가져오기 가능" : "유효하지 않음"}
            </Badge>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-md border border-border/50 bg-background/30 p-2.5">
              <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <ImageIcon className="size-3.5" />
                참조 이미지
              </p>
              <p className="mt-1 text-xs font-medium">
                {candidate.preview.assetCount}개 ·{" "}
                {formatBytes(candidate.preview.totalAssetBytes)}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                새 자산 {candidate.preview.newAssetCount} · 중복 재사용{" "}
                {candidate.preview.deduplicatedAssetCount}
              </p>
            </div>
            <div className="rounded-md border border-border/50 bg-background/30 p-2.5">
              <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <FileJson className="size-3.5" />
                캐릭터 프로필
              </p>
              <p className="mt-1 text-xs font-medium">
                {candidate.preview.characterProfileCount}개
              </p>
            </div>
            <div className="rounded-md border border-border/50 bg-background/30 p-2.5">
              <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Package className="size-3.5" />
                모델 팩
              </p>
              <p className="mt-1 text-xs font-medium">
                {candidate.preview.modelPackCount}개
              </p>
            </div>
            <div className="rounded-md border border-border/50 bg-background/30 p-2.5">
              <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <HardDriveDownload className="size-3.5" />
                누락 항목
              </p>
              <p className="mt-1 text-xs font-medium">{missing.length}개</p>
            </div>
          </div>

          {missing.length ? (
            <div className="mt-3 rounded-md border border-amber-400/20 bg-amber-400/[0.06] p-3">
              <p className="flex items-center gap-2 text-[11px] font-medium text-amber-100">
                <AlertTriangle className="size-3.5" />
                누락 항목은 자동 설치되지 않습니다
              </p>
              <ul className="mt-2 space-y-2">
                {missing.map((issue) => (
                  <li
                    key={`${issue.kind}:${issue.id}`}
                    className="rounded-md border border-amber-400/10 bg-background/20 p-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium text-amber-100/90">
                          <Badge variant="outline">
                            {ISSUE_KIND_LABEL[issue.kind]}
                          </Badge>{" "}
                          {issue.label}
                        </p>
                        <p
                          className="mt-1 truncate font-mono text-[9px] text-muted-foreground"
                          title={issue.id}
                        >
                          {issue.id}
                        </p>
                        {issue.package ? (
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            설치 패키지: {issue.package}
                          </p>
                        ) : null}
                      </div>
                      {issue.installUrl ? (
                        <Button asChild type="button" size="sm" variant="outline">
                          <a
                            href={issue.installUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink />
                            설치 안내
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 flex items-center gap-2 rounded-md border border-emerald-400/15 bg-emerald-400/[0.05] p-3 text-[11px] text-emerald-100">
              <CheckCircle2 className="size-4 text-emerald-300" />
              현재 환경에서 확인된 누락 노드나 모델이 없습니다.
            </p>
          )}

          <label className="mt-3 flex items-start gap-2 text-[11px] text-amber-100/80">
            <input
              type="checkbox"
              className="mt-0.5 accent-pink-500"
              checked={acknowledged}
              disabled={!candidate.preview.valid}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            {missing.length
              ? `누락된 ${missing.length}개 항목은 설치되지 않으며, 설정만 가져온 뒤 직접 해결해야 함을 확인했습니다.`
              : "현재 편집값이 교체될 수 있음을 확인했습니다."}{" "}
            가져온 설정은 자동 생성하거나 런타임을 시작하지 않습니다.
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setCandidate(null);
                setAcknowledged(false);
                setError("");
                if (inputRef.current) inputRef.current.value = "";
              }}
              disabled={working !== null}
            >
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void importSettings()}
              disabled={
                !candidate.preview.valid ||
                !acknowledged ||
                working !== null
              }
            >
              {working === "import" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Upload />
              )}
              설정 가져오기
            </Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-emerald-200">
          <CheckCircle2 className="size-4" />
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 flex items-center gap-2 text-xs text-red-200">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </section>
  );
}

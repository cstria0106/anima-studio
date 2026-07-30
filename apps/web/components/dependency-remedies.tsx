"use client";

import * as React from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  PackageSearch,
  RefreshCw,
  ServerCog,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CapabilityIssue } from "@/lib/types";

export interface DependencyRemediesProps {
  ready: boolean;
  issues: CapabilityIssue[];
  checking?: boolean;
  onRetry: () => void;
  onOpenRuntime: () => void;
}

function remedyFor(issue: CapabilityIssue) {
  const identity = (
    issue.classType ??
    issue.id ??
    issue.kind ??
    ""
  ).toLocaleLowerCase();
  if (identity.includes("model") || issue.kind === "model") {
    return {
      title: "설치된 모델을 선택하거나 Library에서 다운로드하세요.",
      action: "모델 목록 보기",
      target: "installed-resources",
    };
  }
  if (
    identity.includes("endpoint") ||
    identity.includes("comfy") ||
    issue.kind === "endpoint"
  ) {
    return {
      title: "ComfyUI 주소와 실행 상태를 먼저 확인하세요.",
      action: "런타임 열기",
      target: "runtime-manager",
    };
  }
  return {
    title:
      "관리형 모드라면 엔진 복구를 실행하세요. 외부 모드에서는 안내된 패키지를 해당 ComfyUI에 직접 설치해야 합니다.",
    action: "런타임/복구 열기",
    target: "runtime-manager",
  };
}

export function DependencyRemedies({
  ready,
  issues,
  checking = false,
  onRetry,
  onOpenRuntime,
}: DependencyRemediesProps) {
  const [copied, setCopied] = React.useState("");

  async function copyIdentity(issue: CapabilityIssue) {
    const value = issue.classType ?? issue.id ?? issue.label ?? "";
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(value);
    window.setTimeout(() => setCopied(""), 1200);
  }

  if (ready) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.06] p-4">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-300" />
        <div>
          <p className="text-sm font-medium text-emerald-100">
            필수 노드 계약을 모두 확인했습니다.
          </p>
          <p className="mt-1 text-xs leading-5 text-emerald-100/60">
            내장 API 템플릿을 실행할 준비가 됐습니다.
          </p>
        </div>
      </div>
    );
  }

  if (!issues.length) {
    return (
      <div className="rounded-lg border border-border/70 bg-background/30 p-5 text-center">
        <PackageSearch className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-2 text-xs text-muted-foreground">
          {checking
            ? "호환성 검사 결과를 기다리고 있습니다."
            : "ComfyUI를 시작한 뒤 다시 검사하세요."}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={onRetry}
          disabled={checking}
        >
          <RefreshCw className={checking ? "animate-spin" : ""} />
          다시 검사
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {issues.map((issue) => {
        const identity =
          issue.classType ?? issue.id ?? issue.label ?? "unknown";
        const remedy = remedyFor(issue);
        return (
          <article
            key={identity}
            className="rounded-lg border border-amber-400/15 bg-amber-400/[0.05] p-3"
          >
            <div className="flex items-start gap-3">
              <Wrench className="mt-0.5 size-4 shrink-0 text-amber-300" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-all text-xs font-medium">
                    {issue.label ?? identity}
                  </p>
                  <Badge variant="warning">
                    {issue.kind ?? "필수 항목"}
                  </Badge>
                </div>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  {issue.packageName ?? issue.reason ?? "필수 항목 누락"}
                </p>
                <p className="mt-2 text-[11px] leading-5 text-amber-100/75">
                  {remedy.title}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => void copyIdentity(issue)}
                  >
                    <Copy />
                    {copied === identity ? "복사됨" : "노드명 복사"}
                  </Button>
                  {issue.installUrl ? (
                    <Button
                      asChild
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[10px]"
                    >
                      <a
                        href={issue.installUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        설치 안내
                        <ExternalLink />
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => {
                      if (remedy.target === "runtime-manager") {
                        onOpenRuntime();
                      } else {
                        document
                          .getElementById(remedy.target)
                          ?.scrollIntoView({ behavior: "smooth" });
                      }
                    }}
                  >
                    {remedy.target === "runtime-manager" ? (
                      <ServerCog />
                    ) : (
                      <PackageSearch />
                    )}
                    {remedy.action}
                  </Button>
                </div>
              </div>
            </div>
          </article>
        );
      })}
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onRetry}
          disabled={checking}
        >
          <RefreshCw className={checking ? "animate-spin" : ""} />
          조치 후 다시 검사
        </Button>
      </div>
    </div>
  );
}

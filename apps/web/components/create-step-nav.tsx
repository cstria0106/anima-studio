"use client";

import * as React from "react";
import {
  AlertCircle,
  Check,
  Circle,
  ImagePlus,
  Settings2,
  SlidersHorizontal,
  TextCursorInput,
} from "lucide-react";
import type { CreateStepId } from "@/lib/studio-ux";
import { cn } from "@/lib/utils";

export type CreateStepState = "idle" | "current" | "complete" | "error";

export interface CreateStepDefinition {
  id: CreateStepId;
  label: string;
  state: CreateStepState;
}

const icons = {
  reference: ImagePlus,
  prompt: TextCursorInput,
  models: Settings2,
  generation: SlidersHorizontal,
} satisfies Record<CreateStepId, typeof ImagePlus>;

export function CreateStepNav({
  steps,
  activeStep,
  onSelect,
}: {
  steps: CreateStepDefinition[];
  activeStep: CreateStepId;
  onSelect: (step: CreateStepId) => void;
}) {
  return (
    <nav
      aria-label="생성 단계"
      className="sticky top-14 z-20 -mx-1 mb-5 overflow-x-auto px-1 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="glass-surface mx-auto flex min-w-max items-center gap-1 rounded-xl border p-1.5 shadow-sm">
        {steps.map((step, index) => {
          const Icon = icons[step.id];
          const selected = activeStep === step.id;
          return (
            <button
              key={step.id}
              type="button"
              aria-current={selected ? "step" : undefined}
              onClick={() => onSelect(step.id)}
              className={cn(
                "group flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs font-medium text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                selected && "bg-accent text-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-md border border-border bg-background text-[11px] tabular-nums",
                  step.state === "complete" &&
                    "border-success/35 bg-success/10 text-success",
                  step.state === "error" &&
                    "border-danger/35 bg-danger/10 text-danger",
                  selected &&
                    step.state !== "complete" &&
                    step.state !== "error" &&
                    "border-primary/40 bg-primary/10 text-primary",
                )}
              >
                {step.state === "complete" ? (
                  <Check className="size-3.5" />
                ) : step.state === "error" ? (
                  <AlertCircle className="size-3.5" />
                ) : selected ? (
                  <Icon className="size-3.5" />
                ) : (
                  <Circle className="size-2.5" />
                )}
              </span>
              <span>{step.label}</span>
              <span className="text-[11px] text-muted-foreground/70">
                {index + 1}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function CreateStepSection({
  id,
  active,
  label,
  state,
  onOpen,
  children,
}: {
  id: CreateStepId;
  active: boolean;
  label: string;
  state: CreateStepState;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`create-step-${id}`}
      data-create-step={id}
      className="scroll-mt-32"
    >
      <button
        type="button"
        aria-expanded={active}
        aria-controls={`create-step-${id}-panel`}
        onClick={onOpen}
        className={cn(
          "mb-2 flex min-h-11 w-full items-center justify-between rounded-xl border border-border bg-card px-4 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring xl:hidden",
          active && "border-primary/35 bg-primary/[0.04]",
        )}
      >
        <span>{label}</span>
        <span
          className={cn(
            "text-xs text-muted-foreground",
            state === "complete" && "text-success",
            state === "error" && "text-danger",
          )}
        >
          {state === "complete"
            ? "완료"
            : state === "error"
              ? "확인 필요"
              : active
                ? "편집 중"
                : "열기"}
        </span>
      </button>
      <div
        id={`create-step-${id}-panel`}
        role="region"
        aria-label={label}
        className={cn(active ? "block" : "hidden", "xl:block")}
      >
        {children}
      </div>
    </section>
  );
}

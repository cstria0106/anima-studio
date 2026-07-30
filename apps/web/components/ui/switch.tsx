"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        "relative inline-flex h-11 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none relative inline-flex h-7 w-12 items-center rounded-full border border-input bg-muted transition-colors duration-[120ms]",
          checked && "bg-primary",
        )}
      >
        <span
          className={cn(
            "block size-5 translate-x-0.5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-[120ms]",
            checked && "translate-x-[1.55rem]",
          )}
        />
      </span>
    </button>
  );
}

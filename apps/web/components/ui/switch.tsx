"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  size?: "default" | "sm";
}

export function Switch({
  checked,
  onCheckedChange,
  size = "default",
  className,
  onClick,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        "relative inline-flex h-10 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-6 w-8",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none relative inline-flex h-5 w-9 items-center rounded-full border border-input bg-muted transition-colors duration-[120ms]",
          size === "sm" && "h-3.5 w-6",
          checked && "bg-primary",
        )}
      >
        <span
          className={cn(
            "block size-4 translate-x-0.5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-[120ms]",
            size === "sm" && "size-2.5",
            checked &&
              (size === "sm" ? "translate-x-[0.7rem]" : "translate-x-[1.1rem]"),
          )}
        />
      </span>
    </button>
  );
}

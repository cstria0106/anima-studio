import type * as React from "react";
import { cn, clamp } from "@/lib/utils";

export interface ProgressProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  value?: number | null;
}

export function Progress({ value, className, ...props }: ProgressProps) {
  const determinate = value !== undefined && value !== null;
  return (
    <div
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2",
        className,
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? clamp(value, 0, 100) : undefined}
      aria-valuetext={determinate ? undefined : "진행 중"}
      {...props}
    >
      <div
        className={cn(
          "h-full rounded-full bg-primary transition-[width] duration-300",
          !determinate &&
            "w-1/2 animate-shimmer bg-[length:200%_100%]",
        )}
        style={determinate ? { width: `${clamp(value, 0, 100)}%` } : undefined}
      />
    </div>
  );
}

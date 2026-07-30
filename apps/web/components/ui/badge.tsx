import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium leading-none transition-colors duration-[120ms]",
  {
    variants: {
      variant: {
        default:
          "border-primary/35 bg-primary/10 text-pink-200",
        secondary:
          "border-border bg-secondary/70 text-secondary-foreground",
        success:
          "border-success/35 bg-success/10 text-emerald-300",
        warning:
          "border-warning/35 bg-warning/10 text-amber-300",
        destructive:
          "border-destructive/35 bg-destructive/10 text-red-300",
        info:
          "border-info/35 bg-info/10 text-sky-300",
        outline: "border-border bg-transparent text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

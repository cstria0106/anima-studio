import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      "flex h-11 w-full rounded-md border border-input bg-surface-2 px-3 py-2 text-sm text-foreground transition-colors duration-[120ms] placeholder:text-muted-foreground hover:border-foreground/55 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "flex min-h-24 w-full resize-y rounded-md border border-input bg-surface-2 px-3 py-3 text-sm leading-6 text-foreground transition-colors duration-[120ms] placeholder:text-muted-foreground hover:border-foreground/55 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = "Textarea";

type AutoResizeTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  maxRows?: number;
};

export const AutoResizeTextarea = React.forwardRef<
  HTMLTextAreaElement,
  AutoResizeTextareaProps
>(
  (
    {
      className,
      maxRows = 10,
      onInput,
      rows = 2,
      value,
      ...props
    },
    ref,
  ) => {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);

    React.useImperativeHandle(ref, () => textareaRef.current!, []);

    const resize = React.useCallback(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.style.height = "auto";

      const styles = window.getComputedStyle(textarea);
      const lineHeight = Number.parseFloat(styles.lineHeight);
      const verticalPadding =
        Number.parseFloat(styles.paddingTop) +
        Number.parseFloat(styles.paddingBottom);
      const verticalBorder =
        Number.parseFloat(styles.borderTopWidth) +
        Number.parseFloat(styles.borderBottomWidth);
      const maximumHeight =
        lineHeight * Math.max(rows, maxRows) + verticalPadding + verticalBorder;
      const contentHeight = textarea.scrollHeight + verticalBorder;

      textarea.style.height = `${Math.min(contentHeight, maximumHeight)}px`;
      textarea.style.overflowY =
        contentHeight > maximumHeight ? "auto" : "hidden";
    }, [maxRows, rows]);

    React.useLayoutEffect(resize, [resize, value]);

    return (
      <Textarea
        {...props}
        ref={textareaRef}
        rows={rows}
        value={value}
        onInput={(event) => {
          resize();
          onInput?.(event);
        }}
        className={cn("min-h-0 resize-none", className)}
      />
    );
  },
);
AutoResizeTextarea.displayName = "AutoResizeTextarea";

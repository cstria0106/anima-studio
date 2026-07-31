"use client";

import * as React from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { clamp, cn } from "@/lib/utils";

export function CommittedNumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
  disabled,
  className,
  inputClassName,
}: {
  id?: string;
  label: React.ReactNode;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number | string;
  hint?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const generatedId = React.useId();
  const inputId = id ?? `number-field-${generatedId}`;
  const errorId = `${inputId}-error`;
  const [draft, setDraft] = React.useState(String(value));
  const [error, setError] = React.useState("");
  const editingRef = React.useRef(false);

  React.useEffect(() => {
    if (!editingRef.current) setDraft(String(value));
  }, [value]);

  function bounded(next: number) {
    return min !== undefined && max !== undefined
      ? clamp(next, min, max)
      : min !== undefined
        ? Math.max(next, min)
        : max !== undefined
          ? Math.min(next, max)
          : next;
  }

  function commit() {
    editingRef.current = false;
    if (!draft.trim()) {
      setDraft(String(value));
      setError("값을 입력해주세요.");
      return;
    }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      setError("올바른 숫자를 입력해주세요.");
      return;
    }
    const next = bounded(parsed);
    onChange(next);
    setDraft(String(next));
    setError("");
  }

  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      htmlFor={inputId}
      errorId={errorId}
      className={className}
    >
      <Input
        id={inputId}
        type="number"
        className={cn("number-input", inputClassName)}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onFocus={() => {
          editingRef.current = true;
          setError("");
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setDraft(String(value));
            setError("");
            editingRef.current = false;
            event.currentTarget.blur();
          }
        }}
      />
    </Field>
  );
}

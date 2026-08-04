"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function StrengthSlider({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const [showValue, setShowValue] = React.useState(false);
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const min = -1;
  const max = 1;
  const position = ((value - min) / (max - min)) * 100;
  const tooltipPosition = Math.min(94, Math.max(6, position));

  React.useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  function showKeyboardValue() {
    setShowValue(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowValue(false), 900);
  }

  return (
    <div
      className={cn(
        "grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-1.5",
        disabled && "opacity-50",
      )}
    >
      <label htmlFor={id} className="text-[9px] font-medium text-white/70">
        {label}
      </label>
      <div className="relative">
        {showValue ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute bottom-full z-20 mb-1 -translate-x-1/2 rounded-md border border-white/20 bg-white/90 px-2 py-1 text-[11px] font-semibold tabular-nums text-slate-950 shadow-glass backdrop-blur-xl"
            style={{ left: `${tooltipPosition}%` }}
          >
            {value.toFixed(2)}
          </div>
        ) : null}
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={0.05}
          value={value}
          disabled={disabled}
          aria-valuetext={value.toFixed(2)}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/25 accent-pink-200 outline-none transition focus-visible:ring-2 focus-visible:ring-pink-200/60 disabled:cursor-not-allowed [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-white/80 [&::-moz-range-thumb]:bg-pink-200 [&::-moz-range-thumb]:shadow-md [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/80 [&::-webkit-slider-thumb]:bg-pink-200 [&::-webkit-slider-thumb]:shadow-md"
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          onPointerDown={() => {
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
            setShowValue(true);
          }}
          onPointerUp={() => setShowValue(false)}
          onPointerCancel={() => setShowValue(false)}
          onKeyDown={(event) => {
            if (
              event.key === "ArrowLeft" ||
              event.key === "ArrowRight" ||
              event.key === "ArrowUp" ||
              event.key === "ArrowDown" ||
              event.key === "Home" ||
              event.key === "End" ||
              event.key === "PageUp" ||
              event.key === "PageDown"
            ) {
              showKeyboardValue();
            }
          }}
          onBlur={() => setShowValue(false)}
        />
      </div>
      <output
        htmlFor={id}
        className="number-input text-right text-[9px] font-semibold text-white/90"
      >
        {value.toFixed(2)}
      </output>
    </div>
  );
}

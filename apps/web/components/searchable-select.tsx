"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ModelOption } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SearchableSelectProps {
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
  placeholder: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
}

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder,
  emptyText = "일치하는 항목이 없습니다.",
  disabled,
  id,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = React.useId();
  const selected = options.find((option) => option.value === value);
  const filtered = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) =>
      `${option.name} ${option.value}`.toLowerCase().includes(normalized),
    );
  }, [options, query]);

  React.useEffect(() => setActiveIndex(0), [query, options]);

  React.useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function select(option: ModelOption) {
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setQuery("");
          setActiveIndex(0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="w-full justify-between bg-surface-2 px-3 font-normal"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          disabled={disabled}
        >
          <span
            className={cn(
              "truncate",
              !selected && !value && "text-muted-foreground",
            )}
          >
            {selected?.name || value || placeholder}
          </span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-1.5"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
          <div className="relative mb-1.5">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-8 pr-8"
              placeholder="검색…"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={
                filtered[activeIndex]
                  ? `${listboxId}-option-${activeIndex}`
                  : undefined
              }
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  if (filtered.length) {
                    setActiveIndex((index) =>
                      Math.min(index + 1, filtered.length - 1),
                    );
                  }
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((index) => Math.max(index - 1, 0));
                }
                if (event.key === "Home" && filtered.length) {
                  event.preventDefault();
                  setActiveIndex(0);
                }
                if (event.key === "End" && filtered.length) {
                  event.preventDefault();
                  setActiveIndex(filtered.length - 1);
                }
                if (event.key === "Enter" && filtered[activeIndex]) {
                  event.preventDefault();
                  select(filtered[activeIndex]);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                }
              }}
            />
            {query ? (
              <button
                type="button"
                aria-label="검색어 지우기"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setQuery("")}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          <div
            id={listboxId}
            role="listbox"
            aria-label={placeholder}
            className="max-h-60 overflow-y-auto overscroll-contain"
          >
            {filtered.length ? (
              filtered.map((option, index) => (
                <button
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={option.value === value}
                  key={option.value}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground",
                    index === activeIndex && "bg-accent/70 text-foreground",
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(option)}
                >
                  <Check
                    className={cn(
                      "size-3.5 text-primary",
                      option.value !== value && "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                {emptyText}
              </p>
            )}
          </div>
      </PopoverContent>
    </Popover>
  );
}

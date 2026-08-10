import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { doctorMatchesQuery } from "@/lib/doctorSearch";
import { cn } from "@/lib/utils";

export type DoctorOption = {
  id: number;
  name: string;
  specialization?: string | null;
};

type Props = {
  doctors: DoctorOption[];
  value: number | null; // null = All Doctors
  onChange: (id: number | null) => void;
  allowAll?: boolean;
  allLabel?: string;
  placeholder?: string;
  className?: string;
  /** Wider panel for long doctor names */
  wide?: boolean;
};

/**
 * Searchable, scrollable doctor picker. Replaces Radix Select for long lists —
 * Radix Select viewport was height-locked to the trigger so the list would not scroll.
 */
export function DoctorSearchSelect({
  doctors,
  value,
  onChange,
  allowAll = true,
  allLabel = "All Doctors",
  placeholder = "Search doctors…",
  className,
  wide = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = value != null ? doctors.find((d) => d.id === value) : null;
  const label = selected ? selected.name : allowAll ? allLabel : placeholder;

  const filtered = useMemo(() => {
    const list = doctors.filter((d) => doctorMatchesQuery(d, query));
    return list.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [doctors, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    // Focus search when opened
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm",
          "hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring",
          wide ? "min-w-[16rem]" : "min-w-[14rem]",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate text-left">{label}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 mt-1 w-full min-w-[18rem] rounded-md border bg-popover text-popover-foreground shadow-md",
            wide && "min-w-[24rem]",
          )}
          role="listbox"
        >
          <div className="relative border-b border-border p-2">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm outline-none focus:ring-1 focus:ring-ring"
              aria-label="Search doctors"
            />
            {query && (
              <button
                type="button"
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto overscroll-contain p-1">
            {allowAll && (
              <button
                type="button"
                role="option"
                aria-selected={value == null}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                  value == null && "bg-accent",
                )}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check size={14} className={cn("shrink-0", value == null ? "opacity-100" : "opacity-0")} />
                <span className="truncate font-medium">{allLabel}</span>
              </button>
            )}

            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No doctors match &ldquo;{query.trim()}&rdquo;
              </div>
            ) : (
              filtered.map((d) => {
                const active = value === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent text-left",
                      active && "bg-accent",
                    )}
                    onClick={() => {
                      onChange(d.id);
                      setOpen(false);
                    }}
                  >
                    <Check size={14} className={cn("mt-0.5 shrink-0", active ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{d.name}</span>
                      {d.specialization && (
                        <span className="block truncate text-[11px] text-muted-foreground">{d.specialization}</span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
            {query.trim()
              ? `${filtered.length} of ${doctors.length}`
              : `${doctors.length} doctors — type to filter (e.g. abi)`}
          </div>
        </div>
      )}
    </div>
  );
}

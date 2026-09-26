import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, History, Loader2, Plus, UserRound } from "lucide-react";
import { api } from "@/lib/fetchApi";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PayeeSuggestionDto = {
  kind: "vendor" | "previous_payee";
  name: string;
  normalizedName: string;
  vendorId: number | null;
  phone?: string | null;
  gstin?: string | null;
  lastCategory?: string | null;
  lastDescription?: string | null;
  lastExpenseDate?: string | null;
  lastBillAmount?: number | null;
  lastPaymentMode?: string | null;
  useCount: number;
  matchReason?: string;
};

export type PayeeUsualDto = {
  name: string;
  vendorId: number | null;
  kind: "vendor" | "previous_payee";
  lastCategory: string | null;
  lastDescription: string | null;
  lastExpenseDate: string | null;
  lastBillAmount: number | null;
  lastPaymentMode: string | null;
  suggestedCategory: string | null;
  suggestedPaymentMode: string | null;
  meta: {
    workType?: string | null;
    labourBasis?: "per_day" | "per_job" | "contract" | null;
    days?: number | null;
    ratePerDay?: number | null;
    labourAmount?: number | null;
    materialAmount?: number | null;
  } | null;
  recent: Array<{
    expenseId: string;
    expenseDate: string;
    description: string;
    category: string;
    billAmount: number;
  }>;
};

type Props = {
  value: string;
  vendorId: string;
  disabled?: boolean;
  onChange: (next: { vendorName: string; vendorId: string }) => void;
  onSelectSuggestion?: (s: PayeeSuggestionDto) => void;
  onUsualDetails?: (details: PayeeUsualDto | null) => void;
  onAddToVendorMaster?: (name: string) => void;
  onViewHistory?: (opts: { vendorId: string; payeeName: string }) => void;
};

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

function contextLabel(s: PayeeSuggestionDto): string {
  if (s.kind === "vendor") return "Vendor";
  const cat = (s.lastCategory || "").trim();
  return cat ? `Previous Payee · ${cat}` : "Previous Payee";
}

export default function PayeeCombobox({
  value,
  vendorId,
  disabled,
  onChange,
  onSelectSuggestion,
  onUsualDetails,
  onAddToVendorMaster,
  onViewHistory,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value.trim()), 220);
    return () => window.clearTimeout(t);
  }, [value]);

  const q = debounced;
  const { data: suggestData, isFetching: suggesting } = useQuery({
    queryKey: ["expense-payees-suggest", q],
    queryFn: () => api.get<{ items: PayeeSuggestionDto[] }>(`/api/expenses/payees/suggest?q=${encodeURIComponent(q)}&limit=12`),
    enabled: open && q.length >= 1,
    staleTime: 15_000,
  });

  const { data: recentData, isFetching: loadingRecent } = useQuery({
    queryKey: ["expense-payees-recent"],
    queryFn: () => api.get<{ items: PayeeSuggestionDto[] }>("/api/expenses/payees/recent?limit=8"),
    enabled: open && q.length === 0,
    staleTime: 30_000,
  });

  const { data: usual } = useQuery({
    queryKey: ["expense-payee-usual", vendorId, value.trim()],
    queryFn: () => {
      const params = new URLSearchParams();
      if (vendorId) params.set("vendorId", vendorId);
      if (value.trim()) params.set("name", value.trim());
      return api.get<PayeeUsualDto>(`/api/expenses/payees/usual?${params}`);
    },
    enabled: Boolean(vendorId || value.trim().length >= 2),
    staleTime: 60_000,
  });

  const usualCbRef = useRef(onUsualDetails);
  usualCbRef.current = onUsualDetails;
  useEffect(() => {
    usualCbRef.current?.(usual ?? null);
  }, [usual]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const items = q.length >= 1 ? (suggestData?.items ?? []) : (recentData?.items ?? []);
  const showCreate = q.length >= 2 && !items.some((i) => i.normalizedName === q.toUpperCase().replace(/\s+/g, " "));

  function pick(s: PayeeSuggestionDto) {
    onChange({ vendorName: s.name, vendorId: s.vendorId != null ? String(s.vendorId) : "" });
    onSelectSuggestion?.(s);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    const total = items.length + (showCreate ? 2 : 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (total ? (h + 1) % total : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (total ? (h - 1 + total) % total : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight < items.length) pick(items[highlight]!);
      else if (showCreate && highlight === items.length) {
        onChange({ vendorName: value.trim(), vendorId: "" });
        setOpen(false);
      } else if (showCreate && highlight === items.length + 1) {
        onAddToVendorMaster?.(value.trim());
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="space-y-1.5" data-testid="payee-combobox">
      <div className="relative">
        <Input
          value={value}
          disabled={disabled}
          placeholder="Start typing a vendor or previous payee…"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          data-testid="payee-combobox-input"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange({ vendorName: e.target.value, vendorId: "" });
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
        />
        {(suggesting || loadingRecent) && (
          <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && (
        <div
          id={listId}
          role="listbox"
          className="z-50 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-md"
          data-testid="payee-combobox-list"
        >
          {q.length === 0 && (
            <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Recent payees
            </p>
          )}
          {items.length === 0 && q.length >= 1 && !suggesting ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
          ) : null}
          {items.map((s, idx) => (
            <button
              key={`${s.kind}-${s.normalizedName}-${s.vendorId ?? "x"}`}
              type="button"
              role="option"
              aria-selected={highlight === idx}
              className={cn(
                "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60",
                highlight === idx && "bg-muted/70",
              )}
              onMouseEnter={() => setHighlight(idx)}
              onClick={() => pick(s)}
            >
              {s.kind === "vendor" ? (
                <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
              ) : (
                <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-medium truncate">{s.name}</span>
                <span className="block text-[11px] text-muted-foreground truncate">
                  {contextLabel(s)}
                  {s.gstin ? ` · ${s.gstin}` : s.phone ? ` · ${s.phone}` : ""}
                </span>
              </span>
            </button>
          ))}
          {showCreate && (
            <>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm hover:bg-muted/60",
                  highlight === items.length && "bg-muted/70",
                )}
                onMouseEnter={() => setHighlight(items.length)}
                onClick={() => {
                  onChange({ vendorName: value.trim(), vendorId: "" });
                  setOpen(false);
                }}
                data-testid="payee-use-onetime"
              >
                <UserRound className="h-3.5 w-3.5 text-slate-600" />
                Use &quot;{value.trim()}&quot; as one-time payee
              </button>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60",
                  highlight === items.length + 1 && "bg-muted/70",
                )}
                onMouseEnter={() => setHighlight(items.length + 1)}
                onClick={() => onAddToVendorMaster?.(value.trim())}
                data-testid="payee-add-vendor"
              >
                <Plus className="h-3.5 w-3.5 text-emerald-700" />
                Add &quot;{value.trim()}&quot; to Vendor Master
              </button>
            </>
          )}
        </div>
      )}

      {usual && (usual.lastExpenseDate || usual.recent.length > 0) ? (
        <div
          className="rounded-md border border-dashed border-emerald-200 bg-emerald-50/40 px-2.5 py-2 text-[11px] text-emerald-950"
          data-testid="payee-usual-helper"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold truncate">
                {usual.name}{" "}
                <span className="font-normal text-muted-foreground">
                  · {usual.kind === "vendor" ? "Vendor" : "Previous Payee"}
                </span>
              </p>
              <p className="text-muted-foreground mt-0.5">
                Last expense:{" "}
                {usual.lastBillAmount != null ? inr(usual.lastBillAmount) : "—"}
                {usual.lastExpenseDate
                  ? ` · ${new Date(usual.lastExpenseDate + "T00:00:00").toLocaleDateString("en-IN")}`
                  : ""}
                {usual.suggestedCategory ? ` · ${usual.suggestedCategory}` : ""}
                {usual.meta?.workType ? ` · ${usual.meta.workType}` : ""}
                {usual.meta?.labourBasis === "per_day" && usual.meta.ratePerDay != null
                  ? ` · ₹${usual.meta.ratePerDay}/day`
                  : ""}
                {usual.suggestedPaymentMode ? ` · ${usual.suggestedPaymentMode}` : ""}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Suggestions only — amounts and invoices are not copied automatically.
              </p>
            </div>
            {onViewHistory && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 text-[10px]"
                onClick={() =>
                  onViewHistory({ vendorId: usual.vendorId != null ? String(usual.vendorId) : "", payeeName: usual.name })
                }
              >
                View history
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Primary modality quick-filter: USG | MRI | More (CT / CR / DX / All).
 * Used on the Worklist (where study filtering belongs), not the reporting editor.
 */

import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

export const QUEUE_MODALITY_PRIMARY = [
  { value: "US", label: "USG" },
  { value: "MR", label: "MRI" },
] as const;

export const QUEUE_MODALITY_REST = [
  { value: "CT", label: "CT" },
  { value: "CR", label: "CR / X-ray" },
  { value: "DX", label: "DX" },
  { value: "MG", label: "MG" },
  { value: "BMD", label: "BMD" },
  { value: "OT", label: "Other" },
  { value: "all", label: "All modalities" },
] as const;

export type QueueModalityFilterProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  size?: "sm" | "md";
};

export default function QueueModalityFilter({
  value,
  onChange,
  className = "",
  size = "sm",
}: QueueModalityFilterProps) {
  const restActive = QUEUE_MODALITY_REST.some((m) => m.value === value);
  const restLabel = QUEUE_MODALITY_REST.find((m) => m.value === value)?.label
    ?? (value !== "US" && value !== "MR" && value !== "all" ? value : "More");

  const h = size === "md" ? "h-9 px-3 text-xs" : "h-7 px-2 text-[10px]";
  const btn = (selected: boolean) =>
    `${h} font-semibold border transition-colors ${
      selected
        ? "bg-primary text-primary-foreground border-primary"
        : "bg-background text-muted-foreground border-border hover:bg-muted"
    }`;

  return (
    <div className={`flex items-center gap-0.5 shrink-0 ${className}`} role="group" aria-label="Study modality filter" data-testid="queue-modality-buttons">
      {QUEUE_MODALITY_PRIMARY.map((m) => (
        <Button
          key={m.value}
          type="button"
          size="sm"
          variant="outline"
          className={btn(value === m.value)}
          data-testid={`queue-modality-${m.value}`}
          aria-pressed={value === m.value}
          onClick={() => onChange(m.value)}
        >
          {m.label}
        </Button>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={`${btn(restActive)} gap-0.5`}
            data-testid="queue-modality-rest"
            aria-pressed={restActive}
            title="Other modalities"
          >
            {restLabel}
            <ChevronDown size={11} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {QUEUE_MODALITY_REST.map((m) => (
            <DropdownMenuItem
              key={m.value}
              data-testid={`queue-modality-rest-${m.value}`}
              className={value === m.value ? "bg-muted font-semibold" : ""}
              onClick={() => onChange(m.value)}
            >
              {m.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

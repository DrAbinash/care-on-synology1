/**
 * CanalApRow.tsx — one level's cell in an AP canal diameter table.
 *
 * Shared by the cervical / lumbar / dorsal grid and the dorso-lumbar grid so the
 * two tables cannot drift into two different relationships with the canonical
 * record: same read path, same single writer, same typing behaviour.
 *
 * The cell owns nothing. Its displayed number is the record's number, and every
 * accepted keystroke goes to the record through the store's only manual writer,
 * which also marks the draft dirty and refuses to write a signed report.
 */

import { useCanalApCell } from "./useCanalApCell";
import type { CanalSegment } from "@/lib/spineCanalAp";

export function CanalApRow({
  level,
  segment,
  testIdPrefix,
  segmentTag,
  disabled,
  setInputRef,
  onKeyDown,
}: {
  /** Canonical disc level, e.g. "L4-L5" / "D8-D9". */
  level: string;
  /** Which canal table this row belongs to. */
  segment: CanalSegment;
  /** Stable prefix for the input's data-testid. */
  testIdPrefix: string;
  /** Optional DOM marker for tests / styling, e.g. the row's owning segment. */
  segmentTag?: string;
  disabled?: boolean;
  setInputRef?: (el: HTMLInputElement | null) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const cell = useCanalApCell({ level, segment });
  return (
    <label className="flex flex-col gap-0.5" data-segment={segmentTag}>
      <span className="text-[8px] font-bold text-slate-600">{level}</span>
      <input
        ref={setInputRef}
        type="number"
        step="0.1"
        disabled={disabled}
        value={cell.value}
        onChange={(e) => cell.onChange(e.target.value)}
        onBlur={cell.onBlur}
        onKeyDown={onKeyDown}
        placeholder="—"
        className="h-6 w-full rounded border border-slate-200 px-1 text-[10px] tabular-nums"
        data-testid={`${testIdPrefix}-${level}`}
      />
      <span className="text-[7px] text-slate-400">mm</span>
    </label>
  );
}

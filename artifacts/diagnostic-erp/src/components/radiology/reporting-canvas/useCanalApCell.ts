/**
 * useCanalApCell — one AP canal diameter input, backed by the canonical record.
 *
 * Every surface that lets a radiologist type a canal AP diameter at a level uses
 * this: the cervical / lumbar / dorsal grids, the dorso-lumbar grid, the
 * per-level blocks on the canvases, and the dorsal and dorso-lumbar level-entry
 * forms. One behaviour, one writer, so a number cannot exist on one surface and
 * be missing from another.
 *
 * Two things this settles that are easy to get wrong:
 *
 * 1. THE RECORD IS A NUMBER, THE KEYSTROKE IS TEXT. The canonical record stores
 *    `reportValue` as a number, so it cannot hold the text "7." a radiologist is
 *    halfway through typing "7.5". Rendering the input straight from the record
 *    would eat the decimal point on the second keystroke and turn 7.5 mm into
 *    75 mm. While the cell has focus its own text is displayed; once it is left,
 *    the display comes back from the record — the only thing that is stored,
 *    printed, or sent to the ledger.
 * 2. A REFUSED WRITE SHOWS NO CHANGE. On a signed report the store's single
 *    writer refuses and returns null. The buffer is not set in that case, so the
 *    field keeps showing the signed number instead of a value that was never
 *    accepted.
 *
 * `committed` is what other renderers should use — narrative previews, the
 * report measurement block, the observation bundle. It is the record's value and
 * never the typing buffer, so prose and the printed table cannot disagree about
 * what was measured.
 */

import { useCallback, useState } from "react";
import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  canalApValueAt,
  parseCanalApNumber,
  type CanalSegment,
} from "@/lib/spineCanalAp";

export type CanalApCell = {
  /** What the input shows: the text being typed, else the record's number. */
  value: string;
  /** What should be reported: the canonical record, then a legacy fallback. */
  committed: number | null;
  onChange: (raw: string) => void;
  onBlur: () => void;
};

/** Empty, or text that resolves to a number. Anything else is not a measurement. */
function isReportable(raw: string): boolean {
  if (raw.trim() === "") return true;
  return parseCanalApNumber(raw) !== "";
}

export function useCanalApCell(opts: {
  /** The level this cell measures, in whatever lettering the caller holds. */
  level: string | null | undefined;
  /** Which canal table the level belongs to; the store decides the record. */
  segment?: CanalSegment | null;
  /**
   * A number from before the canonical record existed — prose or a ledger
   * observation. Read only when the record holds nothing, so re-typing an old
   * report never appears as a fresh measurement the viewer cannot account for.
   */
  legacy?: number | null;
}): CanalApCell {
  const { level, segment = null, legacy = null } = opts;
  const records = useWorkspace((s) => s.canalApProvenance);
  const recordManual = useWorkspace((s) => s.recordCanalApManualValue);
  const [buffer, setBuffer] = useState<string | null>(null);

  const committed = canalApValueAt(records, level) ?? legacy ?? null;

  const onChange = useCallback(
    (raw: string) => {
      // No level in scope, nothing to measure.
      if (!level) return;
      // Text that is not a number is never sent to the record. "7." mid-keystroke
      // and a stray letter both fail to parse as a value; treating them as "no
      // measurement" would delete the number that is already stored.
      if (!isReportable(raw)) {
        setBuffer(raw);
        return;
      }
      // A refusal (a signed report) leaves the field on the signed number: the
      // writer returns null and nothing is displayed that was not accepted.
      if (recordManual(level, raw, segment) != null) setBuffer(raw);
    },
    [recordManual, level, segment],
  );

  const onBlur = useCallback(() => setBuffer(null), []);

  return {
    value: buffer ?? (committed == null ? "" : String(committed)),
    committed,
    onChange,
    onBlur,
  };
}

/**
 * Server-side modality filter for pacs-worklist — mirrors client
 * `matchesQueueModality` / `normalizeModality` so deep links like
 * ?modality=USG|US|XR return the same rows the Reading Queue shows.
 */
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export function worklistModalitySqlFilter(
  modalityColumn: PgColumn,
  raw: string,
): SQL | undefined {
  const filter = raw.trim();
  if (!filter || filter === "all") return undefined;
  const upper = filter.toUpperCase();

  if (upper === "US" || upper === "USG") {
    // Match ultrasound aliases stored on worklist rows.
    return sql`(
      UPPER(TRIM(${modalityColumn})) IN ('US', 'USG')
      OR UPPER(${modalityColumn}) LIKE 'US %'
      OR UPPER(${modalityColumn}) LIKE '%ULTRASOUND%'
      OR UPPER(${modalityColumn}) LIKE '%DOPPLER%'
      OR UPPER(${modalityColumn}) LIKE '%USG%'
    )`;
  }

  if (upper === "XR" || upper === "XRAY" || upper === "X-RAY") {
    return sql`UPPER(TRIM(${modalityColumn})) IN ('XR', 'CR', 'DX', 'XA', 'RF', 'XRAY', 'X-RAY')`;
  }

  // Prefix match for MR/CT/etc. (MR matches MRI; CT matches CTA).
  return sql`UPPER(TRIM(${modalityColumn})) LIKE ${upper + "%"}`;
}

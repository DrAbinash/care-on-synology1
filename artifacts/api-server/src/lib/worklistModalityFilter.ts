/**
 * Server-side modality filter for pacs-worklist — mirrors client
 * `matchesReadingQueueModality` / `normalizeModality` so deep links like
 * ?modality=USG|US|XR return the same rows the Reading Queue shows.
 *
 * Blank / OT / unknown modalities are excluded from specific family filters
 * (they appear only when modality=all).
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

  // Non-empty modality required for every specific family filter.
  const nonBlank = sql`NULLIF(TRIM(${modalityColumn}), '') IS NOT NULL`;
  const notUnknown = sql`UPPER(TRIM(${modalityColumn})) NOT IN ('OT', 'OTHER', 'UN', 'UNKNOWN')`;

  if (upper === "US" || upper === "USG") {
    // Ultrasound family — exclusive. Avoid bare LIKE '%USG%' false-positives;
    // mirror client normalizeModality aliases + US-prefix boundary.
    return sql`(
      ${nonBlank}
      AND ${notUnknown}
      AND (
        UPPER(TRIM(${modalityColumn})) IN (
          'US', 'USG', 'DOPPLER', 'ULTRASOUND',
          'US-DOPPLER', 'USDOPPLER', 'US/DOPPLER', 'COLOR DOPPLER',
          'OB US', 'OB-US', 'OBUS', 'FETAL US', 'FETAL-US', '4D US', '3D US'
        )
        OR UPPER(TRIM(${modalityColumn})) LIKE 'US %'
        OR UPPER(TRIM(${modalityColumn})) LIKE 'US-%'
        OR UPPER(TRIM(${modalityColumn})) LIKE 'US.%'
        OR UPPER(${modalityColumn}) LIKE '%ULTRASOUND%'
        OR UPPER(${modalityColumn}) LIKE '%DOPPLER%'
        OR UPPER(TRIM(${modalityColumn})) LIKE 'USG %'
        OR UPPER(TRIM(${modalityColumn})) LIKE 'USG-%'
        OR UPPER(TRIM(${modalityColumn})) LIKE '% USG'
        OR UPPER(TRIM(${modalityColumn})) LIKE '% USG %'
      )
    )`;
  }

  if (upper === "XR" || upper === "XRAY" || upper === "X-RAY") {
    return sql`(
      ${nonBlank}
      AND ${notUnknown}
      AND UPPER(TRIM(${modalityColumn})) IN ('XR', 'CR', 'DX', 'XA', 'RF', 'XRAY', 'X-RAY')
    )`;
  }

  // Prefix match for MR/CT/etc. (MR matches MRI; CT matches CTA).
  // Still exclude blank/unknown so they only appear under All.
  return sql`(
    ${nonBlank}
    AND ${notUnknown}
    AND UPPER(TRIM(${modalityColumn})) LIKE ${upper + "%"}
  )`;
}

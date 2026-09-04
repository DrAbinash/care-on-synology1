/**
 * Strip heavy blobs from pacs-worklist list rows after server-side use.
 * Detail / ai-draft endpoints remain the source for full payloads.
 */
export function omitHeavyPacsWorklistFields<T extends Record<string, unknown>>(
  row: T,
): Omit<T, "dicomMetadata" | "aiDraftJson"> {
  const { dicomMetadata: _d, aiDraftJson: _a, ...rest } = row;
  return rest as Omit<T, "dicomMetadata" | "aiDraftJson">;
}

export function omitHeavyPacsWorklistRows<T extends Record<string, unknown>>(
  rows: T[],
): Array<Omit<T, "dicomMetadata" | "aiDraftJson">> {
  return rows.map((r) => omitHeavyPacsWorklistFields(r));
}

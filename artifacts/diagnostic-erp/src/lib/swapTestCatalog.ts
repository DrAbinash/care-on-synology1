/**
 * Pure helpers for the Change/Replace Test catalog picker on Bill Detail.
 * Keeps the full active catalog searchable by name or code (not a hard-coded
 * subset / non-searchable Select).
 */

export type SwapCatalogTest = {
  id: number;
  name: string;
  code?: string | null;
  price?: number | string | null;
  isActive?: boolean | null;
  category?: string | null;
};

export function filterSwapCatalogTests(
  tests: SwapCatalogTest[],
  opts: { search?: string; excludeTestId?: number | null } = {},
): SwapCatalogTest[] {
  const q = (opts.search ?? "").trim().toLowerCase();
  const exclude = opts.excludeTestId ?? null;

  return tests
    .filter((t) => t.isActive !== false)
    .filter((t) => (exclude == null ? true : t.id !== exclude))
    .filter((t) => {
      if (!q) return true;
      const name = (t.name ?? "").toLowerCase();
      const code = (t.code ?? "").toLowerCase();
      return name.includes(q) || code.includes(q);
    })
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function formatSwapCatalogLabel(t: SwapCatalogTest): string {
  const code = t.code ? ` (${t.code})` : "";
  const price = Number(t.price ?? 0).toFixed(2);
  return `${t.name}${code} — ₹${price}`;
}

/** What `POST /api/bills/:id/swap-test` says it did to the booked examination. */
export type SwapStudySync = {
  status?: string;
  accessionNumber?: string;
  modality?: string;
  department?: string;
  bookedAs?: string | null;
  accessions?: string[];
  studyDescriptionOutcome?: string;
  reason?: string;
  error?: string;
};

/**
 * The invoice is only half of a test swap: a radiology line also books an
 * examination that a machine and a radiologist act on. "Test replaced" used to
 * be the whole sentence, so a desk that corrected a bill had no way to know
 * whether the console, the room and the report header followed it. This says
 * what happened to the booking, in the desk's own words, and stays quiet (the
 * plain wording) when there was no examination to move.
 */
export function swapStudySyncMessage(sync?: SwapStudySync | null): {
  title: string;
  description: string;
  variant?: "destructive";
} {
  const acc = (sync?.accessionNumber ?? "").trim();
  const study = acc ? `Study ${acc}` : "The booked study";
  switch (sync?.status) {
    case "synced":
      return {
        title: "Test and booked examination replaced",
        description:
          `${study} now reads ${sync?.modality ?? ""} (${sync?.department ?? ""}) for the new test ` +
          "and the modality worklist was re-published" +
          (sync?.studyDescriptionOutcome === "kept_manual"
            ? ". Your own description was kept — edit the study if it names the old test."
            : "."),
      };
    case "study_created": {
      const created = (sync?.accessions ?? []).filter(Boolean).join(", ");
      return {
        title: "Test replaced",
        description: created
          ? `The new test is a radiology examination, so it was booked as study ${created}.`
          : "The new test is a radiology examination and was booked.",
      };
    }
    case "booking_stale":
      return {
        title: "Bill corrected — the examination is still booked",
        description:
          `The new test is not an imaging examination, but ${acc ? `study ${acc}` : "the old study"} is ` +
          `still booked${sync?.bookedAs ? ` as ${sync.bookedAs}` : ""}. Cancel that test, or void the ` +
          "study in Radiology, to take it off the machine.",
      };
    case "blocked":
      return {
        title: "Bill corrected — the booked study was left alone",
        description:
          `${study} ${sync?.reason === "terminal" ? "is already closed" : "has already been started or imaged"}, ` +
          "so it still names the old examination. Take the difference as a refund/adjustment, or cancel " +
          "and re-bill.",
        variant: "destructive",
      };
    case "failed":
      return {
        title: "Bill corrected — the booked study could not be updated",
        description:
          `${sync?.error ?? "The study synchronisation failed."} The invoice is right, but the ` +
          "examination may still name the old test — fix it in Radiology.",
        variant: "destructive",
      };
    default:
      return {
        title: "Test replaced",
        description: "The test was changed and bill totals recalculated.",
      };
  }
}

/**
 * What the workspace says about the pictures after a report is signed.
 *
 * Freeze-at-sign copies the images the radiologist attached into the signed
 * artifact's own store, so a reprint does not depend on PACS. It never blocks
 * a signing — by ruling, and pinned by `patient-reports.d7.test.ts`. The only
 * question left is what the desk HEARS when it degrades, and until now that
 * depended on how badly it degraded: images whose pixels could not be fetched
 * came back as `{placeholders: n}` and raised a destructive toast, while a
 * freeze that threw — losing EVERY attached picture — came back as nothing and
 * said nothing. The worst case was the quietest.
 */

export type FrozenImageSignRefs = {
  frozen: number;
  placeholders: number;
  skipped: number;
  failed?: boolean;
  error?: string;
};

export type FrozenImageSignMessage = { title: string; description: string };

export function frozenKeyImageSignMessage(
  refs?: FrozenImageSignRefs | null,
): FrozenImageSignMessage | null {
  if (!refs) return null;

  if (refs.failed) {
    const reason = refs.error?.trim();
    return {
      title: "Signed — its attached images could not be saved into the report",
      description:
        `The report is signed and correct, but the pictures attached to it were not copied into the ` +
        `signed artifact${reason ? ` (${reason})` : ""}, so a reprint still depends on PACS and may ` +
        "print IMAGE COULD NOT BE READ. Check PACS availability, then re-capture the images from the " +
        "report's Key Images panel.",
    };
  }

  if (refs.placeholders > 0) {
    const n = refs.placeholders;
    return {
      title: n === 1 ? "1 attached image could not be captured" : `${n} attached images could not be captured`,
      description:
        `${n === 1 ? "An image" : "Some images"} attached to this report could not be fetched from PACS at signing, ` +
        "so the signed copy marks each one IMAGE COULD NOT BE READ. Check PACS availability and re-attach before sharing.",
    };
  }

  return null;
}

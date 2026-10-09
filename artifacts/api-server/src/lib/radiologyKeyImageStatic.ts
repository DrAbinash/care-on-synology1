/**
 * Access control for stored radiology key images.
 *
 * Key images are clinical pictures. A viewport capture can carry the patient's
 * name, UHID or accession burned into the raster by the modality, and no code
 * anywhere in CARE inspects pixels — so the file itself has to be treated as
 * PHI. They live under `data/uploads/radiology-key-images/`, which sits inside
 * the public `/uploads` static mount, so until now the only thing between an
 * unauthenticated request and a patient's MRI screenshot was an unguessable
 * UUID filename. Obscurity is not access control.
 *
 * These handlers are exported rather than inlined in `app.ts` so the boundary
 * can be exercised over real HTTP (`keyImageAccessControl.request.test.ts`).
 * Everything else under `/uploads` — site photos, logos, queue-display assets —
 * keeps its existing behaviour; this narrows one prefix.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { requireStaffAuth, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { FROZEN_KEY_IMAGE_DIR, FROZEN_KEY_IMAGE_URL_PREFIX } from "./frozenKeyImages";

/** Mount point for the guarded prefix (no trailing slash). */
export const KEY_IMAGE_MOUNT = FROZEN_KEY_IMAGE_URL_PREFIX.replace(/\/$/, "");

/**
 * Middleware stack that serves key-image bytes to authenticated staff sessions
 * only. `<img>` cannot send an Authorization header, so the client appends
 * `?staffToken=` — the convention this app already uses for image and stream
 * URLs (worklist SSE, expense attachments, the ERP DICOMweb proxy).
 *
 * Server-side readers are deliberately unaffected: the composer and the print
 * pipeline read these files from disk, so report reopen, thumbnails and the
 * PDF rail all keep working with no token at all.
 */
export function radiologyKeyImageHandlers() {
  return [
    (req: StaffAuthRequest, res: Response, next: NextFunction) =>
      void requireStaffAuth(req, res, next),
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      // `private` + short max-age: a shared cache or CDN must never retain
      // clinical pixels, and the token in the URL changes per session anyway.
      res.setHeader("Cache-Control", "private, max-age=300");
      next();
    },
    express.static(FROZEN_KEY_IMAGE_DIR, { index: false, dotfiles: "ignore" }),
  ];
}

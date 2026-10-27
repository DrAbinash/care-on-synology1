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
 *
 * HOW A REQUEST GETS IN — two ways, and neither puts a session token in a URL:
 *  1. `Authorization: Bearer <staff session>` + `requireStaffPermission("/radiology")`,
 *     which is what a `fetch()`/blob caller uses (the PDF export path).
 *  2. A short-lived, file-bound grant in the query string (`?kimg=…`), which is
 *     what an `<img src>` uses, because an image tag cannot send a header. The
 *     client gets these from
 *     `POST /api/radiology/report-generator/key-images/access-urls` — a normal
 *     authenticated, permission-checked call. See `keyImageAccessToken.ts` for
 *     why the URL carries a grant rather than the staff session token.
 *
 * A `?staffToken=` query token is deliberately NOT honored on this prefix: the
 * worklist SSE stream and expense attachments have used that convention
 * elsewhere, and it is exactly the long-lived credential this file refuses.
 * No grant and no header means no bytes — there is no public fallback path and
 * no anonymous listing.
 *
 * Server-side readers are unaffected either way: the composer and the print
 * pipeline read these files from disk, so report reopen, thumbnails and the PDF
 * rail never depend on a URL grant at all.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import {
  FROZEN_KEY_IMAGE_DIR,
  FROZEN_KEY_IMAGE_URL_PREFIX,
  isSafeKeyImageFilename,
} from "./frozenKeyImages";
import {
  requireStaffAuth,
  requireStaffPermission,
  type StaffAuthRequest,
} from "../middleware/requireStaffAuth";
import {
  KEY_IMAGE_GRANT_QUERY_PARAM,
  verifyKeyImageGrant,
  type KeyImageGrantReason,
} from "./keyImageAccessToken";

/** Mount point for the guarded prefix (no trailing slash). */
export const KEY_IMAGE_MOUNT = FROZEN_KEY_IMAGE_URL_PREFIX.replace(/\/$/, "");

/** The refusal a caller sees for each reason — all of them carry zero image bytes. */
export function keyImageGrantRejection(reason: KeyImageGrantReason): {
  status: number;
  body: { error: string; message: string };
} {
  switch (reason) {
    case "missing":
      return {
        status: 401,
        body: {
          error: "key_image_access_grant_required",
          message:
            "This image needs a short-lived access grant. Open it from the Reporting Workspace, which requests one for you.",
        },
      };
    case "expired":
      return {
        status: 410,
        body: {
          error: "key_image_access_grant_expired",
          message: "This image link expired. Reload the report to get a new one.",
        },
      };
    case "file_mismatch":
      return {
        status: 403,
        body: {
          error: "key_image_access_grant_mismatch",
          message: "This access grant was issued for a different image.",
        },
      };
    default:
      // malformed / bad_signature / secret_unavailable — a tampered URL, or a
      // deployment without a signing secret. Both refuse; neither serves bytes.
      return {
        status: 403,
        body: {
          error: "key_image_access_grant_invalid",
          message: "This image link is not valid. Reload the report to get a new one.",
        },
      };
  }
}

/**
 * The single file name a grant can be bound to, or null when the request is not
 * one bare file under the prefix (directory, nested path, or anything with a
 * traversal shape). `express.static` would resolve a nested path against the
 * upload dir; binding the grant to a basename alone would then be too weak, so
 * the surface is pinned to exactly one segment.
 */
export function keyImageFileKeyFromRequest(req: Request): string | null {
  const rel = String(req.url ?? "").split("?")[0] ?? "";
  const decoded = (() => {
    try {
      return decodeURIComponent(rel);
    } catch {
      return rel;
    }
  })();
  const name = decoded.replace(/^\/+/, "");
  if (!name || name.includes("/") || name.includes("\\")) return null;
  if (!isSafeKeyImageFilename(name)) return null;
  return path.posix.basename(name);
}

export function radiologyKeyImageHandlers() {
  return [
    (req: StaffAuthRequest, res: Response, next: NextFunction) => {
      const header = req.headers.authorization ?? "";
      if (header.startsWith("Bearer ")) {
        // A real staff session in the header, with the module permission the
        // workspace itself needs. Nothing about it appears in the URL.
        void requireStaffAuth(req, res, () =>
          requireStaffPermission("/radiology")(req, res, next),
        );
        return;
      }

      const fileKey = keyImageFileKeyFromRequest(req);
      if (!fileKey) {
        // Not a single guarded file: refuse rather than fall through to the
        // directory. This also kills the directory listing and `/../` shapes.
        res.status(404).json({
          error: "key_image_not_found",
          message: "No image is served at this address.",
        });
        return;
      }
      const token =
        typeof req.query[KEY_IMAGE_GRANT_QUERY_PARAM] === "string"
          ? String(req.query[KEY_IMAGE_GRANT_QUERY_PARAM])
          : null;
      const verified = verifyKeyImageGrant(token, fileKey);
      if (!verified.ok) {
        const rejection = keyImageGrantRejection(verified.reason);
        res.status(rejection.status).json(rejection.body);
        return;
      }
      next();
    },
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      // `private` + short max-age: a shared cache or CDN must never retain
      // clinical pixels; only this user's own browser may, and only briefly.
      res.setHeader("Cache-Control", "private, max-age=300");
      next();
    },
    express.static(FROZEN_KEY_IMAGE_DIR, { index: false, dotfiles: "ignore" }),
  ];
}

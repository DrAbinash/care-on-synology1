# Image Upload Normalization — Status

Covers all document-scan upload paths: `POST /api/scans` (the shared
scan-persistence service), `POST /api/uploads` (general file uploads),
`POST /api/form-f/upload-id` (ID card OCR), `POST /api/expenses/scan-bill`
(expense bill OCR).

## Supported formats

| Format | Accept | Auto-convert | Notes |
|---|---|---|---|
| JPG / JPEG | ✅ | — | Native sharp support |
| PNG | ✅ | — | Native sharp support |
| WEBP | ✅ | — | Native sharp support (decode + encode) |
| PDF | ✅ | — | **Not rasterized.** Stored as-is; no processed/thumbnail variant is generated (sharp cannot render PDF pages to an image). See "PDF handling" below. |
| HEIC / HEIF | ✅ (accepted, allow-listed) | ⚠️ attempted, **unverified** | See "HEIC caveat" below — decode may not actually work depending on this deployment's sharp/libvips build. |

`SAFE_MIME_TYPES` (`lib/db/src/schema/uploadFiles.ts`) is the single
allow-list shared by `/api/uploads` and `/api/scans` — now includes
`image/heic` and `image/heif` (previously absent, silently rejecting them
with a generic "unsupported type" error rather than attempting conversion).

## HEIC caveat — read before relying on this

Tested in this development environment: `sharp`'s reported HEIF codec
support (`sharp.format.heif`) only lists `.avif` as a decodable file
suffix — **not** `.heic`/`.heif`. This is a well-known limitation of
standard prebuilt `sharp`/`libvips` binaries: HEIC decode requires an HEVC
codec that's patent-encumbered, so most prebuilt binaries ship with AVIF
(unencumbered) enabled and HEIC disabled, even though both share the same
underlying HEIF container format.

**This has not been confirmed against the actual production Docker
image's sharp build** — it's possible (though unlikely, since production
uses the same `sharp` npm package via the same install process) that the
production build differs. Until a real iPhone-captured `.heic` photo has
been tested end-to-end:
- Assume HEIC images will be stored as the **original** (pristine, per the
  legal-evidence requirement) but will **not** get a processed/thumbnail
  JPEG variant, and OCR on a HEIC image will likely fail with a clear
  error (`imageVariants.ts` catches the sharp failure and returns a
  specific `variantsError` rather than crashing or silently succeeding
  with wrong output).
- Practical mitigation until confirmed: ask reception staff/patients to
  share ID photos as JPG rather than relying on automatic HEIC conversion,
  or fix the deployment's libvips build to include licensed HEVC decode.

## PDF handling

PDFs are accepted, size-limited, and stored as the original file — but are
**not** processed into a viewable JPEG or thumbnail (`sharp` has no PDF
rasterization capability; that would need a separate library like
`pdf-to-img`/`pdfjs-dist` + a rendering step, not implemented). A PDF scan
therefore has `processedUrl: null` and `thumbnailUrl: null` in its
`scanned_documents` row — this is intentional, not a bug, and
`imageVariants.ts`'s `variantsError` field explains it in the API response
rather than leaving the UI to guess why no preview exists.

## Size limits

`MAX_UPLOAD_SIZE_BYTES = 25 MB` (`lib/db/src/schema/uploadFiles.ts`),
enforced identically by `/api/uploads` and `/api/scans` (previously
`/api/scans` had its own hardcoded `25 * 1024 * 1024` — now references the
same shared constant so the two can't drift).

## Automatic compression / downscaling / quality settings

`artifacts/api-server/src/lib/ocr/idCardPipeline.ts`'s `preprocessScanImage()`
(applied to every processed variant, ID-card OCR, and — as of the
production-readiness pass — expense-bill OCR) now:
1. Auto-orients via EXIF (`sharp().rotate()` with no args).
2. Trims uniform borders (`sharp().trim()`).
3. Normalizes contrast (`sharp().normalize()`).
4. **New:** downscales to a configurable max width (default 2000px,
   `withoutEnlargement: true` so smaller images are never upscaled) —
   previously there was no downscale step at all, meaning a 48MP phone
   photo would be stored and OCR'd at full resolution.
5. Re-encodes as JPEG at a configurable quality (default 88, `mozjpeg: true`).

Thumbnails are a separate, smaller derivation (300px wide, JPEG quality 70)
generated alongside the processed variant — see
`artifacts/api-server/src/lib/ocr/imageVariants.ts`.

## Orientation correction

Implemented via `sharp().rotate()` (step 1 above) for every processed/
thumbnail variant. The **original** is never rotated — EXIF-driven
orientation is a display concern, and altering the original's pixel data
would conflict with the "original = legal evidence, never re-encoded"
requirement. Any consumer displaying the original directly should respect
its EXIF orientation tag itself (most browsers/OSes already do this for
`<img>` tags).

## What is deliberately NOT altered: the original

Per the storage-triad requirement, the **original** file is written to
disk exactly as received — no recompression, no resizing, no orientation
correction, no format conversion — specifically because it is the
legal-evidence copy. All compression/downscaling/orientation-correction
work happens only on the derived processed/thumbnail variants. This is a
deliberate design choice, not an oversight — see
`lib/db/src/schema/scannedDocuments.ts`'s column comments.

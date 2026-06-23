import type { Response } from "express";
import type { ZodError } from "zod/v4";

/**
 * Canonical 4xx error envelope used by every route in this server.
 *
 *   { error: string, details?: Array<{ path: (string|number)[]; message: string }> }
 *
 * - `error` is a short human-readable summary safe to surface as a toast.
 * - `details` is optional; populated for validation failures so the client can
 *   highlight individual fields. The shape mirrors a flattened Zod issue list
 *   without leaking internal codes / metadata.
 */
export type ApiErrorDetail = { path: (string | number)[]; message: string };
export type ApiErrorBody = { error: string; details?: ApiErrorDetail[] };

export function apiError(
  res: Response,
  status: number,
  error: string,
  details?: ApiErrorDetail[],
): Response {
  const body: ApiErrorBody = details && details.length > 0 ? { error, details } : { error };
  return res.status(status).json(body);
}

/** Convenience for Zod parse failures — flattens issues into the envelope. */
export function apiErrorFromZod(
  res: Response,
  status: number,
  error: string,
  zodErr: ZodError,
): Response {
  const details: ApiErrorDetail[] = zodErr.issues.map((i) => ({
    path: i.path as (string | number)[],
    message: i.message,
  }));
  return apiError(res, status, error, details);
}

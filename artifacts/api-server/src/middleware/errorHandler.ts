import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

/**
 * Centralised error handler for the Express API.
 *
 * Rules:
 *  - In production: NEVER return stack traces or internal error details to the client.
 *  - In development: include the stack for easier debugging.
 *  - Validation / Zod errors → 400 with a clean message.
 *  - Auth / permission errors → 401 / 403 (already handled upstream).
 *  - Everything else → 500 with a generic message.
 *
 * This middleware must be registered AFTER all routes and BEFORE any other
 * catch-all (e.g. SPA fallback) so that API errors are handled first.
 */

export interface ApiError extends Error {
  statusCode?: number;
  isValidation?: boolean;
}

export function errorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const isProd = process.env.NODE_ENV === "production";
  const status = err.statusCode ?? 500;

  // Log everything server-side so we can investigate later.
  logger.error({
    message: err.message,
    stack: err.stack,
    cause: (err as any).cause ?? null,
    status,
    url: _req.originalUrl,
    method: _req.method,
  }, "API error caught by global handler");

  // Never leak stack traces or internal details in production.
  const response: Record<string, unknown> = { error: "Internal server error" };

  if (status === 400 && err.message) {
    response.error = err.message;
  }
  if (!isProd) {
    response.detail = err.message;
    response.stack = err.stack;
    response.cause = (err as any).cause?.message ?? (err as any).cause ?? null;
  }

  res.status(status).json(response);
}

/**
 * Express wrapper that catches async route errors and forwards them to the
 * global error handler. Use this around any route handler that returns a Promise.
 */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

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

  // Express's own body-parser (express.json()) throws errors with `.status`
  // (and sometimes `.statusCode`), e.g. malformed JSON in the request body
  // (`err.type === "entity.parse.failed"`) or a payload over the configured
  // size limit (`err.type === "entity.too.large"`). Previously this handler
  // only checked `err.statusCode`, so those errors fell through to the
  // generic 500 branch below — a client sending broken JSON saw "Internal
  // server error" instead of a clear "your request body isn't valid JSON"
  // message, which is confusing to debug from the frontend and looks like a
  // server bug rather than a malformed request.
  const bodyParserType = (err as any).type as string | undefined;
  let status = err.statusCode ?? (err as any).status ?? 500;
  let message = err.message;
  if (bodyParserType === "entity.parse.failed") {
    status = 400;
    message = "Request body is not valid JSON.";
  } else if (bodyParserType === "entity.too.large") {
    status = 413;
    message = "Request body is too large.";
  }

  // Log everything server-side so we can investigate later.
  logger.error({
    message: err.message,
    stack: err.stack,
    cause: (err as any).cause ?? null,
    status,
    bodyParserType: bodyParserType ?? null,
    url: _req.originalUrl,
    method: _req.method,
  }, "API error caught by global handler");

  // Never leak stack traces or internal details in production.
  const response: Record<string, unknown> = { error: "Internal server error" };

  if ((status === 400 || status === 413) && message) {
    response.error = message;
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

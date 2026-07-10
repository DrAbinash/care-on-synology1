// ─────────────────────────────────────────────────────────────────────────────
// Radiology Canonical Catalog — pure validation layer (Tickets B1 + B2).
//
// Everything here is a pure function with no DB / IO, so the guarantees the
// ticket demands (no duplicate aliases/ids/keys, no orphan bindings, no
// parameter cycles, no missing required references, no invalid version
// transitions) are exhaustively unit-testable without a live database.
// ─────────────────────────────────────────────────────────────────────────────

export type CatalogStatus = "draft" | "active" | "deprecated";
export const CATALOG_STATUSES: CatalogStatus[] = ["draft", "active", "deprecated"];

export type ValidationCode =
  | "INVALID_KEY"
  | "DUPLICATE_KEY"
  | "DUPLICATE_ALIAS"
  | "ORPHAN_BINDING"
  | "MISSING_REFERENCE"
  | "CYCLE"
  | "INVALID_STATUS_TRANSITION"
  | "INVALID_VERSION"
  | "VERSION_CONFLICT"
  | "INVALID_FIELD"
  | "NOT_FOUND"
  | "ALREADY_DELETED";

/** Thrown by the service layer; routes translate `.status` into an HTTP code. */
export class CatalogValidationError extends Error {
  code: ValidationCode;
  field?: string;
  /** Suggested HTTP status (409 for conflicts, 404 not found, else 400). */
  status: number;
  constructor(code: ValidationCode, message: string, field?: string) {
    super(message);
    this.name = "CatalogValidationError";
    this.code = code;
    this.field = field;
    this.status =
      code === "NOT_FOUND" ? 404 :
      code === "DUPLICATE_KEY" || code === "DUPLICATE_ALIAS" || code === "VERSION_CONFLICT" || code === "ALREADY_DELETED" ? 409 :
      400;
  }
}

// ── Keys & text normalization ────────────────────────────────────────────────

const KEY_RE = /^[a-z0-9][a-z0-9._:-]*$/;
export const MAX_KEY_LENGTH = 128;

/** Immutable keys are lowercase, dotted/colon/hyphen slugs — stable forever. */
export function isValidKey(key: unknown): key is string {
  return typeof key === "string" && key.length > 0 && key.length <= MAX_KEY_LENGTH && KEY_RE.test(key);
}

export function assertValidKey(key: unknown, field = "key"): string {
  if (!isValidKey(key)) {
    throw new CatalogValidationError(
      "INVALID_KEY",
      `Invalid ${field}: must match ${KEY_RE} and be ≤ ${MAX_KEY_LENGTH} chars`,
      field,
    );
  }
  return key;
}

/** Case/space-insensitive normalization used for synonym + alias dedup. */
export function normalizeText(s: string): string {
  return s.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

// ── Duplicate detection ──────────────────────────────────────────────────────

/** Returns the set of values that appear more than once. */
export function findDuplicates<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const dups = new Set<T>();
  for (const v of values) {
    if (seen.has(v)) dups.add(v);
    else seen.add(v);
  }
  return [...dups];
}

/**
 * True when `candidateNormalized` already exists among live aliases. Callers pass
 * the set of normalized alias values currently in use (excluding soft-deleted).
 */
export function isAliasCollision(liveNormalized: Set<string>, candidateNormalized: string): boolean {
  return liveNormalized.has(candidateNormalized);
}

// ── Reference integrity ──────────────────────────────────────────────────────

/** Bindings whose referenced parent id is not in the set of live parent ids. */
export function findOrphanReferences(
  bindings: Array<{ id: number; refId: number }>,
  liveRefIds: Set<number>,
): number[] {
  return bindings.filter((b) => !liveRefIds.has(b.refId)).map((b) => b.id);
}

// ── Hierarchy cycle detection ────────────────────────────────────────────────

/**
 * Targeted check used on every category create/update: would setting
 * `nodeId`'s parent to `newParentId` introduce a cycle? Walks ancestors of the
 * proposed parent; a cycle exists if we reach `nodeId` again or revisit any
 * node (a pre-existing upstream cycle). O(depth).
 */
export function wouldCreateCycle(
  nodeId: number | null,
  newParentId: number | null | undefined,
  parentOf: (id: number) => number | null | undefined,
): boolean {
  let cur = newParentId ?? null;
  const seen = new Set<number>();
  while (cur != null) {
    if (cur === nodeId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = parentOf(cur) ?? null;
  }
  return false;
}

/**
 * Whole-graph cycle scan (used at import time). Returns the first node id that
 * participates in a cycle, or null. Nodes whose parent is outside the set are
 * treated as roots (missing-reference is validated separately).
 */
export function detectHierarchyCycle(nodes: Array<{ id: number; parentId: number | null }>): number | null {
  const parent = new Map<number, number | null>();
  for (const n of nodes) parent.set(n.id, n.parentId);
  for (const start of parent.keys()) {
    const seen = new Set<number>();
    let cur: number | null = start;
    while (cur != null && parent.has(cur)) {
      if (seen.has(cur)) return cur;
      seen.add(cur);
      cur = parent.get(cur) ?? null;
    }
  }
  return null;
}

// ── Lifecycle: status + version transitions ──────────────────────────────────

const STATUS_TRANSITIONS: Record<CatalogStatus, CatalogStatus[]> = {
  draft: ["draft", "active", "deprecated"],
  active: ["active", "deprecated"],
  deprecated: ["deprecated"],
};

export function isValidStatus(s: unknown): s is CatalogStatus {
  return typeof s === "string" && (CATALOG_STATUSES as string[]).includes(s);
}

/** draft → active → deprecated is one-directional; reversals are rejected. */
export function assertStatusTransition(from: CatalogStatus, to: CatalogStatus): void {
  if (!isValidStatus(to)) {
    throw new CatalogValidationError("INVALID_FIELD", `Unknown status "${to}"`, "status");
  }
  if (!STATUS_TRANSITIONS[from].includes(to)) {
    throw new CatalogValidationError(
      "INVALID_STATUS_TRANSITION",
      `Illegal status transition ${from} → ${to}`,
      "status",
    );
  }
}

/** Versions are monotonic and advance by exactly 1 on each content change. */
export function assertVersionTransition(current: number, next: number): void {
  if (!Number.isInteger(next) || next !== current + 1) {
    throw new CatalogValidationError(
      "INVALID_VERSION",
      `Invalid version transition ${current} → ${next} (must advance by exactly 1)`,
      "version",
    );
  }
}

/** Optimistic-lock guard for updates. */
export function assertExpectedVersion(current: number, expected: number | undefined): void {
  if (expected != null && expected !== current) {
    throw new CatalogValidationError(
      "VERSION_CONFLICT",
      `Version conflict: expected ${expected} but current is ${current}`,
      "expectedVersion",
    );
  }
}

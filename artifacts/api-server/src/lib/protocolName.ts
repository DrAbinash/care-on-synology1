/**
 * Study Tab–scoped protocol / Technique name normalization and duplicate lookup.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { radiologyProtocolsTable } from "@workspace/db/schema";

export function normalizeProtocolName(name: unknown): string {
  return String(name ?? "").trim().toLowerCase();
}

export async function findProtocolByScopedName(input: {
  name: string;
  studyTabId?: number | null;
  studyType?: string | null;
  excludeId?: number;
}) {
  const norm = normalizeProtocolName(input.name);
  if (!norm) return null;

  const tabId = Number(input.studyTabId);
  if (Number.isInteger(tabId) && tabId > 0) {
    const rows = await db
      .select()
      .from(radiologyProtocolsTable)
      .where(
        and(
          eq(radiologyProtocolsTable.studyTabId, tabId),
          sql`lower(trim(${radiologyProtocolsTable.name})) = ${norm}`,
          input.excludeId ? sql`${radiologyProtocolsTable.id} <> ${input.excludeId}` : sql`true`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  const studyType = String(input.studyType ?? "").trim();
  if (!studyType) return null;
  const rows = await db
    .select()
    .from(radiologyProtocolsTable)
    .where(
      and(
        isNull(radiologyProtocolsTable.studyTabId),
        sql`lower(trim(${radiologyProtocolsTable.studyType})) = lower(trim(${studyType}))`,
        sql`lower(trim(${radiologyProtocolsTable.name})) = ${norm}`,
        input.excludeId ? sql`${radiologyProtocolsTable.id} <> ${input.excludeId}` : sql`true`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export function duplicateProtocolErrorPayload(input: {
  name: string;
  studyTabId: number | null;
  studyType: string;
  existingId: number;
}) {
  const label = input.studyType || "this Study Tab";
  return {
    error: `A Technique named '${input.name.trim()}' already exists for ${label}.`,
    code: "DUPLICATE_PROTOCOL_NAME" as const,
    name: input.name.trim(),
    studyTabId: input.studyTabId,
    studyType: input.studyType,
    existingId: input.existingId,
  };
}

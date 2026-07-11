/**
 * reportPresentationConfig.ts — Ticket R1.1: which presentation template the
 * clinic has selected (pacs_settings key `report_presentation_template`).
 * Shared by every surface that renders through lib/reportPresentation.ts.
 * Failure-tolerant: any read problem falls back to the classic default so a
 * report can always print.
 */

import { db } from "@workspace/db";
import { pacsSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_TEMPLATE_ID, PRESENTATION_TEMPLATES } from "./reportPresentation";

export const REPORT_TEMPLATE_SETTING_KEY = "report_presentation_template";

export async function selectedPresentationTemplateId(explicit?: string): Promise<string> {
  if (explicit && PRESENTATION_TEMPLATES.some((t) => t.id === explicit)) return explicit;
  try {
    const [row] = await db
      .select({ value: pacsSettingsTable.value })
      .from(pacsSettingsTable)
      .where(eq(pacsSettingsTable.key, REPORT_TEMPLATE_SETTING_KEY))
      .limit(1);
    const configured = row?.value?.trim() ?? "";
    if (configured && PRESENTATION_TEMPLATES.some((t) => t.id === configured)) return configured;
  } catch { /* settings unreadable → default */ }
  return DEFAULT_TEMPLATE_ID;
}

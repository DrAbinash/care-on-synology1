/**
 * usgTemplateStore.ts — canonical-table lookup for USG report skeletons.
 *
 * The authoritative copy of each USG auto-generate template's skeleton lives
 * in structured_report_templates (modality "USG", studyType = UsgTemplateId,
 * skeleton in defaultFindings) — the same store MRI/CT/X-ray structured
 * templates use, seeded via POST /api/structured-report-templates/seed from
 * USG_STRUCTURED_TEMPLATE_PRESETS. This module is the ONLY bridge between
 * that table and lib/usgReportTemplates.ts's renderer: it fetches the
 * admin-edited skeleton (or null to fall back to the built-in default).
 *
 * Deliberately fail-open: any DB problem (table not migrated yet, connection
 * down) returns null so report generation always works — worst case the
 * built-in skeleton is used, which is exactly the pre-consolidation output.
 * Auto-fill safety (approved-measurements-only, low-confidence guards) lives
 * in the renderer's binding layer and is untouched by anything stored here.
 */

import { db } from "@workspace/db";
import { structuredReportTemplatesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import type { UsgTemplateId } from "./usgReportTemplates";

/** Skeleton override for one template: the active USG row's defaultFindings,
 *  or null when no usable row exists (renderer falls back to the built-in). */
export async function fetchUsgSkeletonOverride(templateId: UsgTemplateId): Promise<string | null> {
  try {
    const rows = await db
      .select({
        defaultFindings: structuredReportTemplatesTable.defaultFindings,
      })
      .from(structuredReportTemplatesTable)
      .where(and(
        eq(structuredReportTemplatesTable.modality, "USG"),
        eq(structuredReportTemplatesTable.studyType, templateId),
        eq(structuredReportTemplatesTable.isActive, true),
      ))
      .orderBy(desc(structuredReportTemplatesTable.updatedAt))
      .limit(1);
    const skeleton = rows[0]?.defaultFindings;
    return skeleton && skeleton.trim().length > 0 ? skeleton : null;
  } catch (err) {
    logger.warn({ err, templateId }, "usgTemplateStore: falling back to built-in skeleton (DB lookup failed)");
    return null;
  }
}

/** The set of template ids that currently have an active row in the
 *  canonical table — used to annotate GET /usg-reports/templates so the UI
 *  can show which templates are DB-backed vs built-in fallback. */
export async function fetchCustomizedUsgTemplateIds(): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ studyType: structuredReportTemplatesTable.studyType })
      .from(structuredReportTemplatesTable)
      .where(and(
        eq(structuredReportTemplatesTable.modality, "USG"),
        eq(structuredReportTemplatesTable.isActive, true),
      ));
    return new Set(rows.map((r) => r.studyType).filter((s): s is string => !!s));
  } catch (err) {
    logger.warn({ err }, "usgTemplateStore: could not list customized templates (DB lookup failed)");
    return new Set();
  }
}

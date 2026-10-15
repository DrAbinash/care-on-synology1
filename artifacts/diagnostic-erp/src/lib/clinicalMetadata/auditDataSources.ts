/**
 * Assembles the real clinical metadata for the anatomy audit.
 *
 * This is the only place that knows where CARE's reporting metadata lives, so
 * the regression tests and the `pnpm audit:anatomy` report cannot drift apart
 * by each remembering a different subset. Everything here is read from source
 * control: catalogue files, baseline manifests, and the static seed SQL under
 * `migrations/`. Nothing connects to a database, reads a patient, or writes a
 * report — and nothing in the app imports this module, which is why it may use
 * `node:fs`.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_QUICK_SELECT_TILES } from "@/lib/zai-workspace/quick-select-tiles.data";
import { CLINICAL_CONTENT_PACKS } from "@/lib/conceptCanon/contentPacks";
import { ownedBaselineCatalog } from "@/lib/zai-workspace/baselines";
import { MRI_LS_SPINE_STANDARD_NORMAL_MANIFEST } from "@/lib/zai-workspace/fullReportBaseline";
import { SECTION_ORDER } from "@/lib/findingsCompose";

import {
  RADIOLOGY_READINESS_SCOPES,
  type AuditContentPack, type AuditInput, type AuditManifest, type AuditSeedBatch, type AuditTile,
} from "./anatomyMetadataAudit";
import { parseQuickFindingInserts } from "./radiologyQuickFindingsSql";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** artifacts/diagnostic-erp/src/lib/clinicalMetadata → repository root. */
export const REPO_ROOT = path.resolve(HERE, "../../../../..");

/** The LS Spine standard normal is a built-in, not a `ownedBaselineCatalog()` member. */
export function baselineManifests(): AuditManifest[] {
  const out: AuditManifest[] = ownedBaselineCatalog().map((e) => ({
    name: e.name,
    revision: e.manifest.revision,
    modality: e.modality,
    bodyPart: e.bodyPart,
    protocolScope: e.protocolScope,
    observations: e.manifest.observations,
  }));
  out.push({
    name: "MRI LS Spine — Standard Normal",
    revision: MRI_LS_SPINE_STANDARD_NORMAL_MANIFEST.revision,
    modality: "MR",
    bodyPart: "LS Spine",
    protocolScope: "Standard",
    observations: MRI_LS_SPINE_STANDARD_NORMAL_MANIFEST.observations,
  });
  return out;
}

/**
 * Every `INSERT INTO radiology_quick_findings` in the migration history, parsed
 * from the checked-in SQL. The live Quick Select strip does not read this table,
 * so these rows are inventoried as what the clinic seeded, not as what the
 * operator clicks.
 */
export function seededQuickFindings(): AuditSeedBatch[] {
  const dir = path.join(REPO_ROOT, "migrations");
  const batches: AuditSeedBatch[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    const text = readFileSync(path.join(dir, f), "utf8");
    if (!/INSERT\s+INTO\s+(?:public\.)?radiology_quick_findings/i.test(text)) continue;
    const b = parseQuickFindingInserts(text, f);
    if (b) batches.push(b);
  }
  return batches;
}

export function loadAuditInput(): AuditInput {
  return {
    tiles: DEFAULT_QUICK_SELECT_TILES as unknown as AuditTile[],
    packs: CLINICAL_CONTENT_PACKS as unknown as AuditContentPack[],
    manifests: baselineManifests(),
    seedBatches: seededQuickFindings(),
    librarySectionOrder: SECTION_ORDER,
    requestedScopes: RADIOLOGY_READINESS_SCOPES,
  };
}

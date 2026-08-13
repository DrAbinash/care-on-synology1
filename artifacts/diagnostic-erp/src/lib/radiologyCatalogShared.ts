/**
 * Shared types and pure helpers for the radiology catalog (no fetchApi import — vitest-safe).
 */

export const RADIOLOGY_CATALOG_API = "/api/radiology/catalog";

export type CatalogStatus = "draft" | "active" | "deprecated";

export type CatalogRow = {
  id: number;
  key: string;
  label: string;
  status: CatalogStatus;
  version: number;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
};

export type ParameterGroupRow = CatalogRow & {
  description?: string | null;
  dataType: string;
  unit?: string | null;
  allowMultiple?: boolean;
};

export type ParameterOptionRow = CatalogRow & {
  groupId: number;
  sortOrder: number;
  codeSystem?: string | null;
  codeValue?: string | null;
};

export type FindingCategoryRow = CatalogRow & {
  parentId?: number | null;
  modality?: string | null;
  sortOrder: number;
};

export type FindingRow = CatalogRow & {
  categoryId: number;
  description?: string | null;
  narrative?: string | null;
  impression?: string | null;
  codeSystem?: string | null;
  codeValue?: string | null;
};

export type FindingGraph = {
  finding: FindingRow;
  category: FindingCategoryRow | null;
  parameters: Array<Record<string, unknown>>;
  synonyms: Array<{ id: number; synonym: string }>;
  aliases: Array<{ id: number; aliasKey: string; source?: string | null }>;
  locations: Array<{ id: number; key: string; label: string }>;
  recommendations: Array<{ id: number; recommendationText: string }>;
  severities: Array<{ id: number; key: string; label: string }>;
  measurements: Array<{ id: number; key: string; label: string }>;
};

export const CATALOG_EDGE_TABLES = [
  "finding_parameter_bindings",
  "finding_synonyms",
  "finding_aliases",
  "finding_locations",
  "finding_recommendations",
  "finding_severity_bindings",
  "finding_measurement_bindings",
] as const;

export type CatalogEdgeTable = typeof CATALOG_EDGE_TABLES[number];

export function catalogStatusBadgeClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
    case "deprecated":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  }
}

import { api } from "@/lib/fetchApi";
import {
  RADIOLOGY_CATALOG_API,
  type CatalogEdgeTable,
  type FindingCategoryRow,
  type FindingGraph,
  type FindingRow,
  type ParameterGroupRow,
} from "./radiologyCatalogShared";

export {
  RADIOLOGY_CATALOG_API,
  catalogStatusBadgeClass,
  CATALOG_EDGE_TABLES,
  type CatalogStatus,
  type CatalogRow,
  type ParameterGroupRow,
  type ParameterOptionRow,
  type FindingCategoryRow,
  type FindingRow,
  type FindingGraph,
  type CatalogEdgeTable,
} from "./radiologyCatalogShared";

export async function probeRadiologyCatalogApi(): Promise<boolean> {
  try {
    await api.get(`${RADIOLOGY_CATALOG_API}/parameter-groups?limit=1`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404") || msg.toLowerCase().includes("not found")) return false;
    throw err;
  }
}

export async function listParameterGroups(q?: string) {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  params.set("limit", "200");
  return api.get<ParameterGroupRow[]>(`${RADIOLOGY_CATALOG_API}/parameter-groups?${params}`);
}

export async function listFindingCategories(q?: string) {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  return api.get<FindingCategoryRow[]>(`${RADIOLOGY_CATALOG_API}/finding-categories?${params}`);
}

export async function listFindings(q?: string) {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  params.set("limit", "100");
  return api.get<FindingRow[]>(`${RADIOLOGY_CATALOG_API}/findings?${params}`);
}

export async function getFindingGraph(id: number) {
  return api.get<FindingGraph>(`${RADIOLOGY_CATALOG_API}/findings/${id}`);
}

export async function deleteCatalogEdge(table: CatalogEdgeTable, id: number) {
  return api.delete(`${RADIOLOGY_CATALOG_API}/edges/${table}/${id}`);
}

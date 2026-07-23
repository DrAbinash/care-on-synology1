/**
 * Organizational chart builder — pure, deterministic.
 * ============================================================================
 * The org chart is DERIVED (owner decision: no new table) from the effective
 * reporting hierarchy (staff_reporting_lines) + staff/department/designation.
 * This module turns a flat node list + reporting edges into a forest, defends
 * against cycles and self-references, and is order-stable so the same input
 * always renders the same tree. No DB, no I/O.
 */

export interface OrgNode {
  staffId: number;
  name: string;
  designation?: string | null;
  department?: string | null;
  isActive?: boolean;
}

export interface ReportingEdge {
  /** The subordinate. */
  staffId: number;
  /** Who they report to. */
  supervisorStaffId: number;
}

export interface OrgChartNode extends OrgNode {
  reports: OrgChartNode[];
}

/**
 * Build the reporting forest. `roots` are everyone with no (valid) supervisor.
 * Only the first supervisor edge per subordinate is used (a "primary" line);
 * edges that would introduce a cycle or reference an unknown/self node are
 * dropped so the result is always a finite tree.
 */
export function buildOrgChart(
  nodes: OrgNode[],
  edges: ReportingEdge[],
): { roots: OrgChartNode[] } {
  const byId = new Map<number, OrgChartNode>();
  for (const n of nodes) byId.set(n.staffId, { ...n, reports: [] });

  // One primary supervisor per subordinate (first edge wins, deterministically).
  const supervisorOf = new Map<number, number>();
  for (const e of edges) {
    if (e.staffId === e.supervisorStaffId) continue;
    if (!byId.has(e.staffId) || !byId.has(e.supervisorStaffId)) continue;
    if (!supervisorOf.has(e.staffId)) supervisorOf.set(e.staffId, e.supervisorStaffId);
  }

  const wouldCycle = (staffId: number, supervisorId: number): boolean => {
    let cur: number | undefined = supervisorId;
    let guard = 0;
    while (cur !== undefined && guard++ <= byId.size) {
      if (cur === staffId) return true;
      cur = supervisorOf.get(cur);
    }
    return false;
  };

  const childIds = new Set<number>();
  for (const [staffId, supId] of supervisorOf) {
    if (wouldCycle(staffId, supId)) continue;
    byId.get(supId)!.reports.push(byId.get(staffId)!);
    childIds.add(staffId);
  }

  const cmp = (a: OrgChartNode, b: OrgChartNode) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.staffId - b.staffId;
  for (const node of byId.values()) node.reports.sort(cmp);

  const roots = [...byId.values()].filter((n) => !childIds.has(n.staffId)).sort(cmp);
  return { roots };
}

/** Total people under a node (excluding the node itself). */
export function countReports(node: OrgChartNode): number {
  return node.reports.reduce((sum, r) => sum + 1 + countReports(r), 0);
}

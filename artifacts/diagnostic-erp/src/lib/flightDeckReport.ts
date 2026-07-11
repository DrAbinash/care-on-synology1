/**
 * flightDeckReport.ts — Ticket M1.3: pure presentation/export helpers for the
 * Radiology Flight Deck admin page.
 *
 * Mirrors the backend's diagnostics contract (radiologyDiagnosticsRules.ts)
 * and turns a DeploymentReport into traffic lights, clipboard text, JSON and
 * Markdown exports. Pure functions only — the page owns all side effects
 * (fetching, clipboard, downloads).
 */

export type CheckStatus = "PASS" | "WARNING" | "FAIL" | "UNKNOWN";
export type DeploymentVerdict = "HEALTHY" | "DEGRADED" | "BROKEN";

export interface DiagnosticCheck {
  id: string;
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
  endpoint?: string;
  httpStatus?: number;
  latencyMs?: number;
  data?: Record<string, unknown>;
}

export interface DiagnosticSection {
  id: string;
  title: string;
  status: CheckStatus;
  checks: DiagnosticCheck[];
}

export interface DeploymentFinding {
  severity: "BLOCKER" | "WARNING";
  where: string;
  why: string;
  fix: string;
}

export interface DeploymentReport {
  generatedAt: string;
  verdict: DeploymentVerdict;
  findings: DeploymentFinding[];
  sections: DiagnosticSection[];
  version: { app: string; commit: string };
  studyInstanceUID?: string;
}

/** SAME mapping as the backend rules module — green/yellow/red/gray. */
export function trafficLight(status: CheckStatus): "green" | "yellow" | "red" | "gray" {
  switch (status) {
    case "PASS": return "green";
    case "WARNING": return "yellow";
    case "FAIL": return "red";
    default: return "gray";
  }
}

export const LIGHT_CLASSES: Record<ReturnType<typeof trafficLight>, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
  gray: "bg-gray-400",
};

export const VERDICT_STYLE: Record<DeploymentVerdict, { label: string; className: string }> = {
  HEALTHY: { label: "HEALTHY — ready for clinical use", className: "bg-green-100 text-green-800 border-green-300" },
  DEGRADED: { label: "DEGRADED — usable, fix the findings below", className: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  BROKEN: { label: "BROKEN — deployment blockers present", className: "bg-red-100 text-red-800 border-red-300" },
};

export function countByStatus(sections: DiagnosticSection[]): Record<CheckStatus, number> {
  const counts: Record<CheckStatus, number> = { PASS: 0, WARNING: 0, FAIL: 0, UNKNOWN: 0 };
  for (const section of sections) {
    for (const c of section.checks) counts[c.status] += 1;
  }
  return counts;
}

const STATUS_ICON: Record<CheckStatus, string> = { PASS: "🟢", WARNING: "🟡", FAIL: "🔴", UNKNOWN: "⚪" };

/** Deterministic Markdown export — the shareable deployment report. */
export function reportToMarkdown(report: DeploymentReport): string {
  const lines: string[] = [];
  lines.push("# CARE Radiology — Deployment Diagnostics");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Verdict: **${report.verdict}**`);
  lines.push(`- Version: ${report.version.app} (${report.version.commit})`);
  if (report.studyInstanceUID) lines.push(`- Study: ${report.studyInstanceUID}`);
  lines.push("");

  if (report.findings.length > 0) {
    lines.push("## Findings (what to fix)");
    lines.push("");
    for (const f of report.findings) {
      lines.push(`- **${f.severity}** \`${f.where}\``);
      lines.push(`  - Why: ${f.why}`);
      lines.push(`  - Fix: ${f.fix}`);
    }
    lines.push("");
  } else {
    lines.push("## Findings");
    lines.push("");
    lines.push("No blockers or warnings — all checks passed.");
    lines.push("");
  }

  for (const section of report.sections) {
    lines.push(`## ${section.title} — ${section.status}`);
    lines.push("");
    for (const c of section.checks) {
      lines.push(`- ${STATUS_ICON[c.status]} **${c.name}** (\`${c.id}\`): ${c.detail}`);
      if (c.endpoint) lines.push(`  - Endpoint: ${c.endpoint}`);
      if (typeof c.latencyMs === "number") lines.push(`  - Latency: ${c.latencyMs}ms${typeof c.httpStatus === "number" ? ` · HTTP ${c.httpStatus}` : ""}`);
      if (c.fix) lines.push(`  - Fix: ${c.fix}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Compact single-check summary used for per-row copy buttons. */
export function checkToText(check: DiagnosticCheck): string {
  const parts = [`[${check.status}] ${check.id} — ${check.name}: ${check.detail}`];
  if (check.endpoint) parts.push(`endpoint: ${check.endpoint}`);
  if (check.fix) parts.push(`fix: ${check.fix}`);
  return parts.join("\n");
}

export function exportFileName(kind: "json" | "md", generatedAt: string): string {
  const stamp = generatedAt.replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return `radiology-diagnostics_${stamp}.${kind === "json" ? "json" : "md"}`;
}

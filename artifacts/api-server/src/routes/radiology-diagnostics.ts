/**
 * radiology-diagnostics.ts — Ticket M1.3: the Flight Deck API.
 *
 * Mounted at /api/radiology-diagnostics behind requireStaffAuth +
 * requireStaffPermission("/radiology") + requireAdminRole — this is the
 * clinic administrator's deployment toolkit and exposes UNMASKED endpoint
 * topology, so it is admin-only end to end.
 *
 * EVERY endpoint is read-only. The only writes anywhere on this router are
 * hash-chained audit entries recording that a diagnostic ran. Backend v1 is
 * frozen; this surface only observes it.
 */

import { Router, type Response } from "express";
import { requireAdminRole, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { auditFromRequest } from "../lib/audit";
import {
  buildDeploymentReport,
  runNetworkDiagnostics,
  runSettingsVerification,
  runStudyDiagnostics,
  runSystemDiagnostics,
  runViewerDiagnostics,
  runWorkflowSimulation,
} from "../lib/radiologyDeploymentDiagnostics";
import { getAcceptanceChecklistMeta } from "../lib/pacs/radiologyE2eAcceptance";
import { getMwlDeploymentStatus } from "../lib/pacs/mwlDeploymentStatus";

export const radiologyDiagnosticsRouter = Router();
radiologyDiagnosticsRouter.use(requireAdminRole);

const UID_RE = /^[0-9.]{1,128}$/;

function fail(res: Response, err: unknown): void {
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
}

// Full deployment report (Phase 8) — optionally scoped to one study.
radiologyDiagnosticsRouter.get("/report", async (req: StaffAuthRequest, res: Response) => {
  try {
    const study = typeof req.query.study === "string" && UID_RE.test(req.query.study) ? req.query.study : undefined;
    const report = await buildDeploymentReport({ studyInstanceUID: study });
    await auditFromRequest(req, {
      userId: req.staffSession?.subjectId ?? null,
      userName: req.staffSession?.subjectName ?? "unknown",
      role: req.staffSession?.role ?? "unknown",
      action: "radiology_diagnostics_report",
      module: "radiology",
      entityType: "radiology_diagnostics",
      entityId: "deployment_report",
      newValue: JSON.stringify({ verdict: report.verdict, findings: report.findings.length, study: study ?? null }),
    }).catch(() => undefined);
    res.json(report);
  } catch (err) {
    fail(res, err);
  }
});

// Individual sections — same canonical service, smaller scopes.
radiologyDiagnosticsRouter.get("/viewer", async (_req: StaffAuthRequest, res: Response) => {
  try {
    res.json(await runViewerDiagnostics());
  } catch (err) {
    fail(res, err);
  }
});

radiologyDiagnosticsRouter.get("/network", async (_req: StaffAuthRequest, res: Response) => {
  try {
    res.json(await runNetworkDiagnostics());
  } catch (err) {
    fail(res, err);
  }
});

radiologyDiagnosticsRouter.get("/system", async (_req: StaffAuthRequest, res: Response) => {
  try {
    res.json(await runSystemDiagnostics());
  } catch (err) {
    fail(res, err);
  }
});

radiologyDiagnosticsRouter.get("/settings", async (_req: StaffAuthRequest, res: Response) => {
  try {
    res.json(await runSettingsVerification());
  } catch (err) {
    fail(res, err);
  }
});

// Per-study diagnostics (Phase 5).
radiologyDiagnosticsRouter.get("/study/:studyInstanceUID", async (req: StaffAuthRequest, res: Response) => {
  const uid = String(req.params.studyInstanceUID ?? "");
  if (!UID_RE.test(uid)) {
    res.status(400).json({ error: "invalid StudyInstanceUID (digits and dots only, max 128 chars)" });
    return;
  }
  try {
    res.json(await runStudyDiagnostics(uid));
  } catch (err) {
    fail(res, err);
  }
});

// The ONE "Run Complete Workflow" button (Phase 7). POST because it is an
// operator-initiated run worth auditing — but it performs NO writes beyond
// the audit entry: every step is a dry-run over live data.
radiologyDiagnosticsRouter.post("/workflow-simulation", async (req: StaffAuthRequest, res: Response) => {
  try {
    const section = await runWorkflowSimulation();
    await auditFromRequest(req, {
      userId: req.staffSession?.subjectId ?? null,
      userName: req.staffSession?.subjectName ?? "unknown",
      role: req.staffSession?.role ?? "unknown",
      action: "radiology_workflow_simulation",
      module: "radiology",
      entityType: "radiology_diagnostics",
      entityId: "workflow_simulation",
      newValue: JSON.stringify({ status: section.status, checks: section.checks.length }),
    }).catch(() => undefined);
    res.json(section);
  } catch (err) {
    fail(res, err);
  }
});

/**
 * GET /api/radiology-diagnostics/acceptance-checklist
 * Read-only: static acceptance cards + live MWL readiness counts.
 * Never creates patients, bills, or .wl files.
 */
radiologyDiagnosticsRouter.get("/acceptance-checklist", async (_req: StaffAuthRequest, res: Response) => {
  try {
    const meta = getAcceptanceChecklistMeta();
    let infrastructure: {
      ready: boolean;
      verdict?: string;
      wlFileCount: number;
      activeProcedureCount?: number;
      quarantineCount?: number;
    } | null = null;
    try {
      const mwl = await getMwlDeploymentStatus();
      infrastructure = {
        ready: mwl.ready,
        verdict: mwl.verdict,
        wlFileCount: mwl.wlFileCount,
        activeProcedureCount: mwl.activeProcedureCount,
        quarantineCount: mwl.quarantineCount,
      };
    } catch {
      infrastructure = null;
    }
    res.json({ ...meta, infrastructure });
  } catch (err) {
    fail(res, err);
  }
});

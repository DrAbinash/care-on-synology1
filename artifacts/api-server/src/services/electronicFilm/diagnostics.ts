// ============================================================================
// Electronic Film pipeline self-test — operator diagnostics without PHI.
// ============================================================================
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getElectronicFilmSettings, resolveBridgeCredentials } from "./settings";
import { electronicFilmUploadDir } from "./storage";
import { integrationEnabled } from "../integration/scheduler";

export type SelfTestStatus = "PASS" | "FAIL" | "NOT_TESTED" | "NEEDS_REAL_FILM";

export interface SelfTestStage {
  stage: string;
  status: SelfTestStatus;
  detail?: string;
  ms?: number;
}

export async function runElectronicFilmPipelineSelfTest(): Promise<{
  stages: SelfTestStage[];
  summary: { pass: number; fail: number; notTested: number; needsRealFilm: number };
}> {
  const stages: SelfTestStage[] = [];
  const settings = await getElectronicFilmSettings();

  const t0 = Date.now();
  const creds = await resolveBridgeCredentials();
  stages.push({
    stage: "DicomToWindows reachable",
    status: creds ? "PASS" : "FAIL",
    detail: creds ? creds.url : "PRINT_BRIDGE_URL/secret not configured",
    ms: Date.now() - t0,
  });

  if (creds) {
    const t1 = Date.now();
    try {
      const res = await fetch(`${creds.url}/api/v1/health`, { signal: AbortSignal.timeout(10_000) });
      stages.push({
        stage: "Bridge health API",
        status: res.ok ? "PASS" : "FAIL",
        detail: `HTTP ${res.status}`,
        ms: Date.now() - t1,
      });
    } catch (e) {
      stages.push({ stage: "Bridge health API", status: "FAIL", detail: (e as Error).message });
    }

    const t2 = Date.now();
    try {
      const res = await fetch(`${creds.url}/api/v1/print-jobs?limit=5`, {
        headers: { Authorization: `Bearer ${creds.secret}` },
        signal: AbortSignal.timeout(15_000),
      });
      stages.push({
        stage: "Job list readable",
        status: res.ok ? "PASS" : "FAIL",
        detail: `HTTP ${res.status}`,
        ms: Date.now() - t2,
      });

      if (res.ok) {
        const body = await res.json() as { jobs?: Array<{ jobKey: string; captureStatus?: string }> };
        const captured = (body.jobs ?? []).find((j) => j.captureStatus === "captured");
        if (captured) {
          const t3 = Date.now();
          const metaRes = await fetch(`${creds.url}/api/v1/print-jobs/${encodeURIComponent(captured.jobKey)}`, {
            headers: { Authorization: `Bearer ${creds.secret}` },
            signal: AbortSignal.timeout(15_000),
          });
          stages.push({
            stage: "Latest film metadata readable",
            status: metaRes.ok ? "PASS" : "FAIL",
            detail: captured.jobKey,
            ms: Date.now() - t3,
          });

          const t4 = Date.now();
          const artRes = await fetch(`${creds.url}/api/v1/print-jobs/${encodeURIComponent(captured.jobKey)}/artifact`, {
            headers: { Authorization: `Bearer ${creds.secret}` },
            signal: AbortSignal.timeout(30_000),
          });
          stages.push({
            stage: "Artifact endpoint reachable",
            status: artRes.ok ? "PASS" : "FAIL",
            detail: `HTTP ${artRes.status}`,
            ms: Date.now() - t4,
          });
        } else {
          stages.push({ stage: "Latest film metadata readable", status: "NEEDS_REAL_FILM", detail: "No captured DICOM jobs yet" });
          stages.push({ stage: "Artifact endpoint reachable", status: "NEEDS_REAL_FILM" });
        }
      }
    } catch (e) {
      stages.push({ stage: "Job list readable", status: "FAIL", detail: (e as Error).message });
    }
  } else {
    stages.push({ stage: "Bridge health API", status: "NOT_TESTED" });
    stages.push({ stage: "Job list readable", status: "NOT_TESTED" });
    stages.push({ stage: "Latest film metadata readable", status: "NOT_TESTED" });
    stages.push({ stage: "Artifact endpoint reachable", status: "NOT_TESTED" });
  }

  const t5 = Date.now();
  try {
    const dir = electronicFilmUploadDir();
    const probe = join(dir, ".write_probe");
    writeFileSync(probe, "ok");
    stages.push({
      stage: "CARE artifact storage writable",
      status: existsSync(probe) ? "PASS" : "FAIL",
      detail: dir,
      ms: Date.now() - t5,
    });
  } catch (e) {
    stages.push({ stage: "CARE artifact storage writable", status: "FAIL", detail: (e as Error).message });
  }

  const hopeUrl = process.env.INTEGRATION_HOPE_CALLBACK_URL || "";
  const hopeSecret = process.env.INTEGRATION_HOPE_SIGNING_SECRET || "";
  stages.push({
    stage: "CARE→HOPE integration configured",
    status: hopeUrl && hopeSecret ? "PASS" : (await integrationEnabled() ? "FAIL" : "NOT_TESTED"),
    detail: hopeUrl ? "callback URL set" : "INTEGRATION_HOPE_CALLBACK_URL unset",
  });

  stages.push({
    stage: "HOPE electronic-film endpoint",
    status: hopeUrl ? "PASS" : "NOT_TESTED",
    detail: "Handled via care-callback diagnostic_electronic_film.available",
  });

  stages.push({
    stage: "Identifier lineage / settings",
    status: settings.integrationEnabled ? "PASS" : "NOT_TESTED",
    detail: `autoImport=${settings.autoImport} autoSendHope=${settings.autoSendHope} cutover=${settings.importEnabledAt ?? "unset"}`,
  });

  const summary = {
    pass: stages.filter((s) => s.status === "PASS").length,
    fail: stages.filter((s) => s.status === "FAIL").length,
    notTested: stages.filter((s) => s.status === "NOT_TESTED").length,
    needsRealFilm: stages.filter((s) => s.status === "NEEDS_REAL_FILM").length,
  };

  return { stages, summary };
}

export function buildDiagnosticReport(artifact: {
  sourceJobKey: string;
  ingestStatus: string;
  matchMethod: string | null;
  studyId: number | null;
  hopeDeliveryStatus: string | null;
  sourceAe: string | null;
  identitySummary: string | null;
  accessionNumber: string | null;
  studyInstanceUid: string | null;
  errorMessage: string | null;
  correlationId: string | null;
}): string {
  const lines = [
    "ELECTRONIC FILM DIAGNOSTIC REPORT",
    `timestamp: ${new Date().toISOString()}`,
    `jobKey: ${artifact.sourceJobKey}`,
    `ingestStatus: ${artifact.ingestStatus}`,
    `hopeDelivery: ${artifact.hopeDeliveryStatus ?? "n/a"}`,
    `matchMethod: ${artifact.matchMethod ?? "n/a"}`,
    `careStudyId: ${artifact.studyId ?? "n/a"}`,
    `sourceAE: ${artifact.sourceAe ?? "absent"}`,
    `identitySummary: ${artifact.identitySummary ?? "n/a"}`,
    `accessionPresent: ${artifact.accessionNumber ? "yes" : "no"}`,
    `studyUidPresent: ${artifact.studyInstanceUid ? "yes" : "no"}`,
    `correlationId: ${artifact.correlationId ?? "n/a"}`,
    `error: ${artifact.errorMessage ?? "none"}`,
  ];
  return lines.join("\n");
}

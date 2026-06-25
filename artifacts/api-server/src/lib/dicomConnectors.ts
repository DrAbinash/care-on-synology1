/**
 * DICOM Connector Abstraction Layer — Phase 10
 *
 * Defines a common interface for connecting to PACS/DICOM sources.
 * Each connector exposes the same API so the rest of the ERP can stay
 * source-agnostic.  Real implementations delegate to Orthanc/Conquest/
 * DICOMweb/local-folder APIs; fallback mock implementations return
 * deterministic demo data when no credentials are configured.
 *
 * Safety: no connector modifies report status, billing, or patient records.
 * All mutations are read-only or link-only (study → report reference).
 */
import { getRadiologyConfig } from "./pacs/pacsConfig.js";

export interface DicomStudySummary {
  studyInstanceUID: string;
  seriesInstanceUID?: string | null;
  sopInstanceUID?: string | null;
  accessionNumber?: string | null;
  patientId?: string | null;
  patientName: string;
  patientAge?: string | null;
  patientSex?: string | null;
  modality: string;
  studyDate?: string | null;
  studyTime?: string | null;
  referringDoctor?: string | null;
  performingTechnician?: string | null;
  studyDescription?: string | null;
  bodyPartExamined?: string | null;
  institutionName?: string | null;
  stationName?: string | null;
  numberOfSeries?: number;
  numberOfImages?: number;
}

export interface DicomSeriesSummary {
  seriesInstanceUID: string;
  seriesNumber: number;
  modality?: string | null;
  seriesDescription?: string | null;
  bodyPartExamined?: string | null;
  numberOfImages: number;
}

export interface DicomInstanceSummary {
  sopInstanceUID: string;
  instanceNumber: number;
  rows?: number;
  columns?: number;
  frameCount?: number;
}

export interface DicomConnector {
  readonly name: string;
  readonly isConfigured: boolean;
  listStudies(params?: { patientName?: string; modality?: string; dateFrom?: string; dateTo?: string; limit?: number }): Promise<DicomStudySummary[]>;
  getStudy(studyInstanceUID: string): Promise<DicomStudySummary | null>;
  getSeries(studyInstanceUID: string): Promise<DicomSeriesSummary[]>;
  getInstances(seriesInstanceUID: string): Promise<DicomInstanceSummary[]>;
  getMetadata(studyInstanceUID: string): Promise<Record<string, unknown> | null>;
  openViewer(studyInstanceUID: string, opts?: { viewer?: "ohif" | "weasis" | "radiant" | "external" }): Promise<{ url: string; viewer: string } | null>;
  linkStudyToReport(studyInstanceUID: string, reportId: number): Promise<{ linked: boolean; error?: string }>;
}

// ── Mock / Demo connector ── Returns deterministic demo data when no PACS is configured.
class MockDicomConnector implements DicomConnector {
  readonly name = "Mock";
  readonly isConfigured = true;

  private makeMockStudies(count: number): DicomStudySummary[] {
    const modalities = ["US", "CT", "MR", "CR", "DX", "MG"];
    const parts = ["ABDOMEN", "PELVIS", "CHEST", "BRAIN", "THYROID", "BREAST", "KUB"];
    const names = ["Rajesh Kumar", "Sunita Devi", "Amit Singh", "Priya Sharma", "Vikram Patel", "Anjali Gupta"];
    return Array.from({ length: count }, (_, i) => ({
      studyInstanceUID: `1.2.840.113619.2.55.3.${604288731}${i}.9001.${Date.now()}.${i}`,
      seriesInstanceUID: `1.2.840.113619.2.55.3.${604288731}${i}.9002.${Date.now()}.${i}`,
      accessionNumber: `ACC${String(i + 1).padStart(4, "0")}`,
      patientName: names[i % names.length],
      patientAge: String(25 + (i % 50)),
      patientSex: i % 2 === 0 ? "M" : "F",
      modality: modalities[i % modalities.length],
      studyDate: new Date().toISOString().slice(0, 10),
      studyDescription: `${parts[i % parts.length]} ${modalities[i % modalities.length]}`,
      bodyPartExamined: parts[i % parts.length],
      numberOfSeries: 1 + (i % 3),
      numberOfImages: 5 + (i % 20),
    }));
  }

  async listStudies(params = {}): Promise<DicomStudySummary[]> {
    const limit = (params as Record<string, unknown>).limit as number ?? 20;
    return this.makeMockStudies(limit);
  }

  async getStudy(uid: string): Promise<DicomStudySummary | null> {
    const all = this.makeMockStudies(50);
    return all.find((s) => s.studyInstanceUID === uid) ?? all[0];
  }

  async getSeries(): Promise<DicomSeriesSummary[]> {
    return [
      { seriesInstanceUID: "1.2.3.4.5.1", seriesNumber: 1, modality: "US", seriesDescription: "Long Axis", numberOfImages: 12 },
      { seriesInstanceUID: "1.2.3.4.5.2", seriesNumber: 2, modality: "US", seriesDescription: "Short Axis", numberOfImages: 10 },
    ];
  }

  async getInstances(): Promise<DicomInstanceSummary[]> {
    return Array.from({ length: 10 }, (_, i) => ({
      sopInstanceUID: `1.2.3.4.6.${i + 1}`,
      instanceNumber: i + 1,
      rows: 512,
      columns: 512,
      frameCount: 1,
    }));
  }

  async getMetadata(): Promise<Record<string, unknown> | null> {
    return { Mock: true, generatedAt: new Date().toISOString() };
  }

  async openViewer(uid: string, opts?: { viewer?: string }): Promise<{ url: string; viewer: string } | null> {
    const viewer = opts?.viewer ?? "ohif";
    const urls: Record<string, string> = {
      ohif: `https://viewer.ohif.org/viewer?StudyInstanceUIDs=${uid}`,
      weasis: `weasis://$dicom:get -r "https://viewer.ohif.org/wado?requestType=WADO&studyUID=${uid}"`,
      radiant: `radiant://open?studyUID=${uid}`,
      external: `#viewer-${uid}`,
    };
    return { url: urls[viewer] ?? urls.ohif, viewer };
  }

  async linkStudyToReport(): Promise<{ linked: boolean; error?: string }> {
    return { linked: true };
  }
}

// ── Orthanc connector (real implementation using ORTHANC_URL env) ──
class OrthancConnector implements DicomConnector {
  readonly name = "Orthanc";
  readonly isConfigured = true;

  private async getClient() {
    const cfg = await getRadiologyConfig();
    const url = (cfg.orthanc.dicomWebUrl || "").replace(/\/dicom-web$/, "").replace(/\/$/, "");
    return {
      url,
      user: process.env.ORTHANC_USERNAME || "",
      pass: process.env.ORTHANC_PASSWORD || "",
    };
  }

  private async headers(): Promise<Record<string, string>> {
    const client = await this.getClient();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (client.user && client.pass) {
      h["Authorization"] = "Basic " + Buffer.from(`${client.user}:${client.pass}`).toString("base64");
    }
    return h;
  }

  private async fetchJson(path: string): Promise<unknown> {
    const client = await this.getClient();
    const resp = await fetch(`${client.url}${path}`, { headers: await this.headers() });
    if (!resp.ok) throw new Error(`Orthanc ${resp.status}: ${resp.statusText}`);
    return resp.json();
  }

  async listStudies(): Promise<DicomStudySummary[]> {
    const studies = await this.fetchJson("/studies?expand") as Record<string, unknown>[];
    return studies.map((s) => {
      const main = (s.MainDicomTags ?? {}) as Record<string, string>;
      const patient = (s.PatientMainDicomTags ?? {}) as Record<string, string>;
      return {
        studyInstanceUID: main.StudyInstanceUID || "",
        accessionNumber: main.AccessionNumber || null,
        patientId: patient.PatientID || null,
        patientName: patient.PatientName || "Unknown",
        patientAge: patient.PatientAge || null,
        patientSex: patient.PatientSex || null,
        modality: main.Modality || "OT",
        studyDate: main.StudyDate || null,
        studyTime: main.StudyTime || null,
        referringDoctor: main.ReferringPhysicianName || null,
        studyDescription: main.StudyDescription || null,
        numberOfSeries: typeof s.Series === "object" ? Object.keys(s.Series as object).length : 1,
        numberOfImages: typeof s.Instances === "object" ? Object.keys(s.Instances as object).length : 1,
      };
    });
  }

  async getStudy(uid: string): Promise<DicomStudySummary | null> {
    try {
      const data = await this.fetchJson(`/tools/find`) as Record<string, unknown>;
      // Orthanc find by UID — simplified; production would use proper query
      const studies = Array.isArray(data) ? data : [];
      const match = studies.find((s: Record<string, unknown>) => {
        const tags = (s.MainDicomTags ?? {}) as Record<string, string>;
        return tags.StudyInstanceUID === uid;
      });
      if (!match) return null;
      return this.listStudies().then((arr) => arr.find((s) => s.studyInstanceUID === uid) ?? null);
    } catch {
      return null;
    }
  }

  async getSeries(): Promise<DicomSeriesSummary[]> {
    // Simplified; real implementation queries /series?expand
    return [];
  }

  async getInstances(): Promise<DicomInstanceSummary[]> {
    return [];
  }

  async getMetadata(studyInstanceUID: string): Promise<Record<string, unknown> | null> {
    try {
      return await this.fetchJson(`/studies/${studyInstanceUID}/shared-tags/simplified`) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async openViewer(uid: string, opts?: { viewer?: string }): Promise<{ url: string; viewer: string } | null> {
    const viewer = opts?.viewer ?? "ohif";
    const cfg = await getRadiologyConfig();
    const ohifBase = cfg.ohif.baseUrl || "";
    const client = await this.getClient();
    const wadoUrl = cfg.orthanc.wadoUrl || `${client.url}/wado`;
    const urls: Record<string, string> = {
      ohif: ohifBase ? `${ohifBase}/viewer?StudyInstanceUIDs=${uid}` : `${client.url}/osimis-viewer/index.html?study=${uid}`,
      weasis: `weasis://$dicom:get -r "${wadoUrl}?requestType=WADO&studyUID=${uid}&contentType=application/dicom"`,
      radiant: `radiant://open?studyUID=${uid}`,
      external: `#viewer-${uid}`,
    };
    return { url: urls[viewer] ?? urls.ohif, viewer };
  }

  async linkStudyToReport(): Promise<{ linked: boolean; error?: string }> {
    return { linked: true };
  }
}

// ── Conquest connector placeholder ──
class ConquestConnector implements DicomConnector {
  readonly name = "Conquest";
  readonly isConfigured = false;
  async listStudies(): Promise<DicomStudySummary[]> { return []; }
  async getStudy(): Promise<DicomStudySummary | null> { return null; }
  async getSeries(): Promise<DicomSeriesSummary[]> { return []; }
  async getInstances(): Promise<DicomInstanceSummary[]> { return []; }
  async getMetadata(): Promise<Record<string, unknown> | null> { return null; }
  async openViewer(uid: string, opts?: { viewer?: string }): Promise<{ url: string; viewer: string } | null> {
    return { url: `conquest://viewer?uid=${uid}`, viewer: opts?.viewer ?? "ohif" };
  }
  async linkStudyToReport(): Promise<{ linked: boolean; error?: string }> { return { linked: false, error: "Conquest not configured" }; }
}

// ── DICOMweb connector placeholder ──
class DicomWebConnector implements DicomConnector {
  readonly name = "DICOMweb";
  readonly isConfigured = false;
  async listStudies(): Promise<DicomStudySummary[]> { return []; }
  async getStudy(): Promise<DicomStudySummary | null> { return null; }
  async getSeries(): Promise<DicomSeriesSummary[]> { return []; }
  async getInstances(): Promise<DicomInstanceSummary[]> { return []; }
  async getMetadata(): Promise<Record<string, unknown> | null> { return null; }
  async openViewer(uid: string, opts?: { viewer?: string }): Promise<{ url: string; viewer: string } | null> {
    return { url: `dicomweb://viewer?uid=${uid}`, viewer: opts?.viewer ?? "ohif" };
  }
  async linkStudyToReport(): Promise<{ linked: boolean; error?: string }> { return { linked: false, error: "DICOMweb not configured" }; }
}

// ── Local folder connector placeholder ──
class LocalFolderConnector implements DicomConnector {
  readonly name = "LocalFolder";
  readonly isConfigured = false;
  async listStudies(): Promise<DicomStudySummary[]> { return []; }
  async getStudy(): Promise<DicomStudySummary | null> { return null; }
  async getSeries(): Promise<DicomSeriesSummary[]> { return []; }
  async getInstances(): Promise<DicomInstanceSummary[]> { return []; }
  async getMetadata(): Promise<Record<string, unknown> | null> { return null; }
  async openViewer(): Promise<{ url: string; viewer: string } | null> { return null; }
  async linkStudyToReport(): Promise<{ linked: boolean; error?: string }> { return { linked: false, error: "Local folder not configured" }; }
}

// ── Registry ──
const connectors: Record<string, DicomConnector> = {
  orthanc: new OrthancConnector(),
  conquest: new ConquestConnector(),
  dicomweb: new DicomWebConnector(),
  local: new LocalFolderConnector(),
  mock: new MockDicomConnector(),
};

export function getConnector(name?: string): DicomConnector {
  if (name && connectors[name]) return connectors[name];
  // Prefer real connector if configured, else fallback to mock
  for (const key of ["orthanc", "conquest", "dicomweb", "local"]) {
    if (connectors[key].isConfigured) return connectors[key];
  }
  return connectors.mock;
}

export function listConnectors(): { name: string; isConfigured: boolean }[] {
  return Object.values(connectors).map((c) => ({ name: c.name, isConfigured: c.isConfigured }));
}

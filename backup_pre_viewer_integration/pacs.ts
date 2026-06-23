import { Router } from "express";
import { z } from "zod/v4";
import { requireStaffAuth } from "../middleware/requireStaffAuth";

const router = Router();

// Defense-in-depth: enforce staff authentication at the router level.
// These endpoints proxy requests to the PACS/Orthanc backend using stored
// credentials and return patient imaging data — unauthenticated access would
// expose DICOM patient records and internal PACS configuration.
router.use(requireStaffAuth);

// Orthanc resource IDs are 36-char hex UUIDs with dashes (8-4-4-4-12). We
// validate them with a permissive hex pattern so that arbitrary user input
// can never be smuggled into the upstream Orthanc URL.
const OrthancId = z.string().regex(/^[A-Fa-f0-9-]{8,64}$/, "Invalid Orthanc ID");
const OrthancPatientIdParams = z.object({ orthancPatientId: OrthancId });
const OrthancIdParams = z.object({ id: OrthancId });

function getOrthancConfig() {
  const url = (process.env.ORTHANC_URL || "").replace(/\/$/, "");
  const user = process.env.ORTHANC_USERNAME || "";
  const pass = process.env.ORTHANC_PASSWORD || "";
  return { url, user, pass };
}

function orthancHeaders(user: string, pass: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (user && pass) {
    headers["Authorization"] = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  }
  return headers;
}

async function orthancFetch(path: string): Promise<{ ok: boolean; data: unknown; status: number }> {
  const { url, user, pass } = getOrthancConfig();
  if (!url) return { ok: false, data: { error: "PACS not configured" }, status: 503 };
  try {
    const resp = await fetch(`${url}${path}`, { headers: orthancHeaders(user, pass) });
    const data = await resp.json();
    return { ok: resp.ok, data, status: resp.status };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Connection failed";
    return { ok: false, data: { error: msg }, status: 503 };
  }
}

// ─── Config / health ────────────────────────────────────────────────────────

router.get("/config", (_req, res) => {
  const { url, user } = getOrthancConfig();
  res.json({
    configured: !!url,
    url: url || null,
    hasCredentials: !!(user),
    viewerType: process.env.PACS_VIEWER_TYPE || "weasis",
    ohifUrl: process.env.OHIF_URL || null,
  });
});

router.get("/health", async (_req, res) => {
  const { ok, data } = await orthancFetch("/system");
  res.status(ok ? 200 : 503).json({ connected: ok, system: ok ? data : null });
});

// ─── Patients ────────────────────────────────────────────────────────────────

router.get("/patients", async (_req, res): Promise<void> => {
  const { ok, data, status } = await orthancFetch("/patients?expand");
  if (!ok) { res.status(status).json(data); return; }
  res.json(data);
});

router.get("/patients/:orthancPatientId", async (req, res): Promise<void> => {
  const p = OrthancPatientIdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const { ok, data, status } = await orthancFetch(`/patients/${p.data.orthancPatientId}`);
  if (!ok) { res.status(status).json(data); return; }
  res.json(data);
});

router.get("/patients/:orthancPatientId/studies", async (req, res): Promise<void> => {
  const p = OrthancPatientIdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const { ok, data, status } = await orthancFetch(`/patients/${p.data.orthancPatientId}/studies`);
  if (!ok) { res.status(status).json(data); return; }
  res.json(data);
});

// ─── Studies ─────────────────────────────────────────────────────────────────

router.get("/studies", async (_req, res): Promise<void> => {
  const { ok, data, status } = await orthancFetch("/studies?expand");
  if (!ok) { res.status(status).json(data); return; }
  res.json(data);
});

router.get("/studies/:id", async (req, res): Promise<void> => {
  const p = OrthancIdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const { ok, data, status } = await orthancFetch(`/studies/${p.data.id}`);
  if (!ok) { res.status(status).json(data); return; }
  res.json(data);
});

router.get("/studies/:id/series", async (req, res): Promise<void> => {
  const p = OrthancIdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const { ok, data, status } = await orthancFetch(`/studies/${p.data.id}/series`);
  if (!ok) { res.status(status).json(data); return; }
  res.json(data);
});

// ─── Series ──────────────────────────────────────────────────────────────────

router.get("/series/:id", async (req, res): Promise<void> => {
  const p = OrthancIdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const { ok, data, status } = await orthancFetch(`/series/${p.data.id}`);
  if (!ok) { res.status(status).json(data); return; }
  res.json(data);
});

router.get("/series/:id/instances", async (req, res): Promise<void> => {
  const p = OrthancIdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const { ok, data, status } = await orthancFetch(`/series/${p.data.id}/instances`);
  if (!ok) { res.status(status).json(data); return; }
  res.json(data);
});

// ─── Instances ────────────────────────────────────────────────────────────────

router.get("/instances/:id/preview", async (req, res): Promise<void> => {
  const p = OrthancIdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const { url, user, pass } = getOrthancConfig();
  if (!url) { res.status(503).json({ error: "PACS not configured" }); return; }
  try {
    const resp = await fetch(`${url}/instances/${p.data.id}/preview`, {
      headers: orthancHeaders(user, pass),
    });
    if (!resp.ok) { res.status(resp.status).json({ error: "Preview not found" }); return; }
    const buffer = await resp.arrayBuffer();
    res.setHeader("Content-Type", resp.headers.get("Content-Type") || "image/png");
    res.send(Buffer.from(buffer));
  } catch {
    res.status(503).json({ error: "Connection failed" });
  }
});

// ─── WADO proxy ──────────────────────────────────────────────────────────────
// Proxy WADO-URI requests so Weasis can fetch via our backend (avoids CORS)

router.get("/wado", async (req, res): Promise<void> => {
  const { url, user, pass } = getOrthancConfig();
  if (!url) { res.status(503).json({ error: "PACS not configured" }); return; }
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  try {
    const resp = await fetch(`${url}/wado?${qs}`, { headers: orthancHeaders(user, pass) });
    const buffer = await resp.arrayBuffer();
    res.setHeader("Content-Type", resp.headers.get("Content-Type") || "application/dicom");
    res.send(Buffer.from(buffer));
  } catch {
    res.status(503).json({ error: "WADO proxy failed" });
  }
});

// ─── Search studies by patient name / ID ─────────────────────────────────────

const SearchQuery = z.object({ q: z.string().optional() });

router.get("/search", async (req, res): Promise<void> => {
  const parsed = SearchQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request", details: parsed.error.issues }); return; }
  const q = parsed.data.q ?? "";
  const { ok, data, status } = await orthancFetch("/studies?expand");
  if (!ok) { res.status(status).json(data); return; }

  const studies = data as unknown[];
  if (!q) { res.json(studies); return; }

  const lower = q.toLowerCase();
  const filtered = (studies as Record<string, unknown>[]).filter((s: Record<string, unknown>) => {
    const tags = s.PatientMainDicomTags as Record<string, string> | undefined;
    const name = (tags?.PatientName || "").toLowerCase();
    const pid = (tags?.PatientID || "").toLowerCase();
    return name.includes(lower) || pid.includes(lower);
  });
  res.json(filtered);
});

// ─── Weasis launcher URL helper ───────────────────────────────────────────────

router.get("/studies/:id/weasis-url", async (req, res): Promise<void> => {
  const p = OrthancIdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const { url } = getOrthancConfig();
  if (!url) { res.status(503).json({ error: "PACS not configured" }); return; }

  const { ok, data } = await orthancFetch(`/studies/${p.data.id}`);
  if (!ok) { res.status(404).json({ error: "Study not found" }); return; }

  const study = data as Record<string, unknown>;
  const mainTags = study.MainDicomTags as Record<string, string> | undefined;
  const studyInstanceUID = mainTags?.StudyInstanceUID || "";

  const wasiUrl = process.env.WADO_URL || `${url}/wado`;
  const weasisUrl =
    `weasis://$dicom:get -r "` +
    `${wasiUrl}?requestType=WADO&studyUID=${studyInstanceUID}&contentType=application/dicom"`;

  res.json({
    studyInstanceUID,
    weasisUrl,
    orthancViewerUrl: `${url}/app/explorer.html#study?uuid=${p.data.id}`,
    ohifUrl: process.env.OHIF_URL
      ? `${process.env.OHIF_URL}/viewer?StudyInstanceUIDs=${studyInstanceUID}`
      : null,
  });
});

export default router;

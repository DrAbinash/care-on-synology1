/**
 * A real HTTP server that answers Orthanc's instance and series QIDO queries.
 *
 * D2's identity check asks the PACS "does this SOPInstanceUID live in this
 * SeriesInstanceUID of this StudyInstanceUID, and how many frames does the object
 * hold?" — so the test double has to be an HTTP endpoint, not a stubbed function:
 * the route under test reaches it over the network exactly the way it reaches the
 * NAS, through the same base-URL resolution and the same fetch.
 *
 * It mirrors Orthanc 1.13.0's DICOMweb behaviour, which is what the production
 * lookup depends on:
 *   • `/dicom-web/studies/{S}/series/{SE}/instances?00080018={I}` → 200 with a
 *     DICOM-JSON array carrying 0020000D / 0020000E / 00080018 / 00280008; an
 *     unmatched filter is a 200 with an EMPTY array, never a 404.
 *   • `/dicom-web/studies/{S}/series?0020000E={SE}` → the same shape at series level.
 *   • the path-style singletons (`/instances/{SOP}` and `/series/{SE-UID}`), which
 *     Orthanc keys by internal id, return 400 — so a regression back to path-style
 *     lookups fails the check instead of silently passing.
 *   • `/instances/{SOP}[/frames/{N}]/rendered` answers with JPEG bytes for objects
 *     the manifest holds and 404 for those it does not — the PACS image picker's
 *     "give me the pixels of exactly this image" leg.
 *
 * `manifest[study][series] = [{ sopUid, numberOfFrames? }]`.
 */
import { createServer, type Server } from "node:http";
import { once } from "node:events";

export type MockInstance = { sopUid: string; numberOfFrames?: number | null };

export type MockDicomWeb = {
  port: number;
  url: string;
  /** "down" makes every request 500, which the verifier must read as unreachable. */
  setMode(mode: "serve" | "down"): void;
  /** Requests received (decoded, query included), so a test can prove the check really went to the PACS. */
  hits(): string[];
  close(): Promise<void>;
};

type JsonValue = Record<string, { Value: string[] }>;

/** A real (tiny) JPEG, so a caller that pipes the answer through an image
 *  decoder gets bytes it can decode rather than a 404-shaped surprise. */
const JPEG_STUB = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z",
  "base64",
);

function instanceEntry(study: string, series: string, m: MockInstance, instanceNumber: number): JsonValue {
  const e: JsonValue = {
    "0020000D": { Value: [study] },
    "0020000E": { Value: [series] },
    "00080018": { Value: [m.sopUid] },
    "00080016": { Value: ["1.2.840.10008.5.1.4.1.1.6.1"] },
    "00200013": { Value: [String(instanceNumber)] },
  };
  if (m.numberOfFrames != null) e["00280008"] = { Value: [String(m.numberOfFrames)] };
  return e;
}

function seriesEntry(study: string, series: string): JsonValue {
  return {
    "0020000D": { Value: [study] },
    "0020000E": { Value: [series] },
    "00080060": { Value: ["MR"] },
    "00200011": { Value: ["1"] },
  };
}

export async function startMockDicomWeb(
  manifest: Record<string, Record<string, MockInstance[]>>,
  opts: { renderedJpeg?: Buffer } = {},
): Promise<MockDicomWeb> {
  const seen: string[] = [];
  let mode: "serve" | "down" = "serve";

  const server: Server = createServer((req, res) => {
    const raw = req.url || "";
    seen.push(decodeURIComponent(raw));

    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (mode === "down") return send(500, {});

    const [pathRaw, queryRaw = ""] = raw.split("?");
    const path = decodeURIComponent(pathRaw);
    const q = new URLSearchParams(queryRaw);
    const sopFilter = q.get("00080018");
    const seriesFilter = q.get("0020000E");

    // Instance QIDO scoped to Study + Series, filtered by SOPInstanceUID.
    let m = /^\/dicom-web\/studies\/([^/]+)\/series\/([^/]+)\/instances$/.exec(path);
    if (m && sopFilter != null) {
      const [, study, series] = m;
      const hit = (manifest[study]?.[series] || []).find((i) => i.sopUid === sopFilter);
      return send(200, hit ? [instanceEntry(study, series, hit, 1)] : []);
    }

    // Series QIDO scoped to Study, filtered by SeriesInstanceUID.
    m = /^\/dicom-web\/studies\/([^/]+)\/series$/.exec(path);
    if (m && seriesFilter != null) {
      const study = m[1];
      const present = Boolean(manifest[study]?.[seriesFilter]);
      return send(200, present ? [seriesEntry(study, seriesFilter)] : []);
    }

    // WADO-RS rendered pixels — what the PACS image picker asks CARE to fetch
    // and freeze. Answered only for an object the manifest actually holds, so a
    // route that fetched pixels for a wrong-study image gets a 404 rather than
    // a picture, exactly as the clinic's Orthanc does. Frame numbers in the URL
    // are 1-based (PS3.18 / Orthanc), and a single-frame object has no frames
    // path at all.
    m = /^\/dicom-web\/studies\/([^/]+)\/series\/([^/]+)\/instances\/([^/]+)(?:\/frames\/(\d+))?\/rendered$/.exec(path);
    if (m) {
      const [, study, series, sop, frameRaw] = m;
      const inst = (manifest[study]?.[series] || []).find((i) => i.sopUid === sop);
      if (!inst) return send(404, { HttpError: "Not Found" });
      if (frameRaw != null) {
        const frames = inst.numberOfFrames ?? 1;
        const n = Number(frameRaw);
        if (!Number.isInteger(n) || n < 1 || n > frames) return send(404, { HttpError: "Not Found" });
      }
      const body = opts.renderedJpeg ?? JPEG_STUB;
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": String(body.length) });
      return res.end(body);
    }

    // Path-style singletons: Orthanc 1.13.0 rejects these (keys by internal id).
    if (
      /^\/dicom-web\/studies\/[^/]+\/series\/[^/]+\/instances\//.test(path) ||
      /^\/dicom-web\/studies\/[^/]+\/series\/[^/]+$/.test(path)
    ) {
      return send(400, { HttpError: "Bad Request", Message: "cannot retrieve by SOP UID" });
    }

    // Plain list endpoints (not used by the lookup, kept for completeness).
    m = /^\/dicom-web\/studies\/([^/]+)\/series$/.exec(path);
    if (m) {
      const study = m[1];
      return send(200, Object.keys(manifest[study] || {}).map((s) => seriesEntry(study, s)));
    }
    m = /^\/dicom-web\/studies\/([^/]+)\/series\/([^/]+)\/instances$/.exec(path);
    if (m) {
      const [, study, series] = m;
      const list = manifest[study]?.[series] || [];
      return send(200, list.map((i, idx) => instanceEntry(study, series, i, idx + 1)));
    }

    return send(404, []);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    setMode(next) {
      mode = next;
    },
    hits: () => [...seen],
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}

/**
 * A real HTTP server that answers Orthanc's single-instance QIDO query.
 *
 * D2's identity check asks the PACS "does this SOPInstanceUID live in this
 * SeriesInstanceUID of this StudyInstanceUID, and how many frames does the
 * object hold?" — so the test double has to be an HTTP endpoint, not a stubbed
 * function: the route under test reaches it over the network exactly the way it
 * reaches the NAS, through the same base-URL resolution and the same fetch.
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
  /** Requests received, so a test can prove the check really went to the PACS. */
  hits(): string[];
  close(): Promise<void>;
};

function seriesEntry(uid: string): Record<string, { Value: string[] }> {
  return { "0020000E": { Value: [uid] }, "00080060": { Value: ["MR"] }, "00200011": { Value: ["1"] } };
}

function instanceEntry(m: MockInstance, instanceNumber: number): Record<string, { Value: string[] }> {
  const e: Record<string, { Value: string[] }> = {
    "00080018": { Value: [m.sopUid] },
    "00200013": { Value: [String(instanceNumber)] },
  };
  if (m.numberOfFrames != null) e["00280008"] = { Value: [String(m.numberOfFrames)] };
  return e;
}

export async function startMockDicomWeb(
  manifest: Record<string, Record<string, MockInstance[]>>,
): Promise<MockDicomWeb> {
  const seen: string[] = [];
  let mode: "serve" | "down" = "serve";

  const server: Server = createServer((req, res) => {
    const url = decodeURIComponent(req.url || "");
    seen.push(url);
    if (mode === "down") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    const one = /^\/dicom-web\/studies\/([^/]+)\/series\/([^/]+)\/instances\/([^/]+)$/.exec(url);
    if (one) {
      const [, study, series, sop] = one;
      const entry = (manifest[study]?.[series] || []).find((i) => i.sopUid === sop);
      if (!entry) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end("[]");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([instanceEntry(entry, 1)]));
      return;
    }
    const list = /^\/dicom-web\/studies\/([^/]+)\/series$/.exec(url);
    if (list) {
      const series = Object.keys(manifest[list[1]] || {});
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(series.map(seriesEntry)));
      return;
    }
    const insts = /^\/dicom-web\/studies\/([^/]+)\/series\/([^/]+)\/instances$/.exec(url);
    if (insts) {
      const rows = (manifest[insts[1]]?.[insts[2]] || []).map(instanceEntry);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(rows));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end("[]");
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

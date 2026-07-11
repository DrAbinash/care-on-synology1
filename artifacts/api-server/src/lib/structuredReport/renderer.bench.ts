import { bench, describe } from "vitest";
import { renderStructuredReport } from "./renderer";
import { toLegacyReportShape } from "./rendererLegacyAdapter";
import { loadExample } from "./__fixtures__/loadExample";
import type { StructuredReportDocument } from "./types";

// Benchmark for D4 (renderer). The renderer runs on every report
// preview/save/finalize, so it must be cheap relative to the surrounding IO.
// Not part of the normal test run (vitest.config includes only *.test.ts):
//   npx vitest bench artifacts/api-server/src/lib/structuredReport/renderer.bench.ts
// The largest of the D1 §17 worked examples (Doppler carotid) is the payload.

const doc = loadExample("example5DopplerCarotid.json") as StructuredReportDocument;

describe("structured report renderer — hot path (largest §17 example)", () => {
  bench("renderStructuredReport(doc)", () => {
    renderStructuredReport(doc);
  });

  bench("renderStructuredReport + toLegacyReportShape (full legacy-shape pipeline)", () => {
    toLegacyReportShape(renderStructuredReport(doc));
  });
});

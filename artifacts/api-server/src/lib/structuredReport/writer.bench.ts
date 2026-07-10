import { bench, describe } from "vitest";
import { buildStructuredReportDocument } from "./writer";
import { jcsCanonicalize } from "./canonicalizer";
import { computeContentSha256 } from "./hash";
import { loadExample } from "./__fixtures__/loadExample";
import { deriveWriterInput } from "./__fixtures__/deriveWriterInput";

// Benchmark for D1 §19 item 3 / §14 (performance): the writer's canonicalize +
// hash path runs on every draft save and finalize, so it must be cheap relative
// to the surrounding IO. This file is NOT part of the normal test run
// (vitest.config only includes *.test.ts); run it with:
//     npx vitest bench artifacts/api-server/src/lib/structuredReport/writer.bench.ts
//
// The largest of the five D1 §17 worked examples (Doppler carotid, ~7.3 KB
// canonical) is used as the representative payload — real reports are the same
// order of magnitude.

const doc = loadExample("example5DopplerCarotid.json");
const input = deriveWriterInput(doc);
const built = buildStructuredReportDocument(input, "draft");

describe("structured-report writer — hot path (largest §17 example, ~7.3 KB canonical)", () => {
  bench("jcsCanonicalize(document)", () => {
    jcsCanonicalize(built.document);
  });

  bench("computeContentSha256(document) — JCS + SHA-256 + exclusion strip", () => {
    computeContentSha256(built.document);
  });

  bench("buildStructuredReportDocument — full assemble + hash + canonical serialize", () => {
    buildStructuredReportDocument(input, "draft");
  });
});

/**
 * ollamaComposerAdapter.endpoint.test.ts — why no MRI report ever arrived.
 *
 * This is a reproduction, not a mock exercise. A real HTTP server stands in for
 * Ollama and the real adapter drives it, so the guard, the socket, the response
 * and the parse are all the shipped code paths.
 *
 * The failure this documents is invisible by construction: the clinic's Ollama
 * lives at a private LAN address, "Local / LAN mode" ships as `false`, and the
 * composer refuses the endpoint before opening a socket — while bill OCR, which
 * takes a different path, keeps working. The same correctly-configured model was
 * therefore reachable for one feature and blocked for another, and the reason the
 * guard produced was dropped on its way to the screen.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OllamaComposerAdapter } from "./ollamaComposerAdapter";
import { parseComposerDraftJson } from "../types";

/** The synthetic MRI lumbar-sacral spine case from PROMPT 10, Rule 4. */
const MRI_OBSERVATIONS = [
  "Straightening of lumbar lordosis.",
  "Multilevel disc desiccation at L2-L3, L3-L4, L4-L5 and L5-S1.",
  "Reduced intervertebral disc height at L4-L5 and L5-S1.",
  "Diffuse posterior disc bulge at L3-L4.",
  "Broad-based posterior disc bulge at L4-L5 causing mild bilateral lateral recess narrowing.",
  "Diffuse posterior disc bulge at L5-S1.",
  "Mild bilateral facet arthropathy at L4-L5 and L5-S1.",
  "No significant central canal stenosis documented.",
].join("\n");

const MRI_DRAFT_JSON = JSON.stringify({
  findings: [
    "There is straightening of the normal lumbar lordosis.",
    "Multilevel disc desiccation is seen at L2-L3, L3-L4, L4-L5 and L5-S1.",
    "Reduced disc height at L4-L5 and L5-S1.",
    "Diffuse posterior disc bulge at L3-L4.",
    "Broad-based posterior disc bulge at L4-L5 with mild bilateral lateral recess narrowing.",
    "Diffuse posterior disc bulge at L5-S1.",
    "Mild bilateral facet arthropathy at L4-L5 and L5-S1.",
    "No significant central canal stenosis.",
  ].join(" "),
  impression:
    "Multilevel degenerative disc disease of the lumbosacral spine, most pronounced at L4-L5 and L5-S1, "
    + "with mild bilateral lateral recess narrowing at L4-L5. No significant central canal stenosis.",
  recommendation: "",
});

let server: http.Server;
let baseUrl: string;
/** What the stub answers with, and what it actually received. */
const seen: { bodies: any[]; lastReply?: unknown } = { bodies: [] };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.bodies.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(seen.lastReply));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const REQUEST = {
  systemPrompt: "You are a radiology reporting assistant.",
  userPrompt: `EXAMINATION: MRI LUMBOSACRAL SPINE\n\nObservations:\n${MRI_OBSERVATIONS}`,
  model: "gemma3:12b",
  temperature: 0.1,
  timeoutMs: 10_000,
  numCtx: 4096,
};

describe("the endpoint guard is what stopped every MRI report", () => {
  it("refuses a private LAN endpoint while Local/LAN mode is off", async () => {
    // 172.16.1.140 is the clinic's real AI PC address. Nothing about the model,
    // the URL or Ollama itself is wrong here.
    const r = await new OllamaComposerAdapter().compose({
      ...REQUEST,
      endpoint: "http://172.16.1.140:11434",
      localOnly: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("composer_endpoint_blocked");
  });

  it("tells the radiologist which switch to move, instead of a bare code", async () => {
    const r = await new OllamaComposerAdapter().compose({
      ...REQUEST,
      endpoint: "http://172.16.1.140:11434",
      localOnly: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // This sentence was being dropped before it reached the job row, so six
    // months of failures arrived as `composer_endpoint_blocked` with no lead.
    expect(r.detail).toContain("Local / LAN mode");
    expect(r.detail).toContain("172.16.1.140");
  });

  it("reaches the model once Local/LAN mode is on", async () => {
    seen.lastReply = { message: { content: MRI_DRAFT_JSON }, done: true };
    seen.bodies = [];
    const r = await new OllamaComposerAdapter().compose({
      ...REQUEST,
      endpoint: baseUrl,
      localOnly: true,
    });
    expect(r.ok).toBe(true);
    expect(seen.bodies).toHaveLength(1);
    expect(seen.bodies[0].model).toBe("gemma3:12b");
  });
});

describe("a model answer becomes an MRI report draft", () => {
  it("parses to findings and impression preserving every level", async () => {
    seen.lastReply = { message: { content: MRI_DRAFT_JSON }, done: true };
    const r = await new OllamaComposerAdapter().compose({
      ...REQUEST, endpoint: baseUrl, localOnly: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const draft = parseComposerDraftJson(r.text);
    expect(draft).not.toBeNull();
    if (!draft) return;

    // Every supplied abnormality and level survives into the report.
    for (const level of ["L2-L3", "L3-L4", "L4-L5", "L5-S1"]) {
      expect(draft.findings).toContain(level);
    }
    expect(draft.findings).toContain("straightening");
    expect(draft.findings).toContain("bilateral lateral recess narrowing");
    expect(draft.findings).toContain("No significant central canal stenosis");
    expect(draft.impression).toContain("lumbosacral");
    // Nothing invented: no canal measurement appears that observations did not give.
    expect(draft.findings).not.toMatch(/canal (?:diameter|AP) \d/);
  });

  it("names an empty answer as empty, which is what qwen3-vl:8b actually returns", async () => {
    // Measured behaviour of the clinic's vision model: it spends the whole
    // budget on chain-of-thought and answers with no content.
    seen.lastReply = {
      message: { content: "", thinking: "Let me analyse the lumbar spine images..." },
      done: true,
      done_reason: "length",
    };
    const r = await new OllamaComposerAdapter().compose({
      ...REQUEST, endpoint: baseUrl, localOnly: true, model: "qwen3-vl:8b",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("empty_model_response");
  });

  it("survives an unreachable endpoint as a named failure, not a hang", async () => {
    const r = await new OllamaComposerAdapter().compose({
      ...REQUEST, endpoint: "http://127.0.0.1:1", localOnly: true, timeoutMs: 3000,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(["ollama_unreachable", "ollama_timeout"]).toContain(r.safeError);
  });
});

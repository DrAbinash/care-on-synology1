import { describe, expect, test, vi, beforeEach } from "vitest";

// P7 cine router flag gate (404 OFF) + not-cine → 422. Service mocked; DB
// behavior is proven in usgCineService.integration.test.ts.

let flagOn: boolean;
vi.mock("../lib/featureFlags", () => ({ isFeatureEnabledServer: async () => flagOn }));
const captureKeyFrame = vi.fn();
const describeCineClip = vi.fn();
const listKeyFrames = vi.fn();
vi.mock("../lib/usgCineService", () => ({
  captureKeyFrame: (...a: unknown[]) => captureKeyFrame(...a),
  describeCineClip: (...a: unknown[]) => describeCineClip(...a),
  listKeyFrames: (...a: unknown[]) => listKeyFrames(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runChain(router: any, method: string, path: string, req: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method} ${path} not found`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mws = router.stack.filter((l: any) => !l.route && typeof l.handle === "function").map((l: any) => l.handle);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = [...mws, ...layer.route.stack.map((s: any) => s.handle)];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = { statusCode: 200, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(p: unknown) { this.body = p; return this; } };
  let idx = 0;
  const next = async () => { if (idx < handlers.length) await handlers[idx++](req, res, next); };
  await next();
  return res;
}

beforeEach(() => { flagOn = true; captureKeyFrame.mockReset(); describeCineClip.mockReset(); });

describe("P7 usg-cine router", () => {
  test("404s when the flag is OFF", async () => {
    flagOn = false;
    const { default: router } = await import("./usgCine");
    const res = await runChain(router, "post", "/describe", { body: { clip: {} } });
    expect(res.statusCode).toBe(404);
    expect(describeCineClip).not.toHaveBeenCalled();
  });

  test("key-frame capture maps not_cine → 422", async () => {
    captureKeyFrame.mockResolvedValue({ error: "not_cine" });
    const { default: router } = await import("./usgCine");
    const res = await runChain(router, "post", "/studies/:studyId/key-frame", { params: { studyId: "1" }, body: { clip: {}, studyInstanceUID: "1.2.3" }, staffSession: {} });
    expect(res.statusCode).toBe(422);
  });

  test("key-frame capture returns the persisted reference for a cine clip", async () => {
    captureKeyFrame.mockResolvedValue({ keyImageId: 5, frameNumber: 20, sopInstanceUID: "1.2.sop", created: true });
    const { default: router } = await import("./usgCine");
    const res = await runChain(router, "post", "/studies/:studyId/key-frame", { params: { studyId: "1" }, body: { clip: {}, studyInstanceUID: "1.2.3", selectedFrame: 20 }, staffSession: { subjectName: "Dr A" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.frameNumber).toBe(20);
  });

  test("400 when clip or studyInstanceUID is missing", async () => {
    const { default: router } = await import("./usgCine");
    const res = await runChain(router, "post", "/studies/:studyId/key-frame", { params: { studyId: "1" }, body: { clip: {} }, staffSession: {} });
    expect(res.statusCode).toBe(400);
  });
});

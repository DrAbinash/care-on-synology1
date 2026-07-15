import { describe, it, expect, beforeEach, vi } from "vitest";

// Fresh module instance per test — the broadcaster is a shared singleton, so
// import it inside beforeEach via a dynamic re-import to avoid state leaking
// between tests (vitest resets the module registry with vi.resetModules).
let paymentQrBroadcaster: typeof import("./paymentQrBroadcast").paymentQrBroadcaster;

beforeEach(async () => {
  vi.resetModules();
  ({ paymentQrBroadcaster } = await import("./paymentQrBroadcast"));
});

describe("paymentQrBroadcaster — state per counter", () => {
  it("reports inactive for a counter that has never been shown", () => {
    expect(paymentQrBroadcaster.getState("counter1")).toEqual({ active: false, updatedAt: 0 });
  });

  it("show() marks a counter active with status pending", () => {
    paymentQrBroadcaster.show("counter1", { qrData: "https://icici.example/pay?tranCtx=abc", txnRef: "TXN1", amount: 500 });
    const state = paymentQrBroadcaster.getState("counter1");
    expect(state.active).toBe(true);
    expect(state.status).toBe("pending");
    expect(state.qrData).toBe("https://icici.example/pay?tranCtx=abc");
    expect(state.txnRef).toBe("TXN1");
    expect(state.amount).toBe(500);
  });

  it("setStatus() updates the status of an active counter", () => {
    paymentQrBroadcaster.show("counter1", { qrData: "url", txnRef: "TXN1" });
    paymentQrBroadcaster.setStatus("counter1", "success");
    expect(paymentQrBroadcaster.getState("counter1").status).toBe("success");
  });

  it("setStatus() is a no-op when nothing is active for that counter — never fabricates a fake status", () => {
    paymentQrBroadcaster.setStatus("counter1", "success");
    expect(paymentQrBroadcaster.getState("counter1")).toEqual({ active: false, updatedAt: 0 });
  });

  it("clear() returns a counter to inactive", () => {
    paymentQrBroadcaster.show("counter1", { qrData: "url", txnRef: "TXN1" });
    paymentQrBroadcaster.clear("counter1");
    expect(paymentQrBroadcaster.getState("counter1").active).toBe(false);
  });

  it("counters are fully isolated — showing on counter1 never affects counter2", () => {
    paymentQrBroadcaster.show("counter1", { qrData: "url1", txnRef: "TXN1" });
    expect(paymentQrBroadcaster.getState("counter2").active).toBe(false);
    paymentQrBroadcaster.show("counter2", { qrData: "url2", txnRef: "TXN2" });
    expect(paymentQrBroadcaster.getState("counter1").txnRef).toBe("TXN1");
    expect(paymentQrBroadcaster.getState("counter2").txnRef).toBe("TXN2");
  });
});

describe("paymentQrBroadcaster — event emission", () => {
  it("emits payment-qr-update with the counterKey on show/setStatus/clear", () => {
    const received: string[] = [];
    const handler = (counterKey: string) => received.push(counterKey);
    paymentQrBroadcaster.on("payment-qr-update", handler);

    paymentQrBroadcaster.show("counter1", { qrData: "url", txnRef: "TXN1" });
    paymentQrBroadcaster.setStatus("counter1", "success");
    paymentQrBroadcaster.clear("counter1");

    expect(received).toEqual(["counter1", "counter1", "counter1"]);
    paymentQrBroadcaster.off("payment-qr-update", handler);
  });

  it("does not emit on setStatus() for an inactive counter", () => {
    const received: string[] = [];
    const handler = (counterKey: string) => received.push(counterKey);
    paymentQrBroadcaster.on("payment-qr-update", handler);

    paymentQrBroadcaster.setStatus("counter1", "success");

    expect(received).toEqual([]);
    paymentQrBroadcaster.off("payment-qr-update", handler);
  });
});

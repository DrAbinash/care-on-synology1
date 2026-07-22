import { describe, it, expect } from "vitest";
import {
  canTransition, assertTransition, nextStates, TERMINAL_STATUSES, isReferralStatus,
  canItemTransition, isItemTerminal, isItemStatus,
} from "./referralStateMachine";
import { REFERRAL_STATUSES, type ReferralStatus } from "@workspace/db/schema";

describe("referral state machine", () => {
  it("permits the canonical happy path end to end", () => {
    const path: ReferralStatus[] = [
      "RECEIVED_BY_CARE", "PATIENT_ACCEPTED", "CARE_ORDER_CREATED", "BILLED",
      "PAID", "SAMPLE_COLLECTED", "IN_PROGRESS", "COMPLETED", "REPORTED", "DELIVERED",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it("rejects impossible transitions", () => {
    expect(canTransition("RECEIVED_BY_CARE", "PAID")).toBe(false);
    expect(canTransition("PRESCRIBED", "REPORTED")).toBe(false);
    expect(canTransition("DELIVERED", "BILLED")).toBe(false);
    expect(canTransition("COMPLETED", "PRESCRIBED")).toBe(false);
  });

  it("assertTransition throws on an illegal jump", () => {
    expect(() => assertTransition("RECEIVED_BY_CARE", "PAID")).toThrow(/Illegal referral transition/);
  });

  it("treats a same-state transition as an idempotent no-op", () => {
    for (const s of REFERRAL_STATUSES) expect(canTransition(s, s)).toBe(true);
  });

  it("cannot leave a terminal state", () => {
    for (const t of TERMINAL_STATUSES) {
      expect(nextStates(t)).toHaveLength(0);
      expect(canTransition(t, "RECEIVED_BY_CARE")).toBe(false);
    }
  });

  it("allows cancellation before fulfilment but not after report finalisation", () => {
    expect(canTransition("RECEIVED_BY_CARE", "CANCELLED")).toBe(true);
    expect(canTransition("BILLED", "CANCELLED")).toBe(true);
    // Once REPORTED/DELIVERED, cancellation is not a legal transition.
    expect(canTransition("REPORTED", "CANCELLED")).toBe(false);
    expect(canTransition("DELIVERED", "CANCELLED")).toBe(false);
  });

  it("supports partial booking and re-opening a report for amendment", () => {
    expect(canTransition("RECEIVED_BY_CARE", "PARTIALLY_BOOKED")).toBe(true);
    expect(canTransition("PARTIALLY_BOOKED", "CARE_ORDER_CREATED")).toBe(true);
    expect(canTransition("DELIVERED", "REPORTED")).toBe(true); // amended report
  });

  it("only knows declared statuses", () => {
    expect(isReferralStatus("RECEIVED_BY_CARE")).toBe(true);
    expect(isReferralStatus("NONSENSE")).toBe(false);
  });
});

describe("item state machine", () => {
  it("maps the per-item lifecycle", () => {
    expect(canItemTransition("prescribed", "mapped")).toBe(true);
    expect(canItemTransition("mapped", "accepted")).toBe(true);
    expect(canItemTransition("accepted", "billed")).toBe(true);
    expect(canItemTransition("billed", "sample_collected")).toBe(true);
    expect(canItemTransition("in_progress", "reported")).toBe(true);
  });
  it("keeps declined/cancelled terminal", () => {
    expect(isItemTerminal("declined")).toBe(true);
    expect(isItemTerminal("cancelled")).toBe(true);
    expect(canItemTransition("declined", "accepted")).toBe(false);
  });
  it("lets an unavailable test become available later", () => {
    expect(canItemTransition("unavailable", "accepted")).toBe(true);
  });
  it("validates status strings", () => {
    expect(isItemStatus("sample_collected")).toBe(true);
    expect(isItemStatus("teleport")).toBe(false);
  });
});

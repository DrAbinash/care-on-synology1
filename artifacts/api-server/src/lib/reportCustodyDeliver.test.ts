/**
 * The handover decisions, without a database.
 *
 * Two of these are the ones that would be quietly lost in a refactor: the
 * settlement rule (which must stay net of refunds, because `balanceAmount` is 0
 * after a refund while the clinic has not actually kept the money) and the order
 * of the refusals (which decides whether a wrong-patient sheet is reported as a
 * wrong-patient sheet or as something much less alarming).
 */
import { describe, expect, it } from "vitest";
import {
  isRecipientCategory,
  judgeHandover,
  paymentIsSettled,
  RECIPIENT_CATEGORIES,
  RECIPIENT_LABEL,
} from "./reportCustodyDeliver";

const AT_COUNTER = {
  exists: true,
  authorized: true,
  superseded: false,
  physicalState: "AT_COUNTER",
  reportPatientId: 7,
  billPatientId: 7,
  settled: true,
};

describe("judgeHandover", () => {
  it("releases a signed report that the counter received, on the right bill", () => {
    expect(judgeHandover(AT_COUNTER)).toBe("DELIVERABLE");
  });

  it("refuses a report that was never received at the counter", () => {
    // The rule that makes the two timelines two: without it a clerk could receipt
    // and hand over in one click and the ledger would record one act, not two.
    expect(judgeHandover({ ...AT_COUNTER, physicalState: null })).toBe("NOT_AT_COUNTER");
    expect(judgeHandover({ ...AT_COUNTER, physicalState: "AT_REPORTING" })).toBe("NOT_AT_COUNTER");
  });

  it("refuses a report that belongs to another patient than the bill", () => {
    expect(judgeHandover({ ...AT_COUNTER, reportPatientId: 8 })).toBe("WRONG_PATIENT");
  });

  it("names the wrong patient even when the sheet is also unsigned", () => {
    // Order is the policy. "Not signed" invites the clerk to go chase a signature;
    // the actual problem is that this is somebody else's report.
    expect(judgeHandover({ ...AT_COUNTER, authorized: false, reportPatientId: 8 })).toBe("WRONG_PATIENT");
  });

  it("says already-handed-over before anything else", () => {
    expect(judgeHandover({ ...AT_COUNTER, physicalState: "HANDED_OVER", reportPatientId: 8, settled: false }))
      .toBe("ALREADY_HANDED_OVER");
  });

  it("refuses an unsigned report before a superseded one", () => {
    expect(judgeHandover({ ...AT_COUNTER, authorized: false, superseded: true })).toBe("NOT_SIGNED");
  });

  it("refuses a superseded revision that was never signed over", () => {
    expect(judgeHandover({ ...AT_COUNTER, superseded: true })).toBe("SUPERSEDED_REVISION");
  });

  it("holds the outstanding-payment refusal to last", () => {
    // Money is the one refusal a stated reason can clear, so it must not be able
    // to mask a clinical or identity problem behind an override prompt.
    expect(judgeHandover({ ...AT_COUNTER, settled: false, superseded: true })).toBe("SUPERSEDED_REVISION");
    expect(judgeHandover({ ...AT_COUNTER, settled: false })).toBe("PAYMENT_OUTSTANDING");
  });

  it("refuses a row that is not there", () => {
    expect(judgeHandover({ ...AT_COUNTER, exists: false })).toBe("REPORT_NOT_FOUND");
  });
});

describe("paymentIsSettled", () => {
  it("settles when the collected amount reaches the bill total", () => {
    expect(paymentIsSettled(2500, 2500)).toBe(true);
    expect(paymentIsSettled(2499.997, 2500)).toBe(true); // the half-paisa tolerance
  });

  it("is not settled when anything is outstanding", () => {
    expect(paymentIsSettled(1500, 2500)).toBe(false);
    expect(paymentIsSettled(0, 2500)).toBe(false);
  });

  it("uses the net collected amount, not the balance column", () => {
    // The case the repo already documents at commissionCalc.ts:441-446: after a
    // refund `balanceAmount` stays 0 while retained collection drops below the
    // total. A delivery gate reading the balance would call this bill paid.
    const paidAfterRefund = 1500;
    const balanceColumn = 0;
    expect(balanceColumn).toBe(0);
    expect(paymentIsSettled(paidAfterRefund, 2500)).toBe(false);
  });

  it("settles a zero-total bill", () => {
    expect(paymentIsSettled(0, 0)).toBe(true);
  });
});

describe("recipient identification stays minimal", () => {
  it("accepts only the four recorded categories", () => {
    for (const c of RECIPIENT_CATEGORIES) {
      expect(isRecipientCategory(c)).toBe(true);
      // The label is what a clerk reads; the enum is what the ledger stores.
      expect(RECIPIENT_LABEL[c].length).toBeGreaterThan(10);
      expect(RECIPIENT_LABEL[c]).not.toBe(c);
    }
  });

  it("refuses a free-typed recipient", () => {
    // The owner does not want a register of every person who carried a report.
    // A name is an optional note; the category is the recorded fact.
    expect(isRecipientCategory("Brother-in-law")).toBe(false);
    expect(isRecipientCategory("")).toBe(false);
    expect(isRecipientCategory(undefined)).toBe(false);
    expect(isRecipientCategory(null)).toBe(false);
    expect(isRecipientCategory(7)).toBe(false);
  });

  it("names categories the clinic actually uses", () => {
    expect([...RECIPIENT_CATEGORIES]).toEqual(["PATIENT", "FAMILY_MEMBER", "CARRYING_AGENT", "DOOR_DROP"]);
  });
});

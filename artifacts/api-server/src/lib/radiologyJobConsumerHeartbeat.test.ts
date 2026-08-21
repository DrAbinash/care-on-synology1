import { describe, expect, it, beforeEach } from "vitest";
import {
  deriveRadiologyJobConsumerHealth,
  getRadiologyJobConsumerHeartbeat,
  markRadiologyJobConsumerRegistered,
  recordRadiologyJobCronTick,
  resetRadiologyJobConsumerHeartbeatForTests,
} from "./radiologyJobConsumerHeartbeat";

const emptyOpts = { queueDepth: 0, running: 0, nightWindow: true };

describe("radiology job consumer heartbeat", () => {
  beforeEach(() => {
    resetRadiologyJobConsumerHeartbeatForTests();
  });

  it("is STOPPED until the consumer is registered", () => {
    const r = deriveRadiologyJobConsumerHealth(getRadiologyJobConsumerHeartbeat(), emptyOpts);
    expect(r.status).toBe("STOPPED");
    expect(r.detail).toMatch(/not registered/i);
  });

  it("is HEALTHY after register before the first tick", () => {
    markRadiologyJobConsumerRegistered(new Date("2026-08-17T20:00:00Z"));
    const r = deriveRadiologyJobConsumerHealth(getRadiologyJobConsumerHeartbeat(), {
      ...emptyOpts,
      now: new Date("2026-08-17T20:00:30Z"),
    });
    expect(r.status).toBe("HEALTHY");
  });

  it("is STOPPED if registered but never polled past the stale window", () => {
    markRadiologyJobConsumerRegistered(new Date("2026-08-17T20:00:00Z"));
    const r = deriveRadiologyJobConsumerHealth(getRadiologyJobConsumerHeartbeat(), {
      ...emptyOpts,
      now: new Date("2026-08-17T20:03:00Z"),
    });
    expect(r.status).toBe("STOPPED");
    expect(r.detail).toMatch(/never polled/i);
  });

  it("is STALE when the last poll is older than 2.5 minutes", () => {
    markRadiologyJobConsumerRegistered(new Date("2026-08-17T20:00:00Z"));
    recordRadiologyJobCronTick({
      at: new Date("2026-08-17T20:00:00Z"),
      peak: false,
      aiBlocked: false,
      dueAi: 4,
      ran: 0,
    });
    const r = deriveRadiologyJobConsumerHealth(getRadiologyJobConsumerHeartbeat(), {
      queueDepth: 4,
      running: 0,
      nightWindow: true,
      now: new Date("2026-08-17T20:03:00Z"),
    });
    expect(r.status).toBe("STALE");
  });

  it("is PEAK_HOLD during clinic peak with a queue and no running job", () => {
    markRadiologyJobConsumerRegistered(new Date("2026-08-17T20:00:00Z"));
    recordRadiologyJobCronTick({
      at: new Date("2026-08-17T20:01:00Z"),
      peak: true,
      aiBlocked: true,
      dueAi: 20,
      ran: 0,
    });
    const r = deriveRadiologyJobConsumerHealth(getRadiologyJobConsumerHeartbeat(), {
      queueDepth: 20,
      running: 0,
      nightWindow: true,
      now: new Date("2026-08-17T20:01:10Z"),
    });
    expect(r.status).toBe("PEAK_HOLD");
  });

  it("is STARVED when a live night poll sees eligible due AI jobs but running=0", () => {
    markRadiologyJobConsumerRegistered(new Date("2026-08-17T20:00:00Z"));
    recordRadiologyJobCronTick({
      at: new Date("2026-08-17T20:01:00Z"),
      peak: false,
      aiBlocked: false,
      dueAi: 20,
      ran: 0,
    });
    const r = deriveRadiologyJobConsumerHealth(getRadiologyJobConsumerHeartbeat(), {
      queueDepth: 3693,
      running: 0,
      nightWindow: true,
      eligibleDueAi: 20,
      heldLegacyDue: 0,
      now: new Date("2026-08-17T20:01:10Z"),
    });
    expect(r.status).toBe("STARVED");
    expect(r.detail).toMatch(/eligible/i);
  });

  it("is HELD_LEGACY (not STARVED) when only pre-cutover held jobs remain", () => {
    markRadiologyJobConsumerRegistered(new Date("2026-08-17T20:00:00Z"));
    recordRadiologyJobCronTick({
      at: new Date("2026-08-17T20:01:00Z"),
      peak: false,
      aiBlocked: false,
      dueAi: 0,
      ran: 0,
    });
    const r = deriveRadiologyJobConsumerHealth(getRadiologyJobConsumerHeartbeat(), {
      queueDepth: 2455,
      running: 0,
      nightWindow: true,
      eligibleDueAi: 0,
      heldLegacyDue: 2455,
      now: new Date("2026-08-17T20:01:10Z"),
    });
    expect(r.status).toBe("HELD_LEGACY");
  });

  it("is HEALTHY when lastRan>0 even if due jobs remain (short fail is still progress)", () => {
    markRadiologyJobConsumerRegistered(new Date("2026-08-17T20:00:00Z"));
    recordRadiologyJobCronTick({
      at: new Date("2026-08-17T20:01:00Z"),
      peak: false,
      aiBlocked: false,
      dueAi: 20,
      ran: 1,
      claimedJobId: 99,
      claimedType: "ai_shadow_pipeline",
      outcome: "retrying",
    });
    const r = deriveRadiologyJobConsumerHealth(getRadiologyJobConsumerHeartbeat(), {
      queueDepth: 3576,
      running: 0,
      nightWindow: true,
      now: new Date("2026-08-17T20:01:10Z"),
    });
    expect(r.status).toBe("HEALTHY");
  });

  it("is HEALTHY while a job is running even if the wrapping tick is older than 2.5 min", () => {
    markRadiologyJobConsumerRegistered(new Date("2026-08-17T20:00:00Z"));
    recordRadiologyJobCronTick({
      at: new Date("2026-08-17T20:00:00Z"),
      peak: false,
      aiBlocked: false,
      dueAi: 20,
      ran: 0,
    });
    const r = deriveRadiologyJobConsumerHealth(getRadiologyJobConsumerHeartbeat(), {
      queueDepth: 20,
      running: 1,
      nightWindow: true,
      now: new Date("2026-08-17T20:05:00Z"),
    });
    expect(r.status).toBe("HEALTHY");
  });

  it("does not call ENABLE_SCHEDULERS + staleRunning=0 a healthy worker", () => {
    // Regression: getOvernightDiagnostics used to report worker:"healthy"
    // whenever ENABLE_SCHEDULERS was on and staleRunning===0, even with
    // pending=3693 / running=0 and no tick. Unregistered must be STOPPED.
    process.env.ENABLE_SCHEDULERS = "1";
    const r = deriveRadiologyJobConsumerHealth(getRadiologyJobConsumerHeartbeat(), {
      queueDepth: 3693,
      running: 0,
      nightWindow: true,
    });
    expect(r.status).toBe("STOPPED");
  });
});

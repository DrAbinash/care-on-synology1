/**
 * The Report Delivery dashboard's UI contract — structural.
 *
 * Why source text and not a render: the four queues are the part of this feature
 * that a later edit can undo SILENTLY. If someone deletes the "not measured"
 * branch, the card shows a zero and nobody notices that the clinic was told a
 * fact CARE never measured. If someone adds a second keyboard listener to the
 * queues card, two scanners start competing for the same buffer. Neither shows up
 * in a type check, and a payload assertion cannot see either. The request-level
 * suite (`reportCustodyQueues.request.test.ts`) proves the endpoint answers; this
 * file pins what the counter's screen is allowed to do with the answer.
 *
 * Every absence assertion is paired with the positive control — the thing that
 * had to be there instead — because a pattern that matches nothing passes for the
 * wrong reason the moment the surrounding JSX is renamed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(__dirname, "ReportDelivery.tsx"), "utf8");
const settings = readFileSync(resolve(__dirname, "Settings.tsx"), "utf8");

describe("report delivery dashboard — the counter's own screen", () => {
  it("shows the four queues the brief names, in its words", () => {
    for (const title of ["Awaiting Receipt", "At Counter", "Handed Over", "Discrepancies"]) {
      expect(page, `the queue "${title}" must be on the page`).toContain(`title: "${title}"`);
    }
    // Positive control: they are rendered from one list, not four copy-pasted cards.
    expect(page).toMatch(/QUEUE_CARDS\s*=\s*\[/);
    expect(page.match(/<QueueCard /g)).toHaveLength(1);
  });

  it("reads the queues from the one ledger endpoint, and nothing else", () => {
    expect(page.match(/\/api\/report-custody\/queues/g) ?? []).toHaveLength(1);
    // Positive control: the query it declares is the same one call, not a second
    // surface invented for the same job.
    expect(page).toMatch(/queryKey:\s*\["report-custody-queues"\]/);
  });

  it("says \"not measured\" instead of a number, and never both", () => {
    const card = /function QueueCard\([\s\S]*?\n\}/.exec(page)?.[0] ?? "";
    expect(card, "the card component must exist to be read").not.toBe("");
    // The count badge itself: the not-measured arm says the words, the measured
    // arm says the number. A card that prints 0 beside "not measured" is the
    // defect this whole rule exists to stop.
    const badge = /q\.status === "not_measured" \? \(([\s\S]*?)\) : \(([\s\S]*?)\)\}/.exec(card);
    expect(badge, "the badge must be a two-arm choice").not.toBeNull();
    expect(badge?.[1]).toContain("Not measured");
    expect(badge?.[1]).not.toMatch(/q\.total/);
    expect(badge?.[2]).toMatch(/\{\s*q\.total\s*\}/);
    // And no row list is rendered for an unmeasured queue.
    expect(card).toMatch(/q\.status === "measured" && count > 0 &&/);
  });

  it("keeps the queue read out of the kiosk's auto-clear", () => {
    // The countdown clears the last patient's card. It must not clear the counter's
    // own state, and the queues must not be part of `resolved`.
    const clear = /const handleClear = useCallback\(\(\) => \{[\s\S]*?\n\s*\}, \[\]\);/.exec(page)?.[0] ?? "";
    expect(clear, "the kiosk reset must still exist to be read").not.toBe("");
    expect(clear).not.toMatch(/queue/i);
    expect(page).toMatch(/<CustodyQueuesSection \/>\s*<\/div>\s*\)/);
  });

  it("adds no second scanner keyboard listener", () => {
    // Exactly the pair the kiosk has always had: one window keydown, and the
    // hidden input's own handler. A queue card that grabs Enter starts a race on
    // the same buffer.
    expect(page.match(/window\.addEventListener\("keydown"/g) ?? []).toHaveLength(1);
    expect(page.match(/onKeyDown=\{onInputKeyDown\}/g) ?? []).toHaveLength(1);
    expect(page).not.toMatch(/CustodyQueuesSection[\s\S]{0,400}addEventListener/);
  });

  it("explains a missing permission instead of hiding the dashboard", () => {
    const errorBranch = /if \(error\) \{[\s\S]*?\n  \}/.exec(page)?.[0] ?? "";
    expect(errorBranch).not.toBe("");
    expect(errorBranch).toMatch(/403/);
    expect(errorBranch).toMatch(/Settings → Users|Settings\s*→\s*Users/);
    // The section is not gated behind a client-side permission guess either: the
    // server decides, and a hidden card would read as "no reports exist".
    expect(page).not.toMatch(/hasSubPermission|permissions\.includes/);
  });

  it("carries no clinical text and no one-click delivery action", () => {
    // Checked on the type that the queue renders, because the words `body` and
    // `impression` belong in this file's HISTORY comments (they used to be in the
    // type, and rendered) and a whole-file grep would either trip on the comment
    // or be deleted by the next person who reads it.
    const queueType = /type CustodyQueueEntry = \{[\s\S]*?\n\};/.exec(page)?.[0] ?? "";
    expect(queueType, "the entry type must exist to be read").not.toBe("");
    expect(queueType.toLowerCase()).not.toContain("impression");
    expect(queueType).not.toMatch(/\n\s*(body|parameters)\??:/);
    expect(page).not.toMatch(/\br\.(body|impression)\b/);
    expect(page).not.toMatch(/reports\/\$\{[^}]*\}\/deliver/);
    expect(page).toContain("Hand over at the counter");
  });

  it("stays a queue list, not an analytics surface", () => {
    expect(page).not.toMatch(/recharts|chart\.js|Chart\b/);
    expect(page).not.toMatch(/<svg[\s\S]{0,200}(pie|bar|line)/i);
    expect(page).toMatch(/toLocaleString\(\)/);
  });
});

describe("report delivery go-live cutoff — the administrator's side", () => {
  it("is settable in Settings and travels as an instant, not a wall clock", () => {
    expect(settings).toContain("reportDeliveryGoLiveAt");
    expect(settings).toMatch(/type="datetime-local"/);
    // The whole point of the two helpers: a bare "2026-11-01T09:30" would be read
    // in the API container's zone, five and a half hours from the counter's.
    expect(settings).toMatch(/fromLocalInputValue\(e\.target\.value\)/);
    expect(settings).toMatch(/getTimezoneOffset\(\)/);
    expect(settings).toMatch(/toLocalInputValue\(current\.reportDeliveryGoLiveAt\)/);
    // Positive control for the absence below: the field is bound through the
    // helper, so a raw assignment is what must be gone.
    expect(settings).not.toMatch(/reportDeliveryGoLiveAt:\s*e\.target\.value/);
  });

  it("tells the administrator what clearing it does", () => {
    expect(settings).toMatch(/not measured/i);
    expect(settings).toMatch(/Report delivery go-live/);
  });
});

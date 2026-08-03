/**
 * queueDisplayPingScheduler.ts — "you're almost up" WhatsApp ping.
 *
 * Off by default per room (queue_display_settings.patient_ping_enabled).
 * Read-only against test_tokens/patients — never writes to either table.
 * Does NOT touch test-tokens.ts (protected/billing) or its schema; this
 * only reads columns that route already maintains as part of its normal
 * call flow. Ping de-duplication is kept in-memory (best-effort courtesy
 * notification, not an audit record) so a restart at worst re-pings or
 * misses one message — never anything that touches money or PHI at rest.
 *
 * Token numbers are sequenced PER DEPARTMENT (test-tokens.ts's
 * generateTestToken computes MAX(tokenNo)+1 scoped to one department; its
 * /call route auto-completes the previous "serving" token scoped to that
 * same one department too) — each department runs its own independent
 * queue, in parallel, at its own pace. A room whose `departments` field
 * lists more than one department (or leaves it empty, meaning "every
 * department on this ledger") therefore must rank "who's almost up"
 * PER DEPARTMENT, never by sorting the merged list on tokenNo globally —
 * department A's token #5 and department B's token #2 have no meaningful
 * relative order just because 2 < 5; they're different counters.
 *
 * Called from cron.ts on a short interval (see scheduleQueueDisplayAlerts).
 */

import { db } from "@workspace/db";
import { testTokensTable, patientsTable, queueDisplaySettingsTable } from "@workspace/db/schema";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { getWhatsAppService } from "../services/whatsapp/WhatsAppService";
import { resolveQueueDisplayDepartments } from "./queueDisplayDepartments";

// Keyed by `${date}:${tokenId}` so a restart just means a token might be
// pinged again — never a crash, never a duplicate financial/audit record.
const pingedTokens = new Set<string>();

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Pure (exported for tests and for the settings UI's "send test ping" action
// in routes/queueDisplaySettings.ts, so a test message is worded IDENTICALLY
// to a real one instead of drifting from a copy-pasted template).
export function buildPingMessage(opts: {
  roomTitle: string | null;
  roomKey: string;
  tokenLabel: string;
  firstName?: string | null;
}): string {
  const name = opts.firstName ? `, ${opts.firstName}` : "";
  return `Hi${name}! You're almost up at ${opts.roomTitle || opts.roomKey} — token #${opts.tokenLabel}. Please make your way to the waiting area.`;
}

// Pure (exported for tests): given a room's full waiting list already sorted
// (priority DESC, tokenNo ASC) - the same ordering test-tokens.ts uses - picks
// the top `n` tokens FROM EACH DEPARTMENT independently, instead of the top
// `n` of the merged list. Grouping is a stable filter (it never reorders
// rows), so each department's slice stays correctly ranked without needing
// to re-sort.
export function selectTopNPerDepartment<T extends { department: string }>(sortedWaiting: T[], n: number): T[] {
  const byDepartment = new Map<string, T[]>();
  for (const token of sortedWaiting) {
    const bucket = byDepartment.get(token.department);
    if (bucket) bucket.push(token);
    else byDepartment.set(token.department, [token]);
  }
  const cap = Math.max(1, n);
  return Array.from(byDepartment.values()).flatMap((bucket) => bucket.slice(0, cap));
}

export async function runPatientPingSweep(): Promise<{ pinged: number }> {
  const rooms = await db.select().from(queueDisplaySettingsTable).where(eq(queueDisplaySettingsTable.patientPingEnabled, true));
  if (rooms.length === 0) return { pinged: 0 };

  const date = todayISO();
  // Cheap daily cleanup — drop yesterday's dedup keys so the Set doesn't grow forever.
  for (const key of pingedTokens) {
    if (!key.startsWith(`${date}:`)) pingedTokens.delete(key);
  }

  const service = getWhatsAppService();
  let pinged = 0;

  for (const room of rooms) {
    const departments = resolveQueueDisplayDepartments(room.roomKey, room.departments);
    const conds = [
      eq(testTokensTable.tokenDate, date),
      eq(testTokensTable.status, "waiting"),
      room.ledgerId === 1
        ? or(eq(testTokensTable.ledgerId, 1), isNull(testTokensTable.ledgerId))
        : eq(testTokensTable.ledgerId, room.ledgerId),
    ];
    if (departments.length > 0) conds.push(inArray(testTokensTable.department, departments));

    // No SQL-level LIMIT here: it must consider the whole scoped waiting list
    // before it can group by department, or a department with many more
    // waiting patients than others would crowd out a different department's
    // own next-in-line entirely (see selectTopNPerDepartment above).
    const allWaiting = await db
      .select({
        id: testTokensTable.id,
        tokenNo: testTokensTable.tokenNo,
        department: testTokensTable.department,
        phone: patientsTable.phone,
        firstName: patientsTable.firstName,
      })
      .from(testTokensTable)
      .leftJoin(patientsTable, eq(patientsTable.id, testTokensTable.patientId))
      .where(and(...conds))
      .orderBy(desc(testTokensTable.priority), asc(testTokensTable.tokenNo));

    const waiting = selectTopNPerDepartment(allWaiting, room.patientPingTokensBefore);

    for (const token of waiting) {
      if (!token.phone) continue;
      const dedupeKey = `${date}:${token.id}`;
      if (pingedTokens.has(dedupeKey)) continue;

      const phone = service.normalizePhone(token.phone);
      const text = buildPingMessage({
        roomTitle: room.roomTitle, roomKey: room.roomKey,
        tokenLabel: String(token.tokenNo), firstName: token.firstName,
      });
      try {
        const result = await service.sendText(phone, text);
        pingedTokens.add(dedupeKey); // mark attempted either way — don't retry-storm a bad number
        if (result.ok) pinged++;
        else console.warn(`[queue-display] patient ping failed for token #${token.id}:`, result.error);
      } catch (err) {
        pingedTokens.add(dedupeKey);
        console.warn(`[queue-display] patient ping threw for token #${token.id}:`, err);
      }
    }
  }

  return { pinged };
}

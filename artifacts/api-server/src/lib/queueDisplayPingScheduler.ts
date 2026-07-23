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
 * Called from cron.ts on a short interval (see scheduleQueueDisplayAlerts).
 */

import { db } from "@workspace/db";
import { testTokensTable, patientsTable, queueDisplaySettingsTable } from "@workspace/db/schema";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { getWhatsAppService } from "../services/whatsapp/WhatsAppService";

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
    const departments = room.departments ? room.departments.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const conds = [
      eq(testTokensTable.tokenDate, date),
      eq(testTokensTable.status, "waiting"),
      room.ledgerId === 1
        ? or(eq(testTokensTable.ledgerId, 1), isNull(testTokensTable.ledgerId))
        : eq(testTokensTable.ledgerId, room.ledgerId),
    ];
    if (departments.length > 0) conds.push(inArray(testTokensTable.department, departments));

    const waiting = await db
      .select({
        id: testTokensTable.id,
        tokenNo: testTokensTable.tokenNo,
        phone: patientsTable.phone,
        firstName: patientsTable.firstName,
      })
      .from(testTokensTable)
      .leftJoin(patientsTable, eq(patientsTable.id, testTokensTable.patientId))
      .where(and(...conds))
      .orderBy(desc(testTokensTable.priority), asc(testTokensTable.tokenNo))
      .limit(Math.max(1, room.patientPingTokensBefore));

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

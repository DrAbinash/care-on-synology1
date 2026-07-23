/**
 * In-app notifications — the first generic notify() in the ERP.
 * Fire-and-forget: a failed notification never breaks the business action.
 * In-app only (no external WhatsApp/SMS dependency).
 */
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";

export interface NotifyInput {
  staffId?: number | null;
  userId?: number | null;
  type: string;
  title: string;
  body?: string | null;
  refType?: string | null;
  refId?: string | null;
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    await db.insert(notificationsTable).values({
      staffId: input.staffId ?? null,
      userId: input.userId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
    });
  } catch {
    // best-effort; notifications must never block the caller
  }
}

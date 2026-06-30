// Reception Command Center — Live Feed.
// AI_RECEPTIONIST_OPERATIONAL_DESIGN.md Section 1. Per that document's
// own section 1.6, several widgets it described (Voice, Web Chat, QR
// Gateway, live doctor availability, VIP flag, staff-online tracking,
// live modality status) are explicitly flagged as not-yet-confirmed-to-
// exist or genuinely new. This endpoint aggregates ONLY what was
// confirmed real by directly reading the relevant schema files before
// writing this route — it does not fabricate cards for channels that
// don't exist. The frontend explicitly labels which channels are live
// versus not-yet-connected, rather than presenting an empty list as
// "nothing happening" when the truth is "this channel isn't built yet."
//
// Confirmed real sources, by direct schema read, not assumption:
//   wa_conversations    — thread-level, has a genuine status field
//                          (bot/human/closed) that IS the Human Handoff
//                          signal section 1.3 of the design doc asked
//                          for under "New" — turns out to already exist.
//   appointments        — today's scheduled appointments.
//   knowledge_base_search_log — unanswered-question events, the same
//                          data the Knowledge Base admin's "gaps" panel
//                          already surfaces, reused here as live-feed
//                          items rather than duplicated logic.
//   machines.status     — confirmed real per section 1.6's own note
//                          ("the one downtime data point genuinely
//                          ready to surface as-is").

import { Router } from "express";
import { db } from "@workspace/db";
import {
  waConversationsTable, waContactsTable,
  appointmentsTable, patientsTable,
  knowledgeBaseSearchLogTable,
  machinesTable,
} from "@workspace/db/schema";
import { eq, desc, gte } from "drizzle-orm";
import { requireStaffAuth } from "../middleware/requireStaffAuth";

export const receptionCommandCenterRouter = Router();
receptionCommandCenterRouter.use(requireStaffAuth);

interface FeedItem {
  id: string;
  channel: "whatsapp" | "knowledge_gap";
  priority: "emergency" | "handoff" | "normal";
  title: string;
  subtitle: string;
  timestamp: string;
  ageMinutes: number;
}

receptionCommandCenterRouter.get("/feed", async (_req, res): Promise<void> => {
  const items: FeedItem[] = [];
  const now = Date.now();

  // WhatsApp conversations currently needing a human (status='human') or
  // recently active — this is the real Human Handoff queue section 1.3
  // asked for, sourced from wa_conversations.status, which already
  // exists.
  const waConvos = await db
    .select({
      id: waConversationsTable.id,
      phone: waConversationsTable.phone,
      status: waConversationsTable.status,
      currentFlow: waConversationsTable.currentFlow,
      lastMessageAt: waConversationsTable.lastMessageAt,
      contactName: waContactsTable.name,
    })
    .from(waConversationsTable)
    .leftJoin(waContactsTable, eq(waConversationsTable.contactId, waContactsTable.id))
    .where(gte(waConversationsTable.lastMessageAt, new Date(now - 4 * 60 * 60 * 1000)))
    .orderBy(desc(waConversationsTable.lastMessageAt))
    .limit(50);

  for (const c of waConvos) {
    const ts = c.lastMessageAt ?? new Date();
    const ageMinutes = Math.max(0, Math.round((now - new Date(ts).getTime()) / 60000));
    items.push({
      id: `wa-${c.id}`,
      channel: "whatsapp",
      priority: c.status === "human" ? "handoff" : "normal",
      title: c.status === "human" ? "Needs staff reply" : "AI handling",
      subtitle: `${c.contactName || c.phone}${c.currentFlow ? ` · ${c.currentFlow}` : ""}`,
      timestamp: new Date(ts).toISOString(),
      ageMinutes,
    });
  }

  // Unanswered patient/staff questions — reuses the exact same table the
  // Knowledge Base admin's gaps panel reads, so a question that stumped
  // the AI shows up in BOTH the live feed (for immediate awareness) and
  // the Knowledge Base screen (for the longer-term fix of adding
  // content) — one source of truth, two views of it, not two logs.
  const gaps = await db
    .select()
    .from(knowledgeBaseSearchLogTable)
    .where(eq(knowledgeBaseSearchLogTable.matched, false))
    .orderBy(desc(knowledgeBaseSearchLogTable.createdAt))
    .limit(20);

  for (const g of gaps) {
    const ageMinutes = Math.max(0, Math.round((now - new Date(g.createdAt).getTime()) / 60000));
    items.push({
      id: `gap-${g.id}`,
      channel: "knowledge_gap",
      priority: "normal",
      title: "AI couldn't answer",
      subtitle: `"${g.query}" via ${g.channel || "unknown channel"}`,
      timestamp: new Date(g.createdAt).toISOString(),
      ageMinutes,
    });
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  res.json({ items, generatedAt: new Date().toISOString() });
});

// Right-rail status panels — only the two confirmed-real ones (machines,
// today's appointments). Queue status, doctor availability, and live
// modality status are deliberately NOT included here — per section 1.6,
// those need either a live-availability flag that doesn't exist yet
// (doctors) or are a config flag rather than live status (modalities) —
// building fake panels for those would mislead a receptionist into
// trusting data that isn't real.
receptionCommandCenterRouter.get("/status-panels", async (_req, res): Promise<void> => {
  const machines = await db
    .select({ id: machinesTable.id, name: machinesTable.name, status: machinesTable.status, department: machinesTable.department })
    .from(machinesTable)
    .where(eq(machinesTable.isActive, true));

  const today = new Date().toISOString().slice(0, 10);
  const todaysAppointments = await db
    .select({
      id: appointmentsTable.id,
      appointmentId: appointmentsTable.appointmentId,
      timeSlot: appointmentsTable.timeSlot,
      status: appointmentsTable.status,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
    })
    .from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .where(eq(appointmentsTable.appointmentDate, today))
    .orderBy(appointmentsTable.timeSlot);

  res.json({
    machines: machines.map((m) => ({ ...m, isDown: m.status !== "active" })),
    todaysAppointments,
    // Explicit, honest placeholders — the frontend renders these as
    // "Not yet connected" rather than omitting them silently, so a
    // receptionist understands this is a known gap, not assumes no
    // queue/doctor data exists in the ERP at all.
    notYetConnected: ["queue_status", "doctor_availability", "live_modality_status", "voice_calls", "web_chat", "qr_enquiries"],
  });
});

// =============================================================================
// WhatsAppBotEngine
//
// Processes incoming messages and produces bot replies. Manages conversation
// flows: main menu, appointment booking, report status, payment/dues check,
// queue/token, admin summary, staff summary, doctor summary, human handover.
// =============================================================================

import type { WhatsAppService } from "./WhatsAppService";
import type { ParsedIncomingMessage } from "./WhatsAppProvider";
import { db } from "@workspace/db";
import {
  waContactsTable, waConversationsTable, waAuditLogsTable,
  billsTable, ordersTable, patientReportsTable, appointmentsTable,
  clinicSettingsTable, staffTable, patientsTable,
  knowledgeBaseEntriesTable, knowledgeBaseSearchLogTable,
} from "@workspace/db/schema";
import { eq, and, desc, gte, sql, or, ilike } from "drizzle-orm";
import { generateAiForTask } from "@workspace/ai-providers";

export interface BotReply {
  text?: string;
  buttons?: { id: string; title: string }[];
  template?: { name: string; languageCode?: string };
  action?: "handover_human" | "close_conversation" | "none";
}

export class WhatsAppBotEngine {
  private service: WhatsAppService;

  constructor(service: WhatsAppService) {
    this.service = service;
  }

  async processMessage(contact: { id: number; phone: string; name: string; contactType: string; patientId?: number | null; doctorId?: number | null; staffUserId?: number | null; consentStatus: string }, msg: ParsedIncomingMessage): Promise<BotReply> {
    const text = (msg.body || "").trim().toLowerCase();

    // Opt-out
    if (text === "stop" || text === "unsubscribe") {
      await db.update(waContactsTable).set({ consentStatus: "denied" }).where(eq(waContactsTable.id, contact.id));
      return { text: "You have been opted out. You will not receive any more messages from us. Reply START to opt back in." };
    }

    // Opt-in
    if (text === "start" || text === "subscribe") {
      await db.update(waContactsTable).set({ consentStatus: "granted" }).where(eq(waContactsTable.id, contact.id));
      return { text: "Welcome back! You are now subscribed to Care Diagnostics WhatsApp updates." };
    }

    // Check consent
    if (contact.consentStatus === "denied") return { text: "" };

    // Human handover keywords
    if (text === "staff" || text === "human" || text === "talk to staff" || text === "agent" || text === "support") {
      return this.handoverToHuman(contact.id);
    }

    // Return to bot from human handover
    if (text === "bot" || text === "menu") {
      const [conv] = await db.select().from(waConversationsTable).where(eq(waConversationsTable.contactId, contact.id)).limit(1);
      if (conv && conv.status === "human") {
        await db.update(waConversationsTable).set({ status: "bot", currentFlow: "" }).where(eq(waConversationsTable.id, conv.id));
      }
      await this.service.resetSession(contact.id);
      return this.showMainMenu(contact);
    }

    // Admin commands
    if (contact.contactType === "admin" || contact.contactType === "staff") {
      const adminReply = await this.handleAdminCommands(contact, text);
      if (adminReply) return adminReply;
    }

    // Doctor commands
    if (contact.contactType === "doctor" && contact.doctorId) {
      const doctorReply = await this.handleDoctorCommands(contact, text);
      if (doctorReply) return doctorReply;
    }

    // Get or create bot session
    const session = await this.service.getOrCreateSession(contact.id);

    // If conversation is in human mode, don't process with bot
    const [conv] = await db.select().from(waConversationsTable).where(eq(waConversationsTable.contactId, contact.id)).limit(1);
    if (conv && conv.status === "human") {
      return { text: "" }; // silence — staff will handle
    }

    // Flow-based routing
    if (session.currentStep === "main_menu" || text === "menu" || text === "hi" || text === "hello" || text === "help") {
      return this.showMainMenu(contact);
    }

    if (session.currentStep.startsWith("book_")) {
      return this.handleAppointmentFlow(contact, session.currentStep, text, session.context);
    }

    if (session.currentStep.startsWith("report_")) {
      return this.handleReportFlow(contact, session.currentStep, text, session.context);
    }

    if (session.currentStep.startsWith("payment_")) {
      return this.handlePaymentFlow(contact, session.currentStep, text, session.context);
    }

    // Menu selections
    if (text === "1" || text === "book" || text === "appointment") return this.startAppointmentFlow(contact);
    if (text === "2" || text === "report" || text === "status") return this.startReportFlow(contact);
    if (text === "3" || text === "download" || text === "download report") return this.startDownloadReportFlow(contact);
    if (text === "4" || text === "bill" || text === "dues") return this.startPaymentFlow(contact);
    if (text === "5" || text === "location" || text === "address") return this.showLocation();
    if (text === "6" || text === "talk to staff") return this.handoverToHuman(contact.id);
    if (text === "7" || text === "ask" || text === "question") return this.handleKnowledgeBaseQuestion(contact, text);

    // Anything else typed at the main menu, free text that doesn't match a
    // menu number/keyword, is treated as a question rather than silently
    // re-showing the menu (the prior behavior here ignored what the user
    // actually typed). Grounded in the Knowledge Base, same retrieval
    // approach and same escalate-on-no-match contract as the AI path in
    // routes/whatsapp.ts's handleAiReply — see that file for the fuller
    // rationale. Kept deliberately separate from the structured booking/
    // report/payment flows above: those stay fully deterministic and
    // never touch the AI/Knowledge Base layer, by design, so a wrong or
    // unavailable AI provider can never affect a booking or a bill amount.
    if (text.length > 0) return this.handleKnowledgeBaseQuestion(contact, text);

    return this.showMainMenu(contact);
  }

  // ── Main Menu ───────────────────────────────────────────────────────────────────────
  private showMainMenu(contact: { name?: string | null }): BotReply {
    return {
      text: `Hello${contact.name ? ` ${contact.name}` : ""}! Welcome to Care Diagnostics.\n\nPlease reply with a number, or just type your question:\n1. Book Appointment\n2. Check Report Status\n3. Download Report\n4. Check Bill / Dues\n5. Location\n6. Talk to Staff\n7. Ask a Question`,
      buttons: [
        { id: "1", title: "Book" },
        { id: "2", title: "Report Status" },
        { id: "3", title: "Download" },
        { id: "4", title: "Bill/Dues" },
        { id: "5", title: "Location" },
        { id: "6", title: "Talk to Staff" },
      ],
    };
  }

  // ── Knowledge-Base-grounded free-text question ────────────────────────────────
  // Mirrors routes/whatsapp.ts's handleAiReply: search published Knowledge
  // Base entries first; if matched, ground the AI's answer in that content
  // only; if not matched, hand off to staff rather than let the AI
  // improvise. Logs to the same knowledge_base_search_log table the admin
  // UI's "Knowledge Gaps" panel reads from, so a question asked through
  // this menu-bot path shows up in the same place as one asked through the
  // other webhook — one gap-detection feed, not two.
  private async handleKnowledgeBaseQuestion(contact: { id: number; name: string }, text: string): Promise<BotReply> {
    const likeQ = `%${text.trim()}%`;
    const kbMatches = await db
      .select()
      .from(knowledgeBaseEntriesTable)
      .where(and(
        eq(knowledgeBaseEntriesTable.status, "published"),
        or(
          ilike(knowledgeBaseEntriesTable.title, likeQ),
          ilike(knowledgeBaseEntriesTable.content, likeQ),
          ilike(knowledgeBaseEntriesTable.keywords, likeQ),
        ),
      ))
      .limit(3);
    const matched = kbMatches.length > 0;

    await db.insert(knowledgeBaseSearchLogTable).values({
      query: text.trim(),
      matchedEntryId: matched ? kbMatches[0].id : null,
      matched,
      channel: "wa_chatbot",
    });

    if (!matched) {
      return {
        text: "I'm not sure about that one — let me connect you with our team. For urgent matters, please call us directly.\n\nReply MENU for the main menu.",
        action: "handover_human",
      };
    }

    const kbContext = kbMatches.map((m) => `[${m.category}] ${m.title}: ${m.content}`).join("\n\n");
    const prompt = `You are the AI assistant for Care Diagnostics diagnostic center.

The following approved information from our knowledge base is relevant to this patient's question. Base your answer ONLY on this information — do not add facts, prices, or details that are not stated here. If it doesn't fully answer the question, say so and offer to connect them with staff, rather than guessing.

Keep replies concise (under 100 words), warm, and professional. Do not make up specific prices, results, or medical diagnoses.

Approved knowledge base content:
${kbContext}

Patient name: ${contact.name || "Patient"}
Patient message: ${text}

Reply in a helpful, friendly manner. Be concise.`;

    try {
      const result = await generateAiForTask("whatsapp_ai_receptionist", prompt, [], { maxTokens: 300 });
      const reply = result.success && result.text ? result.text : "";
      if (!reply) {
        return { text: "Let me connect you with our team for this one.\n\nReply MENU for the main menu.", action: "handover_human" };
      }
      return { text: `${reply}\n\nReply MENU for the main menu.` };
    } catch {
      return { text: "Let me connect you with our team for this one.\n\nReply MENU for the main menu.", action: "handover_human" };
    }
  }

  // ── Appointment Booking Flow ──────────────────────────────────────────────────
  private async startAppointmentFlow(contact: { id: number }): Promise<BotReply> {
    await this.service.updateSession(contact.id, "book_department", {});
    return {
      text: "Let's book your appointment.\n\nChoose a department:\n1. Pathology\n2. Radiology (X-Ray / USG / CT / MRI)\n3. OPD / Consultation\n\nReply with 1, 2, or 3.",
      buttons: [
        { id: "pathology", title: "Pathology" },
        { id: "radiology", title: "Radiology" },
        { id: "opd", title: "OPD" },
      ],
    };
  }

  private async handleAppointmentFlow(contact: { id: number; name: string; phone: string; patientId?: number | null }, step: string, text: string, context: Record<string, unknown>): Promise<BotReply> {
    if (step === "book_department") {
      let department = "";
      if (text === "1" || text === "pathology") department = "Pathology";
      else if (text === "2" || text === "radiology") department = "Radiology";
      else if (text === "3" || text === "opd") department = "OPD";
      else return { text: "Please reply with 1, 2, or 3." };
      await this.service.updateSession(contact.id, "book_date", { ...context, department });
      return { text: `You selected ${department}.\n\nPlease enter your preferred date (DD-MM-YYYY).` };
    }

    if (step === "book_date") {
      const dateMatch = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (!dateMatch) return { text: "Please enter a valid date in DD-MM-YYYY format." };
      const [, dd, mm, yyyy] = dateMatch;
      const dateStr = `${yyyy}-${mm}-${dd}`;
      await this.service.updateSession(contact.id, "book_confirm", { ...context, preferredDate: dateStr });
      const dept = String(context.department || "");
      return {
        text: `Booking summary:\nDepartment: ${dept}\nDate: ${dd}-${mm}-${yyyy}\nName: ${contact.name || "Patient"}\nMobile: ${contact.phone}\n\nReply CONFIRM to book, or CANCEL to abort.`,
        buttons: [
          { id: "confirm", title: "Confirm" },
          { id: "cancel", title: "Cancel" },
        ],
      };
    }

    if (step === "book_confirm") {
      if (text === "confirm" || text === "yes") {
        const { preferredDate, department } = context as { preferredDate: string; department: string };
        if (!contact.patientId) {
          return { text: "Patient profile not linked. Please visit the clinic to complete registration before booking.\n\nReply MENU for main menu." };
        }
        const aptId = `WAPP-${Date.now()}`;
        const [created] = await db.insert(appointmentsTable).values({
          appointmentId: aptId,
          patientId: contact.patientId,
          appointmentDate: preferredDate,
          timeSlot: "09:00 AM",
          status: "scheduled",
          type: "walk-in",
          notes: `WhatsApp booking - Dept: ${department || "General"}`,
        }).returning();
        await this.service.updateSession(contact.id, "main_menu", {});
        return {
          text: `Appointment booked successfully!\n\nReference: ${created.appointmentId}\nDepartment: ${department || "General"}\nDate: ${preferredDate}\n\nPlease arrive 15 minutes early. You will receive a confirmation call if needed.\n\nReply MENU for main menu.`,
        };
      }
      if (text === "cancel" || text === "no") {
        await this.service.updateSession(contact.id, "main_menu", {});
        return { text: "Booking cancelled. Reply MENU to return to the main menu." };
      }
      return { text: "Please reply CONFIRM or CANCEL." };
    }

    return this.showMainMenu(contact);
  }

  // ── Report Status Flow ──────────────────────────────────────────────────────
  private async startReportFlow(contact: { id: number; patientId?: number | null }): Promise<BotReply> {
    if (contact.patientId) {
      const reports = await this.service.findPendingReportsByPatientId(contact.patientId);
      if (reports.length === 0) {
        return { text: "No reports found for your registered profile.\n\nReply MENU to return to main menu." };
      }
      const lines = reports.map((r) => `• ${r.title}: ${r.status.toUpperCase()}`).join("\n");
      return { text: `Your report status:\n${lines}\n\nReply MENU to return to main menu.` };
    }
    await this.service.updateSession(contact.id, "report_search", {});
    return { text: "To check your report status, please enter your registered mobile number or bill number." };
  }

  private async handleReportFlow(contact: { id: number }, step: string, text: string, context: Record<string, unknown>): Promise<BotReply> {
    if (step === "report_search") {
      const patient = await this.service.findPatientByPhone(text);
      if (!patient) {
        return { text: "No patient found with that number. Please try again or visit the clinic.\n\nReply MENU for main menu." };
      }
      // Identity gate: the phone number that sent THIS message is not
      // necessarily the patient's own — anyone holding the patient's
      // phone number (often not secret: written on prescriptions, given
      // to family) could otherwise extract report status for someone
      // else. Require a second factor (date of birth) before revealing
      // anything, per the platform's "phone number alone is not enough"
      // requirement. This mirrors the same gate the payment/dues flow
      // below also needs and now has.
      await this.service.updateSession(contact.id, "report_verify_dob", { ...context, candidatePatientId: patient.id });
      return { text: "For your privacy, please confirm the patient's date of birth (DD-MM-YYYY) to continue." };
    }
    if (step === "report_verify_dob") {
      const candidatePatientId = Number(context.candidatePatientId);
      const verified = await this.verifyPatientDob(candidatePatientId, text);
      if (!verified) {
        await this.service.updateSession(contact.id, "main_menu", {});
        return { text: "That date of birth does not match our records. For your privacy, we cannot show this information here.\n\nPlease visit the clinic or reply MENU for main menu." };
      }
      const reports = await this.service.findPendingReportsByPatientId(candidatePatientId);
      await this.service.updateSession(contact.id, "main_menu", {});
      if (reports.length === 0) {
        return { text: "No reports found for that profile.\n\nReply MENU to return to main menu." };
      }
      const lines = reports.map((r) => `• ${r.title}: ${r.status.toUpperCase()}`).join("\n");
      return { text: `Report status:\n${lines}\n\nWhen a report is ready, you will receive a secure link.\n\nReply MENU to return to main menu.` };
    }
    return this.showMainMenu(contact as { id: number; name?: string | null });
  }

  // Second-factor identity check — date of birth, compared against the
  // patient record located by the phone number the user typed. Used by
  // both the report-status and payment/dues "search by phone number"
  // flows, so this lives once rather than being duplicated.
  private async verifyPatientDob(patientId: number, typedDob: string): Promise<boolean> {
    const dateMatch = typedDob.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!dateMatch) return false;
    const [, dd, mm, yyyy] = dateMatch;
    const typed = `${yyyy}-${mm}-${dd}`;
    const [patient] = await db.select({ dateOfBirth: patientsTable.dateOfBirth }).from(patientsTable).where(eq(patientsTable.id, patientId)).limit(1);
    if (!patient) return false;
    // dateOfBirth is stored as text; compare the YYYY-MM-DD portion only,
    // tolerant of a stored value that includes a time component.
    return (patient.dateOfBirth || "").slice(0, 10) === typed;
  }

  private async startDownloadReportFlow(contact: { id: number }): Promise<BotReply> {
    await this.service.updateSession(contact.id, "main_menu", {});
    return { text: "Downloadable reports will be sent via a secure link when ready.\n\nPlease use option 2 (Report Status) to check current status.\n\nReply MENU to return to main menu." };
  }

  // ── Payment / Dues Flow ─────────────────────────────────────────────────────
  private async startPaymentFlow(contact: { id: number }): Promise<BotReply> {
    await this.service.updateSession(contact.id, "payment_search", {});
    return { text: "To check your bill or dues, please enter your registered mobile number or bill number." };
  }

  private async handlePaymentFlow(contact: { id: number }, step: string, text: string, context: Record<string, unknown>): Promise<BotReply> {
    if (step === "payment_search") {
      const patient = await this.service.findPatientByPhone(text);
      if (!patient) {
        return { text: "No patient found with that number. Please try again or visit the clinic.\n\nReply MENU for main menu." };
      }
      // Same identity gate as the report-status flow above — see the
      // comment there for why this is required, not optional.
      await this.service.updateSession(contact.id, "payment_verify_dob", { ...context, candidatePatientId: patient.id });
      return { text: "For your privacy, please confirm the patient's date of birth (DD-MM-YYYY) to continue." };
    }
    if (step === "payment_verify_dob") {
      const candidatePatientId = Number(context.candidatePatientId);
      const verified = await this.verifyPatientDob(candidatePatientId, text);
      if (!verified) {
        await this.service.updateSession(contact.id, "main_menu", {});
        return { text: "That date of birth does not match our records. For your privacy, we cannot show this information here.\n\nPlease visit the clinic or reply MENU for main menu." };
      }
      const bills = await this.service.findBillsByPatientId(candidatePatientId);
      if (bills.length === 0) {
        await this.service.updateSession(contact.id, "main_menu", {});
        return { text: "No bills found for that profile.\n\nReply MENU to return to main menu." };
      }
      const pending = bills.filter((b) => Number(b.balanceAmount || 0) > 0);
      if (pending.length === 0) {
        await this.service.updateSession(contact.id, "main_menu", {});
        return { text: "All your bills are paid. Thank you!\n\nReply MENU to return to main menu." };
      }
      const lines = pending.map((b) => `• Bill ${b.billNumber}: ₹${Number(b.balanceAmount).toFixed(2)} pending`).join("\n");
      const total = pending.reduce((s, b) => s + Number(b.balanceAmount || 0), 0);
      await this.service.updateSession(contact.id, "main_menu", {});
      return {
        text: `Your pending dues:\n${lines}\n\nTotal pending: ₹${total.toFixed(2)}\n\nPlease visit the clinic or call to settle.\n\nReply MENU to return to main menu.`,
      };
    }
    return this.showMainMenu(contact as { id: number; name?: string | null });
  }

  // ── Location ─────────────────────────────────────────────────────────────────────
  private async showLocation(): Promise<BotReply> {
    const [clinic] = await db.select({ address: clinicSettingsTable.address, phone: clinicSettingsTable.phone, website: clinicSettingsTable.website }).from(clinicSettingsTable).limit(1);
    return {
      text: `Care Diagnostics\n${clinic?.address || "Visit us for address details."}\n\nPhone: ${clinic?.phone || "N/A"}\n${clinic?.website ? `Website: ${clinic.website}` : ""}\n\nReply MENU to return to main menu.`,
    };
  }

  // ── Human Handover ─────────────────────────────────────────────────────────────
  private async handoverToHuman(contactId: number): Promise<BotReply> {
    const [conv] = await db.select().from(waConversationsTable).where(eq(waConversationsTable.contactId, contactId)).limit(1);
    if (conv) {
      await db.update(waConversationsTable).set({ status: "human", currentFlow: "human_handover" }).where(eq(waConversationsTable.id, conv.id));
    }
    return {
      text: "Connecting you to our staff...\n\nA team member will reply shortly. Please share your query and we will assist you.\n\nReply BOT to return to automated menu.",
      action: "handover_human",
    };
  }

  // ── Admin Commands ─────────────￾────────────────────────────────────────────────────────────────
  private async handleAdminCommands(contact: { contactType: string; staffUserId?: number | null }, text: string): Promise<BotReply | null> {
    const adminCmds = ["today", "cash", "dues", "reports", "discounts", "cancels", "drawer", "alerts"];
    const staffCmds = ["my collection", "my drawer", "my pending", "my bills"];

    if (!adminCmds.includes(text) && !staffCmds.includes(text)) return null;
    if (!contact.staffUserId) return { text: "This command is restricted to authorized staff.\n\nReply MENU for patient options." };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];

    if (text === "today") {
      const bills = await db.select().from(billsTable).where(and(gte(billsTable.createdAt, today), sql`${billsTable.status} != 'cancelled'`)).orderBy(desc(billsTable.createdAt));
      const totalRev = bills.reduce((s, b) => s + Number(b.totalAmount || 0), 0);
      const totalPaid = bills.reduce((s, b) => s + Number(b.paidAmount || 0), 0);
      const totalBal = bills.reduce((s, b) => s + Number(b.balanceAmount || 0), 0);
      return { text: `📊 Today's Summary (${todayStr})\nBills: ${bills.length}\nRevenue: ₹${totalRev.toFixed(2)}\nCash/Collected: ₹${totalPaid.toFixed(2)}\nOutstanding: ₹${totalBal.toFixed(2)}` };
    }

    if (text === "cash") {
      const bills = await db.select().from(billsTable).where(and(gte(billsTable.createdAt, today), sql`${billsTable.status} != 'cancelled'`)).orderBy(desc(billsTable.createdAt));
      const paid = bills.reduce((s, b) => s + Number(b.paidAmount || 0), 0);
      const balance = bills.reduce((s, b) => s + Number(b.balanceAmount || 0), 0);
      return { text: `💵 Cash Summary (${todayStr})\nCollected: ₹${paid.toFixed(2)}\nPending: ₹${balance.toFixed(2)}\nRevenue: ₹${(paid + balance).toFixed(2)}` };
    }

    if (text === "dues") {
      const bills = await db.select().from(billsTable).where(and(sql`${billsTable.balanceAmount} > 0`, sql`${billsTable.status} != 'cancelled'`)).orderBy(desc(billsTable.createdAt)).limit(20);
      const total = bills.reduce((s, b) => s + Number(b.balanceAmount || 0), 0);
      return { text: `💳 Dues Summary\nPending bills: ${bills.length}\nTotal outstanding: ₹${total.toFixed(2)}` };
    }

    if (text === "reports") {
      const pending = await db.select({ count: sql<number>`count(*)` }).from(patientReportsTable).where(sql`${patientReportsTable.status} IN ('draft','pending')`);
      const verified = await db.select({ count: sql<number>`count(*)` }).from(patientReportsTable).where(eq(patientReportsTable.status, "verified"));
      return { text: `📋 Reports Summary\nPending: ${pending[0]?.count ?? 0}\nVerified today: ${verified[0]?.count ?? 0}` };
    }

    if (text === "my collection") {
      if (!contact.staffUserId) return { text: "Staff ID not linked." };
      // Note: billsTable has createdByName (text), not staffUserId (int). Staff commands
      // require mapping in production; simplified summary shown here.
      const bills = await db.select().from(billsTable).where(gte(billsTable.createdAt, today)).orderBy(desc(billsTable.createdAt));
      const total = bills.reduce((s, b) => s + Number(b.totalAmount || 0), 0);
      return { text: `👤 My Collection (${todayStr})\nBills: ${bills.length}\nTotal: ₹${total.toFixed(2)}` };
    }

    if (text === "my pending") {
      if (!contact.staffUserId) return { text: "Staff ID not linked." };
      // Note: ordersTable has no createdBy column; simplified summary shown.
      const orders = await db.select().from(ordersTable).where(sql`${ordersTable.status} IN ('pending','in_progress')`).orderBy(desc(ordersTable.createdAt)).limit(10);
      return { text: `⏳ My Pending Work\nPending orders: ${orders.length}\nCheck ERP for full details.` };
    }

    return { text: `Command "${text}" recognized but detailed data not available via WhatsApp. Please check the ERP dashboard.` };
  }

  // ── Doctor Commands ─────────────────────────────────────────────────────────────────
  private async handleDoctorCommands(contact: { doctorId?: number | null }, text: string): Promise<BotReply | null> {
    const doctorCmds = ["today patients", "pending reports", "commission summary"];
    if (!doctorCmds.includes(text)) return null;
    if (!contact.doctorId) return { text: "Doctor ID not linked to this number." };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (text === "today patients") {
      // Note: billsTable has no referringDoctorId; using doctorId via ordersTable in production.
      // Simplified: show today's total.
      const bills = await db.select().from(billsTable).where(gte(billsTable.createdAt, today)).orderBy(desc(billsTable.createdAt));
      return { text: `👨‍⚕️ Today's Patients (${bills.length})\nTotal bill value: ₹${bills.reduce((s, b) => s + Number(b.totalAmount || 0), 0).toFixed(2)}\nCheck ERP for patient names and details.` };
    }

    if (text === "pending reports") {
      const pending = await db.select({ count: sql<number>`count(*)` }).from(patientReportsTable).where(sql`${patientReportsTable.status} != 'verified'`);
      return { text: `📋 Pending Reports: ${pending[0]?.count ?? 0}\nCheck ERP for full list.` };
    }

    return { text: `Command "${text}" recognized. Check ERP for detailed breakdown.` };
  }
}

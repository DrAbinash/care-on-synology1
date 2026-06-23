// =============================================================================
// WATIProvider
//
// Adapter for WATI (WhatsApp Team Inbox) API.
// Credentials: WATI_API_KEY, WATI_BASE_URL
// =============================================================================

import type {
  WhatsAppProvider, WhatsAppTextMessage, WhatsAppTemplateMessage,
  WhatsAppDocument, WhatsAppImage, WhatsAppInteractiveButtons,
  WhatsAppProviderCredentials, ParsedIncomingMessage,
  WebhookVerificationResult, SendResult,
} from "./WhatsAppProvider";

export class WATIProvider implements WhatsAppProvider {
  readonly name = "wati";
  private creds: WhatsAppProviderCredentials = {};
  private baseUrl = "";

  initialize(credentials: WhatsAppProviderCredentials, config?: Record<string, unknown>): void {
    this.creds = credentials;
    this.baseUrl = this.creds.baseUrl || "";
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.creds.apiKey || ""}`,
    };
  }

  private async apiPost(endpoint: string, body: unknown): Promise<SendResult> {
    if (!this.baseUrl) return { success: false, error: "WATI base URL not configured" };
    const url = `${this.baseUrl}${endpoint}`;
    try {
      const res = await fetch(url, { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { success: false, error: `WATI ${res.status}: ${text}` };
      }
      const data = (await res.json()) as { result?: string; messageId?: string };
      return { success: data.result === "success", providerMessageId: data.messageId };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  async sendTextMessage(message: WhatsAppTextMessage): Promise<SendResult> {
    return this.apiPost(`/api/v1/sendSessionMessage/${encodeURIComponent(message.to)}`, {
      messageText: message.body,
    });
  }

  async sendTemplateMessage(message: WhatsAppTemplateMessage): Promise<SendResult> {
    return this.apiPost(`/api/v1/sendTemplateMessage/${encodeURIComponent(message.to)}`, {
      template_name: message.templateName,
      broadcast_name: "erp_broadcast",
    });
  }

  async sendDocument(doc: WhatsAppDocument): Promise<SendResult> {
    return this.apiPost(`/api/v1/sendSessionMessage/${encodeURIComponent(doc.to)}`, {
      messageText: doc.caption || "Document",
      media: { url: doc.url, caption: doc.caption, filename: doc.filename },
    });
  }

  async sendImage(image: WhatsAppImage): Promise<SendResult> {
    return this.apiPost(`/api/v1/sendSessionMessage/${encodeURIComponent(image.to)}`, {
      messageText: image.caption || "Image",
      media: { url: image.url, caption: image.caption },
    });
  }

  async sendInteractiveButtons(message: WhatsAppInteractiveButtons): Promise<SendResult> {
    return this.apiPost(`/api/v1/sendSessionMessage/${encodeURIComponent(message.to)}`, {
      messageText: `${message.body}\n\n${message.buttons.map((b) => `${b.id}: ${b.title}`).join("\n")}`,
    });
  }

  async verifyWebhook(rawBody: string, signature: string): Promise<WebhookVerificationResult> {
    const secret = this.creds.webhookSecret || "";
    if (!secret) return { valid: true };
    const crypto = await import("node:crypto");
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    return { valid: signature === expected };
  }

  async parseIncomingMessages(rawBody: string): Promise<ParsedIncomingMessage[]> {
    const parsed = JSON.parse(rawBody);
    const msg: ParsedIncomingMessage = {
      provider: "wati",
      from: parsed.waId || parsed.sender?.wa_id || "",
      timestamp: String(Math.floor(Date.now() / 1000)),
      messageId: parsed.messageId || `WATI-${Date.now()}`,
      type: parsed.type === "text" ? "text" : parsed.type === "image" ? "image" : "unknown",
      body: parsed.text || parsed.body || "",
      rawPayload: parsed,
    };
    return [msg];
  }

  async markMessageRead(_providerMessageId: string): Promise<boolean> {
    return true;
  }
}

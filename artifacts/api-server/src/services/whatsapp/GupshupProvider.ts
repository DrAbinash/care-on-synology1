// =============================================================================
// GupshupWhatsAppProvider
//
// Adapter for Gupshup WhatsApp API.
// Credentials: GUPSHUP_API_KEY, GUPSHUP_APP_NAME, GUPSHUP_SOURCE_NUMBER
// =============================================================================

import type {
  WhatsAppProvider, WhatsAppTextMessage, WhatsAppTemplateMessage,
  WhatsAppDocument, WhatsAppImage, WhatsAppInteractiveButtons,
  WhatsAppProviderCredentials, ParsedIncomingMessage,
  WebhookVerificationResult, SendResult,
} from "./WhatsAppProvider";

export class GupshupProvider implements WhatsAppProvider {
  readonly name = "gupshup";
  private creds: WhatsAppProviderCredentials = {};
  private baseUrl = "https://api.gupshup.io/sm/api/v1";

  initialize(credentials: WhatsAppProviderCredentials, config?: Record<string, unknown>): void {
    this.creds = credentials;
    if (config?.baseUrl && typeof config.baseUrl === "string") this.baseUrl = config.baseUrl;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/x-www-form-urlencoded",
      apikey: this.creds.apiKey || "",
    };
  }

  private async apiPost(body: URLSearchParams): Promise<SendResult> {
    const url = `${this.baseUrl}/msg`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: body.toString(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { success: false, error: `Gupshup ${res.status}: ${text}` };
      }
      const data = (await res.json()) as { messageId?: string; status?: string };
      return { success: data.status === "submitted" || data.status === "success", providerMessageId: data.messageId };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  async sendTextMessage(message: WhatsAppTextMessage): Promise<SendResult> {
    const body = new URLSearchParams();
    body.set("channel", "whatsapp");
    body.set("source", this.creds.phoneNumberId || "");
    body.set("destination", message.to);
    body.set("message", JSON.stringify({ type: "text", text: message.body }));
    return this.apiPost(body);
  }

  async sendTemplateMessage(message: WhatsAppTemplateMessage): Promise<SendResult> {
    const body = new URLSearchParams();
    body.set("channel", "whatsapp");
    body.set("source", this.creds.phoneNumberId || "");
    body.set("destination", message.to);
    body.set("message", JSON.stringify({ type: "template", template: { name: message.templateName, language: { code: message.languageCode || "en" } } }));
    return this.apiPost(body);
  }

  async sendDocument(doc: WhatsAppDocument): Promise<SendResult> {
    const body = new URLSearchParams();
    body.set("channel", "whatsapp");
    body.set("source", this.creds.phoneNumberId || "");
    body.set("destination", doc.to);
    body.set("message", JSON.stringify({ type: "file", url: doc.url, caption: doc.caption, filename: doc.filename }));
    return this.apiPost(body);
  }

  async sendImage(image: WhatsAppImage): Promise<SendResult> {
    const body = new URLSearchParams();
    body.set("channel", "whatsapp");
    body.set("source", this.creds.phoneNumberId || "");
    body.set("destination", image.to);
    body.set("message", JSON.stringify({ type: "image", url: image.url, caption: image.caption }));
    return this.apiPost(body);
  }

  async sendInteractiveButtons(message: WhatsAppInteractiveButtons): Promise<SendResult> {
    const body = new URLSearchParams();
    body.set("channel", "whatsapp");
    body.set("source", this.creds.phoneNumberId || "");
    body.set("destination", message.to);
    body.set("message", JSON.stringify({
      type: "quick_reply",
      text: message.body,
      options: message.buttons.map((b) => ({ title: b.title, postbackText: b.id })),
    }));
    return this.apiPost(body);
  }

  async verifyWebhook(rawBody: string, signature: string): Promise<WebhookVerificationResult> {
    const secret = this.creds.webhookSecret || this.creds.appSecret || "";
    if (!secret) return { valid: true };
    const crypto = await import("node:crypto");
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    return { valid: signature === expected };
  }

  async parseIncomingMessages(rawBody: string): Promise<ParsedIncomingMessage[]> {
    const parsed = JSON.parse(rawBody);
    const payload = parsed.payload || parsed;
    const msg: ParsedIncomingMessage = {
      provider: "gupshup",
      from: payload.source || payload.sender?.phone || "",
      timestamp: String(Math.floor(Date.now() / 1000)),
      messageId: payload.id || `GUP-${Date.now()}`,
      type: payload.type === "text" ? "text" : payload.type === "image" ? "image" : payload.type === "file" ? "document" : "unknown",
      body: payload.payload?.text || payload.payload?.caption || "",
      mediaUrl: payload.payload?.url,
      rawPayload: parsed,
    };
    return [msg];
  }

  async markMessageRead(_providerMessageId: string): Promise<boolean> {
    return true;
  }
}

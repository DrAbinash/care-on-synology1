// =============================================================================
// TwilioWhatsAppProvider
//
// Adapter for Twilio WhatsApp API.
// Credentials: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
// =============================================================================

import type {
  WhatsAppProvider, WhatsAppTextMessage, WhatsAppTemplateMessage,
  WhatsAppDocument, WhatsAppImage, WhatsAppInteractiveButtons,
  WhatsAppProviderCredentials, ParsedIncomingMessage,
  WebhookVerificationResult, SendResult,
} from "./WhatsAppProvider";

export class TwilioWhatsAppProvider implements WhatsAppProvider {
  readonly name = "twilio";

  private creds: WhatsAppProviderCredentials = {};
  private baseUrl = "https://api.twilio.com/2010-04-01";

  initialize(credentials: WhatsAppProviderCredentials, config?: Record<string, unknown>): void {
    this.creds = credentials;
    if (config?.baseUrl && typeof config.baseUrl === "string") {
      this.baseUrl = config.baseUrl;
    }
  }

  private auth(): string {
    return Buffer.from(`${this.creds.apiKey || ""}:${this.creds.apiSecret || ""}`).toString("base64");
  }

  private async apiPost(formData: URLSearchParams): Promise<SendResult> {
    const url = `${this.baseUrl}/Accounts/${this.creds.apiKey || ""}/Messages.json`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Basic ${this.auth()}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { success: false, error: `Twilio ${res.status}: ${text}` };
      }
      const data = (await res.json()) as { sid?: string };
      return { success: true, providerMessageId: data.sid };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  async sendTextMessage(message: WhatsAppTextMessage): Promise<SendResult> {
    const fd = new URLSearchParams();
    fd.set("To", `whatsapp:${message.to}`);
    fd.set("From", `whatsapp:${this.creds.phoneNumberId || ""}`);
    fd.set("Body", message.body);
    return this.apiPost(fd);
  }

  async sendTemplateMessage(message: WhatsAppTemplateMessage): Promise<SendResult> {
    const fd = new URLSearchParams();
    fd.set("To", `whatsapp:${message.to}`);
    fd.set("From", `whatsapp:${this.creds.phoneNumberId || ""}`);
    fd.set("Body", `[Template: ${message.templateName}]`);
    return this.apiPost(fd);
  }

  async sendDocument(doc: WhatsAppDocument): Promise<SendResult> {
    const fd = new URLSearchParams();
    fd.set("To", `whatsapp:${doc.to}`);
    fd.set("From", `whatsapp:${this.creds.phoneNumberId || ""}`);
    fd.set("Body", doc.caption || "");
    fd.set("MediaUrl", doc.url);
    return this.apiPost(fd);
  }

  async sendImage(image: WhatsAppImage): Promise<SendResult> {
    const fd = new URLSearchParams();
    fd.set("To", `whatsapp:${image.to}`);
    fd.set("From", `whatsapp:${this.creds.phoneNumberId || ""}`);
    fd.set("Body", image.caption || "");
    fd.set("MediaUrl", image.url);
    return this.apiPost(fd);
  }

  async sendInteractiveButtons(message: WhatsAppInteractiveButtons): Promise<SendResult> {
    const body = `${message.body}\n\n${message.buttons.map((b) => `${b.id}: ${b.title}`).join("\n")}`;
    const fd = new URLSearchParams();
    fd.set("To", `whatsapp:${message.to}`);
    fd.set("From", `whatsapp:${this.creds.phoneNumberId || ""}`);
    fd.set("Body", body);
    return this.apiPost(fd);
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
    const msg: ParsedIncomingMessage = {
      provider: "twilio",
      from: parsed.From?.replace("whatsapp:", "") || "",
      timestamp: String(Math.floor(Date.now() / 1000)),
      messageId: parsed.MessageSid || parsed.SmsSid || `TWILIO-${Date.now()}`,
      type: parsed.MediaUrl0 ? (parsed.NumMedia && Number(parsed.NumMedia) > 0 ? "image" : "text") : "text",
      body: parsed.Body || "",
      mediaUrl: parsed.MediaUrl0,
      rawPayload: parsed,
    };
    return [msg];
  }

  async markMessageRead(_providerMessageId: string): Promise<boolean> {
    return true;
  }
}

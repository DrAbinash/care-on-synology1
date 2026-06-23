// =============================================================================
// InteraktProvider
//
// Adapter for Interakt WhatsApp API.
// Credentials: INTERAKT_API_KEY, INTERAKT_BASE_URL
// =============================================================================

import type {
  WhatsAppProvider, WhatsAppTextMessage, WhatsAppTemplateMessage,
  WhatsAppDocument, WhatsAppImage, WhatsAppInteractiveButtons,
  WhatsAppProviderCredentials, ParsedIncomingMessage,
  WebhookVerificationResult, SendResult,
} from "./WhatsAppProvider";

export class InteraktProvider implements WhatsAppProvider {
  readonly name = "interakt";
  private creds: WhatsAppProviderCredentials = {};
  private baseUrl = "https://api.interakt.ai/v1";

  initialize(credentials: WhatsAppProviderCredentials, config?: Record<string, unknown>): void {
    this.creds = credentials;
    if (config?.baseUrl && typeof config.baseUrl === "string") this.baseUrl = config.baseUrl;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Basic ${this.creds.apiKey || ""}`,
    };
  }

  private async apiPost(endpoint: string, body: unknown): Promise<SendResult> {
    const url = `${this.baseUrl}${endpoint}`;
    try {
      const res = await fetch(url, { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { success: false, error: `Interakt ${res.status}: ${text}` };
      }
      const data = (await res.json()) as { result?: boolean; messageId?: string };
      return { success: data.result === true, providerMessageId: data.messageId };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  async sendTextMessage(message: WhatsAppTextMessage): Promise<SendResult> {
    return this.apiPost("/messages", {
      recipient: { phone: message.to },
      message: { text: message.body },
    });
  }

  async sendTemplateMessage(message: WhatsAppTemplateMessage): Promise<SendResult> {
    return this.apiPost("/messages", {
      recipient: { phone: message.to },
      template: { name: message.templateName, language: { code: message.languageCode || "en" } },
    });
  }

  async sendDocument(doc: WhatsAppDocument): Promise<SendResult> {
    return this.apiPost("/messages", {
      recipient: { phone: doc.to },
      message: { document: { url: doc.url, caption: doc.caption, filename: doc.filename } },
    });
  }

  async sendImage(image: WhatsAppImage): Promise<SendResult> {
    return this.apiPost("/messages", {
      recipient: { phone: image.to },
      message: { image: { url: image.url, caption: image.caption } },
    });
  }

  async sendInteractiveButtons(message: WhatsAppInteractiveButtons): Promise<SendResult> {
    return this.apiPost("/messages", {
      recipient: { phone: message.to },
      message: {
        interactive: {
          type: "button",
          body: { text: message.body },
          action: {
            buttons: message.buttons.map((b) => ({
              type: "reply", reply: { id: b.id, title: b.title },
            })),
          },
        },
      },
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
      provider: "interakt",
      from: parsed.sender?.phone || parsed.waId || "",
      timestamp: String(Math.floor(Date.now() / 1000)),
      messageId: parsed.messageId || `INT-${Date.now()}`,
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

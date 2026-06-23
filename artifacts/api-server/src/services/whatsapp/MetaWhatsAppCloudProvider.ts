// =============================================================================
// MetaWhatsAppCloudProvider
//
// WhatsApp Business Cloud API adapter (meta.com).
// Credentials: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
//              WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_APP_SECRET,
//              WHATSAPP_VERIFY_TOKEN, WHATSAPP_WEBHOOK_SECRET
// =============================================================================

import type {
  WhatsAppProvider, WhatsAppTextMessage, WhatsAppTemplateMessage,
  WhatsAppDocument, WhatsAppImage, WhatsAppInteractiveButtons,
  WhatsAppProviderCredentials, ParsedIncomingMessage,
  WebhookVerificationResult, SendResult,
} from "./WhatsAppProvider";

export class MetaWhatsAppCloudProvider implements WhatsAppProvider {
  readonly name = "meta";

  private creds: WhatsAppProviderCredentials = {};
  private baseUrl = "https://graph.facebook.com/v21.0";

  initialize(credentials: WhatsAppProviderCredentials, config?: Record<string, unknown>): void {
    this.creds = credentials;
    if (config?.baseUrl && typeof config.baseUrl === "string") {
      this.baseUrl = config.baseUrl;
    }
  }

  private apiUrl(): string {
    return `${this.baseUrl}/${this.creds.phoneNumberId || ""}`;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.creds.accessToken || ""}`,
    };
  }

  private async apiPost(endpoint: string, body: unknown): Promise<SendResult> {
    const url = `${this.apiUrl()}/${endpoint}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { success: false, error: `Meta API ${res.status}: ${text}` };
      }
      const data = (await res.json()) as { messages?: { id: string }[] };
      return { success: true, providerMessageId: data.messages?.[0]?.id };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  async sendTextMessage(message: WhatsAppTextMessage): Promise<SendResult> {
    return this.apiPost("messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: message.to,
      type: "text",
      text: { body: message.body, preview_url: message.previewUrl ?? false },
    });
  }

  async sendTemplateMessage(message: WhatsAppTemplateMessage): Promise<SendResult> {
    return this.apiPost("messages", {
      messaging_product: "whatsapp",
      to: message.to,
      type: "template",
      template: {
        name: message.templateName,
        language: { code: message.languageCode || "en" },
        components: message.components || [],
      },
    });
  }

  async sendDocument(doc: WhatsAppDocument): Promise<SendResult> {
    return this.apiPost("messages", {
      messaging_product: "whatsapp",
      to: doc.to,
      type: "document",
      document: {
        link: doc.url,
        caption: doc.caption,
        filename: doc.filename,
      },
    });
  }

  async sendImage(image: WhatsAppImage): Promise<SendResult> {
    return this.apiPost("messages", {
      messaging_product: "whatsapp",
      to: image.to,
      type: "image",
      image: { link: image.url, caption: image.caption },
    });
  }

  async sendInteractiveButtons(message: WhatsAppInteractiveButtons): Promise<SendResult> {
    return this.apiPost("messages", {
      messaging_product: "whatsapp",
      to: message.to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: message.body },
        ...(message.header ? { header: message.header } : {}),
        ...(message.footer ? { footer: { text: message.footer } } : {}),
        action: {
          buttons: message.buttons.map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    });
  }

  /** Verify webhook signature using app secret */
  async verifyWebhook(rawBody: string, signature: string): Promise<WebhookVerificationResult> {
    const secret = this.creds.appSecret || this.creds.webhookSecret || "";
    if (!secret) return { valid: true }; // no secret configured = pass-through in dev
    const crypto = await import("node:crypto");
    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    return { valid: signature === expected };
  }

  /** Parse Meta webhook payload into normalized messages */
  async parseIncomingMessages(rawBody: string): Promise<ParsedIncomingMessage[]> {
    const parsed = JSON.parse(rawBody);
    const entries = parsed.entry || [];
    const messages: ParsedIncomingMessage[] = [];

    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        for (const msg of value.messages || []) {
          const type = msg.type || "unknown";
          messages.push({
            provider: "meta",
            from: msg.from || "",
            timestamp: msg.timestamp || String(Math.floor(Date.now() / 1000)),
            messageId: msg.id || "",
            type: type === "text" ? "text" : type === "image" ? "image" : type === "document" ? "document" : type === "location" ? "location" : type === "interactive" ? "interactive" : type === "button" ? "button" : "unknown",
            body: msg.text?.body,
            mediaUrl: undefined,
            mediaId: msg.image?.id || msg.document?.id,
            caption: msg.image?.caption || msg.document?.caption,
            latitude: msg.location?.latitude,
            longitude: msg.location?.longitude,
            buttonPayload: msg.button?.payload,
            interactiveButtonId: msg.interactive?.button_reply?.id,
            interactiveListId: msg.interactive?.list_reply?.id,
            rawPayload: msg,
          });
        }
      }
    }
    return messages;
  }

  async markMessageRead(providerMessageId: string): Promise<boolean> {
    const res = await this.apiPost("messages", {
      messaging_product: "whatsapp",
      status: "read",
      message_id: providerMessageId,
    });
    return res.success;
  }
}

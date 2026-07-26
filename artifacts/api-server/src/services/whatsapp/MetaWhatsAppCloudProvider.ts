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
    // graphApiVersion takes precedence over a full baseUrl override — this is
    // the single knob the unified WhatsApp Settings page's
    // whatsapp_settings.graph_api_version column controls, so every Meta API
    // call this app makes (this provider, routes/whatsapp.ts's direct
    // fetches, and WhatsAppOutbox.ts's dispatcher) can be kept in sync from
    // one place instead of three independently hardcoded values.
    if (config?.graphApiVersion && typeof config.graphApiVersion === "string") {
      this.baseUrl = `https://graph.facebook.com/${config.graphApiVersion}`;
    } else if (config?.baseUrl && typeof config.baseUrl === "string") {
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

  /**
   * Verify Meta's x-hub-signature-256 header against the raw request body.
   *
   * Fails CLOSED, not open: a missing secret, a missing/malformed signature
   * header, or a mismatched digest all return { valid: false }. This used to
   * return { valid: true } whenever no secret was configured ("pass-through
   * in dev") -- in production, where WHATSAPP_APP_SECRET/WHATSAPP_WEBHOOK_SECRET
   * are never set (see WhatsAppProviderFactory.ts), that meant EVERY webhook
   * call was accepted unverified, including forged ones, since an empty
   * secret was silently treated as "verification not required" rather than
   * "verification impossible."
   *
   * `secret` here is an explicit override the caller passes in (the unified,
   * decrypted whatsapp_settings.app_secret / per-number app_secret) -- the
   * module-level provider instance's own this.creds.appSecret is only ever
   * populated from environment variables at process start (see
   * WhatsAppProviderFactory.getWhatsAppProvider), so it can never reflect a
   * secret an admin saved through the unified settings page without a
   * restart. Callers should always pass the freshly-read DB secret; the
   * fallback to this.creds exists only for completeness / non-webhook uses
   * of this provider instance.
   */
  async verifyWebhook(rawBody: string, signatureHeader: string, secret?: string): Promise<WebhookVerificationResult> {
    const key = secret || this.creds.appSecret || this.creds.webhookSecret || "";
    if (!key) return { valid: false };
    if (!signatureHeader) return { valid: false };
    const prefix = "sha256=";
    if (!signatureHeader.startsWith(prefix)) return { valid: false };
    const providedHex = signatureHeader.slice(prefix.length).trim();
    // A malformed (non-hex, wrong-length) provided value must not reach
    // timingSafeEqual with mismatched buffer lengths -- Node throws in that
    // case rather than returning false, which would surface as a 500
    // instead of a clean signature-rejection.
    if (!/^[0-9a-fA-F]+$/.test(providedHex)) return { valid: false };
    const crypto = await import("node:crypto");
    const expectedHex = crypto.createHmac("sha256", key).update(rawBody, "utf8").digest("hex");
    const providedBuf = Buffer.from(providedHex, "hex");
    const expectedBuf = Buffer.from(expectedHex, "hex");
    if (providedBuf.length !== expectedBuf.length) return { valid: false };
    return { valid: crypto.timingSafeEqual(providedBuf, expectedBuf) };
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

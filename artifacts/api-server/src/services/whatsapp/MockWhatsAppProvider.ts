// =============================================================================
// MockWhatsAppProvider
//
// Test/dev provider that logs instead of sending real messages.
// Simulates success responses and webhook parsing for local testing.
// =============================================================================

import type {
  WhatsAppProvider, WhatsAppTextMessage, WhatsAppTemplateMessage,
  WhatsAppDocument, WhatsAppImage, WhatsAppInteractiveButtons,
  WhatsAppProviderCredentials, ParsedIncomingMessage,
  WebhookVerificationResult, SendResult,
} from "./WhatsAppProvider";

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock";
  private creds: WhatsAppProviderCredentials = {};
  private messageLog: SendResult[] = [];

  initialize(credentials: WhatsAppProviderCredentials): void {
    this.creds = credentials;
  }

  async sendTextMessage(message: WhatsAppTextMessage): Promise<SendResult> {
    const result: SendResult = {
      success: true,
      providerMessageId: `MOCK-TXT-${Date.now()}`,
    };
    this.messageLog.push(result);
    return result;
  }

  async sendTemplateMessage(message: WhatsAppTemplateMessage): Promise<SendResult> {
    const result: SendResult = {
      success: true,
      providerMessageId: `MOCK-TPL-${Date.now()}`,
    };
    this.messageLog.push(result);
    return result;
  }

  async sendDocument(doc: WhatsAppDocument): Promise<SendResult> {
    const result: SendResult = {
      success: true,
      providerMessageId: `MOCK-DOC-${Date.now()}`,
    };
    this.messageLog.push(result);
    return result;
  }

  async sendImage(image: WhatsAppImage): Promise<SendResult> {
    const result: SendResult = {
      success: true,
      providerMessageId: `MOCK-IMG-${Date.now()}`,
    };
    this.messageLog.push(result);
    return result;
  }

  async sendInteractiveButtons(message: WhatsAppInteractiveButtons): Promise<SendResult> {
    const result: SendResult = {
      success: true,
      providerMessageId: `MOCK-BTN-${Date.now()}`,
    };
    this.messageLog.push(result);
    return result;
  }

  async verifyWebhook(rawBody: string, signature: string): Promise<WebhookVerificationResult> {
    return { valid: signature === "mock-valid" || signature === "" || !signature };
  }

  async parseIncomingMessages(rawBody: string): Promise<ParsedIncomingMessage[]> {
    const parsed = JSON.parse(rawBody);
    const entries = parsed.entry || [];
    const messages: ParsedIncomingMessage[] = [];

    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        for (const msg of value.messages || []) {
          messages.push({
            provider: "mock",
            from: msg.from || "918000000000",
            timestamp: msg.timestamp || String(Math.floor(Date.now() / 1000)),
            messageId: msg.id || `MOCK-MSG-${Date.now()}`,
            type: msg.type || "text",
            body: msg.text?.body || msg.body || "",
            buttonPayload: msg.button?.payload || msg.buttonPayload,
            interactiveButtonId: msg.interactive?.button_reply?.id,
            interactiveListId: msg.interactive?.list_reply?.id,
            rawPayload: msg,
          });
        }
      }
    }
    return messages;
  }

  async markMessageRead(_providerMessageId: string): Promise<boolean> {
    return true;
  }

  /** Expose log for testing */
  getMessageLog(): SendResult[] {
    return this.messageLog;
  }
}

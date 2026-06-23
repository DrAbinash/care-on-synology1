// =============================================================================
// WhatsAppProvider Interface
//
// Common contract for all WhatsApp provider integrations. Every adapter must
// implement these methods so the WhatsAppService can treat them identically.
// =============================================================================

export interface WhatsAppTextMessage {
  to: string;
  body: string;
  previewUrl?: boolean;
}

export interface WhatsAppTemplateMessage {
  to: string;
  templateName: string;
  languageCode?: string;
  components?: unknown[];
}

export interface WhatsAppDocument {
  to: string;
  url: string;
  caption?: string;
  filename?: string;
}

export interface WhatsAppImage {
  to: string;
  url: string;
  caption?: string;
}

export interface WhatsAppInteractiveButtons {
  to: string;
  body: string;
  buttons: { id: string; title: string }[];
  header?: { type: string; text: string };
  footer?: string;
}

export interface WhatsAppProviderCredentials {
  accessToken?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  verifyToken?: string;
  appSecret?: string;
  webhookSecret?: string;
  baseUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  [key: string]: string | undefined;
}

export interface ParsedIncomingMessage {
  provider: string;
  from: string;
  timestamp: string;
  messageId: string;
  type: "text" | "image" | "document" | "location" | "button" | "interactive" | "unknown";
  body?: string;
  mediaUrl?: string;
  mediaId?: string;
  caption?: string;
  latitude?: number;
  longitude?: number;
  buttonPayload?: string;
  interactiveButtonId?: string;
  interactiveListId?: string;
  rawPayload: unknown;
}

export interface WebhookVerificationResult {
  valid: boolean;
  challenge?: string;
  eventType?: string;
}

export interface SendResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface WhatsAppProvider {
  readonly name: string;

  /** Initialize with credentials */
  initialize(credentials: WhatsAppProviderCredentials, config?: Record<string, unknown>): void;

  /** Send a plain text message */
  sendTextMessage(message: WhatsAppTextMessage): Promise<SendResult>;

  /** Send an approved template message */
  sendTemplateMessage(message: WhatsAppTemplateMessage): Promise<SendResult>;

  /** Send a document/PDF */
  sendDocument(doc: WhatsAppDocument): Promise<SendResult>;

  /** Send an image */
  sendImage(image: WhatsAppImage): Promise<SendResult>;

  /** Send interactive button message */
  sendInteractiveButtons(message: WhatsAppInteractiveButtons): Promise<SendResult>;

  /** Verify webhook signature */
  verifyWebhook(rawBody: string, signature: string, secret?: string): Promise<WebhookVerificationResult>;

  /** Parse incoming webhook payload into normalized message(s) */
  parseIncomingMessages(rawBody: string): Promise<ParsedIncomingMessage[]>;

  /** Mark a message as read (optional, best-effort) */
  markMessageRead(providerMessageId: string): Promise<boolean>;
}

// =============================================================================
// WhatsAppProviderFactory
//
// Registry of all WhatsApp provider adapters. Credentials loaded from env vars.
// =============================================================================

import type { WhatsAppProvider, WhatsAppProviderCredentials } from "./WhatsAppProvider";
import { MockWhatsAppProvider } from "./MockWhatsAppProvider";
import { MetaWhatsAppCloudProvider } from "./MetaWhatsAppCloudProvider";
import { TwilioWhatsAppProvider } from "./TwilioWhatsAppProvider";
import { GupshupProvider } from "./GupshupProvider";
import { WATIProvider } from "./WATIProvider";
import { InteraktProvider } from "./InteraktProvider";

const REGISTRY: Record<string, () => WhatsAppProvider> = {
  mock: () => new MockWhatsAppProvider(),
  meta: () => new MetaWhatsAppCloudProvider(),
  twilio: () => new TwilioWhatsAppProvider(),
  gupshup: () => new GupshupProvider(),
  wati: () => new WATIProvider(),
  interakt: () => new InteraktProvider(),
};

export function getWhatsAppProvider(): WhatsAppProvider {
  const provider = process.env.WHATSAPP_PROVIDER || "mock";
  const factory = REGISTRY[provider.toLowerCase()];
  if (!factory) {
    throw new Error(`Unknown WhatsApp provider: "${provider}". Supported: ${Object.keys(REGISTRY).join(", ")}`);
  }
  const instance = factory();
  const credentials: WhatsAppProviderCredentials = {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    webhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET,
    baseUrl: process.env.WHATSAPP_BASE_URL,
    apiKey: process.env.WHATSAPP_API_KEY,
    apiSecret: process.env.WHATSAPP_API_SECRET,
  };
  instance.initialize(credentials);
  return instance;
}

export function isValidProvider(provider: string): boolean {
  return REGISTRY[provider.toLowerCase()] !== undefined;
}

export function listProviders(): string[] {
  return Object.keys(REGISTRY);
}

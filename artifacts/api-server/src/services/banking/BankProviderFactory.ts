import type { BankProvider, ProviderCredentials } from "./BankProvider";
import { db, clinicSettingsTable } from "@workspace/db";
import { MockBankProvider } from "./MockBankProvider";
import { ICICIBankProvider } from "./ICICIBankProvider";
import { HDFCBankProvider } from "./HDFCBankProvider";
import { AxisBankProvider } from "./AxisBankProvider";
import { SBIBankProvider } from "./SBIBankProvider";
import { KotakBankProvider } from "./KotakBankProvider";
import { GenericBankProvider } from "./GenericBankProvider";
import { BharatPeProvider } from "./BharatPeProvider";
import { PhonePeProvider } from "./PhonePeProvider";
import { CashfreeProvider } from "./CashfreeProvider";

const PROVIDER_REGISTRY: Record<string, () => BankProvider> = {
  mock: () => new MockBankProvider(),
  icici: () => new ICICIBankProvider(),
  hdfc: () => new HDFCBankProvider(),
  axis: () => new AxisBankProvider(),
  sbi: () => new SBIBankProvider(),
  kotak: () => new KotakBankProvider(),
  generic: () => new GenericBankProvider(),
  bharatpe: () => new BharatPeProvider(),
  phonepe: () => new PhonePeProvider(),
  cashfree: () => new CashfreeProvider(),
};

const PROVIDER_PREFIX_MAP: Record<string, string> = {
  mock: "MOCK",
  icici: "ICICI",
  hdfc: "HDFC",
  axis: "AXIS",
  sbi: "SBI",
  kotak: "KOTAK",
  generic: "GENERIC_BANK",
  bharatpe: "BHARATPE",
  phonepe: "PHONEPE",
  cashfree: "CASHFREE",
};

const providerCache = new Map<string, BankProvider>();

export function getCredentialPrefix(provider: string): string {
  return PROVIDER_PREFIX_MAP[provider.toLowerCase()] || provider.toUpperCase();
}

export async function loadProviderCredentials(provider: string): Promise<ProviderCredentials> {
  const prefix = getCredentialPrefix(provider);
  // Read from clinic_settings as fallback for merchant IDs / app IDs
  let dbMerchantId: string | undefined;
  let dbAppId: string | undefined;
  try {
    const [settings] = await db.select().from(clinicSettingsTable).limit(1);
    if (settings) {
      if (provider === "bharatpe") dbMerchantId = settings.bharatpeMerchantId || undefined;
      if (provider === "phonepe") dbMerchantId = settings.phonepeMerchantId || undefined;
      if (provider === "cashfree") dbAppId = settings.cashfreeAppId || undefined;
    }
  } catch { /* ignore DB read errors */ }
  return {
    apiKey: process.env[`${prefix}_API_KEY`] || undefined,
    apiSecret: process.env[`${prefix}_API_SECRET`] || undefined,
    clientId: process.env[`${prefix}_CLIENT_ID`] || undefined,
    merchantId: process.env[`${prefix}_MERCHANT_ID`] || dbMerchantId || undefined,
    webhookSecret: process.env[`${prefix}_WEBHOOK_SECRET`] || undefined,
    baseUrl: process.env[`${prefix}_BASE_URL`] || undefined,
    appId: dbAppId,
  };
}

export async function createProvider(
  provider: string,
  config?: Record<string, unknown>,
): Promise<BankProvider> {
  const cacheKey = `${provider}:${JSON.stringify(config ?? {})}`;
  const cached = providerCache.get(cacheKey);
  if (cached) return cached;

  const factory = PROVIDER_REGISTRY[provider.toLowerCase()];
  if (!factory) {
    throw new Error(`Unknown bank provider: "${provider}". Supported: ${Object.keys(PROVIDER_REGISTRY).join(", ")}`);
  }
  const instance = factory();
  const credentials = await loadProviderCredentials(provider);
  instance.initialize(credentials, config);
  providerCache.set(cacheKey, instance);
  return instance;
}

export function isValidProvider(provider: string): boolean {
  return PROVIDER_REGISTRY[provider.toLowerCase()] !== undefined;
}

export function listProviders(): string[] {
  return Object.keys(PROVIDER_REGISTRY);
}

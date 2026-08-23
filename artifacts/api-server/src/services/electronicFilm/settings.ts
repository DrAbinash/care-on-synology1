// ============================================================================
// Electronic Film integration settings — persisted in pacs_settings (category
// electronic_film) so operators can toggle rollout without redeploying.
// ============================================================================
import { and, eq } from "drizzle-orm";
import { db, pacsSettingsTable } from "@workspace/db";

const CATEGORY = "electronic_film";

export interface ElectronicFilmSettings {
  integrationEnabled: boolean;
  autoImport: boolean;
  autoSendHope: boolean;
  importEnabledAt: string | null;
  pollIntervalSeconds: number;
  bridgeUrl: string;
  bridgeSecretConfigured: boolean;
}

const DEFAULTS: ElectronicFilmSettings = {
  integrationEnabled: true,
  autoImport: true,
  autoSendHope: false,
  importEnabledAt: null,
  pollIntervalSeconds: 120,
  bridgeUrl: "",
  bridgeSecretConfigured: false,
};

async function readSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: pacsSettingsTable.value })
    .from(pacsSettingsTable)
    .where(and(eq(pacsSettingsTable.key, key), eq(pacsSettingsTable.category, CATEGORY)))
    .limit(1);
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string, isSecret = false): Promise<void> {
  const [existing] = await db
    .select({ id: pacsSettingsTable.id })
    .from(pacsSettingsTable)
    .where(and(eq(pacsSettingsTable.key, key), eq(pacsSettingsTable.category, CATEGORY)))
    .limit(1);
  if (existing) {
    await db.update(pacsSettingsTable).set({ value, updatedAt: new Date() }).where(eq(pacsSettingsTable.id, existing.id));
  } else {
    await db.insert(pacsSettingsTable).values({ key, value, category: CATEGORY, isSecret });
  }
}

export async function getElectronicFilmSettings(): Promise<ElectronicFilmSettings> {
  const keys = [
    "integration_enabled",
    "auto_import",
    "auto_send_hope",
    "import_enabled_at",
    "poll_interval_seconds",
    "bridge_url",
    "bridge_secret",
  ];
  const rows = await db
    .select({ key: pacsSettingsTable.key, value: pacsSettingsTable.value, isSecret: pacsSettingsTable.isSecret })
    .from(pacsSettingsTable)
    .where(eq(pacsSettingsTable.category, CATEGORY));
  const map = new Map(rows.map((r) => [r.key, r]));

  const envUrl = (process.env.PRINT_BRIDGE_URL || "").replace(/\/+$/, "");
  const envSecret = process.env.PRINT_BRIDGE_SECRET || "";

  return {
    integrationEnabled: map.get("integration_enabled")?.value === "true" || map.get("integration_enabled")?.value === "1" || DEFAULTS.integrationEnabled,
    autoImport: map.get("auto_import")?.value === "true" || map.get("auto_import")?.value === "1" || DEFAULTS.autoImport,
    autoSendHope: map.get("auto_send_hope")?.value === "true" || map.get("auto_send_hope")?.value === "1",
    importEnabledAt: map.get("import_enabled_at")?.value ?? DEFAULTS.importEnabledAt,
    pollIntervalSeconds: Number(map.get("poll_interval_seconds")?.value) || DEFAULTS.pollIntervalSeconds,
    bridgeUrl: map.get("bridge_url")?.value || envUrl,
    bridgeSecretConfigured: !!(map.get("bridge_secret")?.value || envSecret),
  };
}

export async function updateElectronicFilmSettings(
  patch: Partial<Pick<ElectronicFilmSettings, "integrationEnabled" | "autoImport" | "autoSendHope" | "importEnabledAt" | "pollIntervalSeconds" | "bridgeUrl">>,
  bridgeSecret?: string,
): Promise<ElectronicFilmSettings> {
  if (patch.integrationEnabled !== undefined) await writeSetting("integration_enabled", patch.integrationEnabled ? "true" : "false");
  if (patch.autoImport !== undefined) await writeSetting("auto_import", patch.autoImport ? "true" : "false");
  if (patch.autoSendHope !== undefined) await writeSetting("auto_send_hope", patch.autoSendHope ? "true" : "false");
  if (patch.importEnabledAt !== undefined) await writeSetting("import_enabled_at", patch.importEnabledAt ?? "");
  if (patch.pollIntervalSeconds !== undefined) await writeSetting("poll_interval_seconds", String(patch.pollIntervalSeconds));
  if (patch.bridgeUrl !== undefined) await writeSetting("bridge_url", patch.bridgeUrl);
  if (bridgeSecret) await writeSetting("bridge_secret", bridgeSecret, true);
  return getElectronicFilmSettings();
}

export async function resolveBridgeCredentials(): Promise<{ url: string; secret: string } | null> {
  const s = await getElectronicFilmSettings();
  const url = s.bridgeUrl || (process.env.PRINT_BRIDGE_URL || "").replace(/\/+$/, "");
  const dbSecret = await readSetting("bridge_secret");
  const secret = dbSecret || process.env.PRINT_BRIDGE_SECRET || "";
  if (!url || !secret) return null;
  return { url, secret };
}

export async function ensureImportCutover(): Promise<string> {
  const at = await readSetting("import_enabled_at");
  if (at) return at;
  const now = new Date().toISOString();
  await writeSetting("import_enabled_at", now);
  return now;
}

import { sendAlertEmail } from "../email";
import { buildLowStockSummary } from "./inventoryLowStockSummary";
import { db } from "@workspace/db";
import { clinicSettingsTable, whatsappSettingsTable } from "@workspace/db/schema";
import { getWhatsAppService } from "../services/whatsapp/WhatsAppService";

const COOLDOWN_MS = 6 * 60 * 60 * 1000;
let lastAlertAt = 0;

export async function maybeSendLowStockAlerts(trigger: string): Promise<{ sent: boolean; count: number }> {
  const summary = await buildLowStockSummary(25);
  if (summary.criticalCount === 0) return { sent: false, count: 0 };

  const now = Date.now();
  if (now - lastAlertAt < COOLDOWN_MS) return { sent: false, count: summary.criticalCount };

  const itemLines = summary.items
    .map((i) => `• ${i.name}: ${i.currentStock} ${i.unit}${i.isOut ? " (OUT)" : ` / min ${i.minStock}`}`)
    .join("<br/>");

  const subject = `[Care ERP] Low stock alert — ${summary.criticalCount} item${summary.criticalCount === 1 ? "" : "s"} need attention`;
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:20px">
      <h2 style="color:#b45309;margin:0 0 8px">Inventory low stock alert</h2>
      <p style="margin:0 0 12px;font-size:13px;color:#475569">Trigger: ${trigger}</p>
      <p style="margin:0 0 8px"><strong>${summary.outCount}</strong> out of stock · <strong>${summary.lowCount}</strong> low</p>
      <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px;font-size:13px;line-height:1.5">
        ${itemLines}
      </div>
      <p style="margin:12px 0 0;font-size:11px;color:#94a3b8">Open Inventory in ERP to reorder or issue stock.</p>
    </div>`;

  await sendAlertEmail({ subject, html });

  try {
    const [clinic] = await db.select({ phone: clinicSettingsTable.phone }).from(clinicSettingsTable).limit(1);
    const [wa] = await db.select({ enabled: whatsappSettingsTable.enabled }).from(whatsappSettingsTable).limit(1);
    const phone = clinic?.phone?.trim();
    if (wa?.enabled && phone) {
      const service = getWhatsAppService();
      const text =
        `Care Diagnostics: ${summary.criticalCount} inventory item(s) need attention` +
        ` (${summary.outCount} out of stock). Open Inventory in ERP to review.`;
      await service.sendText(service.normalizePhone(phone), text);
    }
  } catch (err) {
    console.warn("[inventory] low-stock WhatsApp alert failed:", err);
  }

  lastAlertAt = now;
  return { sent: true, count: summary.criticalCount };
}

export async function runScheduledLowStockAlert(): Promise<void> {
  const result = await maybeSendLowStockAlerts("scheduled-cron");
  if (result.sent) {
    console.log(`[cron] Low stock alert sent for ${result.count} item(s)`);
  }
}

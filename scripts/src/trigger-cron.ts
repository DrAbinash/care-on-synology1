/**
 * trigger-cron.ts — fire api-server cron endpoints from a Replit Scheduled deployment.
 *
 * Required env:
 *   API_BASE_URL   e.g. https://your-app.replit.app
 *   CRON_SECRET    must match the api-server CRON_SECRET
 *
 * Optional CLI arg picks the job (default: "daily-summary"):
 *   pnpm --filter @workspace/scripts run trigger:cron daily-summary
 *   pnpm --filter @workspace/scripts run trigger:cron month-end-commission
 *
 * For month-end-commission, the api-server itself decides whether today is
 * actually the last day of the month before sending — so it's safe to schedule
 * this job daily at 20:00; it will no-op every day except month-end.
 * (Actually it always fires when called via this endpoint — it's the in-process
 * scheduler that has the calendar guard. So configure the scheduled deployment
 * to run on the last day of the month at 20:00 IST/your tz.)
 */

const VALID_JOBS = ["daily-summary", "month-end-commission"] as const;
type Job = (typeof VALID_JOBS)[number];

function isJob(s: string): s is Job {
  return (VALID_JOBS as readonly string[]).includes(s);
}

async function main() {
  const baseUrl = process.env["API_BASE_URL"];
  const secret = process.env["CRON_SECRET"];
  if (!baseUrl) throw new Error("API_BASE_URL env var is required");
  if (!secret) throw new Error("CRON_SECRET env var is required");

  const arg = (process.argv[2] ?? "daily-summary").trim();
  if (!isJob(arg)) {
    throw new Error(`Unknown job "${arg}". Valid: ${VALID_JOBS.join(", ")}`);
  }

  const url = `${baseUrl.replace(/\/$/, "")}/api/internal/cron/${arg}`;
  console.log(`[trigger-cron] POST ${url}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
  });

  const text = await res.text();
  console.log(`[trigger-cron] ${res.status} ${res.statusText} — ${text}`);

  if (!res.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[trigger-cron] failed:", err);
  process.exit(1);
});

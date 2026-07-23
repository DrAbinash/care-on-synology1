// PUBLIC, unauthenticated patient feedback / NPS endpoints. Mounted at /api/f
// (no staff auth) — the patient opens a tokenized link from WhatsApp and submits
// an NPS score with no login. Gated by ff_feedback_nps. Self-contained HTML so
// no SPA route or app shell is needed on the patient's phone. Additive,
// non-financial.
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { feedbackRequestsTable, feedbackResponsesTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import { isValidNps, npsCategory } from "../lib/npsEngine";
import { logger } from "../lib/logger";

export const publicFeedbackRouter = Router();

function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function page(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
  :root{color-scheme:light dark}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f6f7f9;color:#111;display:flex;min-height:100vh;align-items:center;justify-content:center}
  @media(prefers-color-scheme:dark){body{background:#0b0d10;color:#e8eaed}.card{background:#15181c!important;border-color:#2a2f36!important}}
  .card{background:#fff;border:1px solid #e4e7eb;border-radius:16px;max-width:460px;width:calc(100% - 32px);padding:28px 24px;box-shadow:0 6px 24px rgba(0,0,0,.06);margin:16px}
  h1{font-size:20px;margin:0 0 4px} p.sub{margin:0 0 20px;color:#667;font-size:14px}
  .scale{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin:14px 0}
  @media(min-width:380px){.scale{grid-template-columns:repeat(11,1fr)}}
  .scale button{aspect-ratio:1;border:1px solid #cdd3da;background:#fff;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;color:#111}
  .scale button.sel{background:#2563eb;border-color:#2563eb;color:#fff}
  @media(prefers-color-scheme:dark){.scale button{background:#1b1f24;border-color:#2a2f36;color:#e8eaed}}
  textarea{width:100%;box-sizing:border-box;border:1px solid #cdd3da;border-radius:10px;padding:10px;font:inherit;min-height:70px;margin-top:8px;background:transparent;color:inherit}
  .send{margin-top:16px;width:100%;padding:12px;border:0;border-radius:10px;background:#16a34a;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  .send:disabled{opacity:.5}
  .legend{display:flex;justify-content:space-between;font-size:11px;color:#889;margin-top:2px}
  .ok{text-align:center} .ok svg{width:56px;height:56px;color:#16a34a}
</style></head><body><div class="card">${bodyHtml}</div></body></html>`;
}

function formPage(token: string, patientName: string, testName: string): string {
  return page("Your feedback", `
    <h1>How was your experience?</h1>
    <p class="sub">${esc(patientName ? patientName + ", " : "")}how likely are you to recommend us${testName ? " for your " + esc(testName) : ""}? (0 = not likely, 10 = very likely)</p>
    <div class="scale" id="scale">${Array.from({ length: 11 }, (_, i) => `<button type="button" data-v="${i}">${i}</button>`).join("")}</div>
    <div class="legend"><span>Not likely</span><span>Very likely</span></div>
    <textarea id="comment" placeholder="Anything you'd like to tell us? (optional)"></textarea>
    <button class="send" id="send" disabled>Submit feedback</button>
    <script>
      var score=null;var scale=document.getElementById('scale');var send=document.getElementById('send');
      scale.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;score=Number(b.dataset.v);
        Array.prototype.forEach.call(scale.children,function(c){c.classList.remove('sel')});b.classList.add('sel');send.disabled=false;});
      send.addEventListener('click',function(){send.disabled=true;send.textContent='Sending…';
        fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({npsScore:score,comment:document.getElementById('comment').value})})
        .then(function(r){return r.json()}).then(function(){document.querySelector('.card').innerHTML='<div class=ok><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg><h1>Thank you!</h1><p class=sub>Your feedback has been recorded.</p></div>';})
        .catch(function(){send.disabled=false;send.textContent='Submit feedback';alert('Could not submit, please try again.');});});
    </script>`);
}

// GET /api/f/:token — render the feedback form (or a status page).
publicFeedbackRouter.get("/:token", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!(await isFeatureEnabledServer("ff_feedback_nps"))) { res.status(404).send(page("Unavailable", "<h1>Link unavailable</h1><p class='sub'>This feedback link is not active.</p>")); return; }
  const [reqRow] = await db.select().from(feedbackRequestsTable).where(eq(feedbackRequestsTable.token, String(req.params.token))).limit(1);
  if (!reqRow) { res.status(404).send(page("Not found", "<h1>Link not found</h1><p class='sub'>This feedback link is invalid or has expired.</p>")); return; }
  if (reqRow.expiresAt && reqRow.expiresAt < new Date()) { res.status(410).send(page("Expired", "<h1>Link expired</h1><p class='sub'>This feedback link has expired.</p>")); return; }
  if (reqRow.status === "responded") { res.send(page("Thank you", "<div class='ok'><h1>Thank you!</h1><p class='sub'>You've already shared your feedback.</p></div>")); return; }
  res.send(formPage(reqRow.token, reqRow.patientName ?? "", reqRow.testName ?? ""));
});

// POST /api/f/:token — record the NPS response (single-use per token).
publicFeedbackRouter.post("/:token", async (req: Request, res: Response) => {
  if (!(await isFeatureEnabledServer("ff_feedback_nps"))) { res.status(404).json({ error: "unavailable" }); return; }
  const p = z.object({ npsScore: z.number(), comment: z.string().max(2000).optional().nullable(), stars: z.number().int().min(1).max(5).optional().nullable() }).safeParse(req.body);
  if (!p.success || !isValidNps(p.data.npsScore)) { res.status(400).json({ error: "Invalid feedback" }); return; }
  const [reqRow] = await db.select().from(feedbackRequestsTable).where(eq(feedbackRequestsTable.token, String(req.params.token))).limit(1);
  if (!reqRow) { res.status(404).json({ error: "not found" }); return; }
  if (reqRow.expiresAt && reqRow.expiresAt < new Date()) { res.status(410).json({ error: "expired" }); return; }
  if (reqRow.status === "responded") { res.status(409).json({ error: "already submitted" }); return; }
  try {
    await db.insert(feedbackResponsesTable).values({
      requestId: reqRow.id, patientId: reqRow.patientId, reportId: reqRow.reportId,
      npsScore: p.data.npsScore, stars: p.data.stars ?? null, comment: p.data.comment ?? null,
      category: npsCategory(p.data.npsScore), userAgent: (req.headers["user-agent"] ?? "").toString().slice(0, 300),
    });
    await db.update(feedbackRequestsTable).set({ status: "responded", respondedAt: new Date() }).where(eq(feedbackRequestsTable.id, reqRow.id));
    res.json({ ok: true });
  } catch (err) {
    logger.warn({ err }, "[feedback] response insert failed");
    res.status(500).json({ error: "failed" });
  }
});

export default publicFeedbackRouter;

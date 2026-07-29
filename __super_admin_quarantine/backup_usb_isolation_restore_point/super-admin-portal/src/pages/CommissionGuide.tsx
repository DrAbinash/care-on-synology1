/**
 * How Commission Works — the reference for the whole module, inside the portal.
 *
 * Deliberately a screen rather than a document on the pen drive: it ships in the
 * same bundle as the code, so it cannot describe a version of the rules that is
 * no longer running. It is reachable only with the drive plugged in, which is
 * right — it describes rates and payouts.
 */

import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Printer, HandCoins, ListChecks, Wallet, BarChart3, ArrowRight,
  Percent, Clock, Building2, ShieldAlert, Lock, FileText,
} from "lucide-react";

type Section = { id: string; title: string; icon: typeof HandCoins };

const SECTIONS: Section[] = [
  { id: "flow", title: "The journey of one referral", icon: ArrowRight },
  { id: "rate", title: "How the rate is chosen", icon: ListChecks },
  { id: "base", title: "What the rate is applied to", icon: Percent },
  { id: "outsourced", title: "Outsourced lab work", icon: Building2 },
  { id: "hold", title: "When it becomes payable", icon: Clock },
  { id: "pay", title: "Paying, and why figures then freeze", icon: Wallet },
  { id: "screens", title: "Which screen answers what", icon: BarChart3 },
  { id: "guards", title: "Guard rails and the audit trail", icon: ShieldAlert },
  { id: "worked", title: "A worked example, end to end", icon: FileText },
  { id: "privacy", title: "Why this is all behind the pen drive", icon: Lock },
];

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{title}</p>
        <div className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function Card({ id, title, icon: Icon, children }: { id: string; title: string; icon: typeof HandCoins; children: React.ReactNode }) {
  return (
    <section id={id} className="bg-card border border-border rounded-xl p-5 scroll-mt-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
          <Icon size={15} className="text-amber-600" />
        </div>
        <h2 className="font-semibold">{title}</h2>
      </div>
      <div className="space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

const Term = ({ children }: { children: React.ReactNode }) => (
  <span className="font-medium text-foreground">{children}</span>
);

export default function CommissionGuide({ onBack }: { onBack: () => void }) {
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="min-h-screen w-full bg-background">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2">
              <ArrowLeft size={14} className="mr-1" /> Back
            </Button>
            <h1 className="text-2xl font-bold">How Commission Works</h1>
            <p className="text-sm text-muted-foreground mt-1">
              What happens between a doctor sending a patient and that doctor being paid — and which screen to open when
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="mt-9 shrink-0">
            <Printer size={14} className="mr-1" /> Print
          </Button>
        </div>

        {/* Contents */}
        <nav className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Contents</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {SECTIONS.map(({ id, title, icon: Icon }) => (
              <button
                key={id}
                onClick={() => jump(id)}
                className="flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors"
              >
                <Icon size={13} className="text-muted-foreground shrink-0" />
                <span className="truncate">{title}</span>
              </button>
            ))}
          </div>
        </nav>

        <Card id="flow" title="The journey of one referral" icon={ArrowRight}>
          <div className="space-y-3">
            <Step n={1} title="A patient arrives naming a referring doctor">
              The order records that doctor. Commission is calculated only after the order is <Term>billed</Term> —
              unbilled duplicate orders never appear on the report. A test later marked <Term>cancelled</Term> drops
              out entirely, and a cancelled bill stops accruing as well.
            </Step>
            <Step n={2} title="Each test line is priced and rated">
              For every test, the system finds the slab that applies to <em>that</em> doctor and <em>that</em> test, then
              applies it to the test's price. The two steps are separate and both matter — see the next two sections.
            </Step>
            <Step n={3} title="The bill discount is settled">
              If your clinic deducts bill discounts from commission, that happens at <Term>order</Term> level and is then
              spread across the order's test lines. This is why one line's figure can move when another line on the same
              bill changes.
            </Step>
            <Step n={4} title="Eligibility decides whether it can be paid yet">
              The amount is calculated immediately, but stays <Term>on hold</Term> until your payout condition is met —
              by default, the bill being fully paid.
            </Step>
            <Step n={5} title="You settle, and the numbers freeze">
              Recording a payout snapshots what it settled. Change a slab afterwards and the settled figures do not move.
            </Step>
          </div>
        </Card>

        <Card id="rate" title="How the rate is chosen" icon={ListChecks}>
          <p>
            For each test line the system walks a fixed ladder and stops at the first rung that matches.
            This ladder is the single source of truth — every screen that shows you a rate is showing the one that was
            actually used.
          </p>
          <ol className="space-y-2 mt-1">
            {[
              ["Exclusive slab for this test or category", "A slab you marked Exclusive wins outright."],
              ["Ordinary slab for this test or category", "The normal case — the slab you set for that test or that category."],
              ["The doctor's catch-all slab", "A rule with scope \"All Tests\". Reaching this rung usually means no slab was set for that test."],
              ["The doctor's profile default", "The rate on the doctor's own record, used when no rule matched at all."],
              ["Nothing", "No rate anywhere — the line earns zero."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="shrink-0 w-5 h-5 rounded bg-muted text-[11px] font-semibold flex items-center justify-center mt-0.5">{i + 1}</span>
                <span><Term>{t}</Term> — <span className="text-muted-foreground">{d}</span></span>
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground">
            A slab can also be limited to <Term>in-house only</Term> or <Term>outsourced only</Term>. One that does not
            match the line's kind is skipped at every rung, so an outsourced slab never pays on in-house work.
          </p>
          <p className="rounded-md border border-amber-900 bg-amber-950/20 px-3 py-2 text-[13px]">
            Rungs 3, 4 and 5 are flagged as <Term>no slab</Term> in the reports. If you price per test or per category,
            landing there almost always means a slab was never set — not a decision. <Term>Rate Analysis → Slab Gaps</Term>{" "}
            lists them, and you can create the missing slab straight from that row.
          </p>
        </Card>

        <Card id="base" title="What the rate is applied to" icon={Percent}>
          <p>The rate is not simply multiplied by the ticket price. Two adjustments come first:</p>
          <ul className="space-y-2">
            <li>
              <Term>VIP surcharge is removed.</Term> If a patient paid extra for priority handling, that extra is your
              fee for the service, not clinical revenue, so it is stripped out before the rate is applied.
            </li>
            <li>
              <Term>On outsourced work, the lab's cost may be removed</Term> — see the next section.
            </li>
          </ul>
          <p className="text-muted-foreground">
            The figure the rate actually landed on is shown as the <Term>commission base</Term> in the
            "Why this amount?" pop-up on the Referral Report. If a number ever looks wrong, open that first — it shows
            every step from ticket price to final payable.
          </p>
        </Card>

        <Card id="outsourced" title="Outsourced lab work" icon={Building2}>
          <p>
            When you send a test to an outside lab you keep only <Term>price − lab cost</Term>. Paying a percentage of
            the full price can easily exceed that.
          </p>
          <div className="rounded-lg border border-border bg-muted/20 p-3 font-mono text-[13px] leading-relaxed">
            Test billed to patient &nbsp;₹1,000<br />
            Lab charges you &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ₹700<br />
            <span className="text-muted-foreground">You keep&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ₹300</span><br />
            At a 50% slab on price → you pay ₹500 <span className="text-rose-400">(a ₹200 loss)</span><br />
            At a 50% slab on margin → you pay ₹150 <span className="text-emerald-400">(you keep ₹150)</span>
          </div>
          <p>
            <Term>Commission Rules → Outsourced Lab Tests</Term> chooses which. On <Term>Margin</Term>, the payout is also
            capped at the margin, so even a fixed-amount slab such as "₹150 per test" can never pay out more than you earned.
          </p>
          <p className="text-muted-foreground">
            You can also give outsourced work its own slab entirely, using <Term>Test kind</Term> on the rule form.
            <Term> Rate Analysis → Lab Margin</Term> shows which lab is actually worth using, once commission is taken out.
          </p>
        </Card>

        <Card id="hold" title="When it becomes payable" icon={Clock}>
          <p>
            Commission is calculated as soon as the order exists, but it is not owed until your chosen condition is met.
            Until then it shows as <Term>On Hold</Term> and is kept out of Doctor Due. It releases by itself once the
            condition is satisfied — an hourly job checks and records every hold and release.
          </p>
          <ul className="space-y-1.5 text-muted-foreground">
            <li><Term>Full Payment Collected</Term> — the default. Nothing is owed until the bill is fully paid.</li>
            <li><Term>Bill Created</Term> — payable immediately.</li>
            <li><Term>Report Finalized / Delivered</Term> — payable once every report on the order is verified or delivered.</li>
            <li><Term>Minimum Amount Collected</Term> — payable once collections reach an amount you set.</li>
            <li><Term>Collected ≥ Commission</Term> — payable once you have collected at least what you would pay out.</li>
          </ul>
          <p>
              A <Term>cancelled bill</Term> is never payable and does not generate commission rows. Unbilled orders
              (including duplicate orders that were never billed) are excluded from the Referral Report and Doctor Ledger
              entirely — they do not appear as On Hold lines. If a bill is cancelled or refunded <em>after</em> the
              commission had already become payable, it appears in the ledger's <Term>Reversed after eligibility</Term>{" "}
              panel so you can recover it on the next payout.
          </p>
        </Card>

        <Card id="pay" title="Paying, and why figures then freeze" icon={Wallet}>
          <p>
            <Term>Doctor Due / Payment Ledger</Term> is where you settle. It shows the eligible due prominently, a
            quick-fill button for it, and the on-hold amount separately — so you never settle against money you have not
            collected.
          </p>
          <p>
            Recording a payout <Term>snapshots</Term> the orders it settles: the amount, the rules that produced it, as
            they stood that day. Those orders are marked <Term>settled</Term> and read from the snapshot from then on.
          </p>
          <p className="rounded-md border border-emerald-900 bg-emerald-950/20 px-3 py-2 text-[13px]">
            This is what stops a statement in a doctor's hand disagreeing with the screen. Adjust a slab next month and
            settled figures stay exactly as paid; only unpaid work follows the new rate. Deleting a payout undoes the
            freeze and makes those orders payable again.
          </p>
          <p className="text-muted-foreground">
            <Term>Statements (All)</Term> on the ledger produces the whole payout run in one file — PDF to print and get
            signed, or Word / Excel if you need to edit it.
          </p>
        </Card>

        <Card id="screens" title="Which screen answers what" icon={BarChart3}>
          <div className="space-y-2.5">
            {[
              [HandCoins, "Referral & Commission Report", "What each doctor earned, per patient and per test. Rate Bands view groups everything by commission rate so hundreds of tests stay readable. WhatsApp button sends a doctor their figure."],
              [BarChart3, "Rate Analysis", "Slab Gaps — where no slab was set. Rate Matrix — every rate at a glance. Configured vs Realised — where discounts are eating a band. Lab Margin — which outsourced lab is worth using."],
              [ListChecks, "Commission Rules", "The slabs themselves, plus the clinic-wide settings: discount handling, payout condition, outsourced basis, and the guard rails."],
              [Wallet, "Doctor Due / Payment Ledger", "What is owed, recording payments, statements, and the payout worksheet for a settlement run."],
            ].map(([Icon, name, what]) => {
              const I = Icon as typeof HandCoins;
              return (
                <div key={name as string} className="flex gap-3">
                  <I size={15} className="text-muted-foreground shrink-0 mt-1" />
                  <div>
                    <p className="font-medium text-sm">{name as string}</p>
                    <p className="text-muted-foreground text-[13px] leading-relaxed">{what as string}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card id="guards" title="Guard rails and the audit trail" icon={ShieldAlert}>
          <ul className="space-y-2">
            <li>
              <Term>Maximum rate.</Term> No slab, CSV import or doctor profile default can be saved above it — so 5%
              cannot become 50% through a slip. Set it to 0 to switch the check off.
            </li>
            <li>
              <Term>Drift alert.</Term> Rate Analysis flags doctors whose realised rate has fallen further below their
              configured slab than you allow. That is usually discounts quietly eating the band.
            </li>
            <li>
              <Term>Every rate change is recorded</Term> — on screen or by CSV import — with who did it and the value
              before and after.
            </li>
          </ul>
          <p className="text-muted-foreground">
            The rules <Term>CSV export/import</Term> is the bulk editing route. Re-importing an exported file amends the
            rules it matches rather than adding copies, and tells you how many were created, updated and left unchanged.
          </p>
        </Card>

        <Card id="worked" title="A worked example, end to end" icon={FileText}>
          <div className="rounded-lg border border-border bg-muted/20 p-3 text-[13px] font-mono leading-relaxed space-y-0.5">
            <div>Dr. Sharma refers a patient for an MRI, sent to an outside lab.</div>
            <div className="text-muted-foreground pt-1">Ticket price&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ₹1,000  (includes ₹0 VIP)</div>
            <div className="text-muted-foreground">Lab cost&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ₹700</div>
            <div className="pt-1">Slab found&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; "Radiology 40%" (category rung)</div>
            <div>Outsourced basis&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Margin → base is ₹300, not ₹1,000</div>
            <div>Commission&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ₹300 × 40% = <span className="text-amber-400">₹120</span></div>
            <div className="pt-1 text-muted-foreground">Bill discount ₹50, mode = Deduct → ₹120 − ₹50 = ₹70</div>
            <div className="text-muted-foreground">Bill not fully paid yet → <span className="text-rose-400">On Hold</span>, out of Doctor Due</div>
            <div className="text-muted-foreground pt-1">Patient clears the bill → auto-released, ₹70 now payable</div>
            <div>Payout recorded → order marked <span className="text-emerald-400">settled</span>, ₹70 frozen</div>
            <div className="text-muted-foreground">Slab later changed to 30% → this ₹70 does not move</div>
          </div>
          <p className="text-muted-foreground">
            Every one of those steps is visible in the "Why this amount?" pop-up against that line on the Referral Report.
          </p>
        </Card>

        <Card id="privacy" title="Why this is all behind the pen drive" icon={Lock}>
          <p>
            Commission rates and amounts are visible only while the pen drive is plugged in. Without it: the Super Admin
            link is not in the sidebar, the doctor list returns no rates, staff cannot change a rate, and the settings
            that govern how commission is calculated are refused.
          </p>
          <p className="text-muted-foreground">
            The monthly summary email that does go out to your recipients carries referral <em>counts</em> and billed
            amounts only — never a commission figure, rate or payout. That is by construction, not by filtering.
          </p>
          <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-[13px] text-muted-foreground">
            The gate only becomes real once <span className="font-mono">SUPER_ADMIN_USB_KEY</span> is set on the server.
            Until it is, the server logs a warning and lets requests through, so a fresh install cannot lock you out.
          </p>
        </Card>

        <p className="text-xs text-muted-foreground text-center pt-2 pb-6">
          This page ships with the portal, so it always describes the version of the rules currently running.
        </p>
      </div>
    </div>
  );
}

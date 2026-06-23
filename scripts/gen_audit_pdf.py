"""Generate a sample CA-printable Money Trail Audit PDF using ReportLab."""
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                 TableStyle, KeepTogether, HRFlowable)
from reportlab.lib.enums import TA_CENTER, TA_LEFT

OUT = "exports/money-trail-audit-sample.pdf"

styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=18, alignment=TA_CENTER, spaceAfter=2, textColor=colors.HexColor("#1f2937"))
SUB = ParagraphStyle("SUB", parent=styles["Normal"], fontSize=9, alignment=TA_CENTER, textColor=colors.HexColor("#374151"))
NOTES = ParagraphStyle("NOTES", parent=styles["Normal"], fontSize=8.5, alignment=TA_CENTER, textColor=colors.HexColor("#4b5563"), spaceAfter=4)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12, spaceAfter=6, textColor=colors.HexColor("#1f2937"))
H3 = ParagraphStyle("H3", parent=styles["Heading3"], fontSize=11, spaceAfter=2, textColor=colors.HexColor("#1f2937"))
DESC = ParagraphStyle("DESC", parent=styles["Normal"], fontSize=8.5, textColor=colors.HexColor("#374151"), leading=11)
LBL = ParagraphStyle("LBL", parent=styles["Normal"], fontSize=7.5, textColor=colors.HexColor("#6b7280"))
VAL = ParagraphStyle("VAL", parent=styles["Normal"], fontSize=10, textColor=colors.HexColor("#1f2937"))
VAL_BIG = ParagraphStyle("VAL_BIG", parent=styles["Normal"], fontSize=11.5, textColor=colors.HexColor("#1f2937"))
SUMMARY = ParagraphStyle("SUMMARY", parent=styles["Normal"], fontSize=11, textColor=colors.HexColor("#1f2937"), leading=14)
SIG_LABEL = ParagraphStyle("SIG_LABEL", parent=styles["Normal"], fontSize=10, textColor=colors.HexColor("#1f2937"))
SIG_NAME = ParagraphStyle("SIG_NAME", parent=styles["Normal"], fontSize=10, textColor=colors.HexColor("#111827"))
SIG_SMALL = ParagraphStyle("SIG_SMALL", parent=styles["Normal"], fontSize=8.5, textColor=colors.HexColor("#4b5563"), leading=12)
FOOTER = ParagraphStyle("FOOTER", parent=styles["Normal"], fontSize=8, textColor=colors.HexColor("#6b7280"), alignment=TA_CENTER)
CHIP = ParagraphStyle("CHIP", parent=styles["Normal"], fontSize=7, textColor=colors.white, alignment=TA_CENTER)

def stat_cell(label, value, big=False):
    return [Paragraph(label.upper(), LBL), Paragraph(value, VAL_BIG if big else VAL)]

def build():
    doc = SimpleDocTemplate(OUT, pagesize=A4,
                            leftMargin=14*mm, rightMargin=14*mm,
                            topMargin=14*mm, bottomMargin=14*mm,
                            title="Money Trail Audit — Sample")
    story = []

    # Header
    story.append(Paragraph("Money Trail Audit — Archived Snapshot", H1))
    story.append(Paragraph("Audit #18 &nbsp;·&nbsp; Period 2026-04-01 to 2026-04-30 &nbsp;·&nbsp; Generated 1 May 2026, 06:00 IST &nbsp;·&nbsp; Signed off by Anita Verma", SUB))
    story.append(Paragraph("<b>Notes:</b> April books cross-checked with TallyPrime export. Discount overrides clarified with Dr. Mehta on 2 May.", NOTES))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#d1d5db"), spaceBefore=4, spaceAfter=8))

    # Period summary box
    story.append(Paragraph("Period Summary", H2))
    stats_grid = [
        [stat_cell("Bills", "847"),                 stat_cell("Subtotal", "₹18,42,650.00"),
         stat_cell("Discount", "₹1,12,400.00"),     stat_cell("Tax", "₹0.00")],
        [stat_cell("Total Billed", "₹17,30,250.00", big=True), stat_cell("Paid", "₹16,48,900.00"),
         stat_cell("Refunded", "₹14,200.00"),       stat_cell("Outstanding", "₹81,350.00")],
        [stat_cell("Cancelled bills", "11"),        stat_cell("Cancelled amount", "₹38,640.00"),
         "", ""],
    ]
    summary_tbl = Table(stats_grid, colWidths=[45*mm]*4, hAlign="LEFT")
    summary_tbl.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("BOX", (0,0), (-1,-1), 0.5, colors.HexColor("#d1d5db")),
        ("INNERGRID", (0,0), (-1,-1), 0.25, colors.HexColor("#e5e7eb")),
        ("LEFTPADDING", (0,0), (-1,-1), 8),
        ("RIGHTPADDING", (0,0), (-1,-1), 8),
        ("TOPPADDING", (0,0), (-1,-1), 7),
        ("BOTTOMPADDING", (0,0), (-1,-1), 7),
    ]))
    story.append(summary_tbl)
    story.append(Spacer(1, 8))

    # Headline strip
    headline = Table([[Paragraph("<b>7 item(s) flagged for review (no high-severity)</b>", SUMMARY)]],
                     colWidths=[170*mm])
    headline.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), colors.HexColor("#fffbeb")),
        ("LINEBEFORE", (0,0), (0,-1), 3, colors.HexColor("#f59e0b")),
        ("LEFTPADDING", (0,0), (-1,-1), 14),
        ("RIGHTPADDING", (0,0), (-1,-1), 14),
        ("TOPPADDING", (0,0), (-1,-1), 10),
        ("BOTTOMPADDING", (0,0), (-1,-1), 10),
    ]))
    story.append(headline)
    story.append(Spacer(1, 12))

    # Anomaly card builder
    def anomaly(category, severity, count, impact, description, columns, rows):
        if severity == "high":   bg, fg = "#fee2e2", "#991b1b"
        elif severity == "medium": bg, fg = "#fef3c7", "#92400e"
        else:                    bg, fg = "#dbeafe", "#1e40af"

        head_left = Paragraph(f"<b>{category}</b>", H3)
        chip = Paragraph(f"<font color='{fg}'><b>{severity.upper()}</b></font>", ParagraphStyle("c", parent=styles["Normal"], fontSize=8))
        meta = Paragraph(f"<b>{count} row(s)</b>" + (f"  &nbsp;|&nbsp;  <b>{impact}</b>" if impact else ""),
                         ParagraphStyle("m", parent=styles["Normal"], fontSize=9, alignment=2))  # right
        head = Table([[head_left, chip, meta]], colWidths=[95*mm, 22*mm, 53*mm])
        head.setStyle(TableStyle([
            ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
            ("BACKGROUND", (0,0), (-1,-1), colors.HexColor(bg)),
            ("LEFTPADDING", (0,0), (-1,-1), 10),
            ("RIGHTPADDING", (0,0), (-1,-1), 10),
            ("TOPPADDING", (0,0), (-1,-1), 6),
            ("BOTTOMPADDING", (0,0), (-1,-1), 4),
        ]))
        desc = Table([[Paragraph(description, DESC)]], colWidths=[170*mm])
        desc.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,-1), colors.HexColor(bg)),
            ("LEFTPADDING", (0,0), (-1,-1), 10),
            ("RIGHTPADDING", (0,0), (-1,-1), 10),
            ("TOPPADDING", (0,0), (-1,-1), 0),
            ("BOTTOMPADDING", (0,0), (-1,-1), 8),
            ("LINEBELOW", (0,0), (-1,-1), 0.5, colors.HexColor("#d1d5db")),
        ]))

        data = [columns] + rows
        col_w = [170*mm / len(columns)] * len(columns)
        body = Table(data, colWidths=col_w, repeatRows=1)
        body.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#f3f4f6")),
            ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE", (0,0), (-1,-1), 7.5),
            ("LEFTPADDING", (0,0), (-1,-1), 5),
            ("RIGHTPADDING", (0,0), (-1,-1), 5),
            ("TOPPADDING", (0,0), (-1,-1), 4),
            ("BOTTOMPADDING", (0,0), (-1,-1), 4),
            ("LINEBELOW", (0,0), (-1,-1), 0.25, colors.HexColor("#e5e7eb")),
            ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ]))
        story.append(KeepTogether([head, desc]))
        story.append(body)
        story.append(Spacer(1, 12))

    anomaly(
        "Cancelled-but-not-refunded: money still on the books",
        "medium", 2, "₹4,800.00",
        "These bills are cancelled but the patient's payment was never refunded — the original Receipt voucher still sits in revenue. Use Cancel &amp; Refund to auto-issue a Payment voucher in one step.",
        ["id", "bill_number", "total", "paid", "refund", "cancelled_at", "cancelled_by"],
        [
            ["3104", "2026040217", "2,400.00", "2,400.00", "0.00", "2026-04-12 14:32", "Reception – Priya"],
            ["3219", "2026040331", "2,400.00", "2,400.00", "0.00", "2026-04-22 10:08", "Reception – Priya"],
        ],
    )

    anomaly(
        "High discount (&gt;50% of subtotal)",
        "low", 3, "₹8,950.00",
        "Bills where the applied discount exceeds 50% of subtotal. Usually approved by an admin but worth a CA spot-check.",
        ["id", "bill_number", "subtotal", "discount", "created_by", "pct"],
        [
            ["3088", "2026040201", "4,500.00", "2,800.00", "Dr. Mehta", "62.22"],
            ["3155", "2026040268", "5,200.00", "3,200.00", "Dr. Mehta", "61.54"],
            ["3267", "2026040379", "4,800.00", "2,950.00", "Reception – Sandeep", "61.46"],
        ],
    )

    anomaly(
        "Super-admin / override audit trail",
        "low", 2, "",
        "Every super-admin edit, deletion, and discount-override warning recorded in the period. Provided as-is for the CA's manual review.",
        ["id", "bill_number", "edited_by", "change_type", "old", "new", "reason", "at"],
        [
            ["91", "2026040112", "Anita Verma", "totalAmount", "3,200", "2,800", "Patient overcharged", "2026-04-08 11:14"],
            ["92", "2026040298", "Anita Verma", "discount_warn", "—", "—", "Camp patient, owner ok", "2026-04-19 16:42"],
        ],
    )

    # Sign-off block
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=1.2, color=colors.HexColor("#9ca3af"), spaceBefore=4, spaceAfter=10))

    sig_left = [
        Paragraph("<b>Reviewed by (Chartered Accountant):</b>", SIG_LABEL),
        Spacer(1, 50),
        HRFlowable(width="80%", thickness=0.5, color=colors.HexColor("#6b7280")),
        Paragraph("Name &amp; Signature", SIG_NAME),
        Spacer(1, 4),
        Paragraph("Membership No.: ____________", SIG_SMALL),
        Paragraph("Date: ____________", SIG_SMALL),
    ]
    sig_right = [
        Paragraph("<b>For DiagnoCenter (Super Admin):</b>", SIG_LABEL),
        Spacer(1, 50),
        HRFlowable(width="80%", thickness=0.5, color=colors.HexColor("#6b7280")),
        Paragraph("Anita Verma", SIG_NAME),
        Spacer(1, 4),
        Paragraph("Audit #18", SIG_SMALL),
        Paragraph("Date: ____________", SIG_SMALL),
    ]
    sig_table = Table([[sig_left, sig_right]], colWidths=[85*mm, 85*mm])
    sig_table.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 0), ("RIGHTPADDING", (0,0), (-1,-1), 14),
    ]))
    story.append(sig_table)

    story.append(Spacer(1, 22))
    story.append(Paragraph("Generated automatically from the DiagnoCenter ERP. Snapshot stored permanently in audit_runs.", FOOTER))

    doc.build(story)
    print("wrote", OUT)

if __name__ == "__main__":
    build()

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

type Props = {
  barcode: string;
  patientName: string;
  patientId?: string;
  age?: string;
  gender?: string;
  sampleType: string;
  containerType: string;
  collectedAt: string;
  collectedByName?: string;
  testNames: string[];
  width?: number;   // px, default ~ 380 (label printer)
  showTitle?: boolean;
};

// 50mm x 25mm thermal label, scaled to ~380x190px on screen.
// Uses Code 128 (industry-standard for clinical specimens).
export default function SampleLabel({
  barcode, patientName, patientId, age, gender,
  sampleType, containerType, collectedAt, collectedByName,
  testNames, width = 380, showTitle = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, barcode, {
        format: "CODE128",
        displayValue: false,
        margin: 0,
        height: 50,
        width: 1.6,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch (e) {
      console.error("Barcode render failed", e);
    }
  }, [barcode]);

  const collectedDate = (() => {
    try { return new Date(collectedAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }); }
    catch { return collectedAt; }
  })();

  return (
    <div
      className="bg-white text-black border border-black/10 rounded-md p-2 font-sans"
      style={{ width: `${width}px` }}
      data-sample-label={barcode}
    >
      {showTitle && (
        <div className="text-[10px] font-bold uppercase tracking-wide text-center border-b border-black/20 pb-1 mb-1">
          Specimen Label
        </div>
      )}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold leading-tight truncate">{patientName}</div>
          <div className="text-[10px] text-black/70 leading-tight">
            {[patientId, age, gender].filter(Boolean).join(" • ")}
          </div>
        </div>
        <div className="text-right text-[9px] text-black/70 leading-tight whitespace-nowrap">
          {collectedDate}
        </div>
      </div>
      <svg ref={svgRef} className="w-full block" />
      <div className="text-center font-mono text-[11px] font-bold tracking-wider mt-0.5">{barcode}</div>
      <div className="grid grid-cols-2 gap-x-2 mt-1 text-[9px] leading-tight">
        <div><span className="text-black/60">Type:</span> <strong>{sampleType}</strong></div>
        <div className="text-right"><span className="text-black/60">Tube:</span> <strong>{containerType}</strong></div>
      </div>
      {testNames.length > 0 && (
        <div className="text-[9px] mt-0.5 leading-snug border-t border-black/10 pt-0.5">
          <span className="text-black/60">Tests:</span> {testNames.join(", ")}
        </div>
      )}
      {collectedByName && (
        <div className="text-[9px] text-black/60 mt-0.5">By: {collectedByName}</div>
      )}
    </div>
  );
}

// Open a print window with one or more labels stacked vertically.
export function printLabels(labels: HTMLElement[]) {
  const w = window.open("", "_blank", "width=420,height=600");
  if (!w) { alert("Popup blocked. Please allow popups to print labels."); return; }
  const styles = `
    <style>
      @page { margin: 4mm; size: 50mm 25mm; }
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 0; }
      .label { page-break-after: always; margin: 0 0 6mm 0; }
      .label:last-child { page-break-after: auto; }
      svg { display: block; }
    </style>
  `;
  const html = labels.map((el) => `<div class="label">${el.outerHTML}</div>`).join("");
  w.document.write(`<!DOCTYPE html><html><head><title>Sample Labels</title>${styles}</head><body>${html}<script>window.onload=()=>{setTimeout(()=>{window.print();window.close();},200);};<\/script></body></html>`);
  w.document.close();
}

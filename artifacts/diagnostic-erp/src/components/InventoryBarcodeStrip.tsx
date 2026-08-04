import { useRef, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/fetchApi";
import { Barcode, ScanLine } from "lucide-react";

type Item = {
  id: number;
  name: string;
  unit: string;
  currentStock: number;
  barcode?: string | null;
};

type Props = {
  onItemFound: (item: Item) => void;
  onStockAction?: (item: Item, mode: "in" | "out") => void;
};

export default function InventoryBarcodeStrip({ onItemFound, onStockAction }: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [buffer, setBuffer] = useState("");
  const [busy, setBusy] = useState(false);

  const resolve = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const result = await api.get<{ type: string; item?: Item }>(`/api/resolve-barcode/${encodeURIComponent(trimmed)}`);
      if (result.type === "inventory" && result.item) {
        onItemFound(result.item);
        toast({ title: "Item scanned", description: `${result.item.name} (${result.item.currentStock} ${result.item.unit})` });
        setBuffer("");
        return;
      }
      const item = await api.get<Item>(`/api/inventory/by-barcode/${encodeURIComponent(trimmed)}`);
      onItemFound(item);
      toast({ title: "Item scanned", description: `${item.name} (${item.currentStock} ${item.unit})` });
      setBuffer("");
    } catch {
      toast({ title: "Not found", description: `No inventory item for "${trimmed}"`, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, [busy, onItemFound, toast]);

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-dashed border-primary/30 bg-primary/5">
      <ScanLine size={16} className="text-primary shrink-0" />
      <span className="text-xs font-semibold text-primary">Scanner</span>
      <Input
        ref={inputRef}
        value={buffer}
        onChange={(e) => setBuffer(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolve(buffer); } }}
        placeholder="Scan INV- barcode or type & Enter"
        className="h-8 flex-1 min-w-[200px] text-sm font-mono"
        disabled={busy}
      />
      <Button size="sm" variant="outline" className="h-8" onClick={() => void resolve(buffer)} disabled={busy || !buffer.trim()}>
        <Barcode size={13} className="mr-1" /> Lookup
      </Button>
      {onStockAction && (
        <span className="text-[10px] text-muted-foreground w-full sm:w-auto">Tip: scan item then use Stock In / Stock Out on the card</span>
      )}
    </div>
  );
}

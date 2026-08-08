import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";

type Props = {
  /** When set, edits are held locally until the parent saves the full portal form. */
  value?: string | null;
  onChange?: (dataUrl: string | null) => void;
  /** Standalone mode: load/save via API (used on Appearance tab). */
  standalone?: boolean;
  id?: string;
};

export function PortalLoginBackgroundSettings({
  value: controlledValue,
  onChange,
  standalone = false,
  id = "portal-login-background",
}: Props) {
  const qc = useQueryClient();
  const [localValue, setLocalValue] = useState<string | null>(null);
  const [bgUploadErr, setBgUploadErr] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!standalone && controlledValue !== undefined) return;
    let cancelled = false;
    void api.get<{ portalBackgroundImageDataUrl?: string | null }>("/api/clinic-settings").then((data) => {
      if (!cancelled) {
        setLocalValue(data.portalBackgroundImageDataUrl ?? null);
        setDirty(false);
      }
    });
    return () => { cancelled = true; };
  }, [standalone, controlledValue]);

  const displayValue = standalone ? localValue : (controlledValue ?? null);

  const setValue = (next: string | null) => {
    if (standalone) {
      setLocalValue(next);
      setDirty(true);
    } else {
      onChange?.(next);
    }
  };

  const onBackgroundChange = (file: File | null) => {
    if (!file) return;
    setBgUploadErr("");
    if (!file.type.startsWith("image/")) {
      setBgUploadErr("Please upload an image file");
      return;
    }
    if (file.size > 3_000_000) {
      setBgUploadErr("Image too large (max ~3 MB). Use a smaller photo.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setValue(String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = useMutation({
    mutationFn: (dataUrl: string | null) =>
      api.put("/api/clinic-settings", { portalBackgroundImageDataUrl: dataUrl }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clinic-settings"] });
      qc.invalidateQueries({ queryKey: ["portal-settings"] });
      setDirty(false);
    },
  });

  return (
    <div id={id} className="bg-card border border-card-border rounded-xl p-5 space-y-4 scroll-mt-24">
      <div>
        <h3 className="font-bold flex items-center gap-2">
          <ImageIcon size={16} /> Staff login &amp; portal background
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Shown behind the staff login page and patient portal instead of the plain gradient.
          Recommended: a wide clinic photo, under 3 MB.
        </p>
      </div>
      <div className="border-2 border-dashed border-card-border rounded-lg p-4 flex items-center justify-center bg-muted/30 min-h-[140px]">
        {displayValue ? (
          <img src={displayValue} alt="Portal background preview" className="max-h-40 max-w-full object-contain rounded" />
        ) : (
          <div className="text-center text-muted-foreground text-sm">
            <ImageIcon size={32} className="mx-auto mb-2 opacity-30" />
            No background image set
          </div>
        )}
      </div>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => onBackgroundChange(e.target.files?.[0] ?? null)}
        className="hidden"
        id={`${id}-file-input`}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => document.getElementById(`${id}-file-input`)?.click()}
        className="w-full"
      >
        <Upload size={14} className="mr-2" /> Choose background image
      </Button>
      {displayValue && (
        <Button
          type="button"
          variant="ghost"
          className="w-full text-destructive hover:text-destructive"
          onClick={() => setValue(null)}
        >
          <Trash2 size={14} className="mr-2" /> Remove background image
        </Button>
      )}
      {bgUploadErr && <p className="text-xs text-destructive">{bgUploadErr}</p>}
      {standalone ? (
        <div className="flex justify-end pt-1">
          <Button
            type="button"
            onClick={() => save.mutate(localValue)}
            disabled={save.isPending || !dirty}
          >
            {save.isPending ? "Saving…" : "Save background"}
          </Button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Click <strong>Save Changes</strong> at the bottom of this page after choosing an image.
        </p>
      )}
    </div>
  );
}

/**
 * An `<img>` for a stored key image — the pixel itself, not a credential.
 *
 * Key images under `/uploads/radiology-key-images/` are guarded server-side
 * (`lib/radiologyKeyImageStatic.ts`), and an image tag cannot send an
 * Authorization header, so this component resolves a short-lived per-file grant
 * through `lib/keyImageAccess.ts` and points `src` at that. It never puts the
 * staff session token in a URL.
 *
 * Images that are not stored key-image files — an Orthanc/DICOMweb rendered URL,
 * a `data:` URI — are passed through untouched, because there is nothing to
 * grant for them and silently blanking them would lose pictures that work today.
 *
 * A failed load invalidates the cached grant and asks for a new one once. If it
 * fails again the frame stays empty: an empty frame is honest, a stale or
 * borrowed image is not.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cachedKeyImageUrls,
  fetchKeyImageAccessUrls,
  invalidateKeyImageUrls,
  isGuardedKeyImageUrl,
} from "@/lib/keyImageAccess";

type KeyImageWithAccessProps = {
  /** `radiology_report_key_images.id` — what the grant is minted for. */
  id: number;
  /** The stored URL, used as-is when it is not a guarded key-image file. */
  src: string | null | undefined;
  variant?: "image" | "thumbnail";
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  "data-testid"?: string;
};

export function KeyImageWithAccess({
  id,
  src,
  variant = "image",
  alt,
  className,
  loading = "lazy",
  ...rest
}: KeyImageWithAccessProps) {
  const guarded = isGuardedKeyImageUrl(src);
  const [url, setUrl] = useState<string | null>(
    guarded ? (cachedKeyImageUrls(id)?.[variant === "thumbnail" ? "thumbnailUrl" : "imageUrl"] ?? null) : (src ?? null),
  );
  const attempts = useRef(guarded ? 0 : 1);

  const resolve = useCallback(async () => {
    if (!guarded) return;
    const found = await fetchKeyImageAccessUrls([id]);
    const entry = found.get(id);
    // A row may store only the full image (no separate thumbnail file). Falling
    // back to it matches what the rail showed before; returning null would
    // blank a picture that exists.
    const next =
      variant === "thumbnail" ? (entry?.thumbnailUrl ?? entry?.imageUrl) : (entry?.imageUrl ?? null);
    setUrl(next ?? null);
  }, [guarded, id, variant]);

  useEffect(() => {
    if (!guarded) {
      setUrl(src ?? null);
      return;
    }
    void resolve();
  }, [guarded, resolve, src]);

  const onError = useCallback(() => {
    if (!guarded) return;
    attempts.current += 1;
    if (attempts.current > 2) return; // one retry, then stay empty
    invalidateKeyImageUrls(id);
    void resolve();
  }, [guarded, id, resolve]);

  if (!url) {
    // Keep the frame the parent sized for it; render nothing rather than a
    // broken-image icon over a black box.
    return <div className={className} data-testid={rest["data-testid"]} aria-hidden />;
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading={guarded ? loading : "lazy"}
      onError={onError}
      data-testid={rest["data-testid"]}
    />
  );
}

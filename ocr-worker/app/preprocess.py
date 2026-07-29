"""Lightweight image preprocessing before PaddleOCR."""

from __future__ import annotations

import io
from typing import Any

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps


def load_image_bytes(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img


def maybe_upscale(img: Image.Image, min_long_edge: int = 1200) -> tuple[Image.Image, list[str]]:
    steps: list[str] = []
    w, h = img.size
    long_edge = max(w, h)
    if long_edge < min_long_edge and long_edge > 0:
        scale = min_long_edge / long_edge
        # Cap enlargement — avoid inventing detail from heavy upscaling
        scale = min(scale, 2.5)
        nw, nh = int(w * scale), int(h * scale)
        img = img.resize((nw, nh), Image.Resampling.LANCZOS)
        steps.append(f"upscale-{scale:.2f}x")
    return img, steps


def preprocess_for_ocr(data: bytes, enabled: bool = True) -> tuple[bytes, list[str]]:
    """
    Mild preprocessing only. Avoid aggressive thresholding that destroys
    faint medical/ID text.
    """
    steps: list[str] = []
    if not enabled:
        return data, steps

    try:
        img = load_image_bytes(data)
        steps.append("exif-orient")

        # Grayscale for OCR stability (keep RGB bytes as JPEG for paddle)
        gray = ImageOps.grayscale(img)
        steps.append("grayscale")

        # Contrast stretch via autocontrast (histogram normalize)
        gray = ImageOps.autocontrast(gray, cutoff=1)
        steps.append("autocontrast")

        # Moderate denoise
        gray = gray.filter(ImageFilter.MedianFilter(size=3))
        steps.append("median-denoise")

        # Slight sharpen
        gray = gray.filter(ImageFilter.UnsharpMask(radius=1.2, percent=120, threshold=3))
        steps.append("unsharp")

        gray, up_steps = maybe_upscale(gray)
        steps.extend(up_steps)

        # Encode as PNG to avoid further JPEG loss
        out = io.BytesIO()
        gray.convert("RGB").save(out, format="PNG", optimize=True)
        return out.getvalue(), steps
    except Exception as exc:  # noqa: BLE001 — never block OCR on preprocess failure
        return data, [f"preprocess-skipped:{type(exc).__name__}"]


def pdf_to_png_pages(data: bytes, max_pages: int = 50) -> list[bytes]:
    """Render PDF pages to PNG bytes (requires pypdfium2)."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    pages: list[bytes] = []
    try:
        n = min(len(pdf), max_pages)
        for i in range(n):
            page = pdf[i]
            # 150 DPI is enough for OCR of printed text; keeps memory bounded
            bitmap = page.render(scale=150 / 72)
            pil = bitmap.to_pil()
            buf = io.BytesIO()
            pil.convert("RGB").save(buf, format="PNG")
            pages.append(buf.getvalue())
            page.close()
    finally:
        pdf.close()
    return pages


def is_pdf(data: bytes, mime: str | None, filename: str | None) -> bool:
    if mime and "pdf" in mime.lower():
        return True
    if filename and filename.lower().endswith(".pdf"):
        return True
    return data[:5] == b"%PDF-"


def to_numpy_rgb(data: bytes) -> Any:
    img = load_image_bytes(data)
    if img.mode != "RGB":
        img = img.convert("RGB")
    return np.array(img)
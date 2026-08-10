"""PaddleOCR engine — initialize once, reuse, GPU with safe CPU fallback."""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .config import CONFIG, PROFILES
from . import PIPELINE_VERSION, __version__
from .preprocess import is_pdf, pdf_to_png_pages, preprocess_for_ocr, to_numpy_rgb
from .quality import assess_quality
from .schemas import OcrLine, OcrPage, OcrResult

log = logging.getLogger("care.ocr_worker")


@dataclass
class EngineStats:
    active_jobs: int = 0
    success_count: int = 0
    failure_count: int = 0
    total_ms: float = 0.0
    last_success_at: str | None = None
    last_failure_at: str | None = None
    last_error: str | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)


class PaddleEngine:
    def __init__(self) -> None:
        self._engines: dict[str, Any] = {}
        self._init_errors: dict[str, str] = {}
        self._device_actual = "cpu"
        self._gpu_available = False
        self._gpu_init_error: str | None = None
        self._ready = False
        self._semaphore = threading.Semaphore(CONFIG.worker_concurrency)
        self.stats = EngineStats()

    @property
    def ready(self) -> bool:
        return self._ready and bool(self._engines)

    def detect_gpu(self) -> bool:
        try:
            import paddle

            compiled = bool(paddle.device.is_compiled_with_cuda())
            count = paddle.device.cuda.device_count() if compiled else 0
            self._gpu_available = compiled and count > 0
            if not self._gpu_available:
                self._gpu_init_error = "CUDA not compiled or no GPU devices"
            return self._gpu_available
        except Exception as exc:  # noqa: BLE001
            self._gpu_available = False
            self._gpu_init_error = f"{type(exc).__name__}: {exc}"
            return False

    def _resolve_device(self) -> str:
        requested = CONFIG.ocr_device
        if requested == "cpu":
            self._device_actual = "cpu"
            return "cpu"
        if requested == "gpu":
            if self.detect_gpu():
                self._device_actual = "gpu"
                return "gpu"
            self._device_actual = "cpu"
            return "cpu"
        # auto
        if self.detect_gpu():
            self._device_actual = "gpu"
            return "gpu"
        self._device_actual = "cpu"
        return "cpu"

    def _build_ocr(self, profile: str, device: str) -> Any:
        from paddleocr import PaddleOCR

        spec = PROFILES[profile]
        kwargs: dict[str, Any] = {
            "text_detection_model_name": spec["text_detection_model_name"],
            "text_recognition_model_name": spec["text_recognition_model_name"],
            "use_doc_orientation_classify": True,
            "use_doc_unwarping": False,
            "use_textline_orientation": True,
        }
        # PaddleOCR 3.x device selection — try common knobs; never crash on unknown kwargs
        if device == "gpu":
            for key, val in (("device", "gpu"), ("use_gpu", True)):
                try:
                    return PaddleOCR(**{**kwargs, key: val})
                except TypeError:
                    continue
                except Exception as exc:  # noqa: BLE001
                    log.warning("GPU Paddle init failed for %s (%s); will try CPU", profile, exc)
                    self._gpu_init_error = str(exc)
                    break
            # Fall through to CPU
            self._device_actual = "cpu"
            device = "cpu"

        try:
            return PaddleOCR(**{**kwargs, "device": "cpu"})
        except TypeError:
            try:
                return PaddleOCR(**{**kwargs, "use_gpu": False})
            except TypeError:
                return PaddleOCR(**kwargs)

    def initialize(self, profiles: list[str] | None = None) -> None:
        wanted = profiles or ["fast", "accurate"]
        device = self._resolve_device()
        for profile in wanted:
            if profile not in PROFILES:
                continue
            try:
                log.info("Initializing PaddleOCR profile=%s device=%s", profile, device)
                self._engines[profile] = self._build_ocr(profile, device)
                log.info("PaddleOCR profile=%s ready on %s", profile, self._device_actual)
            except Exception as exc:  # noqa: BLE001
                self._init_errors[profile] = f"{type(exc).__name__}: {exc}"
                log.exception("Failed to init profile %s", profile)
        self._ready = bool(self._engines)

    def warmup(self) -> None:
        if not self._ready:
            return
        # Tiny synthetic image — avoids PHI; forces model graph load
        import numpy as np
        from PIL import Image, ImageDraw

        img = Image.new("RGB", (320, 80), color=(255, 255, 255))
        draw = ImageDraw.Draw(img)
        draw.text((10, 30), "CARE OCR WARMUP", fill=(0, 0, 0))
        arr = np.array(img)
        for profile in list(self._engines.keys()):
            try:
                self._run_predict(profile, arr)
                log.info("Warm-up complete for profile=%s", profile)
            except Exception as exc:  # noqa: BLE001
                log.warning("Warm-up failed for %s: %s", profile, exc)

    def _run_predict(self, profile: str, image_np: Any) -> list[dict[str, Any]]:
        engine = self._engines[profile]
        # PaddleOCR 3.x: predict(); older: ocr()
        if hasattr(engine, "predict"):
            raw = engine.predict(image_np)
        else:
            raw = engine.ocr(image_np)
        return self._normalize_raw(raw)

    def _normalize_raw(self, raw: Any) -> list[dict[str, Any]]:
        """Convert PaddleOCR 3.x / 2.x outputs into [{text, confidence, bbox}]."""
        lines: list[dict[str, Any]] = []
        if raw is None:
            return lines

        # PP-OCRv5 predict() often returns list of result objects / dicts
        items = raw if isinstance(raw, list) else [raw]
        for item in items:
            # Result object with attributes
            if hasattr(item, "json") and callable(item.json):
                try:
                    item = item.json
                    if callable(item):
                        item = item()
                except Exception:  # noqa: BLE001
                    pass
            if hasattr(item, "res") and isinstance(item.res, dict):
                item = item.res

            if isinstance(item, dict):
                # Common keys in PaddleX / PaddleOCR 3
                texts = item.get("rec_texts") or item.get("texts") or []
                scores = item.get("rec_scores") or item.get("scores") or []
                boxes = item.get("rec_polys") or item.get("dt_polys") or item.get("boxes") or []
                if texts:
                    for i, text in enumerate(texts):
                        conf = float(scores[i]) if i < len(scores) else 0.0
                        bbox = boxes[i] if i < len(boxes) else None
                        if isinstance(bbox, (list, tuple)):
                            bbox = [[float(p[0]), float(p[1])] for p in bbox] if bbox and hasattr(bbox[0], "__len__") else None
                        lines.append({"text": str(text), "confidence": conf, "bbox": bbox})
                    continue

            # Classic PaddleOCR 2.x: [[[box], (text, score)], ...]
            if isinstance(item, list):
                for row in item:
                    try:
                        if not row:
                            continue
                        box, payload = row[0], row[1]
                        if isinstance(payload, (list, tuple)) and len(payload) >= 2:
                            text, score = payload[0], float(payload[1])
                        else:
                            continue
                        bbox = [[float(p[0]), float(p[1])] for p in box] if box is not None else None
                        lines.append({"text": str(text), "confidence": score, "bbox": bbox})
                    except Exception:  # noqa: BLE001
                        continue
        return lines

    def ocr_bytes(
        self,
        data: bytes,
        *,
        profile: str = "fast",
        mime_type: str | None = None,
        filename: str | None = None,
        preprocess: bool = True,
        expected_keywords: list[str] | None = None,
        allow_accurate_retry: bool | None = None,
    ) -> OcrResult:
        if not self._ready:
            raise RuntimeError("PaddleOCR not initialized")
        if profile not in self._engines:
            if "fast" in self._engines:
                profile = "fast"
            else:
                profile = next(iter(self._engines.keys()))

        retry_accurate = CONFIG.retry_accurate if allow_accurate_retry is None else allow_accurate_retry
        started = time.perf_counter()
        warnings: list[str] = []
        with self.stats.lock:
            self.stats.active_jobs += 1
        acquired = self._semaphore.acquire(timeout=300)
        if not acquired:
            with self.stats.lock:
                self.stats.active_jobs -= 1
                self.stats.failure_count += 1
                self.stats.last_error = "OCR concurrency queue timeout"
                self.stats.last_failure_at = datetime.now(timezone.utc).isoformat()
            raise TimeoutError("OCR worker concurrency limit exceeded")

        try:
            page_images: list[bytes]
            if is_pdf(data, mime_type, filename):
                page_images = pdf_to_png_pages(data)
                if not page_images:
                    raise ValueError("PDF contained no renderable pages")
                warnings.append(f"pdf_pages={len(page_images)}")
            else:
                page_images = [data]

            def run_profile(prof: str) -> OcrResult:
                pages_out: list[OcrPage] = []
                all_confs: list[float] = []
                all_text: list[str] = []
                for idx, page_bytes in enumerate(page_images, start=1):
                    t0 = time.perf_counter()
                    processed, steps = preprocess_for_ocr(page_bytes, enabled=preprocess)
                    arr = to_numpy_rgb(processed)
                    raw_lines = self._run_predict(prof, arr)
                    lines = [
                        OcrLine(
                            text=r["text"],
                            confidence=max(0.0, min(1.0, float(r["confidence"]))),
                            bbox=r.get("bbox"),
                            page=idx,
                        )
                        for r in raw_lines
                        if str(r.get("text") or "").strip()
                    ]
                    page_text = "\n".join(l.text for l in lines)
                    confs = [l.confidence for l in lines]
                    mean_c = sum(confs) / len(confs) if confs else 0.0
                    pages_out.append(
                        OcrPage(
                            page=idx,
                            text=page_text,
                            lines=lines,
                            mean_confidence=mean_c,
                            processing_ms=(time.perf_counter() - t0) * 1000,
                        )
                    )
                    all_confs.extend(confs)
                    if page_text.strip():
                        all_text.append(f"--- page {idx} ---\n{page_text}" if len(page_images) > 1 else page_text)
                    if steps:
                        warnings.append(f"page{idx}_preprocess:{','.join(steps)}")

                full_text = "\n\n".join(all_text).strip()
                mean_confidence = sum(all_confs) / len(all_confs) if all_confs else 0.0
                quality = assess_quality(
                    mean_confidence=mean_confidence,
                    line_confidences=all_confs,
                    text=full_text,
                    low_confidence_threshold=CONFIG.low_confidence_threshold,
                    expected_keywords=expected_keywords,
                )
                empty = not full_text
                if empty:
                    warnings.append("empty_ocr_result")
                return OcrResult(
                    ok=not empty,
                    profile=prof,
                    model_label=PROFILES[prof]["label"],
                    device=self._device_actual,
                    text=full_text,
                    pages=pages_out,
                    mean_confidence=mean_confidence,
                    low_confidence_line_ratio=quality.low_confidence_line_ratio,
                    processing_ms=(time.perf_counter() - started) * 1000,
                    warnings=warnings + quality.reasons,
                    path_used=f"paddle:{prof}",
                    pipeline_version=PIPELINE_VERSION,
                    empty=empty,
                    diagnostics={
                        "quality_reasons": quality.reasons,
                        "missing_keywords": quality.missing_keywords,
                        "page_count": len(pages_out),
                        "line_count": len(all_confs),
                        "preprocess_enabled": preprocess,
                    },
                )

            result = run_profile(profile)
            if (
                result.empty
                or (
                    retry_accurate
                    and profile == "fast"
                    and "accurate" in self._engines
                    and assess_quality(
                        mean_confidence=result.mean_confidence,
                        line_confidences=[ln.confidence for p in result.pages for ln in p.lines],
                        text=result.text,
                        low_confidence_threshold=CONFIG.low_confidence_threshold,
                        expected_keywords=expected_keywords,
                    ).is_low_quality
                )
            ):
                if "accurate" in self._engines and profile != "accurate":
                    warnings.append("retrying_accurate_profile")
                    result = run_profile("accurate")
                    result.warnings = list(dict.fromkeys(warnings + result.warnings))

            if result.empty:
                # Never silently succeed with empty text
                result.ok = False
                result.warnings.append("rejected_empty_ocr")

            with self.stats.lock:
                if result.ok:
                    self.stats.success_count += 1
                    self.stats.last_success_at = datetime.now(timezone.utc).isoformat()
                else:
                    self.stats.failure_count += 1
                    self.stats.last_failure_at = datetime.now(timezone.utc).isoformat()
                    self.stats.last_error = "empty OCR" if result.empty else "OCR failed"
                self.stats.total_ms += result.processing_ms
            return result
        except Exception as exc:
            with self.stats.lock:
                self.stats.failure_count += 1
                self.stats.last_failure_at = datetime.now(timezone.utc).isoformat()
                self.stats.last_error = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            self._semaphore.release()
            with self.stats.lock:
                self.stats.active_jobs = max(0, self.stats.active_jobs - 1)

    def health(self) -> dict[str, Any]:
        avg = None
        with self.stats.lock:
            total = self.stats.success_count + self.stats.failure_count
            if total:
                avg = self.stats.total_ms / total
            return {
                "ok": self.ready,
                "version": __version__,
                "pipeline_version": PIPELINE_VERSION,
                "paddle_loaded": self.ready,
                "profiles_ready": list(self._engines.keys()),
                "device_requested": CONFIG.ocr_device,
                "device_actual": self._device_actual,
                "gpu_available": self._gpu_available,
                "gpu_init_error": self._gpu_init_error,
                "init_errors": self._init_errors,
                "active_jobs": self.stats.active_jobs,
                "last_success_at": self.stats.last_success_at,
                "last_failure_at": self.stats.last_failure_at,
                "last_error": self.stats.last_error,
                "average_processing_ms": avg,
                "success_count": self.stats.success_count,
                "failure_count": self.stats.failure_count,
                "config": {
                    "ocr_profile": CONFIG.ocr_profile,
                    "low_confidence_threshold": CONFIG.low_confidence_threshold,
                    "retry_accurate": CONFIG.retry_accurate,
                    "worker_concurrency": CONFIG.worker_concurrency,
                },
            }


ENGINE = PaddleEngine()
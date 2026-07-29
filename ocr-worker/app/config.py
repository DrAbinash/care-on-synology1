"""Single source of truth for OCR-worker environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class WorkerConfig:
    host: str
    port: int
    ocr_profile: str  # fast | accurate
    ocr_device: str  # auto | cpu | gpu
    low_confidence_threshold: float
    retry_accurate: bool
    worker_concurrency: int
    warmup_on_start: bool
    auth_token: str | None

    @classmethod
    def from_env(cls) -> "WorkerConfig":
        profile = (os.environ.get("OCR_PROFILE") or "fast").strip().lower()
        if profile not in {"fast", "accurate"}:
            profile = "fast"
        device = (os.environ.get("OCR_DEVICE") or "auto").strip().lower()
        if device not in {"auto", "cpu", "gpu"}:
            device = "auto"
        return cls(
            host=os.environ.get("OCR_WORKER_HOST", "0.0.0.0"),
            port=_int("OCR_WORKER_PORT", 8090),
            ocr_profile=profile,
            ocr_device=device,
            low_confidence_threshold=_float("OCR_LOW_CONFIDENCE_THRESHOLD", 0.80),
            retry_accurate=_bool("OCR_RETRY_ACCURATE", True),
            worker_concurrency=max(1, _int("OCR_WORKER_CONCURRENCY", 1)),
            warmup_on_start=_bool("OCR_WARMUP_ON_START", True),
            auth_token=(os.environ.get("OCR_WORKER_TOKEN") or "").strip() or None,
        )


CONFIG = WorkerConfig.from_env()

# PP-OCRv5 English profiles (PaddleOCR 3.x)
PROFILES: dict[str, dict[str, str]] = {
    "fast": {
        "text_detection_model_name": "PP-OCRv5_mobile_det",
        "text_recognition_model_name": "en_PP-OCRv5_mobile_rec",
        "label": "PP-OCRv5 English mobile (fast)",
    },
    "accurate": {
        "text_detection_model_name": "PP-OCRv5_server_det",
        "text_recognition_model_name": "en_PP-OCRv5_mobile_rec",
        "label": "PP-OCRv5 English server-det (accurate)",
    },
}
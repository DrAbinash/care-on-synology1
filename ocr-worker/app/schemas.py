"""Normalized OCR response schemas (Pydantic)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class OcrLine(BaseModel):
    text: str
    confidence: float = Field(ge=0.0, le=1.0)
    bbox: list[list[float]] | None = None  # [[x,y], ...]
    page: int = 1


class OcrPage(BaseModel):
    page: int
    text: str
    lines: list[OcrLine]
    mean_confidence: float
    processing_ms: float


class OcrResult(BaseModel):
    ok: bool
    engine: Literal["paddle"] = "paddle"
    profile: str
    model_label: str
    device: str
    text: str
    pages: list[OcrPage]
    mean_confidence: float
    low_confidence_line_ratio: float
    processing_ms: float
    warnings: list[str] = Field(default_factory=list)
    path_used: str  # e.g. paddle:fast | paddle:accurate
    pipeline_version: str
    empty: bool = False
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class OcrRequestMeta(BaseModel):
    profile: Literal["fast", "accurate", "auto"] | None = "auto"
    filename: str | None = None
    mime_type: str | None = None
    preprocess: bool = True
    expected_keywords: list[str] | None = None


class HealthResponse(BaseModel):
    ok: bool
    service: str = "care-ocr-worker"
    version: str
    pipeline_version: str
    paddle_loaded: bool
    profiles_ready: list[str]
    device_requested: str
    device_actual: str
    gpu_available: bool
    gpu_init_error: str | None = None
    active_jobs: int
    last_success_at: str | None = None
    last_failure_at: str | None = None
    last_error: str | None = None
    average_processing_ms: float | None = None
    success_count: int = 0
    failure_count: int = 0
    config: dict[str, Any] = Field(default_factory=dict)
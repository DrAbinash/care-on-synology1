"""FastAPI entrypoint for the CARE OCR worker."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from . import PIPELINE_VERSION, __version__
from .config import CONFIG
from .paddle_engine import ENGINE
from .schemas import HealthResponse, OcrResult

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("care.ocr_worker.api")


def require_token(authorization: Annotated[str | None, Header()] = None, x_ocr_token: Annotated[str | None, Header()] = None) -> None:
    """API-key gate for Synology → Windows worker. Never expose this port publicly."""
    if CONFIG.require_auth and not CONFIG.auth_token:
        raise HTTPException(
            status_code=503,
            detail="OCR_WORKER_TOKEN not configured — refuse unauthenticated OCR in production",
        )
    if not CONFIG.auth_token:
        return
    provided = None
    if x_ocr_token:
        provided = x_ocr_token.strip()
    elif authorization and authorization.lower().startswith("bearer "):
        provided = authorization[7:].strip()
    if provided != CONFIG.auth_token:
        raise HTTPException(status_code=401, detail="Invalid OCR worker token")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log.info(
        "Starting CARE OCR worker v%s (profile=%s device=%s require_auth=%s token_set=%s)",
        __version__,
        CONFIG.ocr_profile,
        CONFIG.ocr_device,
        CONFIG.require_auth,
        bool(CONFIG.auth_token),
    )
    if CONFIG.require_auth and not CONFIG.auth_token:
        log.error(
            "OCR_WORKER_REQUIRE_AUTH=true but OCR_WORKER_TOKEN is empty — /ocr and /warmup will return 503"
        )
    try:
        ENGINE.initialize(["fast", "accurate"])
        if CONFIG.warmup_on_start and ENGINE.ready:
            ENGINE.warmup()
    except Exception:
        log.exception("OCR engine failed to initialize — /ocr will return 503 until fixed")
    yield


app = FastAPI(title="CARE OCR Worker", version=__version__, lifespan=lifespan)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    h = ENGINE.health()
    return HealthResponse(
        ok=bool(h["ok"]),
        version=h["version"],
        pipeline_version=h["pipeline_version"],
        paddle_loaded=h["paddle_loaded"],
        profiles_ready=h["profiles_ready"],
        device_requested=h["device_requested"],
        device_actual=h["device_actual"],
        gpu_available=h["gpu_available"],
        gpu_init_error=h.get("gpu_init_error"),
        active_jobs=h["active_jobs"],
        last_success_at=h.get("last_success_at"),
        last_failure_at=h.get("last_failure_at"),
        last_error=h.get("last_error"),
        average_processing_ms=h.get("average_processing_ms"),
        success_count=h["success_count"],
        failure_count=h["failure_count"],
        config=h.get("config") or {},
    )


@app.post("/ocr", response_model=OcrResult, dependencies=[Depends(require_token)])
async def ocr_endpoint(
    file: UploadFile = File(...),
    profile: str = Form("auto"),
    preprocess: bool = Form(True),
    expected_keywords: str | None = Form(None),
) -> OcrResult | JSONResponse:
    if not ENGINE.ready:
        raise HTTPException(status_code=503, detail="PaddleOCR not loaded")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")

    # Soft size guard — 25 MB
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 25MB)")

    prof = (profile or "auto").strip().lower()
    if prof == "auto":
        prof = CONFIG.ocr_profile
    if prof not in {"fast", "accurate"}:
        raise HTTPException(status_code=400, detail="profile must be auto|fast|accurate")

    keywords = None
    if expected_keywords:
        keywords = [k.strip() for k in expected_keywords.split(",") if k.strip()]

    try:
        result = ENGINE.ocr_bytes(
            data,
            profile=prof,
            mime_type=file.content_type,
            filename=file.filename,
            preprocess=preprocess,
            expected_keywords=keywords,
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("OCR failed")
        raise HTTPException(status_code=500, detail=f"OCR failed: {type(exc).__name__}: {exc}") from exc

    if result.empty:
        # Explicit non-success — callers must not treat empty as OK
        return JSONResponse(status_code=422, content=result.model_dump())
    return result


@app.post("/warmup", dependencies=[Depends(require_token)])
def warmup() -> dict:
    if not ENGINE.ready:
        raise HTTPException(status_code=503, detail="PaddleOCR not loaded")
    ENGINE.warmup()
    return {"ok": True, "pipeline_version": PIPELINE_VERSION}


def main() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=CONFIG.host,
        port=CONFIG.port,
        workers=1,  # one process — models loaded once; concurrency via semaphore
        log_level="info",
    )


if __name__ == "__main__":
    main()
"""Persistent Electronic Film job storage."""
from __future__ import annotations

import json
import os
import re
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import config_store

_LOCK = threading.RLock()
_INDEX: dict[str, dict[str, Any]] = {}


@dataclass
class ElectronicFilmJob:
    jobKey: str
    source: str  # DICOM | ERP
    sourceCallingAE: str = ""
    filmSessionUID: str = ""
    filmBoxUIDs: list[str] = field(default_factory=list)
    receivedAt: str = ""
    completedAt: str = ""
    imageCount: int = 0
    layoutRows: int = 0
    layoutCols: int = 0
    filmSize: str = ""
    filmOrientation: str = ""
    artifactPaths: list[str] = field(default_factory=list)
    artifactFormat: str = ""
    captureStatus: str = "pending"  # pending | captured | failed
    physicalPrintStatus: str = "skipped"  # skipped | pending | printed | failed
    captureError: str = ""
    physicalPrintError: str = ""
    patientId: str = ""
    patientName: str = ""
    accessionNumber: str = ""
    studyInstanceUID: str = ""
    modality: str = ""
    pages: int = 0
    copies: int = 1
    identityAudit: list[dict[str, Any]] = field(default_factory=list)
    identitySummary: dict[str, Any] = field(default_factory=dict)
    unsupportedAttributes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _jobs_dir() -> Path:
    output = Path(config_store.get("OUTPUT_DIR"))
    jobs = output / "jobs"
    jobs.mkdir(parents=True, exist_ok=True)
    return jobs


def _index_path() -> Path:
    return _jobs_dir() / "index.json"


def _safe_job_key(job_key: str) -> str:
    return re.sub(r"[^A-Za-z0-9._:-]", "_", job_key)[:120]


def load_index() -> None:
    global _INDEX
    path = _index_path()
    if not path.exists():
        _INDEX = {}
        return
    if not path.exists():
        _INDEX = {}
        return
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        _INDEX = raw if isinstance(raw, dict) else {}
    except (OSError, json.JSONDecodeError):
        _INDEX = {}


def _save_index() -> None:
    path = _index_path()
    path.write_text(json.dumps(_INDEX, indent=2) + "\n", encoding="utf-8")


def create_job(job: ElectronicFilmJob) -> ElectronicFilmJob:
    with _LOCK:
        load_index()
        now = datetime.now().isoformat()
        if not job.receivedAt:
            job.receivedAt = now
        key = _safe_job_key(job.jobKey)
        job.jobKey = key
        data = job.to_dict()
        _INDEX[key] = data
        job_path = _jobs_dir() / f"{key}.json"
        job_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        _save_index()
        return job


def update_job(job_key: str, **fields: Any) -> Optional[dict[str, Any]]:
    with _LOCK:
        load_index()
        key = _safe_job_key(job_key)
        record = _INDEX.get(key)
        if record is None:
            return None
        record.update(fields)
        if fields.get("captureStatus") == "captured" or fields.get("physicalPrintStatus") == "printed":
            record["completedAt"] = datetime.now().isoformat()
        _INDEX[key] = record
        job_path = _jobs_dir() / f"{key}.json"
        job_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        _save_index()
        return record


def get_job(job_key: str) -> Optional[dict[str, Any]]:
    with _LOCK:
        load_index()
        return _INDEX.get(_safe_job_key(job_key))


def list_jobs(limit: int = 100, source: Optional[str] = None) -> list[dict[str, Any]]:
    with _LOCK:
        load_index()
        rows = list(_INDEX.values())
        if source:
            rows = [r for r in rows if r.get("source") == source]
        rows.sort(key=lambda r: r.get("receivedAt", ""), reverse=True)
        return rows[:limit]


def storage_stats() -> dict[str, Any]:
    output = Path(config_store.get("OUTPUT_DIR"))
    jobs_dir = output / "jobs"
    artifact_files = []
    if output.exists():
        for pattern in ("*.pdf", "*.png"):
            artifact_files.extend(output.glob(pattern))
    total_bytes = sum(p.stat().st_size for p in artifact_files if p.is_file())
    oldest = min(artifact_files, key=lambda p: p.stat().st_mtime) if artifact_files else None
    newest = max(artifact_files, key=lambda p: p.stat().st_mtime) if artifact_files else None
    return {
        "outputDir": str(output),
        "writable": output.exists() and os.access(output, os.W_OK),
        "jobCount": len(_INDEX),
        "artifactCount": len(artifact_files),
        "diskUsageBytes": total_bytes,
        "oldestArtifact": oldest.name if oldest else None,
        "newestArtifact": newest.name if newest else None,
    }



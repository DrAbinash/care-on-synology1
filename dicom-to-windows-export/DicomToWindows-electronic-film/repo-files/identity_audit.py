"""PHI-safe Electronic Film identity audit for DICOM Print datasets."""
from __future__ import annotations

import re
from typing import Any, Optional

from pydicom.dataset import Dataset

AUDIT_TAGS = [
    ("PatientID", (0x0010, 0x0020)),
    ("PatientName", (0x0010, 0x0010)),
    ("AccessionNumber", (0x0008, 0x0050)),
    ("StudyInstanceUID", (0x0020, 0x000D)),
    ("SeriesInstanceUID", (0x0020, 0x000E)),
    ("SOPInstanceUID", (0x0008, 0x0018)),
    ("StudyID", (0x0020, 0x0010)),
    ("RequestedProcedureID", (0x0040, 0x1001)),
    ("Modality", (0x0008, 0x0060)),
    ("StudyDate", (0x0008, 0x0020)),
]


def _redact_value(tag_name: str, value: Any) -> str:
    text = str(value).strip()
    if not text:
        return ""
    if tag_name.endswith("UID"):
        if len(text) <= 8:
            return text[:2] + "…"
        return text[:6] + "…" + text[-4:]
    if tag_name == "PatientName":
        parts = text.replace("^", " ").split()
        if not parts:
            return "…"
        return parts[0][:1] + "…" if len(parts[0]) > 1 else parts[0]
    if tag_name == "PatientID":
        if len(text) <= 3:
            return "…"
        return text[:2] + "…" + text[-1:]
    if tag_name == "StudyDate" and re.fullmatch(r"\d{8}", text):
        return text[:4] + "…"
    if len(text) <= 4:
        return text
    return text[:2] + "…" + text[-2:]


def _tag_present(ds: Optional[Dataset], tag_name: str, tag_tuple: tuple[int, int]) -> tuple[bool, str]:
    if ds is None:
        return False, ""
    value = ds.get(tag_tuple)
    if value is None or str(value).strip() == "":
        # pydicom attribute access fallback
        value = getattr(ds, tag_name, None)
    if value is None or str(value).strip() == "":
        return False, ""
    return True, _redact_value(tag_name, value)


def audit_dataset(ds: Optional[Dataset], source: str) -> list[dict[str, Any]]:
    rows = []
    for tag_name, tag_tuple in AUDIT_TAGS:
        present, redacted = _tag_present(ds, tag_name, tag_tuple)
        rows.append({
            "tag": tag_name,
            "present": present,
            "source": source if present else "",
            "value": redacted if present else "",
        })
    return rows


def audit_film_session(attrs: Dataset, calling_ae: str = "") -> dict[str, Any]:
    return {
        "level": "FilmSession",
        "callingAE": calling_ae or "",
        "tags": audit_dataset(attrs, "FilmSession AttributeList"),
    }


def audit_film_box(attrs: Dataset) -> dict[str, Any]:
    return {
        "level": "FilmBox",
        "tags": audit_dataset(attrs, "FilmBox AttributeList"),
    }


def audit_image_box(mods: Dataset, seq_item: Optional[Dataset] = None) -> dict[str, Any]:
    mods_tags = audit_dataset(mods, "ImageBox ModificationList")
    seq_tags = audit_dataset(seq_item, "ImageSequence Item") if seq_item else []
    merged = {row["tag"]: row for row in mods_tags}
    for row in seq_tags:
        if row["present"]:
            merged[row["tag"]] = row
    return {
        "level": "ImageBox",
        "tags": [merged.get(tag_name, {
            "tag": tag_name, "present": False, "source": "", "value": "",
        }) for tag_name, _ in AUDIT_TAGS],
    }


def summarize_identity(audits: list[dict[str, Any]]) -> dict[str, Any]:
    """Extract best available deterministic match keys without fabricating."""
    found: dict[str, str] = {}
    for audit in audits:
        for row in audit.get("tags", []):
            if not row.get("present"):
                continue
            tag = row["tag"]
            if tag in ("StudyInstanceUID", "AccessionNumber", "PatientID", "PatientName"):
                found.setdefault(tag, row.get("value", ""))
    study_uid_present = "StudyInstanceUID" in found
    accession_present = "AccessionNumber" in found
    patient_id_present = "PatientID" in found
    auto_match_key = None
    if study_uid_present:
        auto_match_key = "StudyInstanceUID"
    elif accession_present:
        auto_match_key = "AccessionNumber"
    return {
        "studyInstanceUIDPresent": study_uid_present,
        "accessionNumberPresent": accession_present,
        "patientIdPresent": patient_id_present,
        "patientNamePresent": "PatientName" in found,
        "recommendedAutoMatchKey": auto_match_key,
        "wouldAutoMatch": auto_match_key is not None,
        "status": "MATCHABLE" if auto_match_key else "UNMATCHED",
    }

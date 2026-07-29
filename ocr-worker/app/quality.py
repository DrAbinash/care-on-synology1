"""OCR quality scoring and fallback decisions."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class QualityAssessment:
    mean_confidence: float
    low_confidence_line_ratio: float
    text_char_count: int
    missing_keywords: list[str]
    is_low_quality: bool
    reasons: list[str]


def assess_quality(
    *,
    mean_confidence: float,
    line_confidences: list[float],
    text: str,
    low_confidence_threshold: float = 0.80,
    very_low_line_threshold: float = 0.55,
    min_chars: int = 12,
    expected_keywords: list[str] | None = None,
) -> QualityAssessment:
    reasons: list[str] = []
    n = len(line_confidences)
    low_ratio = (
        sum(1 for c in line_confidences if c < very_low_line_threshold) / n if n else 1.0
    )
    text_stripped = (text or "").strip()
    char_count = len(text_stripped)

    if mean_confidence < low_confidence_threshold:
        reasons.append(f"mean_confidence<{low_confidence_threshold:.2f}")
    if n > 0 and low_ratio >= 0.35:
        reasons.append("high_low_confidence_line_ratio")
    if char_count < min_chars:
        reasons.append("suspiciously_small_text")

    missing: list[str] = []
    if expected_keywords:
        lower = text_stripped.lower()
        for kw in expected_keywords:
            if kw and kw.lower() not in lower:
                missing.append(kw)
        if missing:
            reasons.append("missing_expected_keywords")

    is_low = bool(reasons)
    return QualityAssessment(
        mean_confidence=mean_confidence,
        low_confidence_line_ratio=low_ratio,
        text_char_count=char_count,
        missing_keywords=missing,
        is_low_quality=is_low,
        reasons=reasons,
    )
"""Unit tests for OCR quality scoring (no Paddle dependency)."""

from __future__ import annotations

import unittest

from app.quality import assess_quality


class QualityTests(unittest.TestCase):
    def test_low_confidence(self) -> None:
        q = assess_quality(
            mean_confidence=0.5,
            line_confidences=[0.4, 0.5, 0.55],
            text="plenty of characters for the threshold",
            low_confidence_threshold=0.8,
        )
        self.assertTrue(q.is_low_quality)
        self.assertTrue(any("mean_confidence" in r for r in q.reasons))

    def test_empty_text(self) -> None:
        q = assess_quality(mean_confidence=0.99, line_confidences=[], text="")
        self.assertTrue(q.is_low_quality)
        self.assertIn("suspiciously_small_text", q.reasons)

    def test_missing_keywords(self) -> None:
        q = assess_quality(
            mean_confidence=0.95,
            line_confidences=[0.95, 0.96],
            text="hello world document text here",
            expected_keywords=["findings", "impression"],
        )
        self.assertTrue(q.is_low_quality)
        self.assertEqual(q.missing_keywords, ["findings", "impression"])

    def test_good_quality(self) -> None:
        q = assess_quality(
            mean_confidence=0.91,
            line_confidences=[0.9, 0.92, 0.93],
            text="Findings: normal. Impression: normal study.",
            expected_keywords=["Findings", "Impression"],
        )
        self.assertFalse(q.is_low_quality)


if __name__ == "__main__":
    unittest.main()

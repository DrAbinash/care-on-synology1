"""Tests for DicomToWindows electronic film enhancements."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

import numpy as np

import config_store
import identity_audit
import image_profiles
import job_store
import admin_auth
from pydicom.dataset import Dataset


class ConfigStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        config_store.CONFIG_DIR = Path(self.tmp.name)
        config_store.CONFIG_FILE = config_store.CONFIG_DIR / "config.json"
        config_store.load()

    def tearDown(self):
        self.tmp.cleanup()

    def test_env_precedence(self):
        os.environ["GAMMA"] = "3.1"
        config_store.update({"GAMMA": 1.5})
        self.assertEqual(config_store.get_source("GAMMA"), "ENV")
        self.assertEqual(float(config_store.get("GAMMA")), 3.1)
        del os.environ["GAMMA"]

    def test_persisted_when_env_missing(self):
        key = "HTTP_PORT"
        os.environ.pop(key, None)
        config_store.update({key: 8091})
        self.assertEqual(config_store.get_source(key), "CONFIG")
        self.assertEqual(int(config_store.get(key)), 8091)

    def test_ae_validation(self):
        self.assertEqual(config_store.validate_ae_title("PRINTSCP"), "PRINTSCP")
        with self.assertRaises(ValueError):
            config_store.validate_ae_title("bad-ae!")

    def test_port_validation(self):
        self.assertEqual(config_store.validate_port(104), 104)
        with self.assertRaises(ValueError):
            config_store.validate_port(70000)

    def test_unsafe_path_rejection(self):
        base = Path(self.tmp.name)
        with self.assertRaises(ValueError):
            config_store.validate_safe_path("/etc/passwd", base)


class IdentityAuditTests(unittest.TestCase):
    def test_summarize_matchable_by_study_uid(self):
        ds = Dataset()
        ds.StudyInstanceUID = "1.2.3.4.5"
        audit = identity_audit.audit_film_session(ds, "MRI_SCU")
        summary = identity_audit.summarize_identity([audit])
        self.assertTrue(summary["studyInstanceUIDPresent"])
        self.assertEqual(summary["recommendedAutoMatchKey"], "StudyInstanceUID")
        self.assertEqual(summary["status"], "MATCHABLE")

    def test_unmatched_without_deterministic_key(self):
        ds = Dataset()
        ds.PatientName = "TEST^PATIENT"
        audit = identity_audit.audit_film_session(ds, "MRI_SCU")
        summary = identity_audit.summarize_identity([audit])
        self.assertFalse(summary["wouldAutoMatch"])


class ImageProfileTests(unittest.TestCase):
    def test_calibrate_and_preview(self):
        arr = np.linspace(0, 255, 256, dtype=np.uint8).reshape(16, 16)
        out = image_profiles.calibrate_frame(arr, False, modality="MRI")
        self.assertEqual(out.shape, arr.shape)
        preview = image_profiles.synthetic_grayscale_preview(128, 64)
        self.assertEqual(preview.shape, (64, 128))


class JobStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        config_store.CONFIG_DIR = Path(self.tmp.name)
        config_store.CONFIG_FILE = config_store.CONFIG_DIR / "config.json"
        if "OUTPUT_DIR" in os.environ:
            del os.environ["OUTPUT_DIR"]
        config_store._persisted["OUTPUT_DIR"] = str(Path(self.tmp.name) / "out")
        job_store.load_index()

    def tearDown(self):
        self.tmp.cleanup()

    def test_create_and_list_jobs(self):
        from job_store import ElectronicFilmJob
        job = ElectronicFilmJob(jobKey="test-job", source="DICOM", imageCount=2, captureStatus="captured")
        job_store.create_job(job)
        rows = job_store.list_jobs()
        self.assertTrue(any(r["jobKey"] == "test-job" for r in rows))


class AdminAuthTests(unittest.TestCase):
    def test_password_hash_roundtrip(self):
        hashed = admin_auth._hash_password("testpassword123")
        self.assertTrue(admin_auth.verify_password("testpassword123", hashed))
        self.assertFalse(admin_auth.verify_password("wrong", hashed))


if __name__ == "__main__":
    unittest.main()

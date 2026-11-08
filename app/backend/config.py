from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

_projects_env = os.environ.get("SCRIBE_PROJECTS")
PROJECTS_DIR = (ROOT / _projects_env).resolve() if _projects_env else (ROOT / "projects").resolve()
SETTINGS_DIR = ROOT / "app" / "settings"
SETTINGS_PATH = SETTINGS_DIR / "inference.json"
MODELS_ROOT = ROOT / "app" / "models"

# LightOnOCR packs (Pinokio fs.link targets)
LIGHTON_OCR_DIR = MODELS_ROOT / "lightonocr-2-1b"
LIGHTON_BBOX_DIR = MODELS_ROOT / "lightonocr-2-1b-bbox"
LIGHTON_BASE_DIR = MODELS_ROOT / "lightonocr-2-1b-base"
LIGHTON_BBOX_BASE_DIR = MODELS_ROOT / "lightonocr-2-1b-bbox-base"
LIGHTON_SOUP_DIR = MODELS_ROOT / "lightonocr-2-1b-ocr-soup"
LIGHTON_BBOX_SOUP_DIR = MODELS_ROOT / "lightonocr-2-1b-bbox-soup"

LIGHTON_OCR_MARKER = LIGHTON_OCR_DIR / "config.json"
LIGHTON_BBOX_MARKER = LIGHTON_BBOX_DIR / "config.json"
LIGHTON_BASE_MARKER = LIGHTON_BASE_DIR / "config.json"
LIGHTON_BBOX_BASE_MARKER = LIGHTON_BBOX_BASE_DIR / "config.json"
LIGHTON_SOUP_MARKER = LIGHTON_SOUP_DIR / "config.json"
LIGHTON_BBOX_SOUP_MARKER = LIGHTON_BBOX_SOUP_DIR / "config.json"

LIGHTON_OCR_REPO = "lightonai/LightOnOCR-2-1B"
LIGHTON_BBOX_REPO = "lightonai/LightOnOCR-2-1B-bbox"
LIGHTON_BASE_REPO = "lightonai/LightOnOCR-2-1B-base"
LIGHTON_BBOX_BASE_REPO = "lightonai/LightOnOCR-2-1B-bbox-base"
LIGHTON_SOUP_REPO = "lightonai/LightOnOCR-2-1B-ocr-soup"
LIGHTON_BBOX_SOUP_REPO = "lightonai/LightOnOCR-2-1B-bbox-soup"

DEFAULT_OCR_PACK_ID = "lightonocr-2-1b"

PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
MODELS_ROOT.mkdir(parents=True, exist_ok=True)

from __future__ import annotations

import json
from typing import Any

from config import DEFAULT_OCR_PACK_ID, SETTINGS_PATH


DEFAULTS = {
    "ocr_pack_id": DEFAULT_OCR_PACK_ID,
    "temperature": 0.2,
    "max_output_tokens": 2048,
    "page_separator": "\n\n---\n\n",
}


def load_settings() -> dict[str, Any]:
    if not SETTINGS_PATH.exists():
        return dict(DEFAULTS)
    try:
        data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        out = dict(DEFAULTS)
        out.update({k: v for k, v in data.items() if k in DEFAULTS})
        return out
    except Exception:
        return dict(DEFAULTS)


def save_settings(payload: dict[str, Any]) -> dict[str, Any]:
    current = load_settings()
    for key in DEFAULTS:
        if key in payload:
            current[key] = payload[key]
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(current, indent=2), encoding="utf-8")
    return current

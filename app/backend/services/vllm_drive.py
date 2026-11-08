"""Keep env-vllm on a Pinokio drive, linked into the app like the OCR models.

The drive key is ``vllm/env-vllm``. Another program shares the runtime by
linking that same key. The app folder only holds the junction.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import stat
import subprocess
import time
from pathlib import Path

from config import ROOT

logger = logging.getLogger("scribe.vllm.drive")

DRIVE_KEY = Path("vllm") / "env-vllm"
LOCAL = ROOT / "env-vllm"


def _is_reparse(path: Path) -> bool:
    try:
        attrs = os.lstat(path).st_file_attributes
    except (AttributeError, OSError):
        return path.is_symlink()
    return bool(attrs & stat.FILE_ATTRIBUTE_REPARSE_POINT)


def _pinokio_home() -> Path | None:
    cfg = Path.home() / ".pinokio" / "config.json"
    try:
        data = json.loads(cfg.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    home = str(data.get("home") or "").strip()
    if not home:
        return None
    path = Path(home)
    return path if path.is_dir() else None


def _peers_dir() -> Path | None:
    home = _pinokio_home()
    if home is None:
        return None
    peers = home / "drive" / "drives" / "peers"
    return peers if peers.is_dir() else None


def _runtime_present(path: Path) -> bool:
    return (path / "Scripts" / "vllm.exe").is_file() or (path / "bin" / "vllm").is_file()


def _find_shared() -> Path | None:
    peers = _peers_dir()
    if peers is None:
        return None
    found: list[Path] = []
    try:
        peers_iter = list(peers.iterdir())
    except OSError:
        return None
    for peer in peers_iter:
        candidate = peer / DRIVE_KEY
        if candidate.is_dir():
            found.append(candidate)
    if not found:
        return None
    for candidate in found:
        if _runtime_present(candidate):
            return candidate
    return found[0]


def _new_shared() -> Path | None:
    peers = _peers_dir()
    if peers is None:
        return None
    peer = peers / f"d{int(time.time() * 1000)}"
    target = peer / DRIVE_KEY
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


def _link(local: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(local), str(target)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()
            raise RuntimeError(f"Could not link env-vllm to the Pinokio drive: {detail}")
        return
    local.symlink_to(target, target_is_directory=True)


def _remove_real_dir(path: Path) -> None:
    """Delete a real directory. Refuse to follow a junction."""
    if _is_reparse(path):
        raise RuntimeError(f"Refusing to delete a linked directory: {path}")
    shutil.rmtree(path)


def ensure_linked() -> Path:
    """Point env-vllm at the shared drive, moving a local copy onto it."""
    if _is_reparse(LOCAL):
        return LOCAL
    shared = _find_shared()
    if shared is None:
        shared = _new_shared()
    if shared is None:
        logger.info("Pinokio drive is not available; env-vllm stays in the app folder.")
        return LOCAL

    local_exists = LOCAL.exists()
    if local_exists and not _is_reparse(LOCAL):
        shared_has_files = shared.exists() and any(shared.iterdir())
        if shared_has_files and _runtime_present(shared):
            _remove_real_dir(LOCAL)
        elif shared_has_files:
            raise RuntimeError(
                f"{shared} already has files, and {LOCAL} is a separate copy. "
                "Move one of them aside before installing vLLM."
            )
        else:
            if shared.exists():
                shared.rmdir()
            shared.parent.mkdir(parents=True, exist_ok=True)
            os.rename(LOCAL, shared)
            logger.info("Moved env-vllm onto the Pinokio drive at %s", shared)
    if not LOCAL.exists():
        _link(LOCAL, shared)
        logger.info("Linked %s -> %s", LOCAL, shared)
    return LOCAL


def clear_runtime() -> None:
    """Remove the runtime files. Keep a Pinokio junction so the drive link stays."""
    if not LOCAL.exists() and not _is_reparse(LOCAL):
        return
    if _is_reparse(LOCAL):
        for child in list(LOCAL.iterdir()):
            if _is_reparse(child):
                if os.name == "nt":
                    subprocess.run(["cmd", "/c", "rmdir", str(child)], check=False, capture_output=True)
                else:
                    child.unlink()
            elif child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
        return
    _remove_real_dir(LOCAL)

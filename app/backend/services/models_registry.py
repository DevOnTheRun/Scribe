from __future__ import annotations

import os
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from config import (
    DEFAULT_OCR_PACK_ID,
    LIGHTON_BASE_DIR,
    LIGHTON_BASE_MARKER,
    LIGHTON_BASE_REPO,
    LIGHTON_BBOX_BASE_DIR,
    LIGHTON_BBOX_BASE_MARKER,
    LIGHTON_BBOX_BASE_REPO,
    LIGHTON_BBOX_DIR,
    LIGHTON_BBOX_MARKER,
    LIGHTON_BBOX_REPO,
    LIGHTON_BBOX_SOUP_DIR,
    LIGHTON_BBOX_SOUP_MARKER,
    LIGHTON_BBOX_SOUP_REPO,
    LIGHTON_OCR_DIR,
    LIGHTON_OCR_MARKER,
    LIGHTON_OCR_REPO,
    LIGHTON_SOUP_DIR,
    LIGHTON_SOUP_MARKER,
    LIGHTON_SOUP_REPO,
)

_jobs: dict[str, "ModelJob"] = {}
_jobs_lock = threading.Lock()


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class ModelJob:
    id: str
    pack_id: str
    action: str
    status: str = "queued"
    message: str = ""
    error: str | None = None
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "pack_id": self.pack_id,
            "action": self.action,
            "status": self.status,
            "message": self.message,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


@dataclass(frozen=True)
class ModelPack:
    id: str
    label: str
    kind: str
    description: str
    size_hint: str
    drive_key: str
    local_dir: Path
    marker: Path
    repo_id: str
    recommended: bool = False


PACKS: dict[str, ModelPack] = {
    "lightonocr-2-1b": ModelPack(
        id="lightonocr-2-1b",
        label="LightOnOCR-2-1B (Best OCR)",
        kind="essential",
        description="Recommended: best overall PDF/page OCR to Markdown.",
        size_hint="~2 GB",
        drive_key="lighton/lightonocr-2-1b",
        local_dir=LIGHTON_OCR_DIR,
        marker=LIGHTON_OCR_MARKER,
        repo_id=LIGHTON_OCR_REPO,
        recommended=True,
    ),
    "lightonocr-2-1b-bbox": ModelPack(
        id="lightonocr-2-1b-bbox",
        label="LightOnOCR-2-1B-bbox",
        kind="optional",
        description="OCR with bounding-box crops embedded in Markdown.",
        size_hint="~2 GB",
        drive_key="lighton/lightonocr-2-1b-bbox",
        local_dir=LIGHTON_BBOX_DIR,
        marker=LIGHTON_BBOX_MARKER,
        repo_id=LIGHTON_BBOX_REPO,
    ),
    "lightonocr-2-1b-base": ModelPack(
        id="lightonocr-2-1b-base",
        label="LightOnOCR-2-1B-base",
        kind="optional",
        description="Base OCR variant.",
        size_hint="~2 GB",
        drive_key="lighton/lightonocr-2-1b-base",
        local_dir=LIGHTON_BASE_DIR,
        marker=LIGHTON_BASE_MARKER,
        repo_id=LIGHTON_BASE_REPO,
    ),
    "lightonocr-2-1b-bbox-base": ModelPack(
        id="lightonocr-2-1b-bbox-base",
        label="LightOnOCR-2-1B-bbox-base",
        kind="optional",
        description="Base bbox variant.",
        size_hint="~2 GB",
        drive_key="lighton/lightonocr-2-1b-bbox-base",
        local_dir=LIGHTON_BBOX_BASE_DIR,
        marker=LIGHTON_BBOX_BASE_MARKER,
        repo_id=LIGHTON_BBOX_BASE_REPO,
    ),
    "lightonocr-2-1b-ocr-soup": ModelPack(
        id="lightonocr-2-1b-ocr-soup",
        label="LightOnOCR-2-1B-ocr-soup",
        kind="optional",
        description="OCR soup variant.",
        size_hint="~2 GB",
        drive_key="lighton/lightonocr-2-1b-ocr-soup",
        local_dir=LIGHTON_SOUP_DIR,
        marker=LIGHTON_SOUP_MARKER,
        repo_id=LIGHTON_SOUP_REPO,
    ),
    "lightonocr-2-1b-bbox-soup": ModelPack(
        id="lightonocr-2-1b-bbox-soup",
        label="LightOnOCR-2-1B-bbox-soup",
        kind="optional",
        description="Bbox soup variant.",
        size_hint="~2 GB",
        drive_key="lighton/lightonocr-2-1b-bbox-soup",
        local_dir=LIGHTON_BBOX_SOUP_DIR,
        marker=LIGHTON_BBOX_SOUP_MARKER,
        repo_id=LIGHTON_BBOX_SOUP_REPO,
    ),
}


def _dir_has_weights(path: Path) -> bool:
    if not path.is_dir():
        return False
    for pattern in ("*.safetensors", "*.bin", "*.pt", "*.pth"):
        if any(path.glob(pattern)) or any(path.rglob(pattern)):
            return True
    return False


def _pack_installed(pack: ModelPack) -> bool:
    return pack.marker.exists() or _dir_has_weights(pack.local_dir)


def catalog() -> list[dict[str, Any]]:
    rows = []
    for pack in PACKS.values():
        rows.append(
            {
                "id": pack.id,
                "label": pack.label,
                "kind": pack.kind,
                "description": pack.description,
                "size_hint": pack.size_hint,
                "drive_key": pack.drive_key,
                "repo_id": pack.repo_id,
                "recommended": pack.recommended,
                "installed": _pack_installed(pack),
            }
        )
    return rows


def status() -> dict[str, Any]:
    packs = catalog()
    essential = [p for p in packs if p["kind"] == "essential"]
    ready = all(p["installed"] for p in essential) if essential else any(p["installed"] for p in packs)
    return {
        "ready": ready,
        "default_pack_id": DEFAULT_OCR_PACK_ID,
        "installed_count": sum(1 for p in packs if p["installed"]),
        "packs": packs,
    }


def get_model_job(job_id: str) -> ModelJob | None:
    with _jobs_lock:
        return _jobs.get(job_id)


def require_ocr(pack_id: str | None = None) -> ModelPack:
    pid = pack_id or DEFAULT_OCR_PACK_ID
    pack = PACKS.get(pid)
    if pack is None:
        raise ValueError(f"Unknown OCR pack: {pid}")
    if not _pack_installed(pack):
        raise FileNotFoundError(
            f"OCR model '{pack.label}' is not installed. Open Settings → Models to download it."
        )
    return pack


def validate_ocr_pack_id(pack_id: str) -> str:
    if pack_id not in PACKS:
        raise ValueError(f"Unknown OCR pack: {pack_id}")
    return pack_id


def _hf_token() -> str | None:
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")


def _format_bytes(num: float) -> str:
    value = float(max(0.0, num))
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024.0 or unit == "TB":
            if unit == "B":
                return f"{int(value)} B"
            return f"{value:.1f} {unit}"
        value /= 1024.0
    return f"{int(num)} B"


class _ByteProgress:
    """Emit `Downloading label: N% (X / Y)` byte messages for the UI."""

    def __init__(self, on_line: Callable[[str], None] | None, total: int, label: str = "pack") -> None:
        self._on_line = on_line
        self.total = max(0, int(total))
        self.done = 0.0
        self.label = label
        self._last_report_at = 0.0
        self._lock = threading.Lock()

    def set_done(self, n: float) -> None:
        with self._lock:
            self.done = max(0.0, float(n or 0))
        self.emit()

    def emit(self, force: bool = False) -> None:
        if not self._on_line:
            return
        with self._lock:
            done = self.done
            total = self.total
        now = time.time()
        finished = total > 0 and done >= total
        if not force and not finished and (now - self._last_report_at) < 0.25:
            return
        self._last_report_at = now
        if total > 0:
            capped = min(done, float(total))
            pct = int(min(100, (capped / float(total)) * 100.0))
            self._on_line(
                f"Downloading {self.label}: "
                f"{pct}% ({_format_bytes(capped)} / {_format_bytes(total)})"
            )
        else:
            self._on_line("Starting…")


def _incomplete_bytes(local_dir: Path) -> int:
    cache = local_dir / ".cache" / "huggingface" / "download"
    if not cache.is_dir():
        return 0
    total = 0
    for path in cache.rglob("*.incomplete"):
        try:
            total += path.stat().st_size
        except OSError:
            continue
    return total


def _finished_file_bytes(local_dir: Path, files: list[tuple[str, int]]) -> int:
    total = 0
    for rel, expected in files:
        dest = local_dir / rel
        if not dest.is_file():
            continue
        try:
            size = dest.stat().st_size
        except OSError:
            continue
        total += min(size, expected) if expected > 0 else size
    return total


def _pack_bytes_on_disk(local_dir: Path, files: list[tuple[str, int]]) -> int:
    finished = _finished_file_bytes(local_dir, files)
    partial = _incomplete_bytes(local_dir)
    expected = sum(max(0, size) for _, size in files)
    done = finished + partial
    return int(min(done, expected)) if expected > 0 else int(done)


def _repo_file_sizes(repo_id: str) -> list[tuple[str, int]]:
    from huggingface_hub import HfApi

    api = HfApi(token=_hf_token())
    filenames = list(api.list_repo_files(repo_id=repo_id, token=_hf_token()))
    infos = api.get_paths_info(repo_id, filenames, repo_type="model")
    rows: list[tuple[str, int]] = []
    for info in infos:
        path = getattr(info, "path", None) or getattr(info, "rfilename", None)
        if not path:
            continue
        size = int(getattr(info, "size", None) or 0)
        rows.append((str(path), size))
    return rows


def _download_hf_files(
    *,
    repo_id: str,
    local_dir: Path,
    files: list[tuple[str, int]],
    on_line: Callable[[str], None] | None,
    label: str,
) -> None:
    from huggingface_hub import hf_hub_download

    try:
        from huggingface_hub.utils.tqdm import tqdm as _HfTqdm
    except ImportError:
        try:
            from tqdm.auto import tqdm as _HfTqdm
        except ImportError:
            from tqdm import tqdm as _HfTqdm  # type: ignore

    local_dir.mkdir(parents=True, exist_ok=True)
    total = sum(size for _, size in files)
    progress = _ByteProgress(on_line, total=total, label=label)
    callback_done = {"n": 0.0}
    callback_lock = threading.Lock()

    class _FileTqdm(_HfTqdm):
        def __init__(self, *args, **kwargs):
            self._file_done = float(kwargs.get("initial") or 0)
            kwargs.setdefault("disable", True)
            super().__init__(*args, **kwargs)

        def update(self, n: float | int = 1):
            try:
                inc = float(n or 0)
            except (TypeError, ValueError):
                inc = 0.0
            self._file_done = max(0.0, self._file_done + inc)
            with callback_lock:
                callback_done["n"] = max(callback_done["n"], self._file_done)
            disk = _pack_bytes_on_disk(local_dir, files)
            with callback_lock:
                finished = _finished_file_bytes(local_dir, files)
                live = finished + callback_done["n"]
                progress.set_done(max(disk, live))
            return super().update(n)

    progress.set_done(_pack_bytes_on_disk(local_dir, files))
    progress.emit(force=True)

    stop = threading.Event()

    def _poll_disk() -> None:
        while not stop.wait(0.25):
            disk = _pack_bytes_on_disk(local_dir, files)
            with callback_lock:
                finished = _finished_file_bytes(local_dir, files)
                live = finished + callback_done["n"]
            progress.set_done(max(disk, live))

    poller = threading.Thread(target=_poll_disk, daemon=True, name=f"hf-progress-{label}")
    poller.start()
    try:
        for path, _size in files:
            with callback_lock:
                callback_done["n"] = 0.0
            try:
                hf_hub_download(
                    repo_id=repo_id,
                    filename=path,
                    local_dir=str(local_dir),
                    token=_hf_token(),
                    tqdm_class=_FileTqdm,
                )
            except TypeError:
                hf_hub_download(
                    repo_id=repo_id,
                    filename=path,
                    local_dir=str(local_dir),
                    token=_hf_token(),
                )
            with callback_lock:
                callback_done["n"] = 0.0
            progress.set_done(_pack_bytes_on_disk(local_dir, files))
    finally:
        stop.set()
        poller.join(timeout=2.0)

    if total > 0:
        progress.set_done(total)
    else:
        progress.set_done(_pack_bytes_on_disk(local_dir, files))
    progress.emit(force=True)


def _download_pack(pack: ModelPack, job: ModelJob) -> None:
    def on_line(line: str) -> None:
        job.message = line[:500]
        job.updated_at = _utc_now()

    on_line("Starting…")
    files = _repo_file_sizes(pack.repo_id)
    if not files:
        raise RuntimeError(f"No files listed for {pack.repo_id}")
    label = pack.repo_id.rsplit("/", 1)[-1] or pack.id
    _download_hf_files(
        repo_id=pack.repo_id,
        local_dir=pack.local_dir,
        files=files,
        on_line=on_line,
        label=label,
    )
    job.message = "Ready"
    job.updated_at = _utc_now()


def _uninstall_pack(pack: ModelPack, job: ModelJob) -> None:
    job.message = "Removing…"
    job.updated_at = _utc_now()
    if pack.local_dir.exists():
        shutil.rmtree(pack.local_dir, ignore_errors=True)
    pack.local_dir.mkdir(parents=True, exist_ok=True)
    job.message = "Removed"
    job.updated_at = _utc_now()


def start_model_job(pack_id: str, action: str) -> ModelJob:
    pack = PACKS.get(pack_id)
    if pack is None:
        raise ValueError(f"Unknown pack: {pack_id}")
    if action not in {"install", "uninstall"}:
        raise ValueError(f"Unknown action: {action}")

    job = ModelJob(id=uuid.uuid4().hex[:12], pack_id=pack_id, action=action)

    def run() -> None:
        job.status = "running"
        job.updated_at = _utc_now()
        try:
            if action == "install":
                if _pack_installed(pack):
                    job.message = "Already installed"
                else:
                    _download_pack(pack, job)
            else:
                _uninstall_pack(pack, job)
            job.status = "done"
        except Exception as exc:
            job.status = "error"
            job.error = str(exc)
            job.message = str(exc)
        finally:
            job.updated_at = _utc_now()

    with _jobs_lock:
        _jobs[job.id] = job
    threading.Thread(target=run, daemon=True, name=f"scribe-model-{job.id}").start()
    return job

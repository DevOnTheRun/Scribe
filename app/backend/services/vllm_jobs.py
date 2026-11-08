"""Install and remove the optional env-vllm runtime from the Models tab."""

from __future__ import annotations

import logging
import shutil
import subprocess
import sys
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from config import DEFAULT_OCR_PACK_ID, ROOT
from services import ocr as ocr_engine
from services.settings_store import load_settings
from services.vllm_supervisor import (
    VllmUnavailable,
    ensure_started,
    gpu_block_reason,
    runtime_installed,
    server_running,
    stop_server,
    vllm_executable,
)

logger = logging.getLogger("scribe.vllm.jobs")

_jobs_lock = threading.Lock()
_jobs: dict[str, "VllmJob"] = {}
_active_job_id: str | None = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class VllmJob:
    id: str
    action: str
    status: str = "queued"
    message: str = ""
    error: str | None = None
    updated_at: str = ""

    def __post_init__(self) -> None:
        if not self.updated_at:
            self.updated_at = _utc_now()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "action": self.action,
            "status": self.status,
            "message": self.message,
            "error": self.error,
            "updated_at": self.updated_at,
        }


def _note(job: VllmJob, message: str) -> None:
    text = " ".join(message.split())
    if not text:
        return
    job.message = text[:500]
    job.updated_at = _utc_now()


def status() -> dict:
    platform = sys.platform
    supported = platform in {"win32", "linux"}
    blocked = gpu_block_reason()
    available = supported and blocked is None
    reason = None
    if not supported:
        reason = (
            "vLLM has no build for this operating system. "
            "OCR uses Transformers."
        )
    elif blocked:
        reason = blocked
    return {
        "available": available,
        "installed": runtime_installed(),
        "running": server_running() if runtime_installed() else False,
        "platform": "windows" if platform == "win32" else platform,
        "reason": reason,
    }


def get_job(job_id: str) -> VllmJob | None:
    with _jobs_lock:
        return _jobs.get(job_id)


def _begin(action: str) -> VllmJob:
    global _active_job_id
    with _jobs_lock:
        if _active_job_id is not None:
            current = _jobs.get(_active_job_id)
            if current is not None and current.status in {"queued", "running"}:
                raise RuntimeError("A vLLM install or uninstall is already running.")
        job = VllmJob(id=uuid.uuid4().hex[:12], action=action)
        _jobs[job.id] = job
        _active_job_id = job.id
    threading.Thread(target=_run, args=(job,), name=f"scribe-vllm-{job.id}", daemon=True).start()
    return job


def start_install() -> VllmJob:
    info = status()
    if not info["available"]:
        raise ValueError(info["reason"] or "vLLM cannot be installed on this machine.")
    return _begin("install")


def start_uninstall() -> VllmJob:
    return _begin("uninstall")


def _finish_active(job: VllmJob) -> None:
    global _active_job_id
    with _jobs_lock:
        if _active_job_id == job.id:
            _active_job_id = None


def _run(job: VllmJob) -> None:
    job.status = "running"
    job.updated_at = _utc_now()
    try:
        if job.action == "install":
            _install(job)
        elif job.action == "uninstall":
            _uninstall(job)
        else:
            raise RuntimeError(f"Unknown action: {job.action}")
        job.status = "done"
    except Exception as exc:
        job.status = "error"
        detail = getattr(exc, "detail", None) or str(exc)
        job.error = detail
        job.message = detail[:500]
        logger.exception("vLLM %s failed", job.action)
    finally:
        job.updated_at = _utc_now()
        _finish_active(job)


def _require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise RuntimeError(
            f"{name} was not found on PATH. Start Scribe from Pinokio so its tools are available."
        )
    return path


def _stream_install(job: VllmJob, platform: str) -> None:
    node = _require_tool("node")
    _require_tool("uv")
    script = ROOT / "install-vllm.js"
    if not script.is_file():
        raise RuntimeError(f"Missing installer script: {script}")
    proc = subprocess.Popen(
        [node, str(script), platform],
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    assert proc.stdout is not None
    pending = ""
    while True:
        chunk = proc.stdout.read(512)
        if not chunk:
            break
        pending += chunk
        while True:
            cuts = [i for i in (pending.find("\r"), pending.find("\n")) if i != -1]
            if not cuts:
                break
            cut = min(cuts)
            line = pending[:cut].strip()
            pending = pending[cut + 1 :]
            if line:
                _note(job, line)
    tail = pending.strip()
    if tail:
        _note(job, tail)
    code = proc.wait()
    if code != 0:
        raise RuntimeError(job.message or f"vLLM install exited with code {code}.")


def _boot_server(job: VllmJob) -> None:
    if not runtime_installed():
        raise VllmUnavailable(
            "The installer finished but the vLLM program is still missing. "
            f"Expected {vllm_executable()}."
        )
    _note(job, "Starting the OCR engine…")
    settings = load_settings()
    pack_id = str(settings.get("ocr_pack_id") or DEFAULT_OCR_PACK_ID)
    repo = ocr_engine.MODEL_REGISTRY[pack_id]["repo_id"]
    ensure_started(ocr_engine.resolve_model_source(pack_id), served_model_name=repo)
    # Install only checks that the server can start. Free the GPU afterward;
    # Process pages starts it again when the user runs OCR.
    stop_server()
    _note(job, "Ready")


def _install(job: VllmJob) -> None:
    from services.vllm_drive import ensure_linked

    platform = "win32" if sys.platform == "win32" else "linux"
    _note(job, "Starting…")
    ensure_linked()
    if runtime_installed():
        _note(job, "Already installed")
    else:
        _stream_install(job, platform)
    _boot_server(job)


def _uninstall(job: VllmJob) -> None:
    from services.vllm_drive import clear_runtime

    _note(job, "Stopping the OCR engine…")
    stop_server()
    _note(job, "Removing…")
    clear_runtime()
    _note(job, "Removed")


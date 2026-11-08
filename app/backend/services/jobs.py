from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

_jobs: dict[str, "Job"] = {}
_jobs_lock = threading.Lock()


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class Job:
    id: str
    kind: str
    status: str = "queued"  # queued | running | done | error | cancelled
    message: str = ""
    progress: float = 0.0
    result: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    cancel_requested: bool = False
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "message": self.message,
            "progress": self.progress,
            "result": self.result,
            "error": self.error,
            "cancel_requested": self.cancel_requested,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def get_job(job_id: str) -> Job | None:
    with _jobs_lock:
        return _jobs.get(job_id)


def request_cancel(job_id: str) -> Job | None:
    """Ask a running/queued job to stop at the next cancel check."""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        if job.status in ("queued", "running"):
            job.cancel_requested = True
            job.message = "Cancelling…"
            job.updated_at = _utc_now()
        return job


def start_job(kind: str, worker: Callable[["Job"], None]) -> Job:
    job = Job(id=uuid.uuid4().hex[:12], kind=kind)

    def run() -> None:
        job.status = "running"
        job.updated_at = _utc_now()
        try:
            worker(job)
            if job.status == "running":
                if job.cancel_requested:
                    job.status = "cancelled"
                    job.message = job.message or "Cancelled"
                    job.error = None
                else:
                    job.status = "done"
                    job.progress = 1.0
        except Exception as exc:
            if job.cancel_requested or "cancelled" in str(exc).lower():
                job.status = "cancelled"
                job.message = "Cancelled"
                job.error = None
            else:
                job.status = "error"
                job.error = str(exc)
                job.message = str(exc)
        finally:
            job.updated_at = _utc_now()

    with _jobs_lock:
        _jobs[job.id] = job
    threading.Thread(target=run, daemon=True, name=f"scribe-job-{job.id}").start()
    return job

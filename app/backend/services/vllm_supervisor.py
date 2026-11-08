"""Start and health-check a local vLLM server for LightOnOCR.

The server lives in env-vllm, built from uv's own CPython. It does not use the
Python or CUDA toolkit already installed on the machine, and its torch stack
does not match the Scribe app environment.
"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path

from config import ROOT

logger = logging.getLogger("scribe.vllm")

_HOST = "127.0.0.1"
_PORT = 8091
_HEALTH_TIMEOUT_S = 300
_STDERR_LINES = 80

# Community Windows build: Python 3.12, CUDA 13, torch 2.11. Not official vLLM.
VLLM_WHEEL_URL = (
    "https://github.com/SystemPanic/vllm-windows/releases/download/v0.24.0/"
    "vllm-0.24.0%2Bcu132-cp312-cp312-win_amd64.whl"
)


class VllmUnavailable(RuntimeError):
    """vLLM could not start or stay healthy. ``detail`` is the user-facing reason."""

    def __init__(self, detail: str):
        self.detail = detail.strip() or "vLLM failed without an error message."
        super().__init__(self.detail)


class _Server:
    def __init__(self) -> None:
        self.proc: subprocess.Popen[bytes] | None = None
        self.model_source: str = ""
        self.served_name: str = ""
        self.stderr: deque[str] = deque(maxlen=_STDERR_LINES)
        self._lock = threading.Lock()
        self._reader: threading.Thread | None = None

    @property
    def base_url(self) -> str:
        return f"http://{_HOST}:{_PORT}/v1"

    def failure_report(self, proc: subprocess.Popen[bytes] | None = None) -> str:
        target = self.proc if proc is None else proc
        lines = list(self.stderr)
        exit_code = None
        if target is not None and target.poll() is not None:
            exit_code = target.returncode
        parts: list[str] = []
        if exit_code is not None:
            parts.append(f"vLLM process exited with code {exit_code}.")
        elif target is None:
            parts.append("vLLM process is not running.")
        else:
            parts.append("vLLM process is still running but did not become healthy.")
        if lines:
            parts.append("Server output:\n" + "\n".join(lines))
        else:
            parts.append("Server output: (no output captured).")
        return "\n".join(parts)


_server = _Server()


_LEAKED_ENV = {
    "PYTHONPATH",
    "PYTHONHOME",
    "PYTHONSTARTUP",
    "PYTHONUSERBASE",
    "PYTHONEXECUTABLE",
    "CUDA_HOME",
    "CUDA_PATH",
    "CUDA_ROOT",
    "CUDA_LIB_PATH",
    "LD_LIBRARY_PATH",
}

_PATH_LEAKS = ("anaconda", "miniconda", "miniforge", "nvidia gpu computing toolkit")


def vllm_executable() -> Path:
    if os.name == "nt":
        return ROOT / "env-vllm" / "Scripts" / "vllm.exe"
    return ROOT / "env-vllm" / "bin" / "vllm"


def _bundled_cuda_home() -> Path:
    """Directory shaped like a CUDA toolkit so FlashInfer loads cudart 13.

    A machine CUDA_PATH (often 11.8) makes FlashInfer look for cudart64_13.dll
    in that toolkit. The wheel ships the DLL under nvidia/cu13 instead.
    """
    source = (
        ROOT
        / "env-vllm"
        / "Lib"
        / "site-packages"
        / "nvidia"
        / "cu13"
        / "bin"
        / "x86_64"
    )
    dll = source / "cudart64_13.dll"
    if not dll.is_file():
        raise VllmUnavailable(
            "The vLLM environment is missing the CUDA 13 runtime "
            f"({dll}). Run Pinokio Update to reinstall env-vllm."
        )
    runtime = ROOT / "env-vllm" / "cuda-runtime"
    link = runtime / "bin"
    runtime.mkdir(parents=True, exist_ok=True)
    if not (link / "cudart64_13.dll").is_file():
        if link.exists() or link.is_symlink():
            if os.name == "nt":
                subprocess.run(["cmd", "/c", "rmdir", str(link)], check=False, capture_output=True)
            else:
                link.unlink(missing_ok=True)
        if link.exists():
            raise VllmUnavailable(
                f"{link} exists but does not contain cudart64_13.dll. "
                "Remove env-vllm/cuda-runtime and try again."
            )
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(source)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()
            raise VllmUnavailable(
                "Could not link the bundled CUDA 13 runtime for vLLM. "
                f"mklink failed: {detail or result.returncode}"
            )
    return runtime


def _scrubbed_path_entries() -> list[str]:
    kept: list[str] = []
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if not entry:
            continue
        low = entry.lower()
        if any(mark in low for mark in _PATH_LEAKS):
            continue
        kept.append(entry)
    return kept


def _bundled_nvidia_lib_dirs() -> list[Path]:
    """Directories shipped inside env-vllm that contain the CUDA runtime."""
    env_root = ROOT / "env-vllm"
    found: list[Path] = []
    seen: set[Path] = set()
    patterns = (
        "Lib/site-packages/nvidia/**/libcudart.so*",
        "lib/python*/site-packages/nvidia/**/libcudart.so*",
        "Lib/site-packages/nvidia/**/cudart64_*.dll",
    )
    for pattern in patterns:
        for hit in env_root.glob(pattern):
            if not hit.is_file():
                continue
            parent = hit.parent
            if parent in seen:
                continue
            seen.add(parent)
            found.append(parent)
    return found


def _vllm_env() -> dict[str, str]:
    """Environment for the vLLM process, without the caller's Python or CUDA toolkit."""
    env = os.environ.copy()
    for key in list(env):
        if key in _LEAKED_ENV or key.startswith("CONDA_") or key.startswith("_CE_"):
            env.pop(key, None)
    env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["VIRTUAL_ENV"] = str(ROOT / "env-vllm")
    # FlashInfer's sampler JIT-compiles with ninja/nvcc. A machine CUDA toolkit
    # is often the wrong version, and the native sampler is enough for OCR.
    env["VLLM_USE_FLASHINFER_SAMPLER"] = "0"
    prefixes: list[str] = []
    if os.name == "nt":
        cuda_home = _bundled_cuda_home()
        env["CUDA_HOME"] = str(cuda_home)
        env["CUDA_PATH"] = str(cuda_home)
        env["CUDA_ROOT"] = str(cuda_home)
        prefixes.append(str(cuda_home / "bin"))
        prefixes.append(str(ROOT / "env-vllm" / "Lib" / "site-packages" / "torch" / "lib"))
        prefixes.append(str(ROOT / "env-vllm" / "Scripts"))
    else:
        lib_dirs = _bundled_nvidia_lib_dirs()
        if lib_dirs:
            env["CUDA_LIB_PATH"] = str(lib_dirs[0])
            env["LD_LIBRARY_PATH"] = os.pathsep.join(str(path) for path in lib_dirs)
        prefixes.append(str(ROOT / "env-vllm" / "bin"))
    env["PATH"] = os.pathsep.join(prefixes + _scrubbed_path_entries())
    return env


def openai_base_url() -> str:
    return _server.base_url


def runtime_installed() -> bool:
    return vllm_executable().is_file()


def server_running() -> bool:
    with _server._lock:
        proc_alive = _server.proc is not None and _server.proc.poll() is None
    return proc_alive or _health_ok()


def stop_server() -> None:
    with _server._lock:
        _stop_locked()


# OCR jobs that currently need the GPU. The last release stops vLLM and
# unloads Transformers weights so VRAM is free after finish or cancel.
_gpu_holders = 0
_gpu_holders_lock = threading.Lock()


def hold_ocr_gpu() -> None:
    global _gpu_holders
    with _gpu_holders_lock:
        _gpu_holders += 1


def release_ocr_gpu() -> None:
    """Stop vLLM and clear Transformers when no OCR work still needs the GPU."""
    global _gpu_holders
    with _gpu_holders_lock:
        if _gpu_holders > 0:
            _gpu_holders -= 1
        if _gpu_holders > 0:
            return
    stop_server()
    try:
        from services import ocr as ocr_engine

        ocr_engine.unload_models()
    except Exception:
        logger.exception("Failed to unload Transformers OCR models")
    logger.info("Released OCR GPU memory")


def gpu_block_reason() -> str | None:
    return _nvidia_block_reason()


def failure_report() -> str:
    with _server._lock:
        return _server.failure_report()


# Laptop GPUs share VRAM with the Windows desktop. Taking nearly all free memory
# (old default: free - 256 MiB, up to 0.90 of total) can freeze the machine
# because the display compositor has nowhere to go.
_DESKTOP_RESERVE_MB = 2048
_MAX_GPU_UTIL = 0.75
_MIN_OCR_VRAM_MB = 3072
_MAX_OCR_CONCURRENCY = 2


def _gpu_memory_utilization() -> str:
    """Fraction of total VRAM vLLM may reserve, with headroom for the desktop."""
    try:
        out = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=memory.free,memory.total",
                "--format=csv,noheader,nounits",
            ],
            text=True,
            timeout=15,
            stderr=subprocess.DEVNULL,
        )
        free_s, total_s = out.strip().splitlines()[0].split(",")
        free_mb = int(free_s.strip())
        total_mb = int(total_s.strip())
    except (OSError, subprocess.SubprocessError, ValueError, IndexError) as exc:
        raise VllmUnavailable(
            "Could not read free GPU memory with nvidia-smi, so vLLM was not started. "
            f"Details: {exc}"
        ) from exc
    if total_mb <= 0:
        raise VllmUnavailable("nvidia-smi reported zero total GPU memory.")
    # vLLM refuses to start when utilization * total exceeds free memory.
    usable = free_mb - _DESKTOP_RESERVE_MB
    if usable < _MIN_OCR_VRAM_MB:
        raise VllmUnavailable(
            "Not enough free GPU memory to start vLLM. "
            f"Free {free_mb} MiB of {total_mb} MiB; about {_MIN_OCR_VRAM_MB} MiB is required "
            f"after keeping {_DESKTOP_RESERVE_MB} MiB for the desktop. "
            "Close other GPU apps and try again, or use Transformers for this run."
        )
    util = min(_MAX_GPU_UTIL, usable / total_mb)
    logger.info(
        "vLLM gpu_memory_utilization=%s (free=%s MiB, total=%s MiB, desktop reserve=%s MiB)",
        f"{util:.2f}",
        free_mb,
        total_mb,
        _DESKTOP_RESERVE_MB,
    )
    return f"{util:.2f}"


def recommended_concurrency() -> int:
    """In-flight pages from free GPU memory after the server is up.

    Capped at two on purpose: more parallel pages raise peak VRAM and are a
    common way a laptop GPU freezes the rest of the system.
    """
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            text=True,
            timeout=15,
            stderr=subprocess.DEVNULL,
        )
        free_mb = int(out.strip().splitlines()[0].strip())
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return 1
    # Weights are already resident; each extra page still needs KV + image activations.
    return max(1, min(_MAX_OCR_CONCURRENCY, free_mb // 2500))


def _nvidia_block_reason() -> str | None:
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "-L"],
            text=True,
            timeout=15,
            stderr=subprocess.STDOUT,
        )
    except subprocess.CalledProcessError as exc:
        text = (exc.output or "").strip()
        return (
            "No NVIDIA GPU was detected, so the faster OCR engine cannot start. "
            "vLLM is only used on NVIDIA GPUs. "
            f"nvidia-smi failed: {text or exc}"
        )
    except OSError as exc:
        return (
            "No NVIDIA GPU was detected (nvidia-smi is not available). "
            "vLLM is only used on NVIDIA GPUs. Use Transformers for this run. "
            f"Details: {exc}"
        )
    if "GPU" not in out:
        return f"nvidia-smi did not list a GPU:\n{out.strip()}"
    return None


def _health_ok() -> bool:
    url = f"http://{_HOST}:{_PORT}/health"
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:
            return 200 <= getattr(resp, "status", 200) < 300
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def _read_output(proc: subprocess.Popen[bytes], bucket: deque[str]) -> None:
    """Drain stdout by chunk, not by line.

    vLLM prints progress with bare carriage returns. A line reader leaves those
    bytes in the pipe until a newline arrives, the pipe fills, and the server
    blocks before it can open its port.
    """
    stream = proc.stdout
    if stream is None:
        return
    pending = b""
    try:
        while True:
            chunk = stream.read(4096)
            if not chunk:
                break
            pending += chunk.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
            parts = pending.split(b"\n")
            pending = parts.pop()
            for raw in parts:
                text = raw.decode("utf-8", "replace").strip()
                if text:
                    bucket.append(text)
                    logger.info("vLLM: %s", text)
        tail = pending.decode("utf-8", "replace").strip()
        if tail:
            bucket.append(tail)
            logger.info("vLLM: %s", tail)
    except Exception:
        logger.exception("vLLM output reader stopped")


def _stop_process_tree(proc: subprocess.Popen[bytes]) -> None:
    """Stop vLLM and the engine child it spawns.

    On Windows, terminating the launcher leaves the GPU worker running.
    """
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            capture_output=True,
            text=True,
        )
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)
        return
    proc.terminate()
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=10)


def _stop_locked() -> None:
    proc = _server.proc
    _server.proc = None
    if proc is None or proc.poll() is not None:
        return
    _stop_process_tree(proc)


# One startup at a time. App launch and Process pages both call this, and the
# second caller must wait rather than kill a server that is still loading.
_start_gate = threading.Lock()


def ensure_started(model_source: str, *, served_model_name: str) -> str:
    """Return the OpenAI-compatible base URL, starting the server if needed.

    Raises VllmUnavailable with the captured reason when startup fails.
    """
    with _start_gate:
        return _ensure_started(model_source, served_model_name=served_model_name)


def _ensure_started(model_source: str, *, served_model_name: str) -> str:
    source = str(model_source or "").strip()
    name = (served_model_name or "").strip() or source
    if not source:
        raise VllmUnavailable("No local OCR model path was resolved, so vLLM was not started.")

    blocked = _nvidia_block_reason()
    if blocked:
        raise VllmUnavailable(blocked)

    exe = vllm_executable()
    if not exe.is_file():
        where = (
            "Windows uses the SystemPanic CUDA 13 wheel."
            if os.name == "nt"
            else "Linux uses the official vLLM package."
        )
        raise VllmUnavailable(
            "The vLLM runtime is not installed. Expected "
            f"{exe}. Install it from Settings → Models. "
            f"{where} That environment uses uv's own Python 3.12 and does not use the "
            "Python or CUDA toolkit already installed on this machine. "
            "The Scribe app environment was left unchanged."
        )

    with _server._lock:
        same = (
            _server.proc is not None
            and _server.proc.poll() is None
            and _server.model_source == source
            and _health_ok()
        )
        if same:
            return _server.base_url

        if _health_ok() and _server.proc is None and _server.model_source in ("", source):
            # A healthy server from an earlier session is already on the port.
            _server.model_source = source
            _server.served_name = name
            logger.info("Reusing vLLM already listening on port %s", _PORT)
            return _server.base_url

        _stop_locked()
        _server.stderr.clear()
        _server.model_source = source
        _server.served_name = name

        cmd = [
            str(exe),
            "serve",
            source,
            "--host",
            _HOST,
            "--port",
            str(_PORT),
            "--served-model-name",
            name,
            "--limit-mm-per-prompt",
            '{"image": 1}',
            "--mm-processor-cache-gb",
            "0",
            "--no-enable-prefix-caching",
            "--gpu-memory-utilization",
            _gpu_memory_utilization(),
        ]
        # CUDA graph capture spikes VRAM and can lock a laptop display GPU for
        # a long stretch. Eager mode is a bit slower and much steadier on Windows.
        if os.name == "nt":
            cmd.append("--enforce-eager")
        logger.info("Starting vLLM: %s", " ".join(cmd))
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=str(ROOT),
                env=_vllm_env(),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=0,
            )
        except OSError as exc:
            raise VllmUnavailable(f"Could not launch vLLM ({exe}): {exc}") from exc

        _server.proc = proc
        _server._reader = threading.Thread(
            target=_read_output,
            args=(proc, _server.stderr),
            name="scribe-vllm-log",
            daemon=True,
        )
        _server._reader.start()
        proc = _server.proc

    deadline = time.monotonic() + _HEALTH_TIMEOUT_S
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            time.sleep(0.3)
            with _server._lock:
                raise VllmUnavailable(_server.failure_report(proc))
        if _health_ok():
            logger.info("vLLM healthy at %s", _server.base_url)
            return _server.base_url
        time.sleep(1.0)

    with _server._lock:
        if _server.proc is proc:
            _stop_locked()
        raise VllmUnavailable(
            f"Timed out after {_HEALTH_TIMEOUT_S}s waiting for http://{_HOST}:{_PORT}/health.\n"
            + _server.failure_report()
        )

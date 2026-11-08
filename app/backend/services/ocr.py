"""LightOnOCR engine — Gradio-free port of LightOnOCR-2-1B-Pinokio app.py."""

from __future__ import annotations

import base64
import logging
import os
import re
import threading
from collections import OrderedDict
from io import BytesIO
from pathlib import Path
from typing import Any, Callable

import pypdfium2 as pdfium
import torch
from PIL import Image

logger = logging.getLogger("scribe.ocr")

# PDFium is not safe for concurrent use across threads. OCR (worker) and
# Preview (request threads) must serialize all PdfDocument open/render/close.
_pdfium_lock = threading.RLock()

VLLM_ENDPOINT_OCR = os.environ.get("VLLM_ENDPOINT_OCR")
VLLM_ENDPOINT_BBOX = os.environ.get("VLLM_ENDPOINT_BBOX")

# Pack id → HuggingFace / local identity (mirrors LightOn MODEL_REGISTRY)
MODEL_REGISTRY: dict[str, dict[str, Any]] = {
    "lightonocr-2-1b": {
        "label": "LightOnOCR-2-1B (Best OCR)",
        "repo_id": "lightonai/LightOnOCR-2-1B",
        "has_bbox": False,
        "vllm_endpoint": VLLM_ENDPOINT_OCR,
        "dir_attr": "LIGHTON_OCR_DIR",
    },
    "lightonocr-2-1b-bbox": {
        "label": "LightOnOCR-2-1B-bbox",
        "repo_id": "lightonai/LightOnOCR-2-1B-bbox",
        "has_bbox": True,
        "vllm_endpoint": VLLM_ENDPOINT_BBOX,
        "dir_attr": "LIGHTON_BBOX_DIR",
    },
    "lightonocr-2-1b-base": {
        "label": "LightOnOCR-2-1B-base",
        "repo_id": "lightonai/LightOnOCR-2-1B-base",
        "has_bbox": False,
        "dir_attr": "LIGHTON_BASE_DIR",
    },
    "lightonocr-2-1b-bbox-base": {
        "label": "LightOnOCR-2-1B-bbox-base",
        "repo_id": "lightonai/LightOnOCR-2-1B-bbox-base",
        "has_bbox": True,
        "dir_attr": "LIGHTON_BBOX_BASE_DIR",
    },
    "lightonocr-2-1b-ocr-soup": {
        "label": "LightOnOCR-2-1B-ocr-soup",
        "repo_id": "lightonai/LightOnOCR-2-1B-ocr-soup",
        "has_bbox": False,
        "dir_attr": "LIGHTON_SOUP_DIR",
    },
    "lightonocr-2-1b-bbox-soup": {
        "label": "LightOnOCR-2-1B-bbox-soup",
        "repo_id": "lightonai/LightOnOCR-2-1B-bbox-soup",
        "has_bbox": True,
        "dir_attr": "LIGHTON_BBOX_SOUP_DIR",
    },
}

DEFAULT_PACK_ID = "lightonocr-2-1b"
BBOX_PATTERN = r"!\[image\]\((image_\d+\.png)\)\s*(\d+),(\d+),(\d+),(\d+)"

_device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
if _device == "cuda":
    _attn = "sdpa"
    _dtype = torch.bfloat16
elif _device == "mps":
    _attn = "eager"
    _dtype = torch.float32
else:
    _attn = "eager"
    _dtype = torch.float32

_load_lock = threading.Lock()
_cache: OrderedDict[str, tuple[Any, Any]] = OrderedDict()
_MAX_CACHED = 2


def device_info() -> dict[str, str]:
    return {"device": _device, "attn": _attn, "dtype": str(_dtype).replace("torch.", "")}


def _local_dir_for(pack_id: str) -> Path:
    import config as cfg

    meta = MODEL_REGISTRY[pack_id]
    return getattr(cfg, meta["dir_attr"])


def resolve_model_source(pack_id: str) -> str:
    """Prefer local Pinokio-linked weights; fall back to HF repo id."""
    if pack_id not in MODEL_REGISTRY:
        raise ValueError(f"Unknown OCR pack: {pack_id}")
    local = _local_dir_for(pack_id)
    if (local / "config.json").is_file():
        return str(local)
    return MODEL_REGISTRY[pack_id]["repo_id"]


def unload_models() -> None:
    """Drop Transformers weights so GPU memory can return to the system."""
    with _load_lock:
        if not _cache:
            return
        logger.info("Unloading %s cached OCR model(s)", len(_cache))
        _cache.clear()
    if _device == "cuda":
        torch.cuda.empty_cache()
    elif _device == "mps":
        torch.mps.empty_cache()


def get_model(pack_id: str) -> tuple[Any, Any]:
    """Load LightOnOCR model + processor with a small LRU cache."""
    from transformers import LightOnOcrForConditionalGeneration, LightOnOcrProcessor

    source = resolve_model_source(pack_id)
    with _load_lock:
        if source in _cache:
            _cache.move_to_end(source)
            return _cache[source]

        while len(_cache) >= _MAX_CACHED:
            evicted_id, (evicted_model, _) = _cache.popitem(last=False)
            logger.info("Evicting OCR model cache: %s", evicted_id)
            del evicted_model
            if _device == "cuda":
                torch.cuda.empty_cache()
            elif _device == "mps":
                torch.mps.empty_cache()

        logger.info("Loading OCR model from %s …", source)
        model = (
            LightOnOcrForConditionalGeneration.from_pretrained(
                source,
                attn_implementation=_attn,
                torch_dtype=_dtype,
                trust_remote_code=True,
            )
            .to(_device)
            .eval()
        )
        processor = LightOnOcrProcessor.from_pretrained(source, trust_remote_code=True)
        _cache[source] = (model, processor)
        logger.info("OCR model ready: %s", pack_id)
        return model, processor


def render_pdf_page(page: Any, max_resolution: int = 1540, scale: float = 2.77) -> Image.Image:
    width, height = page.get_size()
    pixel_width = width * scale
    pixel_height = height * scale
    resize_factor = min(1, max_resolution / pixel_width, max_resolution / pixel_height)
    target_scale = scale * resize_factor
    return page.render(scale=target_scale, rev_byteorder=True).to_pil()


def estimate_paper_color(rgb: Any) -> Any:
    """Estimate page paper colour from borders + bright pixels (sepia-safe)."""
    import numpy as np

    arr = np.asarray(rgb, dtype=np.float32)
    h, w, _ = arr.shape
    border = max(2, min(h, w) // 40)
    strips = [
        arr[:border, :, :],
        arr[-border:, :, :],
        arr[:, :border, :],
        arr[:, -border:, :],
    ]
    samples = np.concatenate([s.reshape(-1, 3) for s in strips], axis=0)
    lum = 0.2126 * arr[:, :, 0] + 0.7152 * arr[:, :, 1] + 0.0722 * arr[:, :, 2]
    flat = arr.reshape(-1, 3)
    lum_flat = lum.reshape(-1)
    cutoff = float(np.percentile(lum_flat, 75))
    bright = flat[lum_flat >= cutoff]
    if bright.size:
        samples = np.concatenate([samples, bright], axis=0)
    return np.median(samples, axis=0)


def crush_near_paper(image: Image.Image, fade_threshold: int = 0) -> Image.Image:
    """
    Replace pixels close to this page's paper colour with the paper colour.

    fade_threshold: 0 = off; 1–100 = how aggressively near-paper (faint /
    bleed-through) tones are treated as blank. Real ink and non-paper colour
    are left alone — nothing is forced to pure white.
    """
    strength = max(0, min(100, int(fade_threshold or 0)))
    if strength <= 0:
        return image

    import numpy as np

    rgb = image.convert("RGB")
    arr = np.asarray(rgb, dtype=np.float32)
    paper = estimate_paper_color(arr)
    # Map 1..100 → max RGB distance ~12..120 (Euclidean).
    max_dist = 12.0 + (strength / 100.0) * 108.0
    dist = np.sqrt(((arr - paper) ** 2).sum(axis=2))
    # Soft edge: fully crush below 70% of max_dist, blend up to max_dist.
    hard = max_dist * 0.7
    out = arr.copy()
    crush = dist <= hard
    out[crush] = paper
    blend_zone = (dist > hard) & (dist <= max_dist)
    if np.any(blend_zone):
        t = (dist[blend_zone] - hard) / max(max_dist - hard, 1e-6)
        t = t[..., None]
        out[blend_zone] = paper * (1.0 - t) + arr[blend_zone] * t
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def _open_pdf(pdf_path: str | Path) -> Any:
    """Open a PDF from an in-memory copy so readers do not fight over the file handle."""
    data = Path(pdf_path).read_bytes()
    return pdfium.PdfDocument(data)


def pdf_page_count(pdf_path: str | Path) -> int:
    with _pdfium_lock:
        pdf = _open_pdf(pdf_path)
        try:
            return len(pdf)
        finally:
            pdf.close()


def clean_output_text(text: str) -> str:
    markers_to_remove = {"system", "user", "assistant"}
    lines = text.split("\n")
    cleaned_lines = [line for line in lines if line.strip().lower() not in markers_to_remove]
    cleaned = "\n".join(cleaned_lines).strip()
    if "assistant" in text.lower():
        parts = text.split("assistant", 1)
        if len(parts) > 1:
            cleaned = parts[1].strip()
    return cleaned


def parse_bbox_output(text: str) -> tuple[str, list[dict[str, Any]]]:
    detections = []
    for match in re.finditer(BBOX_PATTERN, text):
        image_ref, x1, y1, x2, y2 = match.groups()
        detections.append(
            {"ref": image_ref, "coords": (int(x1), int(y1), int(x2), int(y2))}
        )
    cleaned = re.sub(BBOX_PATTERN, r"![image](\1)", text)
    return cleaned, detections


def crop_from_bbox(source_image: Image.Image, bbox: dict[str, Any], padding: int = 5) -> Image.Image:
    w, h = source_image.size
    x1, y1, x2, y2 = bbox["coords"]
    px1 = int(x1 * w / 1000)
    py1 = int(y1 * h / 1000)
    px2 = int(x2 * w / 1000)
    py2 = int(y2 * h / 1000)
    px1, py1 = max(0, px1 - padding), max(0, py1 - padding)
    px2, py2 = min(w, px2 + padding), min(h, py2 + padding)
    return source_image.crop((px1, py1, px2, py2))


def image_to_data_uri(image: Image.Image) -> str:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    b64 = base64.b64encode(buffer.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def render_bbox_with_crops(raw_output: str, source_image: Image.Image) -> str:
    cleaned, detections = parse_bbox_output(raw_output)
    for bbox in detections:
        try:
            cropped = crop_from_bbox(source_image, bbox)
            data_uri = image_to_data_uri(cropped)
            cleaned = cleaned.replace(
                f"![image]({bbox['ref']})", f"![Cropped region]({data_uri})"
            )
        except Exception as exc:
            logger.warning("bbox crop failed: %s", exc)
    return cleaned


def extract_text_from_image(
    image: Image.Image,
    pack_id: str,
    temperature: float = 0.2,
    max_tokens: int = 2048,
    *,
    engine: str = "transformers",
    vllm_endpoint: str | None = None,
) -> str:
    """Single-page OCR (non-streaming)."""
    from services.vllm_supervisor import VllmUnavailable, failure_report

    config = MODEL_REGISTRY.get(pack_id, {})
    endpoint = vllm_endpoint or (config.get("vllm_endpoint") if engine != "transformers" else None)
    if engine == "vllm" or endpoint:
        if not endpoint:
            raise VllmUnavailable("vLLM was selected but no server URL is available.")
        try:
            return _extract_via_vllm(image, pack_id, temperature, max_tokens, endpoint)
        except VllmUnavailable:
            raise
        except Exception as exc:
            raise VllmUnavailable(f"{exc}\n\n{failure_report()}") from exc

    model, processor = get_model(pack_id)
    chat = [{"role": "user", "content": [{"type": "image", "url": image}]}]
    inputs = processor.apply_chat_template(
        chat,
        add_generation_prompt=True,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
    )
    inputs = {
        k: v.to(device=_device, dtype=_dtype)
        if isinstance(v, torch.Tensor) and v.dtype in [torch.float32, torch.float16, torch.bfloat16]
        else v.to(_device)
        if isinstance(v, torch.Tensor)
        else v
        for k, v in inputs.items()
    }
    generation_kwargs = dict(
        **inputs,
        max_new_tokens=max_tokens,
        temperature=temperature if temperature > 0 else 0.0,
        top_p=0.9,
        top_k=0,
        use_cache=True,
        do_sample=temperature > 0,
    )
    with torch.no_grad():
        outputs = model.generate(**generation_kwargs)
    output_text = processor.decode(outputs[0], skip_special_tokens=True)
    return clean_output_text(output_text)


def _extract_via_vllm(
    image: Image.Image,
    pack_id: str,
    temperature: float,
    max_tokens: int,
    endpoint: str,
) -> str:
    from openai import OpenAI

    client = OpenAI(base_url=endpoint, api_key="not-needed")
    model_id = MODEL_REGISTRY[pack_id]["repo_id"]
    response = client.chat.completions.create(
        model=model_id,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_to_data_uri(image)}},
                ],
            }
        ],
        max_tokens=max_tokens,
        temperature=temperature if temperature > 0 else 0.0,
        top_p=0.9,
        stream=False,
    )
    return clean_output_text(response.choices[0].message.content or "")


def ocr_document(
    pdf_path: str | Path,
    pack_id: str,
    *,
    temperature: float = 0.2,
    max_tokens: int = 2048,
    page_separator: str = "\n\n---\n\n",
    page_headers: bool = True,
    on_progress: Callable[[int, int, str], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> str:
    """Legacy: OCR every page and return one joined Markdown string."""
    if pack_id not in MODEL_REGISTRY:
        raise ValueError(f"Unknown OCR pack: {pack_id}")
    has_bbox = bool(MODEL_REGISTRY[pack_id].get("has_bbox"))
    with _pdfium_lock:
        pdf = _open_pdf(pdf_path)
        try:
            total = len(pdf)
        finally:
            pdf.close()
    parts: list[str] = []
    for index in range(total):
        if cancel_check and cancel_check():
            raise RuntimeError("OCR cancelled")
        page_num = index + 1
        if on_progress:
            on_progress(page_num, total, f"OCR page {page_num} of {total}")
        with _pdfium_lock:
            pdf = _open_pdf(pdf_path)
            try:
                image = render_pdf_page(pdf[index])
            finally:
                pdf.close()
        raw = extract_text_from_image(
            image, pack_id, temperature=temperature, max_tokens=max_tokens
        )
        page_md = render_bbox_with_crops(raw, image) if has_bbox else raw
        if page_headers:
            block = f"## Page {page_num}\n\n{page_md.strip()}"
        else:
            block = page_md.strip()
        parts.append(block)
        if on_progress:
            on_progress(page_num, total, f"Done page {page_num} of {total}")
    return page_separator.join(parts)


def render_page_jpeg(
    pdf_path: str | Path,
    page_num: int,
    *,
    quality: int = 85,
    max_resolution: int = 2048,
) -> bytes:
    """Render one PDF page to JPEG bytes."""
    quality = max(1, min(95, int(quality)))
    image = load_page_image(pdf_path, page_num, max_resolution=max_resolution)
    return image_to_jpeg(image, quality=quality)


def load_page_image(
    source_path: str | Path,
    page_num: int = 1,
    *,
    max_resolution: int = 2048,
) -> Image.Image:
    """Load a PDF page (or a single image source) as a PIL RGB image."""
    path = Path(source_path)
    if path.suffix.lower() != ".pdf":
        image = Image.open(path)
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        return image
    with _pdfium_lock:
        pdf = _open_pdf(path)
        try:
            total = len(pdf)
            idx = min(max(int(page_num) - 1, 0), total - 1)
            return render_pdf_page(pdf[idx], max_resolution=max_resolution)
        finally:
            pdf.close()


def crop_normalized_region(
    image: Image.Image,
    x: float,
    y: float,
    width: float,
    height: float,
) -> Image.Image:
    """Crop using normalized coordinates (0–1 relative to the image)."""
    w, h = image.size
    x1 = int(max(0.0, min(1.0, float(x))) * w)
    y1 = int(max(0.0, min(1.0, float(y))) * h)
    x2 = int(max(0.0, min(1.0, float(x) + float(width))) * w)
    y2 = int(max(0.0, min(1.0, float(y) + float(height))) * h)
    if x2 <= x1 or y2 <= y1:
        raise ValueError("Selection region is empty")
    # Require a minimum crop so accidental clicks don't OCR/extract a speck
    if (x2 - x1) < 8 or (y2 - y1) < 8:
        raise ValueError("Selection region is too small")
    return image.crop((x1, y1, x2, y2))


def ocr_image_region(
    source_path: str | Path,
    page_num: int,
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    pack_id: str,
    fade_threshold: int = 0,
    temperature: float = 0.2,
    max_tokens: int = 2048,
    max_resolution: int = 1540,
    engine: str = "vllm",
    vllm_endpoint: str | None = None,
) -> str:
    """Render a page, crop a normalized region, and OCR it."""
    if pack_id not in MODEL_REGISTRY:
        raise ValueError(f"Unknown OCR pack: {pack_id}")
    has_bbox = bool(MODEL_REGISTRY[pack_id].get("has_bbox"))
    image = load_page_image(source_path, page_num, max_resolution=max_resolution)
    cropped = crop_normalized_region(image, x, y, width, height)
    cropped = crush_near_paper(cropped, fade_threshold)
    raw = extract_text_from_image(
        cropped,
        pack_id,
        temperature=temperature,
        max_tokens=max_tokens,
        engine=engine,
        vllm_endpoint=vllm_endpoint,
    )
    page_md = render_bbox_with_crops(raw, cropped) if has_bbox else raw
    return page_md.strip()


def extract_image_region(
    source_path: str | Path,
    page_num: int,
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    quality: int = 85,
    max_resolution: int = 2048,
) -> bytes:
    """Render a page, crop a normalized region, and encode as JPEG."""
    image = load_page_image(source_path, page_num, max_resolution=max_resolution)
    cropped = crop_normalized_region(image, x, y, width, height)
    return image_to_jpeg(cropped, quality=quality)


def image_to_jpeg(image_or_path: Any, *, quality: int = 85) -> bytes:
    """Encode a PIL image or image file path to JPEG bytes."""
    quality = max(1, min(95, int(quality)))
    if isinstance(image_or_path, (str, Path)):
        image = Image.open(image_or_path)
    else:
        image = image_or_path
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    buf = BytesIO()
    image.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def process_pdf_range(
    pdf_path: str | Path,
    pack_id: str,
    *,
    start_page: int,
    end_page: int,
    cover_page: int | None = None,
    cover_jpeg_quality: int = 85,
    cover_jpeg_bytes: bytes | None = None,
    fade_threshold: int = 0,
    temperature: float = 0.2,
    max_tokens: int = 2048,
    engine: str = "vllm",
    vllm_endpoint: str | None = None,
    concurrency: int = 1,
    on_cover: Callable[[int, bytes], None] | None = None,
    on_ocr_page: Callable[[int, str], None] | None = None,
    on_progress: Callable[[int, int, str], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """OCR (or cover-embed) each page in [start_page, end_page]."""
    import queue
    from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait

    if pack_id not in MODEL_REGISTRY:
        raise ValueError(f"Unknown OCR pack: {pack_id}")
    has_bbox = bool(MODEL_REGISTRY[pack_id].get("has_bbox"))
    use_vllm = engine == "vllm"
    workers = max(1, int(concurrency if use_vllm else 1))

    with _pdfium_lock:
        pdf = _open_pdf(pdf_path)
        try:
            total_pages = len(pdf)
        finally:
            pdf.close()

    start = max(1, min(int(start_page), total_pages))
    end = max(start, min(int(end_page), total_pages))
    page_nums = list(range(start, end + 1))
    range_len = len(page_nums)
    prefetch = workers + 2
    rendered: queue.Queue[tuple[int, Image.Image | None] | None] = queue.Queue(maxsize=prefetch)
    stop_render = threading.Event()

    def produce() -> None:
        """Render ahead. Close the PDF while the queue is full so Preview can use PDFium."""
        pdf_doc = None
        path = Path(pdf_path)
        try:
            for page_num in page_nums:
                if stop_render.is_set() or (cancel_check and cancel_check()):
                    break
                is_cover = cover_page is not None and int(cover_page) == page_num
                image: Image.Image | None = None
                if not (is_cover and cover_jpeg_bytes is not None):
                    with _pdfium_lock:
                        if pdf_doc is None:
                            pdf_doc = _open_pdf(path)
                        image = render_pdf_page(pdf_doc[page_num - 1])
                item: tuple[int, Image.Image | None] = (page_num, image)
                queued = False
                while not stop_render.is_set():
                    if cancel_check and cancel_check():
                        stop_render.set()
                        break
                    try:
                        rendered.put(item, timeout=0.2)
                        queued = True
                        break
                    except queue.Full:
                        with _pdfium_lock:
                            if pdf_doc is not None:
                                pdf_doc.close()
                                pdf_doc = None
                if not queued:
                    break
        finally:
            with _pdfium_lock:
                if pdf_doc is not None:
                    pdf_doc.close()
            rendered.put(None)

    def finish_page(page_num: int, image: Image.Image | None) -> None:
        if cancel_check and cancel_check():
            raise RuntimeError("OCR cancelled")
        is_cover = cover_page is not None and int(cover_page) == page_num
        if is_cover:
            if cover_jpeg_bytes is not None:
                jpeg = cover_jpeg_bytes
            elif image is not None:
                jpeg = image_to_jpeg(image, quality=cover_jpeg_quality)
            else:
                jpeg = render_page_jpeg(pdf_path, page_num, quality=cover_jpeg_quality)
            if on_cover:
                on_cover(page_num, jpeg)
            return

        if image is None:
            with _pdfium_lock:
                pdf_doc = _open_pdf(pdf_path)
                try:
                    image = render_pdf_page(pdf_doc[page_num - 1])
                finally:
                    pdf_doc.close()
        prepared = crush_near_paper(image, fade_threshold)
        raw = extract_text_from_image(
            prepared,
            pack_id,
            temperature=temperature,
            max_tokens=max_tokens,
            engine="vllm" if use_vllm else "transformers",
            vllm_endpoint=vllm_endpoint,
        )
        page_md = render_bbox_with_crops(raw, prepared) if has_bbox else raw
        if on_ocr_page:
            on_ocr_page(page_num, page_md.strip())

    producer = threading.Thread(target=produce, name="scribe-ocr-render", daemon=True)
    producer.start()
    completed = 0
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            in_flight: set[Future[None]] = set()
            done_producing = False
            while not done_producing or in_flight:
                if cancel_check and cancel_check():
                    stop_render.set()
                    raise RuntimeError("OCR cancelled")
                while not done_producing and len(in_flight) < workers:
                    try:
                        item = rendered.get(timeout=0.2)
                    except queue.Empty:
                        break
                    if item is None:
                        done_producing = True
                        break
                    page_num, image = item
                    in_flight.add(pool.submit(finish_page, page_num, image))
                if not in_flight:
                    if done_producing:
                        break
                    continue
                finished, in_flight = wait(in_flight, timeout=0.2, return_when=FIRST_COMPLETED)
                for fut in finished:
                    fut.result()
                    completed += 1
                    if on_progress:
                        on_progress(completed, range_len, f"Done {completed} of {range_len}")
    finally:
        stop_render.set()
        producer.join(timeout=5)

    return {
        "start_page": start,
        "end_page": end,
        "total_pages": total_pages,
        "range_len": range_len,
        "completed": completed,
        "engine": "vllm" if use_vllm else "transformers",
    }

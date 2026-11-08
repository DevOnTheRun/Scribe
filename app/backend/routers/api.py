from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from services import ocr as ocr_engine
from services import cleaning as cleaning_engine
from services import index_builder
from services import epub_export
from services import metadata_scrape
from services import metadata_lookup
from services.jobs import get_job, request_cancel, start_job
from services.models_registry import (
    catalog as models_catalog,
    get_model_job,
    require_ocr,
    start_model_job,
    status as models_status,
    validate_ocr_pack_id,
)
from services.project import ProjectState, delete_project, list_projects, slugify
from services.settings_store import load_settings, save_settings

logger = logging.getLogger("scribe.api")
router = APIRouter(prefix="/api")


class CreateProjectBody(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""


class PatchProjectBody(BaseModel):
    name: str | None = None
    description: str | None = None
    cover_page: int | None = None
    cover_jpeg_quality: int | None = Field(default=None, ge=1, le=95)
    cover_mode: str | None = None  # none | page | upload
    clear_cover: bool = False


class StartOcrBody(BaseModel):
    pack_id: str | None = None
    temperature: float | None = None
    max_output_tokens: int | None = None
    start_page: int = Field(default=1, ge=1)
    end_page: int | None = Field(default=None, ge=1)
    cover_page: int | None = Field(default=None, ge=1)
    cover_jpeg_quality: int | None = Field(default=None, ge=1, le=95)
    cover_mode: str | None = None  # none | page | upload
    clear_cover: bool = False
    fade_threshold: int | None = Field(default=None, ge=0, le=100)
    engine: str | None = None  # "transformers" skips vLLM for this run only


class CleanOptionsBody(BaseModel):
    remove_page_numbers: bool = True
    remove_running_headers: bool = True
    header_pattern: str = ""
    book_title: str = ""  # legacy alias for header_pattern
    extra_phrases: list[str] = Field(default_factory=list)
    selected_running: list[str] = Field(default_factory=list)


class CleanPreviewBody(BaseModel):
    page: int = Field(ge=1)
    options: CleanOptionsBody = Field(default_factory=CleanOptionsBody)


class SavePageMarkdownBody(BaseModel):
    markdown: str = ""


class RegionBody(BaseModel):
    """Normalized crop rect (0–1 relative to the page image)."""
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)
    quality: int | None = Field(default=None, ge=1, le=95)
    engine: str | None = None  # "transformers" skips vLLM for this region only


class CleanApplyBody(BaseModel):
    options: CleanOptionsBody = Field(default_factory=CleanOptionsBody)
    start_page: int | None = Field(default=None, ge=1)
    end_page: int | None = Field(default=None, ge=1)


class IndexEntryBody(BaseModel):
    id: str | None = None
    label: str = ""
    page: int = Field(ge=1)
    anchor: str | None = None
    level: int = Field(default=1, ge=1, le=3)
    enabled: bool = True
    source: str | None = None


class IndexSaveBody(BaseModel):
    title: str = "Contents"
    replace_start: int | None = Field(default=None, ge=1)
    replace_end: int | None = Field(default=None, ge=1)
    entries: list[IndexEntryBody] = Field(default_factory=list)


class IndexScanBody(BaseModel):
    replace_start: int | None = Field(default=None, ge=1)
    replace_end: int | None = Field(default=None, ge=1)
    title: str | None = None
    keep_manual: bool = True


class EpubExportBody(BaseModel):
    title: str | None = None
    authors: str | None = None
    author: str | None = None  # legacy alias
    publisher: str | None = None
    year: str | None = None
    description: str | None = None
    rights: str | None = None
    language: str = "en"
    isbn: str | None = None


class MetadataLookupBody(BaseModel):
    title: str = ""
    authors: str = ""
    author: str = ""  # alias
    isbn: str = ""
    limit: int = Field(default=8, ge=1, le=15)


class SettingsBody(BaseModel):
    ocr_pack_id: str | None = None
    temperature: float | None = None
    max_output_tokens: int | None = None
    page_separator: str | None = None


def _safe_filename(name: str, fallback: str = "document.pdf") -> str:
    cleaned = re.sub(r"[^\w.\-]+", "_", (name or "").strip())[:120]
    return cleaned or fallback


def _prepare_ocr_engine(pack_id: str, engine: str | None) -> tuple[str, str | None, int]:
    """Start vLLM when the optional runtime is installed, unless this run asks for Transformers.

    A missing env-vllm is quiet: that run uses Transformers. A runtime that is
    present but unhealthy still raises 503 so the UI can offer a choice.
    Callers must release_ocr_gpu() when the work finishes or is cancelled.
    """
    from services.vllm_supervisor import (
        VllmUnavailable,
        ensure_started,
        hold_ocr_gpu,
        recommended_concurrency,
        runtime_installed,
    )

    if (engine or "").strip().lower() == "transformers" or not runtime_installed():
        hold_ocr_gpu()
        return "transformers", None, 1
    repo = ocr_engine.MODEL_REGISTRY[pack_id]["repo_id"]
    try:
        endpoint = ensure_started(
            ocr_engine.resolve_model_source(pack_id),
            served_model_name=repo,
        )
    except VllmUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "vllm_unavailable", "detail": exc.detail},
        ) from exc
    hold_ocr_gpu()
    return "vllm", endpoint, recommended_concurrency()


def _load_project(project_id: str) -> ProjectState:
    try:
        return ProjectState.load(project_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


def _reconcile_ocr_job(project: ProjectState) -> tuple[ProjectState, bool]:
    """
    Clear stale ocr_running when the in-memory job is gone (Pinokio/server restart)
    or already finished. Returns (project, cleared_stale).
    """
    if project.status != "ocr_running":
        return project, False

    job = get_job(project.last_job_id) if project.last_job_id else None
    if job is not None and job.status in ("queued", "running"):
        return project, False

    if job is not None and job.status == "done":
        project.status = "ocr_done"
        project.error = None
        project.pages_done = int(
            (job.result or {}).get("completed")
            or project.pages_done
            or project.processed_page_count()
        )
        project.save()
        return project, False

    if job is not None and job.status == "error":
        project.status = "error"
        project.error = job.error or job.message or "OCR failed"
        project.pages_done = 0
        project.save()
        return project, False

    if job is not None and job.status == "cancelled":
        project.status = "ready" if project.source_path else "needs_source"
        project.error = None
        project.pages_done = 0
        project.save()
        return project, False

    # Job missing (process exit) or unknown — unlock so the user can re-run.
    project.status = "ready" if project.source_path else "needs_source"
    project.error = None
    project.pages_done = 0
    project.save()
    return project, True


@router.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "app": "scribe",
        "device": ocr_engine.device_info(),
        "models": models_status(),
    }


@router.get("/models")
def models() -> dict[str, Any]:
    return {"models": models_catalog()}


@router.get("/models/status")
def models_status_endpoint() -> dict[str, Any]:
    return models_status()


@router.post("/models/{pack_id}/install")
def install_model(pack_id: str) -> dict[str, Any]:
    try:
        job = start_model_job(pack_id, "install")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"job": job.to_dict()}


@router.delete("/models/{pack_id}")
def uninstall_model(pack_id: str) -> dict[str, Any]:
    try:
        job = start_model_job(pack_id, "uninstall")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"job": job.to_dict()}


@router.get("/models/jobs/{job_id}")
def model_job(job_id: str) -> dict[str, Any]:
    job = get_model_job(job_id)
    if job is None:
        raise HTTPException(404, "Model job not found")
    return {"job": job.to_dict()}


@router.get("/vllm")
def vllm_status() -> dict[str, Any]:
    from services.vllm_jobs import status as vllm_runtime_status

    return vllm_runtime_status()


@router.post("/vllm/install")
def vllm_install() -> dict[str, Any]:
    from services.vllm_jobs import start_install

    try:
        job = start_install()
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"job": job.to_dict()}


@router.delete("/vllm")
def vllm_uninstall() -> dict[str, Any]:
    from services.vllm_jobs import start_uninstall

    try:
        job = start_uninstall()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"job": job.to_dict()}


@router.get("/vllm/jobs/{job_id}")
def vllm_job(job_id: str) -> dict[str, Any]:
    from services.vllm_jobs import get_job

    job = get_job(job_id)
    if job is None:
        raise HTTPException(404, "vLLM job not found")
    return {"job": job.to_dict()}


@router.get("/settings/inference")
def get_settings() -> dict[str, Any]:
    return load_settings()


@router.put("/settings/inference")
def put_settings(body: SettingsBody) -> dict[str, Any]:
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    if "ocr_pack_id" in payload:
        try:
            validate_ocr_pack_id(payload["ocr_pack_id"])
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    return save_settings(payload)


@router.get("/projects")
def projects() -> dict[str, Any]:
    return {"projects": list_projects()}


@router.post("/projects")
def create_project(body: CreateProjectBody) -> dict[str, Any]:
    project = ProjectState.create(body.name, body.description)
    return {"project": project.to_public()}


@router.get("/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    project = _load_project(project_id)
    project, cleared = _reconcile_ocr_job(project)
    payload = {"project": project.to_public()}
    if cleared:
        payload["ocr_interrupted"] = True
    return payload


@router.patch("/projects/{project_id}")
def patch_project(project_id: str, body: PatchProjectBody) -> dict[str, Any]:
    project = _load_project(project_id)
    if body.name is not None:
        project.name = body.name.strip() or project.name
    if body.description is not None:
        project.description = body.description.strip()
    if body.clear_cover:
        project.cover_page = None
        project.cover_mode = "none"
        project.clear_cover_upload()
    else:
        if body.cover_mode is not None:
            mode = body.cover_mode.strip().lower()
            if mode not in {"none", "page", "upload"}:
                raise HTTPException(400, "cover_mode must be none, page, or upload")
            project.cover_mode = mode
            if mode == "none":
                project.cover_page = None
            elif mode == "upload" and project.cover_upload_file() is None:
                raise HTTPException(400, "Upload a cover image before selecting upload mode")
        if body.cover_page is not None:
            if project.page_count and body.cover_page > project.page_count:
                raise HTTPException(400, f"Cover page must be between 1 and {project.page_count}")
            project.cover_page = body.cover_page
            if project.cover_mode == "none":
                project.cover_mode = "page"
    if body.cover_jpeg_quality is not None:
        project.cover_jpeg_quality = body.cover_jpeg_quality
    project.save()
    return {"project": project.to_public()}


@router.delete("/projects/{project_id}")
def remove_project(project_id: str) -> dict[str, Any]:
    try:
        delete_project(project_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ok": True}


@router.post("/projects/{project_id}/source")
async def upload_source(
    project_id: str,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    project = _load_project(project_id)

    filename = _safe_filename(file.filename or "document.pdf")
    if not filename.lower().endswith((".pdf", ".png", ".jpg", ".jpeg")):
        raise HTTPException(400, "Upload a PDF or image (png/jpg/jpeg)")

    project.ensure_dirs()
    for child in project.source_dir.iterdir():
        if child.is_file():
            child.unlink(missing_ok=True)

    dest = project.source_dir / filename
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    project.source_filename = filename
    project.source_path = str(dest)
    project.error = None
    project.pages_done = 0
    project.last_start_page = None
    project.last_end_page = None
    if dest.suffix.lower() == ".pdf":
        try:
            project.page_count = ocr_engine.pdf_page_count(dest)
        except Exception as exc:
            raise HTTPException(400, f"Could not read PDF: {exc}") from exc
    else:
        project.page_count = 1
    project.status = "ready"
    project.clear_markdown()
    project.save()
    return {"project": project.to_public()}


@router.post("/projects/{project_id}/cover")
async def upload_cover(
    project_id: str,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Upload an external cover image (used instead of a PDF page)."""
    project = _load_project(project_id)
    filename = _safe_filename(file.filename or "cover.jpg", fallback="cover.jpg")
    if not filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        raise HTTPException(400, "Upload a cover image (png/jpg/jpeg/webp)")

    project.ensure_dirs()
    project.clear_cover_upload()
    dest = project.cover_dir / filename
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    project.cover_upload_path = str(dest)
    project.cover_mode = "upload"
    if project.cover_page is None:
        project.cover_page = 1
    project.save()
    return {"project": project.to_public()}


@router.get("/projects/{project_id}/cover/preview")
def cover_preview(
    project_id: str,
    quality: int = 85,
    page: int | None = None,
    mode: str | None = None,
) -> Response:
    """JPEG preview of the cover at the chosen quality (PDF page or uploaded image)."""
    project = _load_project(project_id)
    quality = max(1, min(95, int(quality)))
    preview_mode = (mode or project.cover_mode or "none").strip().lower()
    if preview_mode not in {"none", "page", "upload"}:
        preview_mode = project.cover_mode or "none"
    cover_page = page or project.cover_page or 1

    try:
        if preview_mode == "upload":
            upload = project.cover_upload_file()
            if upload is None:
                raise HTTPException(404, "No cover image uploaded")
            jpeg = ocr_engine.image_to_jpeg(upload, quality=quality)
            return Response(content=jpeg, media_type="image/jpeg")

        if preview_mode == "page":
            if not project.source_path or not Path(project.source_path).is_file():
                raise HTTPException(400, "No source PDF")
            source = Path(project.source_path)
            if source.suffix.lower() != ".pdf":
                jpeg = ocr_engine.image_to_jpeg(source, quality=quality)
                return Response(content=jpeg, media_type="image/jpeg")
            total = project.page_count or ocr_engine.pdf_page_count(source)
            if cover_page < 1 or cover_page > total:
                raise HTTPException(400, f"Page must be between 1 and {total}")
            jpeg = ocr_engine.render_page_jpeg(source, cover_page, quality=quality)
            return Response(content=jpeg, media_type="image/jpeg")

        raise HTTPException(404, "No cover configured")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"Could not render cover: {exc}") from exc


@router.get("/projects/{project_id}/pages")
def list_pages(project_id: str) -> dict[str, Any]:
    project = _load_project(project_id)
    return {"pages": project.list_processed_pages(), "page_count": project.page_count}


@router.get("/projects/{project_id}/pages/{page_num}/markdown")
def get_page_markdown(project_id: str, page_num: int) -> dict[str, Any]:
    project = _load_project(project_id)
    text = project.read_page_markdown(page_num)
    if text is None:
        raise HTTPException(404, f"No markdown for page {page_num}")
    return {
        "page": page_num,
        "markdown": text,
        "is_cover": bool(project.cover_page == page_num),
        "has_image": project.page_image_path(page_num).is_file(),
    }


@router.put("/projects/{project_id}/pages/{page_num}/markdown")
def save_page_markdown(project_id: str, page_num: int, body: SavePageMarkdownBody) -> dict[str, Any]:
    """Overwrite a single page's Markdown (Edit tab / autosave)."""
    project = _load_project(project_id)
    if page_num < 1 or (project.page_count and page_num > project.page_count):
        raise HTTPException(400, f"Page {page_num} is out of range")
    if project.read_page_markdown(page_num) is None:
        raise HTTPException(404, f"No markdown for page {page_num} — process it with OCR first")
    project.write_page_markdown(page_num, body.markdown)
    project.save()
    return {
        "page": page_num,
        "markdown": body.markdown,
        "is_cover": bool(project.cover_page == page_num),
        "has_image": project.page_image_path(page_num).is_file(),
        "project": project.to_public(),
    }


def _validate_region(body: RegionBody) -> None:
    if body.x + body.width > 1.0001 or body.y + body.height > 1.0001:
        raise HTTPException(400, "Selection region must stay within the page")


@router.post("/projects/{project_id}/pages/{page_num}/region-ocr")
def region_ocr(project_id: str, page_num: int, body: RegionBody) -> dict[str, Any]:
    """OCR a selected region and replace that page's Markdown."""
    project = _load_project(project_id)
    project, _ = _reconcile_ocr_job(project)
    _validate_region(body)
    if not project.source_path or not Path(project.source_path).is_file():
        raise HTTPException(400, "No source PDF")
    if page_num < 1 or (project.page_count and page_num > project.page_count):
        raise HTTPException(400, f"Page {page_num} is out of range")
    live = get_job(project.last_job_id) if project.last_job_id else None
    if project.status == "ocr_running" and live and live.status in ("queued", "running"):
        raise HTTPException(409, "OCR is already running for this project")

    settings = load_settings()
    pack_id = project.ocr_pack_id or settings.get("ocr_pack_id") or "lightonocr-2-1b"
    try:
        require_ocr(pack_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc

    temperature = float(settings.get("temperature") if settings.get("temperature") is not None else 0.2)
    max_tokens = int(settings.get("max_output_tokens") or 2048)
    fade_threshold = max(0, min(100, int(project.fade_threshold or 0)))
    from services.vllm_supervisor import release_ocr_gpu

    # Region re-scan is for manual editing. Keep it on Transformers so a
    # single crop does not start the ~10 GB vLLM server.
    ocr_engine_name, vllm_endpoint, _workers = _prepare_ocr_engine(pack_id, "transformers")
    try:
        try:
            markdown = ocr_engine.ocr_image_region(
                project.source_path,
                page_num,
                x=body.x,
                y=body.y,
                width=body.width,
                height=body.height,
                pack_id=pack_id,
                fade_threshold=fade_threshold,
                temperature=temperature,
                max_tokens=max_tokens,
                engine=ocr_engine_name,
                vllm_endpoint=vllm_endpoint,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            logger.exception("region OCR failed")
            raise HTTPException(500, f"Region OCR failed: {exc}") from exc
    finally:
        release_ocr_gpu()

    project.write_page_markdown(page_num, markdown)
    project.save()
    return {
        "page": page_num,
        "markdown": markdown,
        "project": project.to_public(),
    }


@router.post("/projects/{project_id}/pages/{page_num}/extract-image")
def extract_page_image(project_id: str, page_num: int, body: RegionBody) -> dict[str, Any]:
    """Crop a selected region and save it as page-XXXX-NNN.jpg."""
    project = _load_project(project_id)
    _validate_region(body)
    if not project.source_path or not Path(project.source_path).is_file():
        raise HTTPException(400, "No source PDF")
    if page_num < 1 or (project.page_count and page_num > project.page_count):
        raise HTTPException(400, f"Page {page_num} is out of range")

    quality = body.quality if body.quality is not None else int(project.cover_jpeg_quality or 85)
    quality = max(1, min(95, quality))
    try:
        jpeg = ocr_engine.extract_image_region(
            project.source_path,
            page_num,
            x=body.x,
            y=body.y,
            width=body.width,
            height=body.height,
            quality=quality,
        )
        path = project.write_extract_image(page_num, jpeg)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("extract image failed")
        raise HTTPException(500, f"Extract image failed: {exc}") from exc

    project.save()
    return {
        "page": page_num,
        "filename": path.name,
        "url": f"/api/projects/{project.id}/assets/{path.name}",
        "project": project.to_public(),
    }


@router.get("/projects/{project_id}/images")
def list_project_images(project_id: str, page: int | None = None) -> dict[str, Any]:
    """List extracted page images (page-XXXX-NNN.jpg)."""
    project = _load_project(project_id)
    images = project.list_extract_images(page)
    for row in images:
        row["url"] = f"/api/projects/{project.id}/assets/{row['filename']}"
    return {"images": images, "count": len(images)}


@router.get("/projects/{project_id}/assets/{filename}")
def get_project_asset(project_id: str, filename: str) -> FileResponse:
    """Serve a markdown-dir image (cover JPEG or region extract)."""
    project = _load_project(project_id)
    path = project.resolve_asset_image(filename)
    if path is None:
        raise HTTPException(404, "Image not found")
    suffix = path.suffix.lower()
    media = "image/jpeg" if suffix in {".jpg", ".jpeg"} else f"image/{suffix.lstrip('.')}"
    return FileResponse(path, media_type=media)


@router.get("/projects/{project_id}/cleaning/analyze")
def cleaning_analyze(project_id: str) -> dict[str, Any]:
    """Detect recurring header/footer lines across processed pages."""
    project = _load_project(project_id)
    pages_meta = project.list_processed_pages()
    loaded: list[tuple[int, str]] = []
    for row in pages_meta:
        if row.get("is_cover"):
            continue
        text = project.read_page_markdown(int(row["page"]))
        if text is None:
            continue
        loaded.append((int(row["page"]), text))
    candidates = cleaning_engine.analyze_running_headers(loaded)
    return {
        "page_count": len(loaded),
        "candidates": candidates,
        "suggested_title": candidates[0]["text"] if candidates else "",
    }


@router.post("/projects/{project_id}/cleaning/preview")
def cleaning_preview(project_id: str, body: CleanPreviewBody) -> dict[str, Any]:
    project = _load_project(project_id)
    text = project.read_page_markdown(body.page)
    if text is None:
        raise HTTPException(404, f"No markdown for page {body.page}")
    options = cleaning_engine.CleanOptions.from_dict(body.options.model_dump())
    result = cleaning_engine.preview_page(text, options)
    return {"page": body.page, **result}


@router.post("/projects/{project_id}/cleaning/apply")
def cleaning_apply(project_id: str, body: CleanApplyBody) -> dict[str, Any]:
    project = _load_project(project_id)
    options = cleaning_engine.CleanOptions.from_dict(body.options.model_dump())
    pages_meta = project.list_processed_pages()
    updated = 0
    skipped = 0
    unchanged = 0
    for row in pages_meta:
        page_num = int(row["page"])
        if body.start_page is not None and page_num < body.start_page:
            continue
        if body.end_page is not None and page_num > body.end_page:
            continue
        if row.get("is_cover"):
            skipped += 1
            continue
        text = project.read_page_markdown(page_num)
        if text is None:
            skipped += 1
            continue
        cleaned, _removed = cleaning_engine.clean_markdown(text, options)
        if cleaned == text:
            unchanged += 1
            continue
        project.write_page_markdown(page_num, cleaned)
        updated += 1
    project.save()
    return {
        "updated": updated,
        "unchanged": unchanged,
        "skipped": skipped,
        "project": project.to_public(),
    }


@router.get("/projects/{project_id}/pages/{page_num}/image")
def get_page_image(project_id: str, page_num: int) -> FileResponse:
    """Cover JPEG (or any saved page image)."""
    project = _load_project(project_id)
    path = project.page_image_path(page_num)
    if not path.is_file():
        # try any matching stem width
        for candidate in project.markdown_dir.glob(f"page-*{page_num}.jpg"):
            path = candidate
            break
        # also match zero-padded
        for candidate in project.markdown_dir.glob("page-*.jpg"):
            stem = candidate.stem.replace("page-", "")
            if stem.isdigit() and int(stem) == page_num:
                path = candidate
                break
    if not path.is_file():
        raise HTTPException(404, f"No image for page {page_num}")
    return FileResponse(path, media_type="image/jpeg")


@router.get("/projects/{project_id}/pages/{page_num}/preview")
def get_page_preview(project_id: str, page_num: int, quality: int = 80) -> Response:
    """Render the PDF page as JPEG for the Preview pane (not OCR output)."""
    project = _load_project(project_id)
    if not project.source_path or not Path(project.source_path).is_file():
        raise HTTPException(400, "No source PDF")
    source = Path(project.source_path)
    if source.suffix.lower() != ".pdf":
        # Single image source
        return FileResponse(source)
    total = project.page_count or ocr_engine.pdf_page_count(source)
    if page_num < 1 or page_num > total:
        raise HTTPException(400, f"Page must be between 1 and {total}")
    try:
        jpeg = ocr_engine.render_page_jpeg(source, page_num, quality=quality)
    except Exception as exc:
        raise HTTPException(400, f"Could not render page: {exc}") from exc
    return Response(content=jpeg, media_type="image/jpeg")


@router.post("/projects/{project_id}/ocr")
def start_ocr(project_id: str, body: StartOcrBody | None = None) -> dict[str, Any]:
    body = body or StartOcrBody()
    project = _load_project(project_id)
    project, _ = _reconcile_ocr_job(project)

    if not project.source_path or not Path(project.source_path).is_file():
        raise HTTPException(400, "Upload a PDF or image before starting OCR")

    live = get_job(project.last_job_id) if project.last_job_id else None
    if project.status == "ocr_running" and live and live.status in ("queued", "running"):
        raise HTTPException(409, "OCR is already running for this project")

    settings = load_settings()
    pack_id = body.pack_id or settings.get("ocr_pack_id") or "lightonocr-2-1b"
    try:
        require_ocr(pack_id)
    except FileNotFoundError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    temperature = (
        float(body.temperature)
        if body.temperature is not None
        else float(settings.get("temperature", 0.2))
    )
    max_tokens = (
        int(body.max_output_tokens)
        if body.max_output_tokens is not None
        else int(settings.get("max_output_tokens", 2048))
    )

    total = project.page_count or 1
    start_page = max(1, min(body.start_page, total))
    end_page = body.end_page if body.end_page is not None else total
    end_page = max(start_page, min(end_page, total))

    if body.clear_cover:
        project.cover_page = None
        project.cover_mode = "none"
        project.clear_cover_upload()
    else:
        if body.cover_mode is not None:
            mode = body.cover_mode.strip().lower()
            if mode not in {"none", "page", "upload"}:
                raise HTTPException(400, "cover_mode must be none, page, or upload")
            if mode == "upload" and project.cover_upload_file() is None:
                raise HTTPException(400, "Upload a cover image before selecting upload mode")
            project.cover_mode = mode
            if mode == "none":
                project.cover_page = None
        if body.cover_page is not None:
            if body.cover_page > total:
                raise HTTPException(400, f"Cover page must be between 1 and {total}")
            project.cover_page = body.cover_page
            if project.cover_mode in (None, "none") and body.cover_mode is None:
                project.cover_mode = "page"
    if body.cover_jpeg_quality is not None:
        project.cover_jpeg_quality = body.cover_jpeg_quality

    if body.fade_threshold is not None:
        project.fade_threshold = max(0, min(100, int(body.fade_threshold)))

    cover_mode = project.cover_mode or "none"
    cover_page = project.cover_page if cover_mode != "none" else None
    cover_quality = project.cover_jpeg_quality
    fade_threshold = max(0, min(100, int(project.fade_threshold or 0)))
    source_path = Path(project.source_path)

    cover_jpeg_bytes: bytes | None = None
    if cover_mode == "upload" and cover_page is not None:
        upload = project.cover_upload_file()
        if upload is None:
            raise HTTPException(400, "Upload a cover image first")
        cover_jpeg_bytes = ocr_engine.image_to_jpeg(upload, quality=cover_quality)

    project.last_start_page = start_page
    project.last_end_page = end_page
    project.save()

    from services.vllm_supervisor import release_ocr_gpu

    ocr_engine_name, vllm_endpoint, ocr_concurrency = _prepare_ocr_engine(pack_id, body.engine)
    worker_owns_gpu = False

    def worker(job) -> None:
        try:
            _run_ocr_job(job)
        finally:
            release_ocr_gpu()

    def _run_ocr_job(job) -> None:
        proj = ProjectState.load(project_id)
        proj.status = "ocr_running"
        proj.error = None
        proj.ocr_pack_id = pack_id
        proj.last_job_id = job.id
        proj.pages_done = 0
        proj.last_start_page = start_page
        proj.last_end_page = end_page
        proj.save()

        def on_progress(done: int, range_len: int, message: str) -> None:
            if job.cancel_requested:
                raise RuntimeError("OCR cancelled")
            job.message = message
            job.progress = done / max(range_len, 1)
            job.result = {
                "done": done,
                "range_len": range_len,
                "start_page": start_page,
                "end_page": end_page,
                "engine": ocr_engine_name,
            }
            p = ProjectState.load(project_id)
            p.pages_done = done
            p.last_job_id = job.id
            p.status = "ocr_running"
            p.save()

        def on_cover(page_num: int, jpeg: bytes) -> None:
            if job.cancel_requested:
                raise RuntimeError("OCR cancelled")
            p = ProjectState.load(project_id)
            p.write_cover_page(page_num, jpeg, alt="Cover")
            p.save()

        def on_ocr_page(page_num: int, markdown: str) -> None:
            if job.cancel_requested:
                raise RuntimeError("OCR cancelled")
            p = ProjectState.load(project_id)
            p.write_page_markdown(page_num, markdown)
            # Drop stale cover jpeg if this page was previously a cover
            img = p.page_image_path(page_num)
            if img.is_file() and p.cover_page != page_num:
                img.unlink(missing_ok=True)
            p.save()

        def cancel_check() -> bool:
            return bool(job.cancel_requested)

        try:
            # If cover sits outside the OCR range, write it first.
            if (
                cover_page is not None
                and (cover_page < start_page or cover_page > end_page)
            ):
                if cancel_check():
                    raise RuntimeError("OCR cancelled")
                job.message = f"Cover page {cover_page}"
                if cover_jpeg_bytes is not None:
                    jpeg = cover_jpeg_bytes
                elif source_path.suffix.lower() == ".pdf":
                    jpeg = ocr_engine.render_page_jpeg(
                        source_path, cover_page, quality=cover_quality
                    )
                else:
                    jpeg = ocr_engine.image_to_jpeg(source_path, quality=cover_quality)
                on_cover(cover_page, jpeg)

            if source_path.suffix.lower() == ".pdf":
                result = ocr_engine.process_pdf_range(
                    source_path,
                    pack_id,
                    start_page=start_page,
                    end_page=end_page,
                    cover_page=cover_page,
                    cover_jpeg_quality=cover_quality,
                    cover_jpeg_bytes=cover_jpeg_bytes,
                    fade_threshold=fade_threshold,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    engine=ocr_engine_name,
                    vllm_endpoint=vllm_endpoint,
                    concurrency=ocr_concurrency,
                    on_cover=on_cover,
                    on_ocr_page=on_ocr_page,
                    on_progress=on_progress,
                    cancel_check=cancel_check,
                )
            else:
                from PIL import Image

                if cancel_check():
                    raise RuntimeError("OCR cancelled")
                job.message = "OCR image"
                job.progress = 0.1
                if cover_page == 1:
                    if cover_jpeg_bytes is not None:
                        on_cover(1, cover_jpeg_bytes)
                    else:
                        on_cover(1, ocr_engine.image_to_jpeg(source_path, quality=cover_quality))
                else:
                    image = Image.open(source_path)
                    image = ocr_engine.crush_near_paper(image, fade_threshold)
                    raw = ocr_engine.extract_text_from_image(
                        image,
                        pack_id,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        engine=ocr_engine_name,
                        vllm_endpoint=vllm_endpoint,
                    )
                    meta = ocr_engine.MODEL_REGISTRY.get(pack_id, {})
                    markdown = (
                        ocr_engine.render_bbox_with_crops(raw, image)
                        if meta.get("has_bbox")
                        else raw
                    )
                    on_ocr_page(1, markdown.strip())
                on_progress(1, 1, "Done page 1 of 1")
                result = {"start_page": 1, "end_page": 1, "completed": 1}

            if job.cancel_requested:
                raise RuntimeError("OCR cancelled")

            proj = ProjectState.load(project_id)
            proj.status = "ocr_done"
            proj.error = None
            proj.pages_done = int(result.get("completed") or proj.pages_done)
            proj.save()
            job.message = "OCR complete"
            job.result = {
                **result,
                "pages_processed": proj.processed_page_count(),
            }
        except Exception as exc:
            if job.cancel_requested or "cancelled" in str(exc).lower():
                logger.info("OCR cancelled for %s", project_id)
                proj = ProjectState.load(project_id)
                proj.status = "ready"
                proj.error = None
                proj.pages_done = 0
                proj.save()
                job.status = "cancelled"
                job.message = "Cancelled"
                job.error = None
                return
            from services.vllm_supervisor import VllmUnavailable

            detail = exc.detail if isinstance(exc, VllmUnavailable) else str(exc)
            logger.exception("OCR failed for %s", project_id)
            proj = ProjectState.load(project_id)
            proj.status = "error"
            proj.error = detail
            proj.save()
            if isinstance(exc, VllmUnavailable):
                job.status = "error"
                job.error = detail
                job.message = detail
                job.result = {"code": "vllm_unavailable", "detail": detail}
                return
            raise

    try:
        job = start_job("ocr", worker)
        worker_owns_gpu = True
    finally:
        if not worker_owns_gpu:
            release_ocr_gpu()
    project.last_job_id = job.id
    project.status = "ocr_running"
    project.save()
    return {"job": job.to_dict(), "project": project.to_public()}


@router.post("/projects/{project_id}/ocr/cancel")
def cancel_ocr(project_id: str) -> dict[str, Any]:
    project = _load_project(project_id)
    if not project.last_job_id:
        project, _ = _reconcile_ocr_job(project)
        raise HTTPException(400, "No OCR job to cancel")

    job = request_cancel(project.last_job_id)
    if job is None:
        project, _ = _reconcile_ocr_job(project)
        return {
            "job": None,
            "project": project.to_public(),
            "message": "Job was no longer running; project unlocked.",
        }

    if job.status in ("done", "error", "cancelled"):
        project, _ = _reconcile_ocr_job(project)
        return {"job": job.to_dict(), "project": project.to_public()}

    return {
        "job": job.to_dict(),
        "project": project.to_public(),
        "message": "Cancel requested — stopping after the current page.",
    }


@router.get("/projects/{project_id}/index")
def get_index(project_id: str) -> dict[str, Any]:
    project = _load_project(project_id)
    state = index_builder.load_index(project)
    return {"index": index_builder.public_index(state)}


@router.put("/projects/{project_id}/index")
def save_index(project_id: str, body: IndexSaveBody) -> dict[str, Any]:
    project = _load_project(project_id)
    prev = index_builder.load_index(project)
    state = index_builder.IndexState(
        title=(body.title or "Contents").strip() or "Contents",
        replace_start=body.replace_start,
        replace_end=body.replace_end if body.replace_end is not None else body.replace_start,
        entries=[
            index_builder.IndexEntry.from_dict(
                {
                    "id": row.id,
                    "label": row.label,
                    "page": row.page,
                    "anchor": row.anchor,
                    "level": row.level,
                    "enabled": row.enabled,
                    "source": row.source or "manual",
                }
            )
            for row in body.entries
        ],
        applied=prev.applied,
        applied_at=prev.applied_at,
    )
    if state.replace_start is not None and state.replace_end is not None and state.replace_end < state.replace_start:
        state.replace_start, state.replace_end = state.replace_end, state.replace_start
    index_builder.save_index(project, state)
    return {"index": index_builder.public_index(state)}


@router.post("/projects/{project_id}/index/scan")
def scan_index(project_id: str, body: IndexScanBody) -> dict[str, Any]:
    project = _load_project(project_id)
    if project.processed_page_count() < 1:
        raise HTTPException(400, "No processed pages to scan. Run OCR first.")
    current = index_builder.load_index(project)
    rs = body.replace_start if body.replace_start is not None else current.replace_start
    re_ = body.replace_end if body.replace_end is not None else current.replace_end
    scanned = index_builder.scan_project(project, replace_start=rs, replace_end=re_)
    entries = list(scanned)
    if body.keep_manual:
        for entry in current.entries:
            if entry.source == "manual":
                entries.append(entry)
    state = index_builder.IndexState(
        title=(body.title or current.title or "Contents").strip() or "Contents",
        replace_start=rs,
        replace_end=re_ if re_ is not None else rs,
        entries=entries,
        applied=False,
        applied_at=None,
    )
    index_builder.save_index(project, state)
    return {"index": index_builder.public_index(state)}


@router.post("/projects/{project_id}/index/apply")
def apply_index(
    project_id: str,
    body: IndexSaveBody | None = Body(default=None),
) -> dict[str, Any]:
    project = _load_project(project_id)
    if body is not None:
        state = index_builder.IndexState(
            title=(body.title or "Contents").strip() or "Contents",
            replace_start=body.replace_start,
            replace_end=body.replace_end if body.replace_end is not None else body.replace_start,
            entries=[
                index_builder.IndexEntry.from_dict(
                    {
                        "id": row.id,
                        "label": row.label,
                        "page": row.page,
                        "anchor": row.anchor,
                        "level": row.level,
                        "enabled": row.enabled,
                        "source": row.source or "manual",
                    }
                )
                for row in body.entries
            ],
        )
    else:
        state = index_builder.load_index(project)
    try:
        state = index_builder.apply_index(project, state)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"index": index_builder.public_index(state), "project": project.to_public()}


@router.get("/projects/{project_id}/export/metadata")
def get_export_metadata(project_id: str, detect: bool = False) -> dict[str, Any]:
    project = _load_project(project_id)
    if not detect:
        saved = metadata_scrape.load_metadata(project)
        if saved is not None:
            return {"metadata": saved.to_dict(), "source": "saved"}
    detected = metadata_scrape.scrape_project_metadata(project)
    if not detected.title:
        detected.title = project.name or ""
    return {"metadata": detected.to_dict(), "source": "detected"}


@router.put("/projects/{project_id}/export/metadata")
def put_export_metadata(project_id: str, body: EpubExportBody) -> dict[str, Any]:
    project = _load_project(project_id)
    meta = metadata_scrape.BookMetadata(
        title=(body.title or "").strip(),
        authors=(body.authors or body.author or "").strip(),
        publisher=(body.publisher or "").strip(),
        year=(body.year or "").strip(),
        description=(body.description or "").strip(),
        rights=(body.rights or "").strip(),
        language=(body.language or "en").strip() or "en",
        isbn=(body.isbn or "").strip(),
    )
    metadata_scrape.save_metadata(project, meta)
    return {"metadata": meta.to_dict(), "source": "saved"}


@router.post("/projects/{project_id}/export/metadata/lookup")
def lookup_export_metadata(project_id: str, body: MetadataLookupBody) -> dict[str, Any]:
    _load_project(project_id)  # ensure project exists / auth boundary
    try:
        result = metadata_lookup.lookup_open_library(
            title=body.title,
            authors=body.authors or body.author,
            isbn=body.isbn,
            limit=body.limit,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return result


@router.post("/projects/{project_id}/export/epub")
def export_epub(
    project_id: str,
    body: EpubExportBody | None = Body(default=None),
) -> Response:
    project = _load_project(project_id)
    if project.processed_page_count() < 1:
        raise HTTPException(400, "No processed pages to export. Run OCR first.")
    body = body or EpubExportBody()
    # Persist the form used for this download so edits survive reloads
    metadata_scrape.save_metadata(
        project,
        metadata_scrape.BookMetadata(
            title=(body.title or "").strip(),
            authors=(body.authors or body.author or "").strip(),
            publisher=(body.publisher or "").strip(),
            year=(body.year or "").strip(),
            description=(body.description or "").strip(),
            rights=(body.rights or "").strip(),
            language=(body.language or "en").strip() or "en",
            isbn=(body.isbn or "").strip(),
        ),
    )
    try:
        data = epub_export.build_epub(
            project,
            title=body.title,
            authors=body.authors or body.author,
            publisher=body.publisher,
            year=body.year,
            description=body.description,
            rights=body.rights,
            language=body.language or "en",
            isbn=body.isbn,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("EPUB export failed for %s", project_id)
        raise HTTPException(500, f"EPUB export failed: {exc}") from exc

    filename = f"{slugify(body.title or project.name or 'book')}.epub"
    return Response(
        content=data,
        media_type="application/epub+zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return {"job": job.to_dict()}

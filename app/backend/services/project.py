from __future__ import annotations

import json
import logging
import os
import re
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import DEFAULT_OCR_PACK_ID, PROJECTS_DIR

logger = logging.getLogger("scribe.project")

REBUILD_NOTICE = (
    "Project metadata was missing and has been rebuilt from the files on disk. "
    "The name is taken from the PDF. Check the cover and page range before you continue."
)

_save_locks: dict[str, threading.Lock] = {}
_save_locks_guard = threading.Lock()

_PAGE_MD_RE = re.compile(r"^page-(\d+)\.md$", re.IGNORECASE)
_PAGE_EXTRACT_RE = re.compile(r"^page-(\d+)-(\d{3})\.(jpe?g|png|webp)$", re.IGNORECASE)
_SAFE_IMAGE_NAME_RE = re.compile(r"^page-\d+(?:-\d{3})?\.(jpe?g|png|webp)$", re.IGNORECASE)


def _save_lock_for(project_id: str) -> threading.Lock:
    with _save_locks_guard:
        lock = _save_locks.get(project_id)
        if lock is None:
            lock = threading.Lock()
            _save_locks[project_id] = lock
        return lock


def _write_durable(path: Path, text: str) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())


def _parse_project_json(path: Path) -> dict[str, Any] | None:
    """Return project metadata, or None when the file is missing or torn.

    A crash during save can leave project.json as a block of null bytes.
    """
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if not raw or all(byte == 0 for byte in raw):
        return None
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or not data.get("id") or not data.get("name"):
        return None
    return data


def _read_project_data(path: Path) -> tuple[dict[str, Any], bool]:
    data = _parse_project_json(path)
    if data is not None:
        return data, False
    backup = path.with_suffix(".json.bak")
    data = _parse_project_json(backup)
    if data is None:
        raise FileNotFoundError(f"Project file is unreadable: {path}")
    logger.warning("Restored project metadata for %s from %s", data.get("id"), backup.name)
    return data, True


def _replace_with_retry(src: Path, dest: Path, attempts: int = 12) -> None:
    last_error: OSError | None = None
    for attempt in range(attempts):
        try:
            src.replace(dest)
            return
        except PermissionError as exc:
            last_error = exc
            time.sleep(0.025 * (attempt + 1))
    if last_error:
        raise last_error


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def slugify(name: str) -> str:
    text = re.sub(r"[^\w\s-]", "", name.strip().lower())
    text = re.sub(r"[-\s]+", "-", text).strip("-")
    return text[:48] or "document"


def page_width(total_or_page: int) -> int:
    """At least 4 digits; grow for books over 9999 pages."""
    return max(4, len(str(max(1, int(total_or_page)))))


def page_stem(page_num: int, total_pages: int | None = None) -> str:
    width = page_width(total_pages if total_pages is not None else page_num)
    return f"page-{int(page_num):0{width}d}"


@dataclass
class ProjectState:
    id: str
    name: str
    description: str = ""
    status: str = "created"  # created | needs_source | ready | ocr_running | ocr_done | error
    source_filename: str | None = None
    source_path: str | None = None
    page_count: int | None = None
    pages_done: int = 0  # pages completed in the current/last job range
    last_job_id: str | None = None
    error: str | None = None
    ocr_pack_id: str | None = None
    cover_page: int | None = None
    cover_jpeg_quality: int = 85
    cover_mode: str = "none"  # none | page | upload
    cover_upload_path: str | None = None
    fade_threshold: int = 0  # 0 = off; 1–100 crush near-paper (bleed-through)
    last_start_page: int | None = None
    last_end_page: int | None = None
    created_at: str | None = None
    updated_at: str | None = None

    @property
    def root(self) -> Path:
        return PROJECTS_DIR / self.id

    @property
    def source_dir(self) -> Path:
        return self.root / "source"

    @property
    def markdown_dir(self) -> Path:
        return self.root / "markdown"

    @property
    def cover_dir(self) -> Path:
        return self.root / "cover"

    @property
    def output_dir(self) -> Path:
        """Legacy single-file output; kept for older projects."""
        return self.root / "output"

    def touch(self) -> None:
        self.updated_at = _utc_now()

    def ensure_dirs(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.source_dir.mkdir(parents=True, exist_ok=True)
        self.markdown_dir.mkdir(parents=True, exist_ok=True)
        self.cover_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def cover_upload_file(self) -> Path | None:
        if self.cover_upload_path and Path(self.cover_upload_path).is_file():
            return Path(self.cover_upload_path)
        # Fallback: any file in cover/
        if self.cover_dir.is_dir():
            for child in self.cover_dir.iterdir():
                if child.is_file() and child.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                    return child
        return None

    def clear_cover_upload(self) -> None:
        self.ensure_dirs()
        for child in self.cover_dir.iterdir():
            if child.is_file():
                child.unlink(missing_ok=True)
        self.cover_upload_path = None

    def page_md_path(self, page_num: int) -> Path:
        return self.markdown_dir / f"{page_stem(page_num, self.page_count)}.md"

    def page_image_path(self, page_num: int) -> Path:
        return self.markdown_dir / f"{page_stem(page_num, self.page_count)}.jpg"

    def next_extract_filename(self, page_num: int) -> str:
        """Next free extract name: page-0004-001.jpg, page-0004-002.jpg, …"""
        self.ensure_dirs()
        stem = page_stem(page_num, self.page_count)
        # Also honour legacy/alternate zero-padding that may already exist
        used: set[int] = set()
        for path in self.markdown_dir.glob("page-*-*.jpg"):
            match = _PAGE_EXTRACT_RE.match(path.name)
            if not match:
                continue
            if int(match.group(1)) != int(page_num):
                continue
            used.add(int(match.group(2)))
        n = 1
        while n in used:
            n += 1
        if n > 999:
            raise ValueError(f"Too many extracted images for page {page_num}")
        return f"{stem}-{n:03d}.jpg"

    def write_extract_image(self, page_num: int, jpeg_bytes: bytes) -> Path:
        self.ensure_dirs()
        name = self.next_extract_filename(page_num)
        path = self.markdown_dir / name
        path.write_bytes(jpeg_bytes)
        return path

    def list_extract_images(self, page_num: int | None = None) -> list[dict[str, Any]]:
        """List saved region extracts (page-XXXX-NNN.jpg), optionally for one page."""
        self.ensure_dirs()
        rows: list[dict[str, Any]] = []
        for path in sorted(self.markdown_dir.glob("page-*-*.jpg")):
            match = _PAGE_EXTRACT_RE.match(path.name)
            if not match:
                continue
            pnum = int(match.group(1))
            if page_num is not None and pnum != int(page_num):
                continue
            rows.append(
                {
                    "filename": path.name,
                    "page": pnum,
                    "index": int(match.group(2)),
                    "bytes": path.stat().st_size,
                }
            )
        rows.sort(key=lambda row: (row["page"], row["index"]))
        return rows

    def resolve_asset_image(self, filename: str) -> Path | None:
        """Resolve a safe markdown-dir image name (cover or extract)."""
        name = Path(str(filename or "")).name
        if not _SAFE_IMAGE_NAME_RE.match(name):
            return None
        path = self.markdown_dir / name
        return path if path.is_file() else None

    def write_page_markdown(self, page_num: int, text: str) -> Path:
        self.ensure_dirs()
        path = self.page_md_path(page_num)
        path.write_text(text, encoding="utf-8")
        return path

    def write_cover_page(self, page_num: int, jpeg_bytes: bytes, *, alt: str = "Cover") -> Path:
        """Save JPEG beside markdown that embeds it (no OCR text)."""
        self.ensure_dirs()
        stem = page_stem(page_num, self.page_count)
        img_path = self.markdown_dir / f"{stem}.jpg"
        md_path = self.markdown_dir / f"{stem}.md"
        img_path.write_bytes(jpeg_bytes)
        md_path.write_text(f"![{alt}]({stem}.jpg)\n", encoding="utf-8")
        return md_path

    def read_page_markdown(self, page_num: int) -> str | None:
        path = self.page_md_path(page_num)
        # Also try alternate widths if total_pages changed
        if path.is_file():
            return path.read_text(encoding="utf-8")
        for candidate in self.markdown_dir.glob("page-*.md"):
            match = _PAGE_MD_RE.match(candidate.name)
            if match and int(match.group(1)) == page_num:
                return candidate.read_text(encoding="utf-8")
        return None

    def list_processed_pages(self) -> list[dict[str, Any]]:
        self.ensure_dirs()
        pages: list[dict[str, Any]] = []
        seen: set[int] = set()
        for path in sorted(self.markdown_dir.glob("page-*.md")):
            match = _PAGE_MD_RE.match(path.name)
            if not match:
                continue
            num = int(match.group(1))
            if num in seen:
                continue
            seen.add(num)
            stem = path.stem
            jpg = path.with_suffix(".jpg")
            pages.append(
                {
                    "page": num,
                    "stem": stem,
                    "has_markdown": True,
                    "has_image": jpg.is_file(),
                    "is_cover": bool(self.cover_page and num == self.cover_page and jpg.is_file()),
                    "chars": path.stat().st_size,
                }
            )
        pages.sort(key=lambda row: row["page"])
        return pages

    def processed_page_count(self) -> int:
        return len(self.list_processed_pages())

    def clear_markdown(self) -> None:
        self.ensure_dirs()
        for child in self.markdown_dir.iterdir():
            if child.is_file():
                child.unlink(missing_ok=True)
        legacy = self.output_dir / "document.md"
        if legacy.is_file():
            legacy.unlink(missing_ok=True)

    def save(self) -> None:
        self.ensure_dirs()
        if not self.created_at:
            self.created_at = _utc_now()
        self.touch()
        quality = int(self.cover_jpeg_quality or 85)
        quality = max(1, min(95, quality))
        self.cover_jpeg_quality = quality
        payload = {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "status": self.status,
            "source_filename": self.source_filename,
            "source_path": self.source_path,
            "page_count": self.page_count,
            "pages_done": self.pages_done,
            "last_job_id": self.last_job_id,
            "error": self.error,
            "ocr_pack_id": self.ocr_pack_id,
            "cover_page": self.cover_page,
            "cover_jpeg_quality": self.cover_jpeg_quality,
            "cover_mode": self.cover_mode or "none",
            "cover_upload_path": self.cover_upload_path,
            "fade_threshold": max(0, min(100, int(self.fade_threshold or 0))),
            "last_start_page": self.last_start_page,
            "last_end_page": self.last_end_page,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
        path = self.root / "project.json"
        tmp_path = path.with_suffix(".json.tmp")
        backup_path = path.with_suffix(".json.bak")
        backup_tmp = path.with_suffix(".bak.tmp")
        text = json.dumps(payload, ensure_ascii=False, indent=2)
        with _save_lock_for(self.id):
            # Flush a new file, then swap it in. The previous backup is left
            # untouched until that swap succeeds, so a crash cannot zero both.
            _write_durable(tmp_path, text)
            _replace_with_retry(tmp_path, path)
            _write_durable(backup_tmp, text)
            _replace_with_retry(backup_tmp, backup_path)

    @classmethod
    def load(cls, project_id: str) -> "ProjectState":
        folder = PROJECTS_DIR / project_id
        project = _load_folder(folder)
        if project is None:
            raise FileNotFoundError(f"Project not found: {project_id}")
        return project

    @classmethod
    def create(cls, name: str, description: str | None = None) -> "ProjectState":
        project_id = f"{slugify(name)}-{uuid.uuid4().hex[:8]}"
        project = cls(
            id=project_id,
            name=name.strip() or "Untitled document",
            description=(description or "").strip(),
            status="needs_source",
            created_at=_utc_now(),
        )
        project.ensure_dirs()
        project.save()
        return project

    def to_public(self) -> dict[str, Any]:
        has_source = bool(self.source_path and Path(self.source_path).is_file())
        processed = self.list_processed_pages()
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "status": self.status,
            "source_filename": self.source_filename,
            "has_source": has_source,
            "page_count": self.page_count,
            "pages_done": self.pages_done,
            "pages_processed": len(processed),
            "processed_pages": [row["page"] for row in processed],
            "has_markdown": len(processed) > 0,
            "last_job_id": self.last_job_id,
            "error": self.error,
            "ocr_pack_id": self.ocr_pack_id,
            "cover_page": self.cover_page,
            "cover_jpeg_quality": self.cover_jpeg_quality,
            "cover_mode": self.cover_mode or "none",
            "has_cover_upload": self.cover_upload_file() is not None,
            "fade_threshold": max(0, min(100, int(self.fade_threshold or 0))),
            "last_start_page": self.last_start_page,
            "last_end_page": self.last_end_page,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def _state_from_data(data: dict[str, Any]) -> ProjectState:
    quality = int(data.get("cover_jpeg_quality") or 85)
    fade = int(data.get("fade_threshold") or 0)
    return ProjectState(
        id=data["id"],
        name=data["name"],
        description=data.get("description") or "",
        status=data.get("status", "created"),
        source_filename=data.get("source_filename"),
        source_path=data.get("source_path"),
        page_count=data.get("page_count"),
        pages_done=int(data.get("pages_done") or 0),
        last_job_id=data.get("last_job_id"),
        error=data.get("error"),
        ocr_pack_id=data.get("ocr_pack_id"),
        cover_page=data.get("cover_page"),
        cover_jpeg_quality=max(1, min(95, quality)),
        cover_mode=data.get("cover_mode") or ("page" if data.get("cover_page") else "none"),
        cover_upload_path=data.get("cover_upload_path"),
        fade_threshold=max(0, min(100, fade)),
        last_start_page=data.get("last_start_page"),
        last_end_page=data.get("last_end_page"),
        created_at=data.get("created_at"),
        updated_at=data.get("updated_at"),
    )


def _folder_has_work(folder: Path) -> bool:
    source = folder / "source"
    if source.is_dir() and any(path.is_file() for path in source.iterdir()):
        return True
    markdown = folder / "markdown"
    return markdown.is_dir() and any(markdown.glob("page-*.md"))


def _markdown_page_numbers(folder: Path) -> list[int]:
    markdown = folder / "markdown"
    if not markdown.is_dir():
        return []
    numbers: list[int] = []
    for path in markdown.glob("page-*.md"):
        match = _PAGE_MD_RE.match(path.name)
        if match:
            numbers.append(int(match.group(1)))
    return sorted(numbers)


def _source_file(folder: Path) -> Path | None:
    source = folder / "source"
    if not source.is_dir():
        return None
    files = sorted(path for path in source.iterdir() if path.is_file())
    return files[0] if files else None


def _pdf_page_count(path: Path) -> int | None:
    if path.suffix.lower() != ".pdf":
        return 1
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return None
    try:
        pdf = pdfium.PdfDocument(str(path))
    except Exception:
        logger.warning("Could not read page count from %s", path)
        return None
    try:
        return len(pdf)
    finally:
        pdf.close()


def _name_from_files(folder: Path, source: Path | None) -> str:
    if source is not None:
        stem = re.sub(r"\s+", " ", source.stem.replace("_", " ")).strip(" -")
        if stem:
            return stem
    slug = re.sub(r"-[0-9a-f]{8}$", "", folder.name)
    title = slug.replace("-", " ").strip()
    return title or folder.name


def _rebuild_state(folder: Path) -> ProjectState | None:
    if not _folder_has_work(folder):
        return None
    source = _source_file(folder)
    pages = _markdown_page_numbers(folder)
    page_count = _pdf_page_count(source) if source is not None else None
    if page_count is None and pages:
        page_count = pages[-1]
    cover_page = None
    markdown = folder / "markdown"
    if markdown.is_dir():
        for path in sorted(markdown.glob("page-*.jpg")):
            stem_match = re.match(r"^page-(\d+)$", path.stem, re.IGNORECASE)
            if stem_match:
                cover_page = int(stem_match.group(1))
                break
    cover_upload = None
    cover_dir = folder / "cover"
    if cover_dir.is_dir():
        for child in sorted(cover_dir.iterdir()):
            if child.is_file() and child.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                cover_upload = str(child)
                break
    if cover_upload:
        cover_mode = "upload"
    elif cover_page:
        cover_mode = "page"
    else:
        cover_mode = "none"
    done = len(pages)
    if source is None:
        status = "needs_source"
    elif page_count and done >= page_count:
        status = "ocr_done"
    else:
        status = "ready"
    created = datetime.fromtimestamp(folder.stat().st_mtime, timezone.utc).replace(microsecond=0).isoformat()
    logger.warning("Rebuilt missing project metadata for %s", folder.name)
    return ProjectState(
        id=folder.name,
        name=_name_from_files(folder, source),
        description="",
        status=status,
        source_filename=source.name if source else None,
        source_path=str(source) if source else None,
        page_count=page_count,
        pages_done=done,
        error=REBUILD_NOTICE,
        ocr_pack_id=DEFAULT_OCR_PACK_ID,
        cover_page=cover_page,
        cover_mode=cover_mode,
        cover_upload_path=cover_upload,
        last_start_page=1 if page_count else None,
        last_end_page=page_count,
        created_at=created,
        updated_at=_utc_now(),
    )


def _load_folder(folder: Path) -> ProjectState | None:
    if not folder.is_dir():
        return None
    meta = folder / "project.json"
    restored = False
    data: dict[str, Any] | None = None
    with _save_lock_for(folder.name):
        try:
            data, restored = _read_project_data(meta)
        except FileNotFoundError:
            data = None
    if data is not None:
        project = _state_from_data(data)
        if restored:
            logger.warning("Restored project.json for %s from its backup", project.id)
            project.save()
        return project
    project = _rebuild_state(folder)
    if project is None:
        return None
    project.save()
    return project


def list_projects() -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    if not PROJECTS_DIR.exists():
        return results
    for child in sorted(PROJECTS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not child.is_dir():
            continue
        project = _load_folder(child)
        if project is None:
            continue
        processed = project.processed_page_count()
        legacy = child / "output" / "document.md"
        results.append(
            {
                "id": project.id,
                "name": project.name,
                "status": project.status,
                "has_source": bool(project.source_path and Path(project.source_path).is_file()),
                "has_markdown": processed > 0 or legacy.is_file(),
                "page_count": project.page_count,
                "pages_done": project.pages_done,
                "pages_processed": processed,
                "error": project.error,
                "updated_at": project.updated_at,
                "created_at": project.created_at,
            }
        )
    return results


def delete_project(project_id: str) -> None:
    root = PROJECTS_DIR / project_id
    if not root.exists():
        raise FileNotFoundError(f"Project not found: {project_id}")
    shutil.rmtree(root)

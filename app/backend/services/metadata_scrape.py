"""Heuristic scrape of bibliographic metadata from early book pages."""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from services.project import ProjectState

# Strip markdown noise for matching
_MD_NOISE = re.compile(r"[#>*_`\[\]!()]+")
_WS = re.compile(r"\s+")

# "Title, by Author" / "Title by Author" / "Title — Author"
_BY_LINE = re.compile(
    r"(?im)^(?P<title>.{3,120}?)\s*[,–—-]?\s*\bby\b\s+(?P<author>.{3,120})$"
)
_BY_INLINE = re.compile(
    r"(?i)^(?P<title>.{3,100}?)\s+by\s+(?P<author>[A-Z][\w.'\-]+(?:\s+(?:and|&|with)\s+[A-Z][\w.'\-]+|[A-Z][\w.'\-]+){0,6})\s*$"
)

_COPYRIGHT_YEAR = re.compile(
    r"(?i)(?:copyright|\(c\)|©|\bcopyr(?:\.|ight)?)\s*(?:©|\(c\))?\s*(?:19|20)\d{2}\b"
)
_YEAR_ONLY = re.compile(r"\b((?:19|20)\d{2})\b")
_PUBLISHED_BY = re.compile(
    r"(?im)^(?:published\s+by|publisher)\s*[:\-]?\s*(?P<pub>.{2,100})$"
)
_PUBLISHER_LINE = re.compile(
    r"(?im)^(?P<pub>[A-Z][\w &.'\-]{2,60}(?:Press|Books|Publishing|Publishers|House|Inc\.?|Ltd\.?|Co\.?))\s*$"
)
_RIGHTS = re.compile(
    r"(?im)^(.{10,200}(?:all rights reserved|no part of this(?:\s+\w+){0,6}\s+may be reproduced).{0,80})$"
)
_ISBN = re.compile(r"(?i)\bISBN(?:-1[03])?[:\s]*([0-9\-Xx]{10,17})\b")


@dataclass
class BookMetadata:
    title: str = ""
    authors: str = ""  # comma-separated or "A and B"
    publisher: str = ""
    year: str = ""
    description: str = ""
    rights: str = ""
    language: str = "en"
    isbn: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "BookMetadata":
        data = data or {}
        return cls(
            title=str(data.get("title") or "").strip(),
            authors=str(data.get("authors") or data.get("author") or "").strip(),
            publisher=str(data.get("publisher") or "").strip(),
            year=str(data.get("year") or "").strip(),
            description=str(data.get("description") or "").strip(),
            rights=str(data.get("rights") or "").strip(),
            language=str(data.get("language") or "en").strip() or "en",
            isbn=str(data.get("isbn") or "").strip(),
        )


def metadata_path(project: ProjectState) -> Path:
    return project.root / "export_metadata.json"


def load_metadata(project: ProjectState) -> BookMetadata | None:
    """Return persisted export metadata, or None if never saved."""
    path = metadata_path(project)
    if not path.is_file():
        return None
    try:
        return BookMetadata.from_dict(json.loads(path.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, OSError, TypeError, ValueError):
        return None


def save_metadata(project: ProjectState, meta: BookMetadata) -> BookMetadata:
    project.ensure_dirs()
    path = metadata_path(project)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(meta.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return meta


def _plain_lines(markdown: str) -> list[str]:
    lines: list[str] = []
    for raw in (markdown or "").splitlines():
        s = raw.strip()
        if not s or s.startswith("![") or s.startswith("<!--"):
            continue
        s = _MD_NOISE.sub(" ", s)
        s = _WS.sub(" ", s).strip(" -–—|")
        if len(s) >= 2:
            lines.append(s)
    return lines


def _looks_like_title(text: str) -> bool:
    if len(text) < 3 or len(text) > 120:
        return False
    if text.lower() in {"contents", "index", "chapter", "part", "copyright"}:
        return False
    if re.fullmatch(r"\d+", text):
        return False
    return True


def scrape_from_text(pages: list[tuple[int, str]], *, project_name: str = "") -> BookMetadata:
    """Scan early page texts for title/author/publisher/year/rights/isbn."""
    meta = BookMetadata(title=project_name.strip(), language="en")
    all_lines: list[str] = []
    for _page, md in pages:
        all_lines.extend(_plain_lines(md))

    # Title + author patterns
    for line in all_lines[:80]:
        for pat in (_BY_LINE, _BY_INLINE):
            m = pat.match(line)
            if not m:
                continue
            title = m.group("title").strip(" ,.-–—")
            author = m.group("author").strip(" ,.-–—")
            if _looks_like_title(title) and len(author) >= 3:
                if not meta.title or meta.title == project_name:
                    meta.title = title
                if not meta.authors:
                    meta.authors = author
                break
        if meta.authors:
            break

    # Standalone title candidate: first strong heading-like line
    if not meta.title or meta.title == project_name:
        for line in all_lines[:40]:
            if _looks_like_title(line) and not re.search(r"(?i)\bby\b", line):
                # Prefer Title Case / ALL CAPS short lines
                letters = sum(c.isalpha() for c in line)
                if letters >= 4 and (line.isupper() or line.istitle() or letters / max(len(line), 1) > 0.6):
                    meta.title = line
                    break

    # Year from copyright
    blob = "\n".join(all_lines[:120])
    cy = _COPYRIGHT_YEAR.search(blob)
    if cy:
        ym = _YEAR_ONLY.search(cy.group(0))
        if ym:
            meta.year = ym.group(1)
    if not meta.year:
        # First copyright-ish year near "published" / "copyright"
        for line in all_lines[:100]:
            if re.search(r"(?i)copyright|published|©|\(c\)", line):
                ym = _YEAR_ONLY.search(line)
                if ym:
                    meta.year = ym.group(1)
                    break

    # Publisher
    for line in all_lines[:100]:
        m = _PUBLISHED_BY.match(line)
        if m:
            meta.publisher = m.group("pub").strip(" .,;:")
            break
    if not meta.publisher:
        for line in all_lines[:100]:
            m = _PUBLISHER_LINE.match(line)
            if m and not re.search(r"(?i)\bby\b", line):
                meta.publisher = m.group("pub").strip()
                break

    # Rights
    for line in all_lines[:120]:
        m = _RIGHTS.match(line)
        if m:
            meta.rights = m.group(1).strip()
            break

    # ISBN
    isbn = _ISBN.search(blob)
    if isbn:
        meta.isbn = isbn.group(1).strip()

    return meta


def scrape_project_metadata(project: ProjectState, *, max_pages: int = 20) -> BookMetadata:
    """Read early processed pages and scrape metadata."""
    pages_meta = project.list_processed_pages()
    # Prefer cover + first N pages by page number
    pages_meta = sorted(pages_meta, key=lambda row: int(row["page"]))[: max(1, max_pages)]
    texts: list[tuple[int, str]] = []
    for row in pages_meta:
        page = int(row["page"])
        md = project.read_page_markdown(page) or ""
        if md.strip():
            texts.append((page, md))
    return scrape_from_text(texts, project_name=project.name or "")

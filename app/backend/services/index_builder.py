"""Scan markdown for part/chapter titles and build a linked Contents index."""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from services.project import ProjectState, page_stem, slugify

_HEADING_RE = re.compile(r"^(#{1,3})\s+(.+?)\s*$")
_ATX_STRIP = re.compile(r"^#{1,6}\s+")
_STRUCTURAL = re.compile(
    r"(?is)^\s*(?:"
    r"prologue|epilogue|preface|introduction|foreword|afterword|appendix|"
    r"acknowledg(?:e)?ments?|contents|contents?|"
    r"part\s+(?:[ivxlcdm]+|\d+)\b.*|"
    r"book\s+(?:[ivxlcdm]+|\d+)\b.*|"
    r"chapter\s+(?:[ivxlcdm]+|\d+)\b.*"
    r")\s*$"
)
_STRUCTURAL_INLINE = re.compile(
    r"(?i)\b(?:part|book|chapter|prologue|epilogue|preface|introduction|foreword|afterword|appendix)\b"
)
_PAGE_NUMISH = re.compile(r"(?ix)^\s*(?:\d{1,4}|[ivxlcdm]{1,12})\s*$")
_SCRIBE_LINK_RE = re.compile(r"^#scribe-p(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)$", re.I)


def anchor_slug(title: str, page: int) -> str:
    base = slugify(title) or "section"
    # Longer than project slugify default for unique-ish anchors
    text = re.sub(r"[^\w\s-]", "", title.strip().lower())
    text = re.sub(r"[-\s]+", "-", text).strip("-")[:72] or base
    return text


def scribe_href(page: int, anchor: str) -> str:
    return f"#scribe-p{int(page)}-{anchor}"


def parse_scribe_href(href: str) -> tuple[int, str] | None:
    match = _SCRIBE_LINK_RE.match((href or "").strip())
    if not match:
        return None
    return int(match.group(1)), match.group(2)


@dataclass
class IndexEntry:
    id: str
    label: str
    page: int
    anchor: str
    level: int = 1
    enabled: bool = True
    source: str = "scan"  # scan | manual

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "page": self.page,
            "anchor": self.anchor,
            "level": self.level,
            "enabled": self.enabled,
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "IndexEntry":
        label = str(data.get("label") or "").strip() or "Untitled"
        page = max(1, int(data.get("page") or 1))
        anchor = str(data.get("anchor") or "").strip() or anchor_slug(label, page)
        return cls(
            id=str(data.get("id") or uuid.uuid4().hex[:12]),
            label=label,
            page=page,
            anchor=re.sub(r"[^a-z0-9-]", "", anchor.lower()) or anchor_slug(label, page),
            level=max(1, min(3, int(data.get("level") or 1))),
            enabled=bool(data.get("enabled", True)),
            source=str(data.get("source") or "manual"),
        )


@dataclass
class IndexState:
    title: str = "Contents"
    replace_start: int | None = None
    replace_end: int | None = None
    entries: list[IndexEntry] = field(default_factory=list)
    applied: bool = False
    applied_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "replace_start": self.replace_start,
            "replace_end": self.replace_end,
            "entries": [e.to_dict() for e in self.entries],
            "applied": self.applied,
            "applied_at": self.applied_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "IndexState":
        data = data or {}
        entries = [IndexEntry.from_dict(row) for row in (data.get("entries") or []) if isinstance(row, dict)]
        rs = data.get("replace_start")
        re_ = data.get("replace_end")
        return cls(
            title=str(data.get("title") or "Contents").strip() or "Contents",
            replace_start=int(rs) if rs is not None else None,
            replace_end=int(re_) if re_ is not None else None,
            entries=entries,
            applied=bool(data.get("applied")),
            applied_at=data.get("applied_at"),
        )


def index_path(project: ProjectState) -> Path:
    return project.root / "index.json"


def load_index(project: ProjectState) -> IndexState:
    path = index_path(project)
    if not path.is_file():
        return IndexState()
    try:
        return IndexState.from_dict(json.loads(path.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, OSError, TypeError, ValueError):
        return IndexState()


def save_index(project: ProjectState, state: IndexState) -> IndexState:
    project.ensure_dirs()
    path = index_path(project)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return state


def _worthy_heading(level: int, title: str) -> bool:
    t = title.strip()
    if len(t) < 2 or len(t) > 180:
        return False
    if _PAGE_NUMISH.match(t):
        return False
    if level <= 2:
        return True
    return bool(_STRUCTURAL_INLINE.search(t))


def _worthy_plain(title: str) -> bool:
    t = title.strip()
    if len(t) < 3 or len(t) > 120:
        return False
    if _PAGE_NUMISH.match(t):
        return False
    return bool(_STRUCTURAL.match(t))


def scan_page_titles(markdown: str, page: int) -> list[IndexEntry]:
    """Find prominent titles on one page of markdown."""
    found: list[IndexEntry] = []
    lines = (markdown or "").splitlines()
    seen_labels: set[str] = set()

    for i, line in enumerate(lines):
        heading = _HEADING_RE.match(line)
        if heading:
            level = len(heading.group(1))
            title = heading.group(2).strip()
            # Drop trailing attr-list junk if present
            title = re.sub(r"\s*\{#[^}]+\}\s*$", "", title).strip()
            if not _worthy_heading(level, title):
                continue
            key = title.casefold()
            if key in seen_labels:
                continue
            seen_labels.add(key)
            anchor = anchor_slug(title, page)
            found.append(
                IndexEntry(
                    id=uuid.uuid4().hex[:12],
                    label=title,
                    page=page,
                    anchor=anchor,
                    level=min(level, 3),
                    enabled=True,
                    source="scan",
                )
            )
            continue

        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("!["):
            continue
        if stripped.startswith(">") or stripped.startswith("|") or stripped.startswith("```"):
            continue
        # Isolated structural plain line (blank or edge neighbors)
        prev_blank = i == 0 or not lines[i - 1].strip()
        next_blank = i == len(lines) - 1 or not lines[i + 1].strip()
        if not (prev_blank and next_blank):
            continue
        if not _worthy_plain(stripped):
            continue
        key = stripped.casefold()
        if key in seen_labels:
            continue
        seen_labels.add(key)
        found.append(
            IndexEntry(
                id=uuid.uuid4().hex[:12],
                label=stripped,
                page=page,
                anchor=anchor_slug(stripped, page),
                level=1,
                enabled=True,
                source="scan",
            )
        )

    return found


def scan_project(
    project: ProjectState,
    *,
    replace_start: int | None = None,
    replace_end: int | None = None,
) -> list[IndexEntry]:
    """Scan all processed pages for index candidates, skipping the original index range."""
    rs = replace_start
    re_ = replace_end if replace_end is not None else replace_start
    if rs is not None and re_ is not None and re_ < rs:
        rs, re_ = re_, rs

    entries: list[IndexEntry] = []
    used_anchors: set[str] = set()

    for meta in project.list_processed_pages():
        page = int(meta["page"])
        if rs is not None and re_ is not None and rs <= page <= re_:
            continue
        if project.cover_page and page == project.cover_page:
            # Cover is usually just an image
            md = project.read_page_markdown(page) or ""
            if md.strip().startswith("![") and md.strip().count("\n") <= 1:
                continue
        text = project.read_page_markdown(page) or ""
        for entry in scan_page_titles(text, page):
            # Unique anchors across the book
            base = entry.anchor
            candidate = base
            n = 2
            while candidate in used_anchors:
                candidate = f"{base}-{n}"
                n += 1
            entry.anchor = candidate
            used_anchors.add(candidate)
            entries.append(entry)

    return entries


def render_index_markdown(state: IndexState) -> str:
    """Markdown Contents page with in-app / export-friendly scribe links."""
    lines = [f"# {state.title.strip() or 'Contents'}", ""]
    active = [e for e in state.entries if e.enabled]
    if not active:
        lines.append("_No index entries yet. Scan titles or add links manually._")
        lines.append("")
        return "\n".join(lines)

    for entry in active:
        # Four spaces per level so CommonMark / EPUB nest lists reliably
        indent = "    " * max(0, entry.level - 1)
        href = scribe_href(entry.page, entry.anchor)
        lines.append(f"{indent}- [{entry.label}]({href})")
    lines.append("")
    return "\n".join(lines)


def apply_index(project: ProjectState, state: IndexState) -> IndexState:
    """Write the generated index onto the user-selected page range."""
    if state.replace_start is None:
        raise ValueError("Set the original index page range before applying.")
    start = int(state.replace_start)
    end = int(state.replace_end if state.replace_end is not None else start)
    if end < start:
        start, end = end, start
    total = int(project.page_count or end)
    if start < 1 or end > total:
        raise ValueError(f"Index page range must be within 1–{total}.")

    body = render_index_markdown(state)
    project.write_page_markdown(start, body)
    stub = (
        f"_This page was part of the original print index. "
        f"The linked {state.title or 'Contents'} now lives on page {start}._\n"
    )
    # Ensure the title heading has a stable anchor target on the index page itself
    # (export maps scribe links; in-app jumps by page).
    for page in range(start + 1, end + 1):
        project.write_page_markdown(page, stub)

    from datetime import datetime, timezone

    state.applied = True
    state.applied_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    state.replace_start = start
    state.replace_end = end
    return save_index(project, state)


def public_index(state: IndexState) -> dict[str, Any]:
    data = state.to_dict()
    data["markdown"] = render_index_markdown(state)
    data["entry_count"] = len(state.entries)
    data["enabled_count"] = sum(1 for e in state.entries if e.enabled)
    return data

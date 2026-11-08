"""Merge per-page OCR markdown into continuous book text for EPUB export."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_SOFT_HYPHEN_END = re.compile(r"([A-Za-zÀ-ÖØ-öø-ÿ])-\s*$")
_SENTENCE_END = re.compile(r'[.!?…]["”\'»)\]]*\s*$')
_HEADING = re.compile(r"^#{1,6}\s+")
_LIST = re.compile(r"^(\s*[-*+]|\s*\d+[.)])\s+")
_BLOCKQUOTE = re.compile(r"^>\s?")
_HR = re.compile(r"^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$")
_IMAGE = re.compile(r"^!\[[^\]]*\]\([^)]+\)\s*$")
_FENCE = re.compile(r"^```")
_TABLE = re.compile(r"^\s*\|")
_FOOTNOTE_DEF = re.compile(r"^\[\^([^\]]+)\]:\s*(.*)$")
_FOOTNOTE_DEF_BLOCK = re.compile(r"^\[\^([^\]]+)\]:\s*(.*)$", re.M)
_FOOTNOTE_REF = re.compile(r"\[\^([^\]]+)\](?!:)")
_PAGE_NUM_ONLY = re.compile(r"^\d{1,4}$")
_PAGE_MARKER_RE = re.compile(r"<!--\s*scribe-page:(\d+)\s*-->")
_PAGE_MARKER_LINE = re.compile(r"^\s*<!--\s*scribe-page:\d+\s*-->\s*$")
_FIRST_HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*$", re.M)


@dataclass
class PageChunk:
    page: int
    text: str
    is_cover: bool = False
    is_index: bool = False


@dataclass
class MergedSection:
    """One EPUB-bound section (cover, front matter, contents, or body chapter)."""

    key: str
    title: str
    markdown: str
    pages: list[int] = field(default_factory=list)
    kind: str = "body"  # cover | front | index | body


def is_blank_page(text: str) -> bool:
    """True when a page has no meaningful content to keep in the ebook."""
    for raw in (text or "").splitlines():
        s = raw.strip()
        if not s:
            continue
        if _HR.match(s) or _PAGE_NUM_ONLY.match(s):
            continue
        if s in {"*", "·", "•", "—", "–", "-"}:
            continue
        if _PAGE_MARKER_LINE.match(s):
            continue
        return False
    return True


def _strip_edges(text: str) -> str:
    return (text or "").strip("\n")


def _is_marker(line: str) -> bool:
    return bool(_PAGE_MARKER_LINE.match(line))


def _is_structural_start(line: str) -> bool:
    s = line.strip()
    if not s or _is_marker(s):
        return True
    return bool(
        _HEADING.match(s)
        or _LIST.match(s)
        or _HR.match(s)
        or _IMAGE.match(s)
        or _FENCE.match(s)
        or _TABLE.match(s)
        or _FOOTNOTE_DEF.match(s)
        or _BLOCKQUOTE.match(s)
    )


def _is_prose_line(line: str) -> bool:
    s = line.strip()
    return bool(s) and not _is_marker(s) and not _is_structural_start(s)


def _last_content_idx(lines: list[str]) -> int:
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].strip() and not _is_marker(lines[i]):
            return i
    return -1


def _first_content_idx(lines: list[str]) -> int:
    for i, ln in enumerate(lines):
        if ln.strip() and not _is_marker(ln):
            return i
    return -1


def join_page_texts(left: str, right: str) -> str:
    """
    Join two consecutive page bodies at the boundary.

    Handles soft hyphens, continued paragraphs/sentences, and continued block quotes.
    Page markers (``<!-- scribe-page:N -->``) on ``right`` are preserved at the join.
    """
    left = _strip_edges(left)
    right = _strip_edges(right)
    if not left:
        return right
    if not right:
        return left

    left_lines = left.splitlines()
    right_lines = right.splitlines()

    lead_markers: list[str] = []
    while right_lines and (not right_lines[0].strip() or _is_marker(right_lines[0])):
        if _is_marker(right_lines[0]):
            lead_markers.append(right_lines[0].strip())
        right_lines.pop(0)

    li = _last_content_idx(left_lines)
    ri = _first_content_idx(right_lines)
    if li < 0:
        return "\n".join(lead_markers + right_lines) if right_lines or lead_markers else left
    if ri < 0:
        return left

    left_last = left_lines[li]
    right_first = right_lines[ri]

    hyphen = _SOFT_HYPHEN_END.search(left_last.rstrip())
    cont = right_first.lstrip()
    if hyphen and cont and cont[0].isalpha():
        prefix = _SOFT_HYPHEN_END.sub(hyphen.group(1), left_last.rstrip())
        if _BLOCKQUOTE.match(cont):
            cont_inner = _BLOCKQUOTE.sub("", cont, count=1)
            if prefix.lstrip().startswith(">"):
                merged_line = prefix + cont_inner
            else:
                merged_line = "> " + prefix.lstrip() + cont_inner
        else:
            merged_line = prefix + cont
        new_left = left_lines[:li] + [merged_line]
        new_right = right_lines[ri + 1 :]
        parts = [ln for ln in new_left]
        while parts and not parts[-1].strip():
            parts.pop()
        parts.extend(lead_markers)
        parts.extend(new_right)
        return "\n".join(parts)

    if _BLOCKQUOTE.match(left_last.lstrip()) and _BLOCKQUOTE.match(right_first.lstrip()):
        parts = list(left_lines)
        while parts and not parts[-1].strip():
            parts.pop()
        parts.extend(lead_markers)
        parts.extend(right_lines)
        return "\n".join(parts)

    if _is_prose_line(left_last) and not _is_structural_start(right_first):
        ends_sentence = bool(_SENTENCE_END.search(left_last.rstrip()))
        starts_lower = right_first.lstrip()[:1].islower()
        if (not ends_sentence) or starts_lower:
            merged_line = left_last.rstrip() + " " + right_first.lstrip()
            new_left = left_lines[:li] + [merged_line]
            new_right = right_lines[ri + 1 :]
            parts = list(new_left)
            while parts and not parts[-1].strip():
                parts.pop()
            parts.extend(lead_markers)
            parts.extend(new_right)
            return "\n".join(parts)

    parts = list(left_lines)
    while parts and not parts[-1].strip():
        parts.pop()
    parts.append("")
    parts.extend(lead_markers)
    parts.extend(right_lines)
    return "\n".join(parts)


def prefix_footnotes(markdown: str, prefix: str) -> str:
    """Rewrite footnote ids with a prefix so colliding per-page ids stay distinct before merge."""
    text = markdown or ""
    if not prefix:
        return text
    ids = set(_FOOTNOTE_REF.findall(text)) | set(_FOOTNOTE_DEF_BLOCK.findall(text))
    if not ids:
        return text

    def repl_ref(match: re.Match[str]) -> str:
        return f"[^{prefix}{match.group(1)}]"

    def repl_def(match: re.Match[str]) -> str:
        return f"[^{prefix}{match.group(1)}]:{match.group(2)}"

    # Defs first so ref-pattern doesn't touch them incorrectly
    text = _FOOTNOTE_DEF_BLOCK.sub(repl_def, text)
    text = _FOOTNOTE_REF.sub(repl_ref, text)
    return text


def renumber_footnotes(markdown: str, start: int = 1) -> tuple[str, int]:
    """
    Remap footnote ids in a markdown section to sequential numbers starting at ``start``.

    Definitions are gathered to the end of the section. Returns (markdown, next_number).
    """
    text = markdown or ""
    defs: dict[str, str] = {}

    def _eat_def(match: re.Match[str]) -> str:
        defs[match.group(1)] = (match.group(2) or "").strip()
        return ""

    body = _FOOTNOTE_DEF_BLOCK.sub(_eat_def, text)
    body = re.sub(r"\n{3,}", "\n\n", body).rstrip()

    mapping: dict[str, str] = {}
    next_n = start

    def _repl_ref(match: re.Match[str]) -> str:
        nonlocal next_n
        old = match.group(1)
        if old not in mapping:
            mapping[old] = str(next_n)
            next_n += 1
        return f"[^{mapping[old]}]"

    body = _FOOTNOTE_REF.sub(_repl_ref, body)

    for old in defs:
        if old not in mapping:
            mapping[old] = str(next_n)
            next_n += 1

    if mapping:
        ordered = sorted(
            ((int(new_id), old) for old, new_id in mapping.items() if str(new_id).isdigit()),
            key=lambda row: row[0],
        )
        body = body.rstrip() + "\n\n"
        for num, old in ordered:
            body += f"[^{num}]: {defs.get(old, '')}\n"

    return body, next_n


def merge_body_pages(pages: list[tuple[int, str]]) -> tuple[str, list[int]]:
    """Merge ordered body pages; keep ``<!-- scribe-page:N -->`` beside each page's text."""
    if not pages:
        return "", []

    page_ids = [p for p, _ in pages]
    merged = ""
    for page, text in pages:
        # Prefix footnote ids so [^1] on page 10 and [^1] on page 11 do not collide
        uniqued = prefix_footnotes(_strip_edges(text), f"p{page}_")
        piece = f"<!-- scribe-page:{page} -->\n{uniqued}"
        merged = piece if not merged else join_page_texts(merged, piece)
    return merged, page_ids


def _section_title(markdown: str, fallback: str) -> str:
    match = _FIRST_HEADING.search(markdown or "")
    if match:
        title = re.sub(r"\s*\{#[^}]+\}\s*$", "", match.group(1)).strip()
        if title:
            return title
    return fallback


def _is_index_stub(text: str) -> bool:
    return "original print index" in (text or "").casefold()


def build_export_sections(
    chunks: list[PageChunk],
    *,
    index_start: int | None = None,
    index_end: int | None = None,
    break_pages: set[int] | None = None,
    entry_titles: dict[int, str] | None = None,
) -> list[MergedSection]:
    """
    Build ordered EPUB sections with hard divides:

    - Cover (if any)
    - Front matter: each page before the index range is its own section (no merge)
    - Index: at its original page locus (not forced after the cover)
    - Body: merge across pages, but hard-break at pages that have an index entry
    """
    break_pages = set(break_pages or ())
    entry_titles = entry_titles or {}

    cover: PageChunk | None = None
    index_chunk: PageChunk | None = None
    ordered: list[PageChunk] = []

    idx_start = index_start
    idx_end = index_end if index_end is not None else index_start
    if idx_start is not None and idx_end is not None and idx_end < idx_start:
        idx_start, idx_end = idx_end, idx_start

    for chunk in chunks:
        text = chunk.text or ""
        if chunk.is_cover:
            cover = chunk
            continue
        if _is_index_stub(text):
            continue
        if is_blank_page(text):
            continue
        if chunk.is_index or (idx_start is not None and chunk.page == idx_start):
            index_chunk = chunk
            continue
        if idx_start is not None and idx_end is not None and idx_start <= chunk.page <= idx_end:
            # Other pages in the replaced print-index range
            continue
        ordered.append(chunk)

    sections: list[MergedSection] = []
    seq = 0

    def add_section(*, key: str, title: str, markdown: str, pages: list[int], kind: str) -> None:
        nonlocal seq
        seq += 1
        sections.append(
            MergedSection(
                key=key or f"sec-{seq}",
                title=title,
                markdown=markdown,
                pages=pages,
                kind=kind,
            )
        )

    if cover and not is_blank_page(cover.text):
        add_section(
            key="cover",
            title="Cover",
            markdown=_strip_edges(cover.text),
            pages=[cover.page],
            kind="cover",
        )

    front: list[PageChunk] = []
    body: list[PageChunk] = []
    if idx_start is not None:
        for chunk in ordered:
            if chunk.page < idx_start:
                front.append(chunk)
            else:
                body.append(chunk)
    else:
        body = list(ordered)

    # Front matter: one section per page (hard divide)
    for chunk in front:
        title = _section_title(chunk.text, f"Page {chunk.page}")
        add_section(
            key=f"front-{chunk.page}",
            title=title,
            markdown=_strip_edges(chunk.text),
            pages=[chunk.page],
            kind="front",
        )

    # Index stays at its original locus (after front matter, before later body)
    if index_chunk and not is_blank_page(index_chunk.text):
        title = _section_title(index_chunk.text, "Contents")
        add_section(
            key="index",
            title=title,
            markdown=_strip_edges(index_chunk.text),
            pages=[index_chunk.page],
            kind="index",
        )

    # Body after index: hard-break at index-entry pages; merge within each run
    if body:
        groups: list[list[PageChunk]] = []
        current: list[PageChunk] = []
        for chunk in body:
            starts_break = chunk.page in break_pages
            if starts_break and current:
                groups.append(current)
                current = [chunk]
            else:
                current.append(chunk)
        if current:
            groups.append(current)

        for gi, group in enumerate(groups, start=1):
            pairs = [(c.page, c.text) for c in group]
            merged, page_ids = merge_body_pages(pairs)
            first_page = page_ids[0] if page_ids else group[0].page
            title = (
                entry_titles.get(first_page)
                or _section_title(merged, f"Page {first_page}")
            )
            add_section(
                key=f"body-{gi}",
                title=title,
                markdown=merged,
                pages=page_ids,
                kind="body",
            )

    return sections


def pages_in_markdown(markdown_text: str) -> list[int]:
    return [int(x) for x in _PAGE_MARKER_RE.findall(markdown_text or "")]

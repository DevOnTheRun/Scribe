"""Page Markdown cleaning — strip running headers/footers and page numbers."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

# Structural headings we should never strip as "running titles"
_KEEP_HEADING = re.compile(
    r"(?is)^\s*#{1,6}\s+"
    r"(?:"
    r"prologue|epilogue|preface|introduction|foreword|afterword|appendix|"
    r"contents|acknowledg(?:e)?ments?|"
    r"part\s+(?:[ivxlcdm]+|\d+)|"
    r"book\s+(?:[ivxlcdm]+|\d+)|"
    r"chapter\s+(?:[ivxlcdm]+|\d+)|"
    r"(?:i{1,3}|iv|vi{0,3}|ix|x{1,3})\.\s+\S"  # "II. Title" — require at least one x if using x's
    r").*",
)

_KEEP_PLAIN = re.compile(
    r"(?is)^\s*"
    r"(?:"
    r"prologue|epilogue|preface|introduction|foreword|afterword|"
    r"part\s+(?:[ivxlcdm]+|\d+)\b.*"
    r"|book\s+(?:[ivxlcdm]+|\d+)\b.*"
    r"|chapter\s+(?:[ivxlcdm]+|\d+)\b.*"
    r")\s*$",
)

# Lone page numbers / folio lines (often at top or bottom)
_PAGE_NUMBER = re.compile(
    r"(?ix)^\s*(?:"
    r"(?:page|p\.?|pg\.?)\s*[.\-:]?\s*)?"
    r"(?:[-–—•·.\s]*)?"
    r"(?:\d{1,4}|[ivxlcdm]{1,12})"
    r"(?:[-–—•·.\s]*)?"
    r"(?:\s*(?:of|/)\s*\d{1,4})?"
    r"\s*$"
)

# Trailing folio on a running header: "Title [xviii]", "Title 12", "Title - 3 -"
_TRAILING_FOLIO = re.compile(
    r"(?ix)\s*"
    r"(?:"
    r"[\[\(\{]\s*(?:\d{1,4}|[ivxlcdm]{1,12})\s*[\]\)\}]"
    r"|(?:[-–—•·|]\s*)?(?:\d{1,4}|[ivxlcdm]{1,12})(?:\s*[-–—•·|])?"
    r")\s*$"
)

_FOLIO_TOKEN = re.compile(
    r"(?ix)^\s*"
    r"(?:"
    r"[\[\(\{]?\s*(?:\d{1,4}|[ivxlcdm]{1,12})\s*[\]\)\}]?"
    r"|(?:[-–—•·|]\s*)?(?:\d{1,4}|[ivxlcdm]{1,12})(?:\s*[-–—•·|])?"
    r")\s*$"
)

_NORMALIZE_SPACE = re.compile(r"\s+")


@dataclass
class CleanOptions:
    remove_page_numbers: bool = True
    remove_running_headers: bool = True
    book_title: str = ""  # header/footer strip pattern (plain, wildcard, or re:)
    extra_phrases: list[str] = field(default_factory=list)
    # Auto-detected candidates the user selected (exact or pattern)
    selected_running: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "CleanOptions":
        data = data or {}
        phrases = data.get("extra_phrases") or []
        if isinstance(phrases, str):
            phrases = [phrases]
        selected = data.get("selected_running") or []
        if isinstance(selected, str):
            selected = [selected]
        # Accept legacy book_title or newer header_pattern from the client
        pattern = str(
            data.get("header_pattern")
            or data.get("book_title")
            or ""
        ).strip()
        return cls(
            remove_page_numbers=bool(data.get("remove_page_numbers", True)),
            remove_running_headers=bool(data.get("remove_running_headers", True)),
            book_title=pattern,
            extra_phrases=[str(p).strip() for p in phrases if str(p).strip()],
            selected_running=[str(p).strip() for p in selected if str(p).strip()],
        )


def normalize_line(line: str) -> str:
    s = line.strip()
    s = s.lstrip("#").strip()  # compare heading text without hashes
    s = re.sub(r"^[*_]+|[*_]+$", "", s).strip()
    s = _NORMALIZE_SPACE.sub(" ", s)
    return s.casefold()


def strip_trailing_folio(text: str) -> str:
    """Remove a trailing page folio so similar headers cluster together."""
    return _TRAILING_FOLIO.sub("", text).strip(" -\t–—|")


def is_folio_token(text: str) -> bool:
    return bool(_FOLIO_TOKEN.match(text.strip()))


def is_structural_keep(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if _KEEP_HEADING.match(stripped) or _KEEP_PLAIN.match(stripped):
        return True
    # Markdown heading with chapter-like words in the middle
    if stripped.startswith("#") and re.search(
        r"(?i)\b(chapter|part|prologue|epilogue|book)\b", stripped
    ):
        return True
    return False


def is_page_number_line(line: str) -> bool:
    s = line.strip()
    if not s or is_structural_keep(s):
        return False
    plain = re.sub(r"^[*_]+|[*_]+$", "", s).strip()
    plain = plain.lstrip("#").strip()
    return bool(_PAGE_NUMBER.match(plain) or _FOLIO_TOKEN.match(plain))


def _edge_lines(text: str, *, edge: int = 4) -> list[str]:
    lines = text.replace("\r\n", "\n").split("\n")
    nonempty = [(i, ln) for i, ln in enumerate(lines) if ln.strip()]
    if not nonempty:
        return []
    head = [ln for _, ln in nonempty[:edge]]
    tail = [ln for _, ln in nonempty[-edge:]]
    return head + tail


def analyze_running_headers(
    pages: list[tuple[int, str]],
    *,
    min_pages: int = 3,
    min_ratio: float = 0.25,
) -> list[dict[str, Any]]:
    """
    Find short lines that recur at page tops/bottoms across many pages.
    Folio suffixes like [xviii] / 12 are stripped so variants group together.
    """
    if not pages:
        return []
    counts: Counter[str] = Counter()
    examples: dict[str, str] = {}
    for _num, text in pages:
        seen_on_page: set[str] = set()
        for line in _edge_lines(text):
            if is_structural_keep(line) or is_page_number_line(line):
                continue
            norm = normalize_line(line)
            if not norm or len(norm) > 100:
                continue
            base = strip_trailing_folio(norm) or norm
            if len(base) < 3:
                continue
            if base in seen_on_page:
                continue
            seen_on_page.add(base)
            counts[base] += 1
            # Prefer an example without folio for the checkbox label
            display = strip_trailing_folio(line.strip().lstrip("#").strip()) or line.strip()
            examples.setdefault(base, display)

    total = len(pages)
    threshold = max(min_pages, int(total * min_ratio + 0.999))
    out: list[dict[str, Any]] = []
    for norm, count in counts.most_common():
        if count < threshold:
            continue
        out.append(
            {
                "text": examples.get(norm, norm),
                "normalized": norm,
                "count": count,
                "ratio": round(count / total, 3),
            }
        )
    return out


def wildcard_to_regex(pattern: str) -> str:
    """Convert a simple glob (* = any run, ? = one char) to a regex body."""
    out: list[str] = []
    for ch in pattern:
        if ch == "*":
            out.append(".*")
        elif ch == "?":
            out.append(".")
        else:
            out.append(re.escape(ch))
    return "".join(out)


def compile_phrase_pattern(phrase: str) -> re.Pattern[str] | None:
    """
    Build a matcher for a strip phrase.
    - `re:...` → raw regex (search against the line)
    - contains `*` or `?` → wildcard / glob
    - otherwise → None (use literal matching helpers)
    """
    raw = phrase.strip()
    if not raw:
        return None
    if raw.lower().startswith("re:"):
        body = raw[3:].strip()
        if not body:
            return None
        try:
            return re.compile(body, re.IGNORECASE | re.MULTILINE)
        except re.error:
            return None
    if "*" in raw or "?" in raw:
        try:
            return re.compile(wildcard_to_regex(raw), re.IGNORECASE)
        except re.error:
            return None
    return None


def _phrases_to_match(options: CleanOptions) -> list[str]:
    phrases: list[str] = []
    if options.book_title:
        phrases.append(options.book_title)
    phrases.extend(options.extra_phrases)
    if options.remove_running_headers:
        phrases.extend(options.selected_running)
    seen: set[str] = set()
    out: list[str] = []
    for p in phrases:
        key = p.strip().casefold()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(p.strip())
    return out


def _line_matches_phrase(line: str, phrase: str) -> bool:
    if is_structural_keep(line):
        return False
    plain = line.strip()
    ln = normalize_line(line)
    if not ln:
        return False

    pattern = compile_phrase_pattern(phrase)
    if pattern is not None:
        # Match against full line and hash-stripped body
        if pattern.search(plain) or pattern.search(ln):
            return True
        # If pattern has no anchors, also try fullmatch on normalized body
        if pattern.fullmatch(ln):
            return True
        return False

    ph = normalize_line(phrase)
    if not ph:
        return False
    if ln == ph:
        return True
    # Same title with a changing folio: "My Book Title [xviii]"
    if strip_trailing_folio(ln) == ph:
        return True
    # Heading form / prefix + folio
    if ln.startswith(ph):
        rest = ln[len(ph) :].strip(" -\t–—|")
        if not rest or is_folio_token(rest) or is_page_number_line(rest):
            return True
    return False


def clean_markdown(text: str, options: CleanOptions) -> tuple[str, list[str]]:
    """
    Return (cleaned_text, list of removed line descriptions).
    """
    if not text:
        return "", []
    lines = text.replace("\r\n", "\n").split("\n")
    phrases = _phrases_to_match(options)
    removed: list[str] = []
    kept: list[str] = []

    for line in lines:
        drop = False
        reason = ""
        if options.remove_page_numbers and is_page_number_line(line):
            drop = True
            reason = "page number"
        elif phrases:
            for phrase in phrases:
                if _line_matches_phrase(line, phrase):
                    drop = True
                    reason = f"running text ({phrase[:48]})"
                    break
        if drop and line.strip():
            removed.append(f"{reason}: {line.strip()[:80]}")
            continue
        if drop:
            continue
        kept.append(line)

    cleaned = "\n".join(kept)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip("\n")
    if text.endswith("\n") and cleaned:
        cleaned += "\n"
    return cleaned, removed


def preview_page(before: str, options: CleanOptions) -> dict[str, Any]:
    after, removed = clean_markdown(before, options)
    return {
        "before": before,
        "after": after,
        "changed": before != after,
        "removed": removed,
    }

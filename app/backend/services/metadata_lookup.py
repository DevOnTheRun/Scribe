"""Look up bibliographic metadata via Open Library (no API key)."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from services.metadata_scrape import BookMetadata

_UA = "ScribeEPUB/1.00 (local; metadata lookup; +https://github.com/DevOnTheRun/Scribe)"
_TIMEOUT_S = 12


def _http_get_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def _year_from_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, int):
        return str(value) if 1000 <= value <= 2100 else ""
    text = str(value)
    m = re.search(r"\b((?:19|20)\d{2})\b", text)
    return m.group(1) if m else ""


def _first_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        for item in value:
            s = _first_str(item)
            if s:
                return s
        return ""
    if isinstance(value, dict):
        for key in ("name", "title", "value"):
            if key in value:
                return _first_str(value[key])
        return ""
    return str(value).strip()


def _join_authors(names: Any) -> str:
    if not names:
        return ""
    if isinstance(names, str):
        return names.strip()
    parts = [str(n).strip() for n in names if str(n).strip()]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return f"{parts[0]} and {parts[1]}"
    return ", ".join(parts[:-1]) + f", and {parts[-1]}"


def _doc_to_metadata(doc: dict[str, Any], *, description: str = "") -> BookMetadata:
    title = _first_str(doc.get("title")) or _first_str(doc.get("title_suggest"))
    authors = _join_authors(doc.get("author_name") or doc.get("authors"))
    publisher = _first_str(doc.get("publisher"))
    year = (
        _year_from_value(doc.get("first_publish_year"))
        or _year_from_value((doc.get("publish_year") or [None])[0] if isinstance(doc.get("publish_year"), list) else doc.get("publish_year"))
        or _year_from_value(doc.get("publish_date"))
    )
    isbn = ""
    for key in ("isbn", "isbn_13", "isbn_10"):
        val = doc.get(key)
        if isinstance(val, list) and val:
            isbn = str(val[0]).strip()
            break
        if isinstance(val, str) and val.strip():
            isbn = val.strip()
            break

    lang = ""
    langs = doc.get("language")
    if isinstance(langs, list) and langs:
        # Open Library uses codes like "eng"
        code = str(langs[0]).lower()
        lang = {"eng": "en", "fre": "fr", "spa": "es", "ger": "de", "ita": "it"}.get(code, code[:2] if len(code) >= 2 else "")

    return BookMetadata(
        title=title,
        authors=authors,
        publisher=publisher,
        year=year,
        description=(description or "").strip(),
        rights="",
        language=lang or "en",
        isbn=isbn,
    )


def _fetch_work_description(work_key: str) -> str:
    if not work_key or not work_key.startswith("/works/"):
        return ""
    try:
        data = _http_get_json(f"https://openlibrary.org{work_key}.json")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, OSError):
        return ""
    desc = data.get("description")
    if isinstance(desc, dict):
        return str(desc.get("value") or "").strip()
    if isinstance(desc, str):
        return desc.strip()
    return ""


def lookup_open_library(
    *,
    title: str = "",
    authors: str = "",
    isbn: str = "",
    limit: int = 8,
) -> dict[str, Any]:
    """
    Search Open Library and return ranked results.

    Prefer ISBN when present; otherwise title (+ author).
    """
    title = (title or "").strip()
    authors = (authors or "").strip()
    isbn = re.sub(r"[^0-9Xx]", "", (isbn or "").strip())
    limit = max(1, min(15, int(limit or 8)))

    if not title and not authors and not isbn:
        raise ValueError("Enter a title, author, or ISBN before looking up.")

    params: dict[str, str] = {"limit": str(limit)}
    if isbn and len(isbn) in (10, 13):
        params["isbn"] = isbn
    else:
        if title:
            params["title"] = title
        if authors:
            # Use first author token cluster for better recall
            first = re.split(r"\s+(?:and|&|,)\s+", authors, maxsplit=1, flags=re.I)[0].strip()
            if first:
                params["author"] = first
        params["q"] = " ".join(p for p in (title, authors) if p)

    url = "https://openlibrary.org/search.json?" + urllib.parse.urlencode(params)
    try:
        payload = _http_get_json(url)
    except urllib.error.HTTPError as exc:
        raise ValueError(f"Open Library returned HTTP {exc.code}. Try again later.") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ValueError(f"Could not reach Open Library: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError("Open Library returned invalid JSON.") from exc

    docs = payload.get("docs") or []
    results: list[dict[str, Any]] = []
    for doc in docs[:limit]:
        work_key = str(doc.get("key") or "")
        description = _fetch_work_description(work_key) if work_key.startswith("/works/") else ""
        # Fallback: sometimes description lives on edition via cover edition key — skip for speed
        meta = _doc_to_metadata(doc, description=description)
        if not meta.title and not meta.authors:
            continue
        results.append(
            {
                "source": "openlibrary",
                "work_key": work_key,
                "score": float(doc.get("score") or 0),
                "metadata": meta.to_dict(),
                "label": " — ".join(
                    p for p in (meta.title, meta.authors, meta.year or meta.publisher) if p
                ),
            }
        )

    best = results[0]["metadata"] if results else None
    return {
        "source": "openlibrary",
        "query": {"title": title, "authors": authors, "isbn": isbn},
        "count": len(results),
        "results": results,
        "best": best,
    }

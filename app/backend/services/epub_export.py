"""Build an EPUB3 from per-page project markdown, images, and optional Contents index."""

from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape as xml_escape

from ebooklib import epub

from services import index_builder
from services.page_merge import PageChunk, build_export_sections, renumber_footnotes
from services.project import ProjectState, page_stem

_IMG_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_HEADING_LINE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.M)

_MD_EXTENSIONS = [
    "markdown.extensions.extra",
    "markdown.extensions.footnotes",
    "markdown.extensions.sane_lists",
    "markdown.extensions.nl2br",
    "markdown.extensions.smarty",
]

_BOOK_CSS = """
@namespace epub "http://www.idpf.org/2007/ops";
body {
  font-family: "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  line-height: 1.55;
  margin: 1em;
  color: #111;
}
h1, h2, h3, h4, h5, h6 {
  font-family: "Palatino Linotype", Palatino, Georgia, serif;
  line-height: 1.25;
  page-break-after: avoid;
  margin-top: 1.4em;
  margin-bottom: 0.5em;
}
h1 { font-size: 1.6em; }
h2 { font-size: 1.35em; }
h3 { font-size: 1.15em; }
p { margin: 0.7em 0; }
blockquote {
  margin: 1em 1.2em;
  padding-left: 0.9em;
  border-left: 3px solid #bbb;
  color: #333;
  font-style: italic;
}
hr {
  border: none;
  border-top: 1px solid #999;
  margin: 1.5em 0;
}
ul, ol { margin: 0.7em 0 0.7em 1.4em; padding: 0; }
li { margin: 0.25em 0; }
code, pre {
  font-family: "Consolas", "Courier New", monospace;
  font-size: 0.92em;
}
pre {
  background: #f4f4f4;
  padding: 0.75em 1em;
  overflow-x: auto;
  white-space: pre-wrap;
}
img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em auto;
}
table {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
}
th, td {
  border: 1px solid #ccc;
  padding: 0.35em 0.55em;
  vertical-align: top;
}
sup { line-height: 1; }
.footnote, .footnotes, div.footnote {
  font-size: 0.9em;
  margin-top: 2em;
  border-top: 1px solid #ccc;
  padding-top: 0.75em;
}
/* Keep footnote bodies at chapter end; many readers also offer popup previews from the ref. */
a.footnote-ref, .footnote-ref {
  text-decoration: none;
}
a.scribe-index-link { text-decoration: none; }
a.scribe-index-link:hover { text-decoration: underline; }
u { text-decoration: underline; }
.cover-page img { max-height: 95vh; }
.title-page {
  min-height: 90vh;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: center;
  padding: 2.5em 1.5em 2em;
  box-sizing: border-box;
}
.title-page-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 1.25em;
}
.title-page-title {
  font-size: 2em;
  font-weight: 700;
  margin: 0;
  line-height: 1.2;
}
.title-page-authors {
  font-size: 1.2em;
  margin: 0;
  font-style: italic;
}
.title-page-meta {
  margin: 0;
  font-size: 0.95em;
  line-height: 1.6;
  color: #333;
}
.title-page-meta p {
  margin: 0.2em 0;
}
"""


def _slug_heading(title: str) -> str:
    text = re.sub(r"[^\w\s-]", "", title.strip().lower())
    text = re.sub(r"[-\s]+", "-", text).strip("-")
    return text[:72] or "section"


def _rewrite_images(markdown_text: str, image_names: set[str]) -> str:
    def repl(match: re.Match[str]) -> str:
        alt, src = match.group(1), match.group(2).strip()
        name = Path(src).name
        if name in image_names:
            return f"![{alt}](../images/{name})"
        return match.group(0)

    return _IMG_RE.sub(repl, markdown_text)


def _inject_heading_ids(markdown_text: str, preferred: dict[str, str] | None = None) -> str:
    """Add HTML id anchors before headings; prefer index-provided slugs when labels match."""
    preferred = preferred or {}
    used: set[str] = set()

    def repl(match: re.Match[str]) -> str:
        hashes, title = match.group(1), match.group(2).strip()
        title_clean = re.sub(r"\s*\{#[^}]+\}\s*$", "", title).strip()
        key = title_clean.casefold()
        slug = preferred.get(key) or _slug_heading(title_clean)
        base = slug
        n = 2
        while slug in used:
            slug = f"{base}-{n}"
            n += 1
        used.add(slug)
        return f'<a id="{xml_escape(slug)}"></a>\n{hashes} {title_clean}'

    return _HEADING_LINE.sub(repl, markdown_text)


def _rewrite_scribe_links(html: str, page_file_map: dict[int, str]) -> str:
    """Turn #scribe-pN-slug hrefs into relative chapter links for the reader."""

    def repl(match: re.Match[str]) -> str:
        page = int(match.group(1))
        anchor = match.group(2)
        fname = page_file_map.get(page)
        if not fname:
            return match.group(0)
        return f'href="{fname}#{anchor}"'

    return re.sub(
        r'href="#scribe-p(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)"',
        repl,
        html,
        flags=re.I,
    )


_NAV_TOC_RE = re.compile(
    r"<nav\b[^>]*\bepub:type\s*=\s*[\"']toc[\"'][^>]*>",
    re.I,
)


def _wrap_as_epub_nav(html: str) -> str:
    """Wrap Contents HTML so the same page can serve as the EPUB3 nav document."""
    body = (html or "").strip()
    if not body:
        return body
    if _NAV_TOC_RE.search(body):
        return body
    return f'<nav epub:type="toc" id="toc" role="doc-toc">\n{body}\n</nav>'


def _title_page_html(
    *,
    title: str,
    authors: str,
    publisher: str | None,
    year: str | None,
) -> str:
    """Synthetic cover when the project has no cover image/page."""
    parts = [
        '<section class="title-page" epub:type="cover">',
        '  <div class="title-page-main">',
        f'    <h1 class="title-page-title">{xml_escape(title)}</h1>',
    ]
    if authors.strip():
        parts.append(
            f'    <p class="title-page-authors">{xml_escape(authors.strip())}</p>'
        )
    parts.append("  </div>")
    meta: list[str] = []
    pub = (publisher or "").strip()
    date = (year or "").strip()
    if pub:
        meta.append(f'    <p>Published by {xml_escape(pub)}</p>')
    if date:
        meta.append(f"    <p>{xml_escape(date)}</p>")
    if meta:
        parts.append('  <div class="title-page-meta">')
        parts.extend(meta)
        parts.append("  </div>")
    parts.append("</section>")
    return "\n".join(parts)


def _find_cover_image_path(project: ProjectState) -> Path | None:
    """Locate the JPEG/PNG used as the project cover, if any."""
    if project.cover_page:
        stem = page_stem(int(project.cover_page), project.page_count)
        for ext in (".jpg", ".jpeg", ".png", ".webp"):
            path = project.markdown_dir / f"{stem}{ext}"
            if path.is_file():
                return path
    upload = project.cover_upload_file()
    if upload is not None and upload.is_file():
        return upload
    return None


def _wrap_text(draw: Any, text: str, font: Any, max_width: int) -> list[str]:
    words = (text or "").split()
    if not words:
        return []
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        trial = f"{current} {word}"
        if draw.textlength(trial, font=font) <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _render_title_cover_jpeg(
    *,
    title: str,
    authors: str,
    publisher: str | None,
    year: str | None,
) -> bytes:
    """Raster title card so libraries that only read cover-image still show art."""
    from PIL import Image, ImageDraw, ImageFont

    width, height = 1200, 1800
    img = Image.new("RGB", (width, height), "#f7f4ef")
    draw = ImageDraw.Draw(img)
    try:
        title_font = ImageFont.truetype("arial.ttf", 72)
        author_font = ImageFont.truetype("arial.ttf", 40)
        meta_font = ImageFont.truetype("arial.ttf", 32)
    except OSError:
        title_font = ImageFont.load_default()
        author_font = title_font
        meta_font = title_font

    margin = 100
    max_w = width - margin * 2
    title_lines = _wrap_text(draw, title.strip() or "Untitled", title_font, max_w)
    author_lines = _wrap_text(draw, authors.strip(), author_font, max_w) if authors.strip() else []

    block_h = len(title_lines) * 88 + (24 + len(author_lines) * 52 if author_lines else 0)
    y = max(margin, (height // 2) - block_h // 2)
    for line in title_lines:
        tw = draw.textlength(line, font=title_font)
        draw.text(((width - tw) / 2, y), line, fill="#1a1a1a", font=title_font)
        y += 88
    if author_lines:
        y += 24
        for line in author_lines:
            tw = draw.textlength(line, font=author_font)
            draw.text(((width - tw) / 2, y), line, fill="#333333", font=author_font)
            y += 52

    meta_y = height - margin - 90
    pub = (publisher or "").strip()
    date = (year or "").strip()
    if pub:
        line = f"Published by {pub}"
        tw = draw.textlength(line, font=meta_font)
        draw.text(((width - tw) / 2, meta_y), line, fill="#444444", font=meta_font)
        meta_y += 44
    if date:
        tw = draw.textlength(date, font=meta_font)
        draw.text(((width - tw) / 2, meta_y), date, fill="#444444", font=meta_font)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88, optimize=True)
    return buf.getvalue()


def _register_cover_image(book: epub.EpubBook, file_name: str, content: bytes) -> None:
    """Mark an image as the package cover (OPF properties=cover-image + meta)."""
    book.set_cover(file_name, content, create_page=False)


def _md_to_html(text: str) -> str:
    try:
        import markdown
    except ImportError as exc:
        raise RuntimeError(
            "Missing Python package 'Markdown'. Run Pinokio Update (or: "
            "pip install Markdown ebooklib) in the Scribe env, then restart."
        ) from exc
    return markdown.markdown(text or "", extensions=_MD_EXTENSIONS, output_format="xhtml")


def build_epub(
    project: ProjectState,
    *,
    title: str | None = None,
    authors: str | None = None,
    author: str | None = None,  # legacy alias
    publisher: str | None = None,
    year: str | None = None,
    description: str | None = None,
    rights: str | None = None,
    language: str = "en",
    isbn: str | None = None,
) -> bytes:
    index_state = index_builder.load_index(project)
    preferred_anchors: dict[str, str] = {}
    for entry in index_state.entries:
        if not entry.enabled:
            continue
        preferred_anchors[entry.label.casefold()] = entry.anchor

    book_title = (title or project.name or "Untitled").strip() or "Untitled"
    author_line = (authors or author or "").strip()
    book = epub.EpubBook()
    if isbn and isbn.strip():
        book.set_identifier(f"isbn:{isbn.strip()}")
    else:
        book.set_identifier(f"scribe-{project.id}")
    book.set_title(book_title)
    book.set_language((language or "en").strip() or "en")

    if author_line:
        # Split on common conjunctions / semicolons for multiple creators
        parts = re.split(r"\s*(?:,|;|\band\b|&)\s*", author_line, flags=re.I)
        names = [p.strip() for p in parts if p.strip()]
        if not names:
            names = [author_line]
        for name in names:
            book.add_author(name)
    else:
        book.add_author("Unknown")

    if publisher and publisher.strip():
        book.add_metadata("DC", "publisher", publisher.strip())
    if year and str(year).strip():
        y = str(year).strip()
        # Dublin Core date: prefer YYYY
        book.add_metadata("DC", "date", y if re.fullmatch(r"\d{4}", y) else y)
    if description and description.strip():
        book.add_metadata("DC", "description", description.strip())
    if rights and rights.strip():
        book.add_metadata("DC", "rights", rights.strip())
    if isbn and isbn.strip():
        book.add_metadata("DC", "identifier", isbn.strip(), {"id": "isbn"})

    style = epub.EpubItem(
        uid="style_book",
        file_name="styles/book.css",
        media_type="text/css",
        content=_BOOK_CSS.encode("utf-8"),
    )
    book.add_item(style)

    cover_image_path = _find_cover_image_path(project)
    cover_image_name = cover_image_path.name if cover_image_path else None
    cover_registered = False

    image_names: set[str] = set()
    for pattern in ("page-*.jpg", "page-*.jpeg", "page-*.png", "page-*.webp"):
        for path in project.markdown_dir.glob(pattern):
            image_names.add(path.name)

    for name in sorted(image_names):
        path = project.markdown_dir / name
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        media = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
        }.get(suffix, "image/jpeg")
        data = path.read_bytes()
        if cover_image_name and name == cover_image_name and not cover_registered:
            # Same bytes as the in-chapter image, but flagged for library thumbnails.
            _register_cover_image(book, f"images/{name}", data)
            cover_registered = True
            continue
        book.add_item(
            epub.EpubItem(
                uid=f"img_{name}",
                file_name=f"images/{name}",
                media_type=media,
                content=data,
            )
        )

    index_start = index_state.replace_start
    index_end = index_state.replace_end if index_state.replace_end is not None else index_start
    break_pages: set[int] = set()
    entry_titles: dict[int, str] = {}
    for entry in index_state.entries:
        if not entry.enabled:
            continue
        break_pages.add(int(entry.page))
        entry_titles.setdefault(int(entry.page), entry.label)

    chunks: list[PageChunk] = []
    for meta in project.list_processed_pages():
        page = int(meta["page"])
        text = project.read_page_markdown(page) or ""
        is_cover = bool(meta.get("is_cover"))
        is_index = bool(index_start and page == index_start)
        chunks.append(
            PageChunk(page=page, text=text, is_cover=is_cover, is_index=is_index)
        )

    sections = build_export_sections(
        chunks,
        index_start=index_start,
        index_end=index_end,
        break_pages=break_pages,
        entry_titles=entry_titles,
    )
    if not sections:
        raise ValueError("No processed pages to export. Run OCR first.")

    page_file_map: dict[int, str] = {}
    chapters: list[epub.EpubHtml] = []
    # Reading order starts at cover — never prepend a separate machine-nav page.
    spine: list[Any] = []
    toc_items: list[Any] = []
    footnote_n = 1
    index_chapter: epub.EpubHtml | None = None
    cover_chapter: epub.EpubHtml | None = None
    use_index_as_nav = False

    for section in sections:
        fname = f"{section.key}.xhtml"
        for page in section.pages:
            page_file_map[page] = fname

        md, footnote_n = renumber_footnotes(section.markdown, footnote_n)
        prepared = _inject_heading_ids(
            _rewrite_images(md, image_names),
            preferred_anchors,
        )
        body_html = _md_to_html(prepared)
        body_html = _rewrite_scribe_links(body_html, page_file_map)

        if section.kind == "cover":
            body_html = f'<div class="cover-page" epub:type="cover">{body_html}</div>'

        ch = epub.EpubHtml(
            title=section.title,
            file_name=f"text/{fname}",
            lang=language or "en",
        )
        ch.content = body_html
        ch.add_item(style)
        book.add_item(ch)
        chapters.append(ch)
        spine.append(ch)
        if section.kind == "index":
            index_chapter = ch
        elif section.kind == "cover":
            cover_chapter = ch
        # Spine order is the reading order; NCX prefers index entries when present.
        if section.kind != "cover":
            toc_items.append(epub.Link(f"text/{fname}", section.title, section.key))

    if cover_image_path is not None and not cover_registered:
        # Uploaded cover outside markdown/, or path missed by the page-* glob.
        suffix = cover_image_path.suffix.lower() or ".jpg"
        _register_cover_image(book, f"images/cover{suffix}", cover_image_path.read_bytes())
        cover_registered = True

    if cover_chapter is None:
        # Always keep a page-1 cover so generated Contents can sit at page 2.
        cover_html = _title_page_html(
            title=book_title,
            authors=author_line,
            publisher=publisher,
            year=year,
        )
        cover_chapter = epub.EpubHtml(
            title="Cover",
            file_name="text/cover.xhtml",
            lang=language or "en",
        )
        cover_chapter.content = cover_html
        cover_chapter.add_item(style)
        book.add_item(cover_chapter)
        chapters.insert(0, cover_chapter)
        spine.insert(0, cover_chapter)

    if not cover_registered:
        # Libraries need a cover-image item; rasterize the title card for thumbnails.
        _register_cover_image(
            book,
            "images/cover.jpg",
            _render_title_cover_jpeg(
                title=book_title,
                authors=author_line,
                publisher=publisher,
                year=year,
            ),
        )
        cover_registered = True

    # EPUB2 guide / EPUB3 landmarks — helps readers identify the cover document.
    book.guide.append(
        {
            "type": "cover",
            "title": "Cover",
            "href": cover_chapter.file_name,
        }
    )

    # Map any index target pages not yet assigned (heading lived on a merged neighbor)
    for entry in index_state.entries:
        if not entry.enabled or entry.page in page_file_map:
            continue
        for section in sections:
            if section.kind not in ("body", "front") or not section.pages:
                continue
            if min(section.pages) <= entry.page <= max(section.pages):
                page_file_map[entry.page] = f"{section.key}.xhtml"
                break

    for ch in chapters:
        if isinstance(ch.content, bytes):
            html = ch.content.decode("utf-8")
        else:
            html = str(ch.content)
        ch.content = _rewrite_scribe_links(html, page_file_map)

    if any(e.enabled for e in index_state.entries):
        # NCX (legacy readers) = chapter targets only; in-book Contents is the EPUB3 nav.
        nav_toc: list[Any] = []
        for entry in index_state.entries:
            if not entry.enabled:
                continue
            fname = page_file_map.get(entry.page)
            if not fname:
                continue
            nav_toc.append(
                epub.Link(f"text/{fname}#{entry.anchor}", entry.label, f"idx-{entry.id}")
            )
        if nav_toc:
            toc_items = nav_toc
            use_index_as_nav = index_chapter is not None

    book.toc = tuple(toc_items)
    book.add_item(epub.EpubNcx())

    if use_index_as_nav and index_chapter is not None:
        # One Contents page: reading-order chapter + package nav document.
        if isinstance(index_chapter.content, bytes):
            idx_html = index_chapter.content.decode("utf-8")
        else:
            idx_html = str(index_chapter.content)
        index_chapter.content = _wrap_as_epub_nav(idx_html)
        if "nav" not in index_chapter.properties:
            index_chapter.properties.append("nav")
        book.spine = spine
    else:
        nav_title = (index_state.title or "Contents").strip() or "Contents"
        nav = epub.EpubNav(title=nav_title)
        book.add_item(nav)
        # No in-book index: Contents is always page 2 (after real or synthetic cover).
        ordered: list[Any] = []
        for item in spine:
            ordered.append(item)
            if item is cover_chapter:
                ordered.append(nav)
        book.spine = ordered

    buf = io.BytesIO()
    epub.write_epub(buf, book, {})
    return buf.getvalue()

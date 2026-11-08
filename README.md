# Scribe

**Version 1.00**

OCR scanned books into per-page Markdown and export an EPUB, powered by [LightOnOCR](https://huggingface.co/lightonai/LightOnOCR-2-1B). Built as a Pinokio app (FastAPI + Lego UI).

## What it does

- One **document project** per book
- Upload a PDF (or single image)
- OCR a **page range** into separate Markdown files (`markdown/page-0001.md`, …)
- Optional **cover** — PDF page as JPEG (no OCR) or an uploaded image
- **Processing** tabs after OCR:
  - **Preview** — source page image beside Markdown (updates while OCR runs)
  - **Cleaning** — strip page numbers and repeating headers/footers
  - **Edit** — raw/rendered Markdown editor (formatting, footnotes, region re-OCR / image extract)
  - **Index** — scan headings into a linked Contents, replace the original print index pages
  - **Export** — bibliographic metadata + **Download EPUB**
- Metadata can be detected from early pages, looked up on Open Library, and is saved per project

## How to use (Pinokio)

1. **Install** — creates the venv, installs torch + Python deps, links model drives
2. **Start** — opens the Scribe UI
3. **Settings → Models** — install **LightOnOCR-2-1B** (~2 GB; default pack)
4. Create a project → upload PDF → set start/end (and optional cover) → **Process pages**
5. Use **Processing** to clean, edit, build Contents, then export EPUB

Keep the app running until OCR finishes. Jobs are in-memory; a restart interrupts an active OCR run (finished pages are kept).

## Project layout

```
Scribe/
├── pinokio.js / pinokio.json / install.js / start.js / update.js / …
├── app/
│   ├── frontend/          # Lego UI (index.html, app.js, editor.js, markdown.js, …)
│   ├── backend/           # FastAPI + LightOnOCR engine
│   ├── models/            # Linked OCR packs (via Pinokio Install)
│   └── settings/          # inference.json (active pack, temperature, …)
├── projects/              # Per-document folders
│   └── <project-id>/
│       ├── project.json
│       ├── source/        # Uploaded PDF/image
│       ├── markdown/      # page-NNNN.md (+ cover/extract images)
│       ├── cover/         # Optional uploaded cover image
│       ├── index.json     # Contents draft (after Index tab work)
│       └── export_metadata.json
└── cache/                 # Hugging Face cache (HF_HOME)
```

## EPUB export (current behavior)

- **Cover:** uses the project cover image when present; otherwise a generated title page (title / authors / publisher / year). The package also registers a `cover-image` for library thumbnails.
- **Contents:** if you applied an Index, that page stays in reading order and is used as the EPUB3 nav. If not, a generated Contents is placed immediately after the cover.
- **Structure:** front matter (pages before Contents) stays as separate sections; body chapters hard-break at Index entry pages and merge between them (hyphen joins, continued paragraphs/quotes; blank and print-index stub pages omitted).
- **Footnotes** are renumbered across the book on export.

## API

Base URL is the local Scribe server (printed at start, e.g. `http://127.0.0.1:8780`). Routes are under `/api`.

### Health

```bash
curl http://127.0.0.1:8780/api/health
```

### Create project + upload + OCR + EPUB

```bash
# Create
curl -X POST http://127.0.0.1:8780/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"My Book","description":""}'

# Upload PDF (use returned project id)
curl -X POST http://127.0.0.1:8780/api/projects/<id>/source \
  -F "file=@/path/to/book.pdf"

# Start OCR for a page range (optional cover_page / cover_mode / fade_threshold)
curl -X POST http://127.0.0.1:8780/api/projects/<id>/ocr \
  -H "Content-Type: application/json" \
  -d '{"start_page":1,"end_page":20}'

# Poll job
curl http://127.0.0.1:8780/api/jobs/<job_id>

# List processed pages / read one page
curl http://127.0.0.1:8780/api/projects/<id>/pages
curl http://127.0.0.1:8780/api/projects/<id>/pages/1/markdown

# Export EPUB (metadata optional; also persisted to export_metadata.json)
curl -OJ -X POST http://127.0.0.1:8780/api/projects/<id>/export/epub \
  -H "Content-Type: application/json" \
  -d '{"title":"My Book","authors":"Author Name","language":"en"}'
```

Other useful endpoints (same base):

| Area | Methods |
|------|---------|
| Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/{id}` |
| Pages | `GET/PUT …/pages/{n}/markdown`, region OCR, extract image, page preview |
| Cleaning | `GET …/cleaning/analyze`, `POST …/cleaning/preview`, `POST …/cleaning/apply` |
| Index | `GET/PUT …/index`, `POST …/index/scan`, `POST …/index/apply` |
| Metadata | `GET/PUT …/export/metadata`, `POST …/export/metadata/lookup` |
| Models / settings | `GET /models`, install/delete packs, `GET/PUT /settings/inference` |

### Python

```python
import requests

base = "http://127.0.0.1:8780/api"
project = requests.post(f"{base}/projects", json={"name": "My Book"}).json()["project"]
pid = project["id"]
with open("book.pdf", "rb") as f:
    requests.post(f"{base}/projects/{pid}/source", files={"file": f})
job = requests.post(
    f"{base}/projects/{pid}/ocr",
    json={"start_page": 1, "end_page": 20},
).json()["job"]
print(job["id"])
```

### JavaScript

```js
const base = "http://127.0.0.1:8780/api";
const { project } = await fetch(`${base}/projects`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "My Book" }),
}).then((r) => r.json());

const form = new FormData();
form.append("file", pdfFile);
await fetch(`${base}/projects/${project.id}/source`, { method: "POST", body: form });
const { job } = await fetch(`${base}/projects/${project.id}/ocr`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ start_page: 1, end_page: 20 }),
}).then((r) => r.json());
```

## Notes

- Visual system: core **Lego** (`app/frontend/lego.js`); app layout in `styles.css`
- OCR is a Gradio-free port of LightOnOCR (`app/backend/services/ocr.py`); Transformers v5 is installed from git (see `requirements.txt`)
- Faster OCR is optional. On an NVIDIA GPU, **Settings → Models** can install a local **vLLM** server. That download is about 6 GB and is not part of Pinokio Install or Update. Install links `env-vllm` to the shared Pinokio drive `vllm/env-vllm` (the same kind of link as the OCR models), so other programs can reuse it. The environment uses uv's own Python 3.12, so it does not use the Python, conda install, or CUDA toolkit already on the machine. It serves the same LightOnOCR weights, not a second model. Windows gets the SystemPanic CUDA 13 wheel (official vLLM does not ship Windows). Linux gets the official vLLM package, and uv picks the CUDA build that matches the driver. Installing it from Models checks that the server can start, then stops it again so VRAM stays free. Start does not launch vLLM. Process pages starts it when OCR needs it and releases that GPU memory when the job finishes or is cancelled. Region re-scan in Edit stays on Transformers, so manual editing does not bring the server up. AMD, Intel, and CPU machines do not offer the install and OCR with Transformers. Several pages are sent at once, and PDF rendering stays ahead of the GPU. The Scribe app environment is not upgraded.
- If an installed server fails to start, the OCR panel shows the captured error and offers **Try again**, **Use Transformers** (this run only, one page at a time), or **Abort**. The next Process pages tries vLLM again. When vLLM is not installed, Process pages uses Transformers without that prompt.
- Default OCR pack id: `lightonocr-2-1b` (other LightOnOCR variants can be installed under Settings → Models)
- Export today is **EPUB only** (no combined Markdown download or ZIP in the UI/API)

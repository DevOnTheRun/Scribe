from __future__ import annotations

import argparse
from pathlib import Path

try:
    import uvicorn
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "Missing Python package 'uvicorn'. "
        "Re-run Pinokio Install, or from the Scribe folder run:\n"
        "  uv pip install -r app/backend/requirements.txt"
    ) from exc

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from config import ROOT
from routers.api import router as api_router

FRONTEND_DIR = ROOT / "app" / "frontend"

app = FastAPI(title="Scribe", version="1.00")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)

if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
def index():
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"message": "Scribe API is running. Add app/frontend/index.html to serve the UI."}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8780)
    args = parser.parse_args()
    url = f"http://{args.host}:{args.port}"
    print(f"Scribe running at {url}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()

from contextlib import asynccontextmanager
from typing import Literal

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.config import settings
from app.downloader import download_manager, MediaType
from app.qobuz import QobuzConfigurationError, search_qobuz

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await download_manager.start()
    yield

app = FastAPI(title="Jack", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="app/static"), name="static")


class DownloadRequest(BaseModel):
    mediaType: MediaType
    id: str = Field(min_length=1)
    quality: int | None = Field(default=None, ge=1, le=4)
    title: str = ""
    artist: str = ""


@app.get("/")
async def index() -> FileResponse:
    return FileResponse("app/static/index.html")


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "qobuzConfigured": bool(settings.qobuz_app_id),
        "streamripConfig": settings.streamrip_config,
        "incomingDir": str(settings.music_incoming_dir),
        "musicDir": str(settings.music_dir),
    }


@app.get("/api/search")
async def search(
    q: str = Query(min_length=2),
    type: Literal["album", "track"] = "album",
    limit: int = Query(default=20, ge=1, le=50),
) -> dict[str, object]:
    try:
        items = await search_qobuz(q, type, limit)
    except QobuzConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Qobuz search failed: {exc}"
        ) from exc
    return {"items": items}


@app.post("/api/downloads", status_code=201)
async def create_download(request: DownloadRequest) -> dict[str, object]:
    try:
        job = download_manager.create_job(
            media_type=request.mediaType,
            media_id=request.id,
            quality=request.quality,
            title=request.title,
            artist=request.artist,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return job.as_dict()


@app.get("/api/downloads")
async def list_downloads() -> dict[str, object]:
    return {"items": [job.as_dict() for job in download_manager.list_jobs()]}


@app.get("/api/downloads/{job_id}")
async def get_download(job_id: str) -> dict[str, object]:
    try:
        return download_manager.get_job(job_id).as_dict()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Download job not found") from exc


def main() -> None:
    uvicorn.run("app.main:app", host="0.0.0.0", port=8090)

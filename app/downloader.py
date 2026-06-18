from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
import shutil
import uuid

from app.config import settings
from enum import IntEnum, StrEnum

from streamrip.config import Config
from streamrip.rip.main import Main

class MediaType(StrEnum):
    ALBUM = "album"
    TRACK = "track"


@dataclass
class DownloadJob:
    id: str
    source: str
    media_type: str
    media_id: str
    title: str = ""
    artist: str = ""
    quality: int = settings.default_quality
    status: str = "queued"
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    log: list[str] = field(default_factory=list)
    error: str = ""
    output_paths: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "source": self.source,
            "mediaType": self.media_type,
            "mediaId": self.media_id,
            "title": self.title,
            "artist": self.artist,
            "quality": self.quality,
            "status": self.status,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "log": self.log[-200:],
            "error": self.error,
            "outputPaths": self.output_paths,
        }


class DownloadManager:
    def __init__(self) -> None:
        self.config = Config(settings.streamrip_config)
        self.main = Main(self.config)
        self.jobs: dict[str, DownloadJob] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.worker_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        print("Starting DownloadManager...")
        await self.main.get_logged_in_client("qobuz")
        print("Logged into Qobuz")

        if self.worker_task is None or self.worker_task.done():
            self.worker_task = asyncio.create_task(self._worker())
        print("Worker started")

    def create_job(
        self,
        media_type: MediaType,
        media_id: str,
        quality: int,
        title: str = "",
        artist: str = "",
    ) -> DownloadJob:
        if quality not in {1, 2, 3, 4}:
            raise ValueError("quality must be one of 1, 2, 3, 4")

        job = DownloadJob(
            id=uuid.uuid4().hex,
            source="qobuz",
            media_type=media_type.value,
            media_id=media_id,
            title=title,
            artist=artist,
            quality=quality,
        )
        self.jobs[job.id] = job
        self.queue.put_nowait(job.id)
        return job

    def list_jobs(self) -> list[DownloadJob]:
        return sorted(self.jobs.values(), key=lambda job: job.created_at, reverse=True)

    def get_job(self, job_id: str) -> DownloadJob:
        try:
            return self.jobs[job_id]
        except KeyError as exc:
            raise KeyError("Download job not found") from exc

    async def _worker(self) -> None:
        while True:
            job_id = await self.queue.get()
            job = self.jobs[job_id]
            try:
                await self._run_job(job)
            finally:
                self.queue.task_done()

    async def _run_job(self, job: DownloadJob) -> None:
        job.status = "downloading"
        self._touch(job)

        try:
            await self.main.add_by_id("qobuz", job.media_type, job.media_id)
            await self.main.resolve()
            await self.main.rip()
        except Exception as e:
            job.status = "failed"
            job.error = str(e)
            self._touch(job)
            return

        job.status = "complete"
        self._touch(job)

    @staticmethod
    def _unique_target(target: Path) -> Path:
        if not target.exists():
            return target
        for index in range(2, 1000):
            candidate = target.with_name(f"{target.name} ({index})")
            if not candidate.exists():
                return candidate
        raise RuntimeError(f"Could not find a free target path for {target}")

    def _append(self, job: DownloadJob, line: str) -> None:
        if line:
            job.log.append(line)
            job.log = job.log[-500:]
            self._touch(job)

    @staticmethod
    def _touch(job: DownloadJob) -> None:
        job.updated_at = datetime.now(UTC).isoformat()


download_manager = DownloadManager()

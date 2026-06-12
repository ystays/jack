from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
import shutil
import uuid

from app.config import settings


VALID_MEDIA_TYPES = {"album", "track"}
VALID_QUALITIES = {1, 2, 3, 4}


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
        self.jobs: dict[str, DownloadJob] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.worker_task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self.worker_task is None or self.worker_task.done():
            self.worker_task = asyncio.create_task(self._worker())

    def create_job(
        self,
        media_type: str,
        media_id: str,
        quality: int | None,
        title: str = "",
        artist: str = "",
    ) -> DownloadJob:
        if media_type not in VALID_MEDIA_TYPES:
            raise ValueError("mediaType must be album or track")
        resolved_quality = quality or settings.default_quality
        if resolved_quality not in VALID_QUALITIES:
            raise ValueError("quality must be one of 1, 2, 3, 4")

        job = DownloadJob(
            id=uuid.uuid4().hex,
            source="qobuz",
            media_type=media_type,
            media_id=media_id,
            title=title,
            artist=artist,
            quality=resolved_quality,
        )
        self.jobs[job.id] = job
        self.queue.put_nowait(job.id)
        return job

    def retry_job(self, job_id: str) -> DownloadJob:
        job = self.get_job(job_id)
        if job.status not in {"failed", "complete"}:
            raise ValueError("Only failed or complete jobs can be retried")

        job.status = "queued"
        job.error = ""
        job.log = []
        job.output_paths = []
        self._touch(job)
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

        settings.music_incoming_dir.mkdir(parents=True, exist_ok=True)
        settings.music_dir.mkdir(parents=True, exist_ok=True)
        staging_dir = settings.music_incoming_dir / job.id
        if staging_dir.exists():
            shutil.rmtree(staging_dir)
        staging_dir.mkdir(parents=True)

        command = self._streamrip_command(job, staging_dir)
        self._append(job, f"$ {' '.join(command)}")

        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        assert process.stdout is not None
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            self._append(job, line.decode(errors="replace").rstrip())

        return_code = await process.wait()
        if return_code != 0:
            job.status = "failed"
            job.error = f"streamrip exited with code {return_code}"
            self._touch(job)
            return

        job.status = "importing"
        self._touch(job)
        job.output_paths = self._import_to_music_dir(staging_dir)
        job.status = "complete"
        self._append(
            job, f"Imported {len(job.output_paths)} item(s) into {settings.music_dir}"
        )
        self._touch(job)

    def _streamrip_command(self, job: DownloadJob, staging_dir: Path) -> list[str]:
        command = [
            settings.streamrip_bin,
            "--quality",
            str(job.quality),
            "--no-progress",
            "-f",
            str(staging_dir),
        ]
        if settings.streamrip_config:
            command.extend(["--config-path", settings.streamrip_config])
        command.extend(["id", "qobuz", job.media_type, job.media_id])
        return command

    def _import_to_music_dir(self, staging_dir: Path) -> list[str]:
        imported: list[str] = []
        for child in staging_dir.iterdir():
            target = self._unique_target(settings.music_dir / child.name)
            shutil.move(str(child), str(target))
            imported.append(str(target))
        return imported

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

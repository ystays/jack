from typing import Any

import httpx

from app.config import settings


QOBUZ_API_BASE = "https://www.qobuz.com/api.json/0.2"


class QobuzConfigurationError(RuntimeError):
    pass


def _require_qobuz_config() -> None:
    if not settings.qobuz_app_id:
        raise QobuzConfigurationError("QOBUZ_APP_ID is not configured")


def _image_url(item: dict[str, Any]) -> str:
    image = item.get("image") or {}
    return image.get("large") or image.get("small") or image.get("thumbnail") or ""


def _artist_name(item: dict[str, Any]) -> str:
    artist = item.get("artist") or item.get("performer") or {}
    if isinstance(artist, dict):
        return artist.get("name", "")
    return str(artist or "")


def _album_artist_name(album: dict[str, Any]) -> str:
    artist = album.get("artist") or {}
    if isinstance(artist, dict):
        return artist.get("name", "")
    return str(artist or "")


def normalize_album(album: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(album.get("id", "")),
        "type": "album",
        "title": album.get("title", ""),
        "artist": _album_artist_name(album),
        "year": str(album.get("release_date_original", "") or album.get("release_date_download", ""))[:4],
        "tracksCount": album.get("tracks_count", 0),
        "duration": album.get("duration", 0),
        "maximumBitDepth": album.get("maximum_bit_depth"),
        "maximumSamplingRate": album.get("maximum_sampling_rate"),
        "hires": bool(album.get("hires")),
        "explicit": bool(album.get("parental_warning")),
        "cover": _image_url(album),
    }


def normalize_track(track: dict[str, Any]) -> dict[str, Any]:
    album = track.get("album") or {}
    return {
        "id": str(track.get("id", "")),
        "type": "track",
        "title": track.get("title", ""),
        "artist": _artist_name(track),
        "album": album.get("title", ""),
        "year": str(album.get("release_date_original", "") or album.get("release_date_download", ""))[:4],
        "duration": track.get("duration", 0),
        "trackNumber": track.get("track_number"),
        "maximumBitDepth": track.get("maximum_bit_depth") or album.get("maximum_bit_depth"),
        "maximumSamplingRate": track.get("maximum_sampling_rate") or album.get("maximum_sampling_rate"),
        "hires": bool(track.get("hires") or album.get("hires")),
        "explicit": bool(track.get("parental_warning")),
        "cover": _image_url(album),
    }


async def search_qobuz(query: str, media_type: str, limit: int) -> list[dict[str, Any]]:
    _require_qobuz_config()

    if media_type not in {"album", "track"}:
        raise ValueError("media_type must be album or track")

    params = {
        "app_id": settings.qobuz_app_id,
        "query": query,
        "type": f"{media_type}s",
        "limit": min(max(limit, 1), 50),
        "offset": 0,
    }
    if settings.qobuz_user_auth_token:
        params["user_auth_token"] = settings.qobuz_user_auth_token

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{QOBUZ_API_BASE}/catalog/search", params=params)
        response.raise_for_status()
        payload = response.json()

    container = payload.get(f"{media_type}s", {})
    items = container.get("items", [])
    normalizer = normalize_album if media_type == "album" else normalize_track
    return [normalizer(item) for item in items if item.get("id")]

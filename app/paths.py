from pathlib import Path


class LibrarySubfolderError(ValueError):
    pass


def resolve_library_subfolder(library_subfolder: str, music_dir: Path) -> Path:
    base_dir = music_dir.resolve()
    raw_subfolder = library_subfolder.strip()
    if not raw_subfolder:
        return base_dir

    if "\\" in raw_subfolder:
        raise LibrarySubfolderError("Library folder must use forward slashes")

    parts = raw_subfolder.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise LibrarySubfolderError(
            "Library folder must be a relative path without empty, '.', or '..' parts"
        )

    relative_path = Path(*parts)
    if relative_path.is_absolute():
        raise LibrarySubfolderError(
            "Library folder must be relative to the music directory"
        )

    target_dir = (base_dir / relative_path).resolve()
    if not target_dir.is_relative_to(base_dir):
        raise LibrarySubfolderError(
            "Library folder must stay inside the music directory"
        )

    return target_dir

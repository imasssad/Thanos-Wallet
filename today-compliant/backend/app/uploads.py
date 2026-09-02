import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.config import settings

ALLOWED_CONTENT_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
IMAGE_CONTENT_TYPES = {key: value for key, value in ALLOWED_CONTENT_TYPES.items() if key.startswith("image/")}
UPLOAD_CHUNK_SIZE = 1024 * 1024


def upload_root() -> Path:
    root = Path(settings.upload_directory).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


async def save_upload(
    file: UploadFile,
    allowed_types: dict[str, str] = ALLOWED_CONTENT_TYPES,
) -> tuple[str, str, int, str]:
    content_type = (file.content_type or "").lower()
    extension = allowed_types.get(content_type)
    if not extension:
        allowed_label = "an image" if allowed_types == IMAGE_CONTENT_TYPES else "a PDF, JPG, PNG, or WebP file"
        raise HTTPException(status_code=415, detail=f"Upload {allowed_label}")

    original_name = Path(file.filename or f"upload{extension}").name
    stored_name = f"{uuid.uuid4().hex}{extension}"
    destination = upload_root() / stored_name
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    size = 0

    try:
        with destination.open("xb") as output:
            while chunk := await file.read(UPLOAD_CHUNK_SIZE):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File must be {settings.max_upload_size_mb} MB or smaller",
                    )
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    if size == 0:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="The uploaded file is empty")

    validate_file_signature(stored_name, content_type)
    return original_name, stored_name, size, content_type


def validate_file_signature(stored_name: str, content_type: str) -> None:
    path = upload_root() / stored_name
    with path.open("rb") as uploaded:
        header = uploaded.read(12)
    valid = {
        "application/pdf": header.startswith(b"%PDF-"),
        "image/jpeg": header.startswith(b"\xff\xd8\xff"),
        "image/png": header.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": header.startswith(b"RIFF") and header[8:12] == b"WEBP",
    }.get(content_type, False)
    if not valid:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=415, detail="File contents do not match the selected file type")

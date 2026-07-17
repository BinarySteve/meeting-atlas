import hashlib
import re
from collections.abc import AsyncIterator
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, Request, status

from .settings import get_settings

SAFE_SUFFIX = re.compile(r"^\.[a-zA-Z0-9]{1,10}$")


async def receive_stream(
    request: Request, suffix: str = ".wav"
) -> AsyncIterator[tuple[Path, str, int]]:
    settings = get_settings()
    safe_suffix = suffix if SAFE_SUFFIX.fullmatch(suffix) else ".bin"
    settings.service_temp_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination = settings.service_temp_dir / f"{uuid4().hex}{safe_suffix}"
    digest = hashlib.sha256()
    size = 0
    try:
        with destination.open("xb") as output:
            async for chunk in request.stream():
                size += len(chunk)
                if size > settings.service_max_upload_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="Upload exceeds configured limit",
                    )
                digest.update(chunk)
                output.write(chunk)
        if size == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty upload")
        yield destination, digest.hexdigest(), size
    finally:
        destination.unlink(missing_ok=True)

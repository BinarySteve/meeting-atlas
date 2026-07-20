import asyncio
import os
import signal
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ProcessResult:
    stdout: str
    stderr: str
    duration_seconds: float


class ProcessFailure(RuntimeError):
    pass


async def run_controlled(
    executable: Path,
    args: list[str],
    *,
    timeout_seconds: int,
    cwd: Path | None = None,
    max_output_bytes: int = 32_768,
) -> ProcessResult:
    loop = asyncio.get_running_loop()
    started = loop.time()
    process = await asyncio.create_subprocess_exec(
        str(executable),
        *args,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=os.name != "nt",
    )
    stdout_task = asyncio.create_task(_read_bounded(process.stdout, max_output_bytes))
    stderr_task = asyncio.create_task(_read_bounded(process.stderr, max_output_bytes))
    try:
        await asyncio.wait_for(process.wait(), timeout=timeout_seconds)
    except (TimeoutError, asyncio.CancelledError):
        _kill_process_group(process)
        await process.wait()
        await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
        raise
    stdout_bytes, stderr_bytes = await asyncio.gather(stdout_task, stderr_task)
    stdout = stdout_bytes.decode("utf-8", errors="replace")
    stderr = stderr_bytes.decode("utf-8", errors="replace")
    if process.returncode != 0:
        raise ProcessFailure(f"Process exited {process.returncode}: {stderr[-2000:]}")
    return ProcessResult(stdout=stdout, stderr=stderr, duration_seconds=loop.time() - started)


async def _read_bounded(reader: asyncio.StreamReader | None, limit: int) -> bytes:
    if reader is None:
        return b""
    output = bytearray()
    while chunk := await reader.read(8192):
        output.extend(chunk)
        if len(output) > limit:
            del output[:-limit]
    return bytes(output)


def _kill_process_group(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    if os.name != "nt":
        try:
            os.killpg(process.pid, signal.SIGKILL)  # type: ignore[attr-defined]
            return
        except ProcessLookupError:
            return
    process.kill()

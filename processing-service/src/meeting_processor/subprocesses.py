import asyncio
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
) -> ProcessResult:
    loop = asyncio.get_running_loop()
    started = loop.time()
    process = await asyncio.create_subprocess_exec(
        str(executable),
        *args,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            process.communicate(), timeout=timeout_seconds
        )
    except (TimeoutError, asyncio.CancelledError):
        process.kill()
        await process.wait()
        raise
    stdout = stdout_bytes.decode("utf-8", errors="replace")
    stderr = stderr_bytes.decode("utf-8", errors="replace")[-32_768:]
    if process.returncode != 0:
        raise ProcessFailure(f"Process exited {process.returncode}: {stderr[-2000:]}")
    return ProcessResult(stdout=stdout, stderr=stderr, duration_seconds=loop.time() - started)

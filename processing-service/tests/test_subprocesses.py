import asyncio
import sys
from pathlib import Path

import pytest

from meeting_processor.subprocesses import run_controlled


def test_controlled_process_bounds_output() -> None:
    result = asyncio.run(run_controlled(
        Path(sys.executable), ["-c", "print('x' * 10000)"],
        timeout_seconds=10, max_output_bytes=128,
    ))
    assert len(result.stdout.encode()) <= 128


def test_controlled_process_times_out() -> None:
    with pytest.raises(TimeoutError):
        asyncio.run(run_controlled(
            Path(sys.executable), ["-c", "import time; time.sleep(10)"],
            timeout_seconds=1,
        ))

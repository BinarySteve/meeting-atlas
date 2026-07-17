#!/usr/bin/env bash
set -euo pipefail

ROOT="${WHISPER_CPP_DIR:-$HOME/opt/whisper.cpp}"
CMAKE="${CMAKE:-$HOME/meeting-transcriber-processing/.venv/bin/cmake}"
NINJA="${NINJA:-$HOME/meeting-transcriber-processing/.venv/bin/ninja}"
TARGET="${AMDGPU_TARGETS:-gfx1151}"

"$CMAKE" -S "$ROOT" -B "$ROOT/build-rocm" -G Ninja \
  -DCMAKE_MAKE_PROGRAM="$NINJA" -DCMAKE_BUILD_TYPE=Release \
  -DGGML_HIP=ON -DAMDGPU_TARGETS="$TARGET"
"$CMAKE" --build "$ROOT/build-rocm" -j "$(nproc)"

"$CMAKE" -S "$ROOT" -B "$ROOT/build-vulkan" -G Ninja \
  -DCMAKE_MAKE_PROGRAM="$NINJA" -DCMAKE_BUILD_TYPE=Release -DGGML_VULKAN=ON
"$CMAKE" --build "$ROOT/build-vulkan" -j "$(nproc)"

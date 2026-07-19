#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 normalized-16khz-mono.wav" >&2
  exit 2
fi

AUDIO="$1"
ROOT="${WHISPER_CPP_DIR:-$HOME/opt/whisper.cpp}"
MODEL="${WHISPER_MODEL_PATH:-$HOME/models/whisper/ggml-large-v3-turbo.bin}"

for backend in rocm vulkan; do
  cli="$ROOT/build-$backend/bin/whisper-cli"
  if [[ ! -x "$cli" ]]; then
    echo "$backend unavailable: $cli" >&2
    continue
  fi
  echo "=== $backend ==="
  /usr/bin/time -v "$cli" --model "$MODEL" --file "$AUDIO" \
    --suppress-nst --no-prints --output-json-full \
    --output-file "/tmp/meeting-benchmark-$backend"
done

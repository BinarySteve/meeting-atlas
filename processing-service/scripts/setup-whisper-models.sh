#!/usr/bin/env bash
set -euo pipefail

WHISPER_CPP_DIR="${WHISPER_CPP_DIR:-$HOME/opt/whisper.cpp}"
MODEL_DIR="${MODEL_DIR:-$HOME/models/whisper}"
MODEL="${1:-large-v3-turbo}"

case "$MODEL" in
  large-v3-turbo|large-v3) ;;
  *) echo "Expected large-v3-turbo or large-v3" >&2; exit 2 ;;
esac

mkdir -p "$MODEL_DIR"
"$WHISPER_CPP_DIR/models/download-ggml-model.sh" "$MODEL" "$MODEL_DIR"
"$WHISPER_CPP_DIR/models/download-vad-model.sh" silero-v6.2.0 "$MODEL_DIR"
echo "Models installed under $MODEL_DIR. Normal service startup performs no downloads."

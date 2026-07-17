#!/usr/bin/env bash
set -euo pipefail

# Public, ungated WeSpeaker model. No account, token, email, or organization is sent.
# This explicit setup step uses network access; normal service startup never downloads models.
ASSET="voxceleb_resnet221_LM.tar.gz"
MODEL_URL="${WESPEAKER_MODEL_URL:-}"
DEST="${WESPEAKER_MODEL_PATH:-$HOME/models/wespeaker-resnet221-lm}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }
command -v tar >/dev/null || { echo "tar is required" >&2; exit 2; }
if [[ -z "$MODEL_URL" ]]; then
  MODEL_URL="$(ASSET="$ASSET" python3 <<'PY'
import json
import os
import urllib.request

api = "https://modelscope.cn/api/v1/datasets/wenet/wespeaker_pretrained_models/oss/tree"
with urllib.request.urlopen(api, timeout=30) as response:
    payload = json.load(response)
print(next(item["Url"] for item in payload["Data"] if item["Key"] == os.environ["ASSET"]))
PY
)"
fi
mkdir -p "$DEST"
curl --fail --location --proto '=https' --tlsv1.2 "$MODEL_URL" --output "$WORK/model.tar.gz"

if [[ -n "${WESPEAKER_MODEL_SHA256:-}" ]]; then
  echo "${WESPEAKER_MODEL_SHA256}  $WORK/model.tar.gz" | sha256sum --check --status
else
  echo "9462705bfafeed7b4a6585638a4d0140ddaf9338471198d014eb2579712f89f6  $WORK/model.tar.gz" \
    | sha256sum --check --status
fi

mkdir "$WORK/unpacked"
tar -xzf "$WORK/model.tar.gz" -C "$WORK/unpacked"
CONFIG="$(find "$WORK/unpacked" -type f -name config.yaml -print -quit)"
CHECKPOINT="$(find "$WORK/unpacked" -type f \( -name avg_model.pt -o -name final_model.pt -o -name '*.pt' \) -print -quit)"
[[ -n "$CONFIG" && -n "$CHECKPOINT" ]] || { echo "Model archive missing config.yaml or checkpoint" >&2; exit 3; }
install -m 0644 "$CONFIG" "$DEST/config.yaml"
install -m 0644 "$CHECKPOINT" "$DEST/avg_model.pt"
printf 'Installed ungated WeSpeaker model at %s\n' "$DEST"
printf 'Archive SHA-256: '
sha256sum "$WORK/model.tar.gz" | cut -d' ' -f1

#!/usr/bin/env bash
set -euo pipefail

# Hugging Face prompts for username and token. The token is never placed in an
# argument, environment file, Git remote, or Meeting Atlas runtime configuration.
SOURCE="https://hf.co/pyannote/speaker-diarization-community-1"
DEST="${PYANNOTE_MODEL_PATH:-$HOME/models/pyannote-speaker-diarization-community-1}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

command -v git >/dev/null || { echo "git is required" >&2; exit 2; }
command -v git-lfs >/dev/null || { echo "git-lfs is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }
[[ ! -e "$DEST" ]] || { echo "Destination already exists: $DEST" >&2; exit 3; }

echo "Hugging Face will prompt for username and access token. Credential storage is disabled."
git -c credential.helper= -c core.askPass= clone "$SOURCE" "$WORK/model"
git -C "$WORK/model" lfs pull
REVISION="$(git -C "$WORK/model" rev-parse HEAD)"

[[ -f "$WORK/model/config.yaml" ]] || { echo "Downloaded pipeline has no config.yaml" >&2; exit 4; }
git -C "$WORK/model" lfs fsck

rm -rf "$WORK/model/.git"
MODEL_DIR="$WORK/model" REVISION="$REVISION" SOURCE="$SOURCE" python3 <<'PY'
import hashlib
import json
import os
from pathlib import Path

root = Path(os.environ["MODEL_DIR"])
files = {}
for path in sorted(item for item in root.rglob("*") if item.is_file()):
    relative = path.relative_to(root).as_posix()
    files[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
manifest = {
    "source": os.environ["SOURCE"],
    "revision": os.environ["REVISION"],
    "files": files,
}
(root / ".meeting-atlas-model.json").write_text(
    json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
)
PY

mkdir -p "$(dirname "$DEST")"
mv "$WORK/model" "$DEST"
printf 'Installed Pyannote Community-1 at %s\nRevision: %s\n' "$DEST" "$REVISION"
echo "No Hugging Face token is needed or permitted in the runtime .env file."

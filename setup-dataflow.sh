#!/usr/bin/env bash
# Set up the OpenDCAI DataFlow framework and launch its Web UI.
# Reference: https://github.com/OpenDCAI/DataFlow#dfwebui
#
# This mirrors `pip install open-dataflow` + `dataflow webui`, with two
# workarounds for restricted/cloud network environments:
#
#   1. The DataFlow-WebUI release zip is downloaded straight from the
#      GitHub release (objects.githubusercontent.com) instead of via
#      api.github.com. The unauthenticated GitHub API only allows 60
#      requests/hour/IP, which shared runners exhaust — making the plain
#      `dataflow webui` command fail with HTTP 403.
#
#   2. The `cl100k_base` tiktoken encoding is pre-cached. One operator
#      (ChunkedPromptedGenerator) evaluates `tiktoken.get_encoding(...)`
#      at import time; the WebUI imports every operator on startup, so a
#      blocked openaipublic.blob.core.windows.net download crashes it.
set -euo pipefail

cd "$(dirname "$0")"

VENV_DIR=".venv"
WEBUI_REPO="OpenDCAI/DataFlow-WebUI"
HOST="${DATAFLOW_HOST:-0.0.0.0}"
PORT="${DATAFLOW_PORT:-8000}"

# tiktoken looks up cached encodings under TIKTOKEN_CACHE_DIR, keyed by the
# SHA-1 of the download URL.
export TIKTOKEN_CACHE_DIR="$PWD/.dataflow/tiktoken-cache"
CL100K_URL="https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken"
CL100K_SHA256="223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7"
CL100K_MIRROR="https://raw.githubusercontent.com/niieani/gpt-tokenizer/main/data/cl100k_base.tiktoken"

# 1. Isolated Python environment (Python 3.10/3.11 recommended).
if ! command -v uv >/dev/null 2>&1; then
  pip install uv
fi
if [ ! -d "$VENV_DIR" ]; then
  uv venv "$VENV_DIR" --python 3.11
fi
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

# 2. DataFlow framework + pip (uv venvs ship without pip, which the WebUI
#    launcher needs for its `python -m pip install -r requirements.txt`).
uv pip install open-dataflow pip

# 3. Pre-cache the cl100k_base tiktoken encoding (see header note #2).
mkdir -p "$TIKTOKEN_CACHE_DIR"
CL100K_KEY="$(printf '%s' "$CL100K_URL" | sha1sum | cut -d' ' -f1)"
CL100K_CACHE="$TIKTOKEN_CACHE_DIR/$CL100K_KEY"
if [ "$(sha256sum "$CL100K_CACHE" 2>/dev/null | cut -d' ' -f1)" != "$CL100K_SHA256" ]; then
  echo "Caching cl100k_base tiktoken encoding ..."
  curl -fsSL -o "$CL100K_CACHE" "$CL100K_MIRROR"
  test "$(sha256sum "$CL100K_CACHE" | cut -d' ' -f1)" = "$CL100K_SHA256" \
    || { echo "ERROR: cl100k_base checksum mismatch" >&2; exit 1; }
fi

# 4. Resolve the latest DataFlow-WebUI release without the GitHub API:
#    /releases/latest is a plain 302 redirect to /releases/tag/<tag>.
TAG="$(curl -fsSL -o /dev/null -w '%{redirect_url}' \
  "https://github.com/${WEBUI_REPO}/releases/latest" | sed 's#.*/tag/##')"
ASSET="DataFlow-WebUI-${TAG}.zip"
ZIP="/tmp/${ASSET}"
if [ ! -s "$ZIP" ]; then
  echo "Downloading ${ASSET} ..."
  curl -fsSL -o "$ZIP" \
    "https://github.com/${WEBUI_REPO}/releases/download/${TAG}/${ASSET}"
fi

# 5. Pre-install the WebUI backend deps so the launcher's own pip step is a
#    fast no-op, then start it from the local zip (skips the rate-limited API).
REQS="$(unzip -p "$ZIP" '*/backend/requirements.txt' 2>/dev/null || true)"
if [ -n "$REQS" ]; then
  echo "$REQS" | uv pip install -r -
fi

echo "Launching DataFlow Web UI at http://${HOST}:${PORT} ..."
# The launcher prompts for a download dir; the blank line accepts the default.
printf '\n\n' | dataflow webui --zip-path "$ZIP" --host "$HOST" --port "$PORT"

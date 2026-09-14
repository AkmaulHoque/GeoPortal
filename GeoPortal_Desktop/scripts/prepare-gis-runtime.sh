#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MICROMAMBA="${MICROMAMBA:-micromamba}"
if ! command -v "$MICROMAMBA" >/dev/null 2>&1; then
  echo "micromamba is required. Install it first or set MICROMAMBA=/path/to/micromamba" >&2
  exit 2
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ENV_DIR="$TMP/geoportal-gis"
"$MICROMAMBA" create -y -p "$ENV_DIR" -c conda-forge python=3.11 gdal pdal conda-pack
"$MICROMAMBA" run -p "$ENV_DIR" conda-pack -p "$ENV_DIR" -o "$ROOT/runtime/gis-runtime.tar.gz" --force
ls -lh "$ROOT/runtime/gis-runtime.tar.gz"

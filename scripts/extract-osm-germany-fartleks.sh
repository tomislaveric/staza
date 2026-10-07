#!/usr/bin/env bash
# Builds the Fartlek OSM way-geometry snapshot from a Geofabrik Germany PBF.
#
# Keeps full way LineStrings for Fartlek candidate generation, plus
# city-limit boundary nodes and traffic-control nodes used to split/evaluate candidates.
#
# Prerequisites:
#   osmium-tool
#
# Usage:
#   scripts/extract-osm-germany-fartleks.sh [path/to/germany-latest.osm.pbf]
#
# Optional environment variables:
#   OUTPUT=/path/to/osm-germany-fartleks.ndjson
#   WORK_DIR=/path/to/work-dir
#   NODE_MAX_OLD_SPACE_MB=8192

set -euo pipefail

PBF="${1:-germany-latest.osm.pbf}"
OUTPUT="${OUTPUT:-fixtures/osm-germany-fartleks.ndjson}"
WORK_DIR="${WORK_DIR:-tmp/osm-extract-fartleks}"

if ! command -v osmium >/dev/null 2>&1; then
  echo "osmium-tool is required." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required." >&2
  exit 1
fi

if [ ! -f "$PBF" ]; then
  echo "PBF extract not found: $PBF" >&2
  exit 1
fi

BUILD_SCRIPT="dist/osm/buildFartlekSnapshot.js"

if [ ! -f "$BUILD_SCRIPT" ]; then
  echo "Compiled Fartlek snapshot builder not found: $BUILD_SCRIPT" >&2
  echo "Make sure the application image contains the compiled dist output." >&2
  exit 1
fi

mkdir -p "$WORK_DIR"
mkdir -p "$(dirname "$OUTPUT")"

FILTERED="$WORK_DIR/filtered.osm.pbf"
EXPORTED="$WORK_DIR/filtered.geojsonseq"

cleanup() {
  rm -f "$FILTERED" "$EXPORTED"
}

trap cleanup EXIT

echo "Filtering $PBF ..."

osmium tags-filter \
  --overwrite \
  --output "$FILTERED" \
  "$PBF" \
  w/highway=primary,primary_link,secondary,secondary_link,tertiary,tertiary_link,unclassified \
  n/traffic_sign=city_limit \
  n/highway=traffic_signals,stop,give_way \
  n/traffic_calming

echo "Exporting geometries ..."

osmium export \
  --overwrite \
  --output "$EXPORTED" \
  --output-format geojsonseq \
  --add-unique-id=type_id \
  --index-type=sparse_file_array \
  "$FILTERED"

EXTRACT_DATE="$(
  osmium fileinfo \
    -e \
    -g header.option.timestamp \
    "$PBF" \
    2>/dev/null \
    | cut -c1-10 \
    || true
)"

if [ -z "$EXTRACT_DATE" ]; then
  EXTRACT_DATE="$(date -u +%Y-%m-%d)"
fi

SOURCE_VERSION="geofabrik-germany-$EXTRACT_DATE"

echo "Building snapshot $OUTPUT ..."

NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_MB:-8192}" \
node "$BUILD_SCRIPT" \
  --input "$EXPORTED" \
  --output "$OUTPUT" \
  --source-url "https://download.geofabrik.de/europe/germany-latest.osm.pbf" \
  --source-version "$SOURCE_VERSION"

if [ ! -f "$OUTPUT" ]; then
  echo "Snapshot was not created: $OUTPUT" >&2
  exit 1
fi

echo
echo "Snapshot created successfully:"
ls -lh "$OUTPUT"

echo
echo "Next step:"
echo "npm run import:fartleks -- --snapshot $OUTPUT"

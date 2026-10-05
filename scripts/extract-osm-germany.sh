#!/usr/bin/env bash
# Builds the committed OSM extract snapshot from a Geofabrik Germany PBF.
#
# Prerequisites: osmium-tool (brew install osmium-tool) and a downloaded extract:
#   curl -O https://download.geofabrik.de/europe/germany-latest.osm.pbf
#
# Usage: scripts/extract-osm-germany.sh [path/to/germany-latest.osm.pbf]
set -euo pipefail

PBF="${1:-germany-latest.osm.pbf}"
OUTPUT="${OUTPUT:-fixtures/osm-germany.json}"
WORK_DIR="${WORK_DIR:-tmp/osm-extract}"

if ! command -v osmium >/dev/null 2>&1; then
  echo "osmium-tool is required: brew install osmium-tool" >&2
  exit 1
fi
if [ ! -f "$PBF" ]; then
  echo "PBF extract not found: $PBF" >&2
  echo "Download it with: curl -O https://download.geofabrik.de/europe/germany-latest.osm.pbf" >&2
  exit 1
fi

mkdir -p "$WORK_DIR"
FILTERED="$WORK_DIR/filtered.osm.pbf"
EXPORTED="$WORK_DIR/filtered.geojsonseq"

# Keep only the imported object classes. Referenced nodes and
# member ways are retained so way/relation geometries can be built.
echo "Filtering $PBF ..."
osmium tags-filter --overwrite --output "$FILTERED" "$PBF" \
  nwr/tourism=viewpoint \
  nwr/natural=peak \
  nwr/historic=castle \
  nwr/waterway=waterfall \
  nwr/place=square \
  nwr/place=quarter \
  nwr/tourism=attraction

echo "Exporting geometries ..."
osmium export --overwrite --output "$EXPORTED" --output-format geojsonseq \
  --add-unique-id=type_id --index-type=sparse_file_array "$FILTERED"

EXTRACT_DATE="$(osmium fileinfo -e -g header.option.timestamp "$PBF" 2>/dev/null | cut -c1-10 || true)"
if [ -z "$EXTRACT_DATE" ]; then
  EXTRACT_DATE="$(date -u +%Y-%m-%d)"
fi
SOURCE_VERSION="geofabrik-germany-$EXTRACT_DATE"

echo "Building snapshot $OUTPUT ..."
npx tsx src/osm/buildOSMSnapshot.ts \
  --input "$EXPORTED" \
  --output "$OUTPUT" \
  --source-url "https://download.geofabrik.de/europe/germany-latest.osm.pbf" \
  --source-version "$SOURCE_VERSION"

rm -f "$FILTERED" "$EXPORTED"
ls -lh "$OUTPUT"
echo "Commit $OUTPUT, then redeploy so the image carries the snapshot."

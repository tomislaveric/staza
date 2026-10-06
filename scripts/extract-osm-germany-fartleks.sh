#!/usr/bin/env bash
# Builds the committed Fartlek OSM way-geometry snapshot from a Geofabrik Germany PBF.
#
# Mirrors scripts/extract-osm-germany.sh, but keeps full way LineStrings (instead of collapsing
# to a centroid) for candidate generation (src/osm/fartlekCandidates.ts), plus single-point
# city-limit boundary nodes and traffic-control nodes used to split/evaluate candidates.
#
# Prerequisites: osmium-tool (brew install osmium-tool) and a downloaded extract:
#   curl -O https://download.geofabrik.de/europe/germany-latest.osm.pbf
#
# Usage: scripts/extract-osm-germany-fartleks.sh [path/to/germany-latest.osm.pbf]
set -euo pipefail

PBF="${1:-germany-latest.osm.pbf}"
OUTPUT="${OUTPUT:-fixtures/osm-germany-fartleks.json}"
WORK_DIR="${WORK_DIR:-tmp/osm-extract-fartleks}"

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

# Keep highway ways plausible for a Fartlek, plus boundary/traffic-control nodes used to
# split candidates and score them. Must stay in sync with src/osm/fartlekSelectors.ts.
echo "Filtering $PBF ..."
osmium tags-filter --overwrite --output "$FILTERED" "$PBF" \
  w/highway=primary,primary_link,secondary,secondary_link,tertiary,tertiary_link,unclassified,residential,cycleway \
  n/traffic_sign=city_limit \
  n/highway=traffic_signals,stop,give_way \
  n/traffic_calming

echo "Exporting geometries ..."
osmium export --overwrite --output "$EXPORTED" --output-format geojsonseq \
  --add-unique-id=type_id --index-type=sparse_file_array "$FILTERED"

EXTRACT_DATE="$(osmium fileinfo -e -g header.option.timestamp "$PBF" 2>/dev/null | cut -c1-10 || true)"
if [ -z "$EXTRACT_DATE" ]; then
  EXTRACT_DATE="$(date -u +%Y-%m-%d)"
fi
SOURCE_VERSION="geofabrik-germany-$EXTRACT_DATE"

echo "Building snapshot $OUTPUT ..."
npx tsx src/osm/buildFartlekSnapshot.ts \
  --input "$EXPORTED" \
  --output "$OUTPUT" \
  --source-url "https://download.geofabrik.de/europe/germany-latest.osm.pbf" \
  --source-version "$SOURCE_VERSION"

rm -f "$FILTERED" "$EXPORTED"
ls -lh "$OUTPUT"
echo "Commit $OUTPUT, then run: npm run import:fartleks -- --snapshot $OUTPUT"

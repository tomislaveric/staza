#!/usr/bin/env bash
set -Eeuo pipefail

required_variables=(
  IMPORT_TARGET
  REMOTE_PATH
  SSH_HOST
  SSH_USER
  SSH_PRIVATE_KEY
)

for variable in "${required_variables[@]}"; do
  if [[ -z "${!variable:-}" ]]; then
    echo "Required import setting is missing: $variable" >&2
    exit 1
  fi
done

if [[ "$IMPORT_TARGET" == "dev" ]]; then
  app_container=staza-dev-app
elif [[ "$IMPORT_TARGET" == "prod" ]]; then
  app_container=staza-prod-app
else
  echo "Unknown import target." >&2
  exit 1
fi

[[ "$REMOTE_PATH" =~ ^/[A-Za-z0-9._/-]+$ && "$REMOTE_PATH" != "/" && "$REMOTE_PATH" != */ ]] || {
  echo "REMOTE_PATH must be a safe absolute directory path." >&2
  exit 1
}
case "$REMOTE_PATH" in
  *"/../"*|*/..|*"/./"*|*/.|*"//"*)
    echo "REMOTE_PATH must not contain traversal or repeated path components." >&2
    exit 1
    ;;
esac
[[ "$SSH_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || {
  echo "SSH_HOST contains unsupported characters." >&2
  exit 1
}
[[ "$SSH_USER" =~ ^[A-Za-z_][A-Za-z0-9_.-]*$ ]] || {
  echo "SSH_USER contains unsupported characters." >&2
  exit 1
}

SSH_PORT="${SSH_PORT:-22}"
[[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] && (( SSH_PORT > 0 && SSH_PORT <= 65535 )) || {
  echo "SSH_PORT must be between 1 and 65535." >&2
  exit 1
}

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must never be provided to the import runner; Compose supplies it on the server." >&2
  exit 1
fi

umask 077
ssh_dir="$(mktemp -d)"
trap 'rm -rf "$ssh_dir"' EXIT
ssh_key="$ssh_dir/id_import"
known_hosts="$ssh_dir/known_hosts"
printf '%s\n' "$SSH_PRIVATE_KEY" > "$ssh_key"
chmod 600 "$ssh_key"

if ! ssh-keyscan -T 10 -p "$SSH_PORT" -H "$SSH_HOST" > "$known_hosts" 2>/dev/null; then
  echo "Could not retrieve the SSH host key." >&2
  exit 1
fi
[[ -s "$known_hosts" ]] || {
  echo "SSH host key scan returned no keys." >&2
  exit 1
}
chmod 600 "$known_hosts"

ssh_options=(
  -i "$ssh_key"
  -p "$SSH_PORT"
  -o BatchMode=yes
  -o ConnectTimeout=15
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$known_hosts"
)
remote="$SSH_USER@$SSH_HOST"

echo "Target environment: ${IMPORT_TARGET^^}"
echo "Remote path: $REMOTE_PATH"

ssh "${ssh_options[@]}" "$remote" bash -s -- \
  "$REMOTE_PATH" "$app_container" <<'REMOTE_IMPORT'
set -Eeuo pipefail

remote_path="$1"
app_container="$2"
env_file="$remote_path/.env"
compose_file="$remote_path/docker-compose.yml"

if [[ ! -d "$remote_path" || ! -f "$env_file" || ! -f "$compose_file" ]]; then
  echo "Remote import inputs are missing; deploy the environment first." >&2
  exit 1
fi

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

deployed_tag="$(sed -n 's/^STAZA_IMAGE_TAG=//p' "$env_file")"
[[ -n "$deployed_tag" ]] || {
  echo "Server .env has no STAZA_IMAGE_TAG; deploy the app image first." >&2
  exit 1
}
echo "Deployed image tag used for the import: $deployed_tag"

if ! docker inspect "$app_container" >/dev/null 2>&1; then
  echo "The app service is not deployed on this server." >&2
  exit 1
fi

snapshot_file=/import-source/osm-germany.json
echo "Uploaded OSM extract snapshot:"
if ! compose run --rm --no-TTY --no-deps --entrypoint sh app -c \
  'test -s /import-source/osm-germany.json && ls -lh /import-source/osm-germany.json'; then
  echo "Snapshot not found or empty: /opt/staza/data/osm-germany.json" >&2
  exit 1
fi

echo "Running the compiled importer as a one-off container on the private Compose network."
compose run --rm --no-TTY \
  -e OSM_WIKIDATA_CACHE_DIR=/data/osm-cache/wikidata \
  app node dist/persistence/importOSMWikidata.js \
  --snapshot "$snapshot_file"

echo "Persistent Wikidata cache on the app-data volume:"
compose run --rm --no-TTY --entrypoint sh app -c \
  'du -sh /data/osm-cache/wikidata 2>/dev/null || true'
REMOTE_IMPORT

echo "Import run finished for target=$IMPORT_TARGET."
echo "No deployment or service restart was performed."

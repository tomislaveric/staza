#!/usr/bin/env bash
set -Eeuo pipefail

required_variables=(
  DEPLOY_TARGET
  IMAGE_TAG
  COMPOSE_SOURCE
  REMOTE_PATH
  PUBLIC_URL
  SSH_HOST
  SSH_USER
  SSH_PRIVATE_KEY
)

for variable in "${required_variables[@]}"; do
  if [[ -z "${!variable:-}" ]]; then
    echo "Required deployment setting is missing: $variable" >&2
    exit 1
  fi
done

if [[ "$DEPLOY_TARGET" == "dev" ]]; then
  [[ "$IMAGE_TAG" =~ ^sha-[0-9a-f]{40}$ ]] || {
    echo "DEV must deploy an immutable sha-<commit> image tag." >&2
    exit 1
  }
  [[ "$COMPOSE_SOURCE" == "ops/app/docker-compose.dev.yml" ]] || {
    echo "DEV must use the versioned DEV Compose file." >&2
    exit 1
  }
  app_container=staza-dev-app
elif [[ "$DEPLOY_TARGET" == "prod" ]]; then
  [[ "$IMAGE_TAG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo "PROD must deploy a bare semantic version image tag." >&2
    exit 1
  }
  [[ "$COMPOSE_SOURCE" == "ops/app/docker-compose.prod.yml" ]] || {
    echo "PROD must use the versioned PROD Compose file." >&2
    exit 1
  }
  app_container=staza-prod-app
else
  echo "Unknown deployment target." >&2
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
[[ "$PUBLIC_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$ ]] || {
  echo "PUBLIC_URL must be an HTTPS URL." >&2
  exit 1
}

SSH_PORT="${SSH_PORT:-22}"
[[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] && (( SSH_PORT > 0 && SSH_PORT <= 65535 )) || {
  echo "SSH_PORT must be between 1 and 65535." >&2
  exit 1
}

image_ref="ghcr.io/tomislaveric/staza:$IMAGE_TAG"
docker image inspect "$image_ref" >/dev/null || {
  echo "The exact deployment image is not available on the runner: $image_ref" >&2
  exit 1
}

umask 077
ssh_dir="$(mktemp -d)"
trap 'rm -rf "$ssh_dir"' EXIT
ssh_key="$ssh_dir/id_deploy"
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
scp_options=(
  -i "$ssh_key"
  -P "$SSH_PORT"
  -o BatchMode=yes
  -o ConnectTimeout=15
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$known_hosts"
)
remote="$SSH_USER@$SSH_HOST"
compose_staging=""
run_id="${GITHUB_RUN_ID:-local}"
run_attempt="${GITHUB_RUN_ATTEMPT:-1}"
[[ "$run_id" =~ ^[A-Za-z0-9-]+$ && "$run_attempt" =~ ^[0-9]+$ ]] || {
  echo "Invalid workflow run identifier." >&2
  exit 1
}
compose_staging="$REMOTE_PATH/.docker-compose.yml.candidate-${run_id}-${run_attempt}"

echo "Target environment: ${DEPLOY_TARGET^^}"
echo "Image tag: $IMAGE_TAG"
echo "Remote path: $REMOTE_PATH"

previous_tag="$(
  ssh "${ssh_options[@]}" "$remote" bash -s -- "$REMOTE_PATH" <<'REMOTE_PREFLIGHT'
set -euo pipefail
remote_path="$1"
env_file="$remote_path/.env"

if [[ ! -d "$remote_path" ]]; then
  echo "Configured remote directory does not exist." >&2
  exit 1
fi
if [[ ! -f "$env_file" ]]; then
  echo "Server-side .env file does not exist." >&2
  exit 1
fi

required=(STAZA_IMAGE STAZA_IMAGE_TAG POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL WEBAUTHN_RP_ID WEBAUTHN_RP_NAME WEBAUTHN_ORIGIN)
for name in "${required[@]}"; do
  count="$(grep -c "^${name}=" "$env_file" || true)"
  if [[ "$count" != "1" ]]; then
    echo "Server .env must contain exactly one $name assignment." >&2
    exit 1
  fi
  value="$(sed -n "s/^${name}=//p" "$env_file")"
  if [[ -z "${value//[[:space:]]/}" ]]; then
    echo "Server .env contains an empty $name value." >&2
    exit 1
  fi
done

if ! grep -Fxq 'STAZA_IMAGE=ghcr.io/tomislaveric/staza' "$env_file"; then
  echo "Server .env must use STAZA_IMAGE=ghcr.io/tomislaveric/staza." >&2
  exit 1
fi
old_tag="$(sed -n 's/^STAZA_IMAGE_TAG=//p' "$env_file")"
if [[ ! "$old_tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "Existing STAZA_IMAGE_TAG is not a valid simple image tag." >&2
  exit 1
fi
printf '%s' "$old_tag"
REMOTE_PREFLIGHT
)"

echo "Previous image tag: $previous_tag"
echo "Compose validation: staging versioned Compose file on the server."
scp "${scp_options[@]}" "$COMPOSE_SOURCE" "$remote:$compose_staging"

if ! ssh "${ssh_options[@]}" "$remote" bash -s -- \
  "$REMOTE_PATH" "$DEPLOY_TARGET" "$IMAGE_TAG" "$PUBLIC_URL" \
  "$compose_staging" "$previous_tag" "$app_container" <<'REMOTE_DEPLOY'
set -Eeuo pipefail

remote_path="$1"
target="$2"
image_tag="$3"
public_url="$4"
staged_compose="$5"
previous_tag="$6"
app_container="$7"
env_file="$remote_path/.env"
compose_file="$remote_path/docker-compose.yml"
env_temp=""
compose_temp=""

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

cleanup() {
  rm -f -- "$staged_compose"
  if [[ -n "$env_temp" ]]; then
    rm -f -- "$env_temp"
  fi
  if [[ -n "$compose_temp" ]]; then
    rm -f -- "$compose_temp"
  fi
}

on_error() {
  status=$?
  trap - ERR
  echo "Remote deployment failed for $target; previous image tag: $previous_tag; attempted image tag: $image_tag." >&2
  if [[ -f "$compose_file" && -f "$env_file" ]]; then
    compose ps >&2 || true
    compose logs --no-color --tail=100 app postgres >&2 || true
  fi
  cleanup
  exit "$status"
}
trap cleanup EXIT
trap on_error ERR

if [[ ! -d "$remote_path" || ! -f "$env_file" || ! -f "$staged_compose" ]]; then
  echo "Remote deployment inputs are missing." >&2
  exit 1
fi
chmod 644 "$staged_compose"
STAZA_IMAGE_TAG="$image_tag" docker compose \
  --env-file "$env_file" -f "$staged_compose" config --quiet
echo "Compose validation: passed."

compose_temp="$remote_path/.docker-compose.yml.install.$$"
install -m 644 "$staged_compose" "$compose_temp"
mv -f -- "$compose_temp" "$compose_file"
compose_temp=""
rm -f -- "$staged_compose"

env_mode="$(stat -c '%a' "$env_file")"
env_temp="$(mktemp "$remote_path/.env.tag.XXXXXX")"
if ! awk -v image_tag="$image_tag" '
  /^STAZA_IMAGE_TAG=/ {
    count++
    if (count > 1) exit 1
    print "STAZA_IMAGE_TAG=" image_tag
    next
  }
  { print }
  END {
    if (count != 1) exit 1
  }
' "$env_file" > "$env_temp"; then
  echo "Could not update exactly one STAZA_IMAGE_TAG assignment." >&2
  exit 1
fi
chmod "$env_mode" "$env_temp"
mv -f -- "$env_temp" "$env_file"
env_temp=""
echo "Updated only STAZA_IMAGE_TAG in the server .env."

echo "Pulling deployment services."
compose pull
echo "Migration: running compiled one-off migration."
compose run --rm app node dist/persistence/migrate.js
echo "Migration: completed."

echo "Recreating app service with the current image and environment."
compose up -d --force-recreate app

echo "Waiting for app container health."
health_status=unknown
for ((attempt = 1; attempt <= 30; attempt++)); do
  health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$app_container" 2>/dev/null || printf 'missing')"
  echo "Container health attempt $attempt/30: $health_status"
  if [[ "$health_status" == "healthy" ]]; then
    break
  fi
  if [[ "$health_status" == "unhealthy" || "$health_status" == "missing" ]]; then
    break
  fi
  sleep 10
done
if [[ "$health_status" != "healthy" ]]; then
  echo "App container did not become healthy." >&2
  false
fi

compose ps
echo "Container health: healthy."
echo "Public URL configured: $public_url"
echo "Image tag deployed: $image_tag"
echo "Previous image tag for manual rollback: $previous_tag"
REMOTE_DEPLOY
then
  echo "Deployment failed. Previous image tag for manual rollback: $previous_tag" >&2
  exit 1
fi

echo "Checking public endpoint: $PUBLIC_URL"
if ! curl --fail --silent --show-error --output /dev/null \
  --retry 10 --retry-delay 5 --retry-all-errors --max-time 10 \
  "${PUBLIC_URL%/}/"; then
  echo "Public HTTP health check failed. Previous image tag: $previous_tag; attempted image tag: $IMAGE_TAG." >&2
  ssh "${ssh_options[@]}" "$remote" bash -s -- "$REMOTE_PATH" <<'REMOTE_LOGS' || true
set -euo pipefail
remote_path="$1"
docker compose --env-file "$remote_path/.env" -f "$remote_path/docker-compose.yml" ps >&2 || true
docker compose --env-file "$remote_path/.env" -f "$remote_path/docker-compose.yml" logs --no-color --tail=100 app postgres >&2 || true
REMOTE_LOGS
  exit 1
fi

echo "Public HTTP health check: passed."
echo "Deployment succeeded: target=$DEPLOY_TARGET image=$IMAGE_TAG previous=$previous_tag."

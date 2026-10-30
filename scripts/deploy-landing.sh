#!/usr/bin/env bash
# Safely sync the staged landing artifact to the configured remote webroot.
#
# Required environment:
#   STAGING_DIR              absolute path to the exported artifact directory
#   LANDING_SSH_HOST         shared-host SSH hostname
#   LANDING_SSH_USER         SSH account username
#   LANDING_SSH_PASSWORD     SSH account password
#   LANDING_REMOTE_PATH      existing dedicated absolute landing webroot
#   LANDING_SSH_PORT         SSH port
#
# The script never prints secret values. It validates configuration, pins the
# host key via ssh-keyscan, verifies the remote directory, then runs
# `rsync -az --delete` scoped to the validated webroot only. `sshpass` must be
# installed and SSH password authentication must be enabled by the host.

set -euo pipefail

fail() {
  echo "::error::$1" >&2
  exit 1
}

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail "Missing required configuration: ${name}"
  fi
}

require STAGING_DIR
require LANDING_SSH_HOST
require LANDING_SSH_USER
require LANDING_SSH_PASSWORD
require LANDING_REMOTE_PATH
require LANDING_SSH_PORT
if ! command -v sshpass >/dev/null 2>&1; then
  fail "sshpass is required for password-based SSH authentication"
fi

if [[ ! -d "${STAGING_DIR}" ]]; then
  fail "Staging directory does not exist: ${STAGING_DIR}"
fi

if [[ ! "${LANDING_SSH_PORT}" =~ ^[0-9]+$ ]] || (( LANDING_SSH_PORT < 1 || LANDING_SSH_PORT > 65535 )); then
  fail "LANDING_SSH_PORT must be a valid port number"
fi

remote_path="${LANDING_REMOTE_PATH}"
# Reject non-absolute paths, the filesystem root, traversal components, and the
# bare home directory so --delete can never target a broad or unintended path.
if [[ "${remote_path}" != /* ]]; then
  fail "LANDING_REMOTE_PATH must be an absolute path"
fi
if [[ "${remote_path}" == *".."* ]]; then
  fail "LANDING_REMOTE_PATH must not contain traversal components"
fi
normalized="${remote_path%/}"
if [[ -z "${normalized}" ]]; then
  fail "LANDING_REMOTE_PATH must not be the filesystem root"
fi
workdir="$(mktemp -d)"
cleanup() {
  rm -rf "${workdir}"
}
trap cleanup EXIT

known_hosts="${workdir}/known_hosts"

# Pin the host key; never disable strict host-key checking globally.
if ! ssh-keyscan -p "${LANDING_SSH_PORT}" -H "${LANDING_SSH_HOST}" > "${known_hosts}" 2>/dev/null; then
  fail "ssh-keyscan failed for ${LANDING_SSH_HOST}:${LANDING_SSH_PORT}"
fi
if [[ ! -s "${known_hosts}" ]]; then
  fail "ssh-keyscan returned no host key for ${LANDING_SSH_HOST}:${LANDING_SSH_PORT}"
fi

ssh_opts=(
  -o "UserKnownHostsFile=${known_hosts}"
  -o "StrictHostKeyChecking=yes"
  -o "PubkeyAuthentication=no"
  -o "PreferredAuthentications=password,keyboard-interactive"
  -o "BatchMode=no"
  -p "${LANDING_SSH_PORT}"
)

remote="${LANDING_SSH_USER}@${LANDING_SSH_HOST}"
export SSHPASS="${LANDING_SSH_PASSWORD}"
unset LANDING_SSH_PASSWORD

ssh_command=(sshpass -e ssh "${ssh_opts[@]}")

# Verify authentication and reject the account's home directory before
# checking the target. The directory is never created automatically.
if ! remote_home="$("${ssh_command[@]}" "${remote}" 'printf %s "$HOME"')"; then
  fail "SSH password authentication or connectivity failed for ${remote}"
fi
if [[ -z "${remote_home}" ]]; then
  fail "Could not determine the remote home directory"
fi
if [[ "${normalized}" == "${remote_home%/}" ]]; then
  fail "LANDING_REMOTE_PATH must be a dedicated directory, not the home directory"
fi

if ! "${ssh_command[@]}" "${remote}" "test -d $(printf '%q' "${normalized}")"; then
  fail "Remote landing webroot does not exist or cannot be accessed: ${normalized}"
fi

echo "Syncing landing artifact to ${remote}:${normalized}/"
rsync -az --delete \
  -e "sshpass -e ssh ${ssh_opts[*]}" \
  "${STAGING_DIR}/" \
  "${remote}:${normalized}/"

quoted_path="$(printf '%q' "${normalized}")"
permission_command="find ${quoted_path} -type d -exec chmod 755 {} + && find ${quoted_path} -type f -exec chmod 644 {} +"
if ! "${ssh_command[@]}" "${remote}" "${permission_command}"; then
  fail "Could not normalize permissions in the remote landing webroot"
fi

echo "Landing deployment complete."

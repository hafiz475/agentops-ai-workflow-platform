#!/usr/bin/env bash
set -Eeuo pipefail

readonly deploy_sha="${1:?usage: deploy-azure-vm.sh <commit-sha>}"
readonly app_dir="/opt/agentops-ai-workflow-platform"
readonly compose=(sudo -n docker compose --project-directory "${app_dir}")

if [[ ! "${deploy_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Refusing to deploy invalid commit SHA: ${deploy_sha}" >&2
  exit 1
fi

cd "${app_dir}"

if [[ -n "$(sudo -n git status --porcelain)" ]]; then
  echo "Refusing to deploy because ${app_dir} has uncommitted changes." >&2
  exit 1
fi

echo "Fetching origin/main..."
sudo -n git fetch --prune origin main

if ! sudo -n git merge-base --is-ancestor "${deploy_sha}" origin/main; then
  echo "Refusing to deploy ${deploy_sha}: it is not on origin/main." >&2
  exit 1
fi

echo "Fast-forwarding production checkout to ${deploy_sha}..."
sudo -n git checkout main
sudo -n git merge --ff-only "${deploy_sha}"

readonly actual_sha="$(sudo -n git rev-parse HEAD)"
if [[ "${actual_sha}" != "${deploy_sha}" ]]; then
  echo "Production checkout is ${actual_sha}, expected ${deploy_sha}." >&2
  exit 1
fi

echo "Building images for ${actual_sha}..."
"${compose[@]}" build --pull

echo "Starting services from rebuilt images..."
"${compose[@]}" up -d --force-recreate --remove-orphans

wait_for_url() {
  local name="$1"
  local url="$2"
  local attempts=30

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl --fail --silent --show-error --max-time 5 "${url}" >/dev/null; then
      echo "${name}: healthy"
      return 0
    fi

    echo "${name}: waiting (${attempt}/${attempts})"
    sleep 5
  done

  echo "${name}: health check failed" >&2
  return 1
}

if ! wait_for_url "API readiness" "http://127.0.0.1:3001/ready" ||
  ! wait_for_url "Persisted API routes" "http://127.0.0.1:3001/api/v1/projects" ||
  ! wait_for_url "Frontend" "http://127.0.0.1:3000/"; then
  "${compose[@]}" ps >&2
  "${compose[@]}" logs --tail=100 api web >&2
  exit 1
fi

"${compose[@]}" ps
echo "Successfully deployed ${deploy_sha}."
echo "DEPLOYMENT_SUCCEEDED_SHA=${deploy_sha}"

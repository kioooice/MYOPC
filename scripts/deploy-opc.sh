#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="${MYOPC_REPO_DIR:-/opt/apps/src/opc}"
DATA_DIR="${MYOPC_DATA_DIR:-/opt/data/opc}"
BACKUP_DIR="${MYOPC_BACKUP_DIR:-/opt/backups/opc}"
SERVICE="${MYOPC_SERVICE:-myopc.service}"
ENV_FILE="${MYOPC_ENV_FILE:-/etc/myopc/myopc.env}"
LOCK_FILE="${MYOPC_DEPLOY_LOCK:-/var/lock/myopc-deploy.lock}"
SUDO="${SUDO:-sudo}"

log() { printf '[deploy-opc] %s\n' "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
run() { log "$*"; "$@"; }

[[ "$(id -u)" -ne 0 ]] || SUDO=""
for command_name in git npm node flock curl; do command -v "$command_name" >/dev/null || die "$command_name is required"; done
mkdir -p "$(dirname "$LOCK_FILE")" "$BACKUP_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || die "another deployment is already running"

[[ -d "$REPO_DIR/.git" ]] || die "not a git repository: $REPO_DIR"
cd "$REPO_DIR"
[[ -z "$(git status --porcelain)" ]] || die "working tree has manual changes; refusing to overwrite"
[[ "$(git branch --show-current)" == "main" ]] || die "repository must be on main"
git remote get-url origin >/dev/null || die "origin remote is missing"
node --version; npm --version
${SUDO} systemctl cat "$SERVICE" >/dev/null || die "$SERVICE is not installed"

previous_commit="$(git rev-parse HEAD)"
run git fetch origin main
target_commit="$(git rev-parse origin/main)"
log "previous_commit=$previous_commit"
log "target_commit=$target_commit"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$BACKUP_DIR/myopc-${timestamp}-${previous_commit}.sqlite"
run env MYOPC_DATA_DIR="$DATA_DIR" npm run db:backup -- --output "$backup_path"
run env MYOPC_DATA_DIR="$DATA_DIR" npm run db:verify -- --file "$backup_path"

rollback() {
  log "health failed; restoring previous code only"
  git reset --hard "$previous_commit" || true
  npm ci --include=dev || true
  npm run build || true
  printf 'MYOPC_RELEASE=%s\n' "$previous_commit" | ${SUDO} install -D -m 640 -o root -g root /dev/stdin "$ENV_FILE" || true
  ${SUDO} systemctl restart "$SERVICE" || true
}

run git merge --ff-only "$target_commit"
run npm ci --include=dev
run npm test
run npm run lint
run npm run build
printf '%s\n' "$target_commit" > .release-commit
printf 'MYOPC_RELEASE=%s\n' "$target_commit" | ${SUDO} install -D -m 640 -o root -g root /dev/stdin "$ENV_FILE"
run ${SUDO} systemctl daemon-reload
run ${SUDO} systemctl restart "$SERVICE"
run ${SUDO} systemctl is-active --quiet "$SERVICE" || { rollback; die "service did not become active"; }
run ${SUDO} systemctl is-enabled --quiet "$SERVICE" || { rollback; die "service is not enabled"; }

tailscale_ip="$(tailscale ip -4 | head -n 1)"
[[ "$tailscale_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "could not determine Tailscale IPv4"
health_url="http://${tailscale_ip}:3010/api/v1/health"
health=""
for attempt in 1 2 3 4 5; do
  health="$(curl --fail --silent --show-error --max-time 5 "$health_url" || true)"
  [[ "$health" == *'"status":"ok"'* && "$health" == *"$target_commit"* ]] && break
  sleep 2
done
if [[ "$health" != *'"status":"ok"'* || "$health" != *"$target_commit"* ]]; then
  rollback
  die "health check failed: $health"
fi
curl --fail --silent --show-error --max-time 5 "http://${tailscale_ip}:3010/api/v1/library" >/dev/null || { rollback; die "library health check failed"; }

log "previous_commit=$previous_commit"
log "target_commit=$target_commit"
log "backup_path=$backup_path"
log "service=$(systemctl is-active "$SERVICE")"
log "health=$health"
log "release=$target_commit"
free -h
df -h "$DATA_DIR"
log "DEPLOY SUCCESS"

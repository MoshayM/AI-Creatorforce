#!/usr/bin/env bash
# infra/dr/backup.sh — PostgreSQL backup for CreatorForce
#
# Usage:
#   export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
#   export BACKUP_DIR="/var/backups/creatorforce"        # default: ./backups
#   export BACKUP_RETENTION_DAYS=14                      # default: 14
#   export RCLONE_REMOTE="s3:my-bucket/creatorforce-db"  # optional; see below
#   ./infra/dr/backup.sh
#
# Cron example (daily at 02:00 server time):
#   0 2 * * * /bin/bash /opt/creatorforce/infra/dr/backup.sh >> /var/log/cf-backup.log 2>&1
#
# Output: $BACKUP_DIR/creatorforce_YYYY-MM-DD_HHMMSS.dump (pg_dump custom format)
# The file is NOT echoed to stdout to prevent leaking credentials in logs.
#
# RTO target: 1 hour  |  RPO target: 24 hours (daily backups)
# To improve RPO to minutes, enable PostgreSQL WAL archiving / continuous archiving (PITR).
# See RUNBOOKS.md §database-restore for guidance.

set -euo pipefail

# ── Config with defaults ──────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
# Optional rclone upload. Set RCLONE_REMOTE to enable (e.g. "s3:my-bucket/cf-db").
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

# ── Validate required env ─────────────────────────────────────────────────────
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

# ── Prepare backup directory ──────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"

# ── Build timestamped filename ────────────────────────────────────────────────
TIMESTAMP="$(date -u '+%Y-%m-%d_%H%M%S')"
BACKUP_FILE="${BACKUP_DIR}/creatorforce_${TIMESTAMP}.dump"

echo "[backup] Starting pg_dump at ${TIMESTAMP}"

# ── Run pg_dump (custom format = compressed, parallel-restoreable) ─────────────
# DATABASE_URL is passed via the env var PGPASSWORD extracted from the URL to
# avoid it appearing in the process list. We use --no-password so pg_dump never
# prompts interactively.
#
# Parse host/port/dbname from DATABASE_URL (postgresql://user:pass@host:port/db)
_url_no_scheme="${DATABASE_URL#postgresql://}"
_url_no_scheme="${_url_no_scheme#postgres://}"
_userinfo="${_url_no_scheme%%@*}"
_hostinfo="${_url_no_scheme#*@}"
PGUSER="${_userinfo%%:*}"
export PGPASSWORD="${_userinfo#*:}"
_hostport="${_hostinfo%%/*}"
PGHOST="${_hostport%%:*}"
PGPORT="${_hostport##*:}"
# If host had no port (host == port after split), default to 5432
[[ "${PGHOST}" == "${PGPORT}" ]] && PGPORT="5432"
PGDATABASE="${_hostinfo#*/}"
PGDATABASE="${PGDATABASE%%\?*}"   # strip query string if any

export PGUSER PGHOST PGPORT PGDATABASE

pg_dump \
  --format=custom \
  --compress=9 \
  --no-password \
  --file="${BACKUP_FILE}"

# Clear password from environment immediately after use
unset PGPASSWORD

echo "[backup] Dump written to ${BACKUP_FILE} ($(du -sh "${BACKUP_FILE}" | cut -f1))"

# ── Prune old backups ─────────────────────────────────────────────────────────
echo "[backup] Pruning backups older than ${BACKUP_RETENTION_DAYS} days from ${BACKUP_DIR}"
find "${BACKUP_DIR}" -maxdepth 1 -name "creatorforce_*.dump" \
  -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete

# ── Optional rclone/S3 upload ─────────────────────────────────────────────────
if [[ -n "${RCLONE_REMOTE}" ]]; then
  # TODO: configure rclone with your S3/R2/GCS credentials before enabling.
  # Recommended: use a service-account key stored in the secrets manager,
  # referenced by rclone's config file (never hardcoded here).
  # Example rclone config path: /etc/rclone/rclone.conf  (chmod 600)
  echo "[backup] Uploading to ${RCLONE_REMOTE} via rclone"
  rclone copy "${BACKUP_FILE}" "${RCLONE_REMOTE}" \
    --config "${RCLONE_CONFIG:-/etc/rclone/rclone.conf}" \
    --log-level INFO
  echo "[backup] Upload complete"
else
  echo "[backup] RCLONE_REMOTE not set — skipping remote upload (local backup only)"
fi

echo "[backup] Done."

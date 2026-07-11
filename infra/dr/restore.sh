#!/usr/bin/env bash
# infra/dr/restore.sh — PostgreSQL restore for CreatorForce
#
# Usage:
#   export TARGET_DATABASE_URL="postgresql://user:pass@host:5432/dbname_restore"
#   ./infra/dr/restore.sh --dump-file /var/backups/creatorforce/creatorforce_2026-07-10_020001.dump \
#                         --i-understand
#
# The --i-understand flag is REQUIRED. This script drops and recreates the target
# database. Never run against production without following the full runbook:
#   infra/dr/RUNBOOKS.md#database-restore
#
# RTO target: 1 hour  |  RPO target: 24 hours

set -euo pipefail

# ── Parse arguments ───────────────────────────────────────────────────────────
DUMP_FILE=""
I_UNDERSTAND=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump-file)
      DUMP_FILE="$2"
      shift 2
      ;;
    --i-understand)
      I_UNDERSTAND=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 --dump-file <path> --i-understand" >&2
      exit 1
      ;;
  esac
done

# ── Safety gate ───────────────────────────────────────────────────────────────
if [[ "${I_UNDERSTAND}" -ne 1 ]]; then
  echo "ERROR: You must pass --i-understand to confirm you have read RUNBOOKS.md#database-restore" >&2
  echo "       This script will DROP and recreate the target database." >&2
  exit 1
fi

if [[ -z "${DUMP_FILE}" ]]; then
  echo "ERROR: --dump-file is required." >&2
  exit 1
fi

if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "ERROR: Dump file not found: ${DUMP_FILE}" >&2
  exit 1
fi

if [[ -z "${TARGET_DATABASE_URL:-}" ]]; then
  echo "ERROR: TARGET_DATABASE_URL is not set." >&2
  exit 1
fi

# ── Parse connection details from URL ─────────────────────────────────────────
_url_no_scheme="${TARGET_DATABASE_URL#postgresql://}"
_url_no_scheme="${_url_no_scheme#postgres://}"
_userinfo="${_url_no_scheme%%@*}"
_hostinfo="${_url_no_scheme#*@}"
PGUSER="${_userinfo%%:*}"
export PGPASSWORD="${_userinfo#*:}"
_hostport="${_hostinfo%%/*}"
PGHOST="${_hostport%%:*}"
PGPORT="${_hostport##*:}"
[[ "${PGHOST}" == "${PGPORT}" ]] && PGPORT="5432"
PGDATABASE="${_hostinfo#*/}"
PGDATABASE="${PGDATABASE%%\?*}"

export PGUSER PGHOST PGPORT

echo "============================================================"
echo " CreatorForce Database Restore"
echo " Dump file : ${DUMP_FILE}"
echo " Target DB : ${PGHOST}:${PGPORT}/${PGDATABASE}"
echo " User      : ${PGUSER}"
echo "============================================================"
echo ""
echo "Starting in 5 seconds — press Ctrl-C to abort."
sleep 5

# ── Drop and recreate the target database ────────────────────────────────────
echo "[restore] Dropping existing database '${PGDATABASE}' (if it exists)..."
psql --no-password \
  --host="${PGHOST}" \
  --port="${PGPORT}" \
  --username="${PGUSER}" \
  --dbname="postgres" \
  --command="DROP DATABASE IF EXISTS \"${PGDATABASE}\";"

echo "[restore] Creating fresh database '${PGDATABASE}'..."
psql --no-password \
  --host="${PGHOST}" \
  --port="${PGPORT}" \
  --username="${PGUSER}" \
  --dbname="postgres" \
  --command="CREATE DATABASE \"${PGDATABASE}\";"

# ── Restore from dump ─────────────────────────────────────────────────────────
echo "[restore] Running pg_restore from ${DUMP_FILE}..."
pg_restore \
  --no-password \
  --host="${PGHOST}" \
  --port="${PGPORT}" \
  --username="${PGUSER}" \
  --dbname="${PGDATABASE}" \
  --verbose \
  "${DUMP_FILE}"

unset PGPASSWORD

echo ""
echo "[restore] pg_restore complete."
echo ""
echo "Next steps (see RUNBOOKS.md#database-restore):"
echo "  1. Run: npx prisma migrate status  (verify all migrations applied)"
echo "  2. Run smoke tests or the healthcheck endpoint"
echo "  3. Spot-check the ledger row count against your pre-restore baseline"
echo "  4. Restart the API service and monitor error rates"

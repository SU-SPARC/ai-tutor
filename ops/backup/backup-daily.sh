#!/bin/sh
# Daily encrypted Production export under institutional custody, followed by
# the custody status check. Intended for launchd, cron, or a systemd timer on
# the University IT backup host. Usage: backup-daily.sh /path/to/backup.env
#
# The environment file holds BACKUP_DATABASE_URL, BACKUP_CUSTODY_DIR,
# BACKUP_ENCRYPTION_PUBLIC_KEY, BACKUP_ACTOR, BACKUP_CHANGE_TICKET,
# BACKUP_CUSTODY_REGION, BACKUP_EXPECTED_*, BACKUP_INSTITUTIONAL_OWNER_1/2,
# BACKUP_OPERATOR, optional BACKUP_ALERT_WEBHOOK_URL, PF_XJ_REPO, and
# BACKUP_LOG_DIR. It must be owned by the backup operator with mode 0600 and
# must never be committed, copied into application hosting, or printed.
set -eu

ENV_FILE="${1:?usage: backup-daily.sh /path/to/backup.env}"
mode="$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE")"
if [ "$mode" != "600" ]; then
  echo "backup-daily: environment file must have mode 600 (found $mode)" >&2
  exit 78
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${PF_XJ_REPO:?PF_XJ_REPO must point at the repository checkout}"
: "${BACKUP_LOG_DIR:?BACKUP_LOG_DIR must be a private log directory outside the repository}"
cd "$PF_XJ_REPO"
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

status=0
node scripts/backup-daily.mjs \
  --target production \
  --manifest-dir "${BACKUP_MANIFEST_DIR:-docs/evidence/database-recovery}" \
  --prune --json \
  > "$BACKUP_LOG_DIR/daily-$stamp.json" 2> "$BACKUP_LOG_DIR/daily-$stamp.err" || status=$?

node scripts/backup-status.mjs \
  --evidence-dir "${BACKUP_STATUS_EVIDENCE_DIR:-docs/evidence/backup-custody}" \
  --json \
  > "$BACKUP_LOG_DIR/status-$stamp.json" 2> "$BACKUP_LOG_DIR/status-$stamp.err" || status=$?

if [ "$status" -ne 0 ]; then
  echo "backup-daily: FAILED or FINDINGS (exit $status); see $BACKUP_LOG_DIR/*-$stamp.*" >&2
fi
exit "$status"

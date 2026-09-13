#!/bin/sh
# Nightly database (+ local uploads) backup.
# Required: DATABASE_URL. Optional: BACKUP_DIR (default ./backups),
# BACKUP_RETENTION_DAYS (default 30), STORAGE_DIR (tarred alongside when set).
# Scheduling is operator-owned: cron, systemd timer, or a K8s CronJob that
# runs this script with the production env (see docs/DEPLOYMENT.md).
# Off-site copies (object storage / second region) are operator-owned too —
# do not claim backups exist unless the schedule above is actually running.
set -eu

: "${DATABASE_URL:?DATABASE_URL must be set}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date +%Y%m%dT%H%M%S)"

mkdir -p "$BACKUP_DIR"

DB_FILE="$BACKUP_DIR/backup-$STAMP.dump"
pg_dump "$DATABASE_URL" -Fc -f "$DB_FILE"
test -s "$DB_FILE" || { echo "backup failed: empty dump at $DB_FILE" >&2; exit 1; }

if [ -n "${STORAGE_DIR:-}" ] && [ -d "$STORAGE_DIR" ]; then
  tar -czf "$BACKUP_DIR/storage-$STAMP.tar.gz" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
  echo "storage snapshot ok: $BACKUP_DIR/storage-$STAMP.tar.gz"
fi

find "$BACKUP_DIR" -maxdepth 1 -name 'backup-*.dump' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'storage-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "backup ok: $DB_FILE"

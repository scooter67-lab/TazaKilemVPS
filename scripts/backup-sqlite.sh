#!/usr/bin/env bash
# Пример: BACKUP_DIR=/var/backups DB_PATH=/var/lib/carpet-journal/app.db ./backup-sqlite.sh
set -euo pipefail
DB_PATH="${DB_PATH:-./backend/app.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
cp -a "$DB_PATH" "$BACKUP_DIR/app-${stamp}.db"
echo "OK: $BACKUP_DIR/app-${stamp}.db"

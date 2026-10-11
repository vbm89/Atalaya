#!/bin/sh
# Restore the newest local dump into a throwaway database, then drop it.
# Never touches a remote host and never replaces the live database.
set -eu
url="${DATABASE_URL:-}"
case "$url" in
  postgres://*@127.0.0.1:*|postgres://*@localhost:*|postgresql://*@127.0.0.1:*|postgresql://*@localhost:*)
    ;;
  *)
    echo "restore-test: DATABASE_URL must point at 127.0.0.1 or localhost" >&2
    exit 1
    ;;
esac
outdir="${ATALAYA_BACKUP_DIR:-/var/backups/atalaya}"
dump="$(ls -1t "$outdir"/atalaya-*.dump 2>/dev/null | head -1)"
if [ -z "$dump" ]; then
  echo "restore-test: no dump in $outdir" >&2
  exit 1
fi
admin="${url%/*}/postgres"
psql --dbname="$admin" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS atalaya_restore_test;"
psql --dbname="$admin" -v ON_ERROR_STOP=1 -c "CREATE DATABASE atalaya_restore_test;"
restore="${url%/*}/atalaya_restore_test"
pg_restore --dbname="$restore" --no-owner --exit-on-error "$dump"
psql --dbname="$restore" -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM paper_bot_state;"
psql --dbname="$admin" -v ON_ERROR_STOP=1 -c "DROP DATABASE atalaya_restore_test;"
echo "restore-test: ok"

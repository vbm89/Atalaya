#!/bin/sh
# Dump the local migration database. Refuses any host that is not localhost.
set -eu
url="${DATABASE_URL:-}"
case "$url" in
  postgres://*@127.0.0.1:*|postgres://*@localhost:*|postgresql://*@127.0.0.1:*|postgresql://*@localhost:*)
    ;;
  *)
    echo "backup: DATABASE_URL must point at 127.0.0.1 or localhost" >&2
    exit 1
    ;;
esac
outdir="${ATALAYA_BACKUP_DIR:-/var/backups/atalaya}"
mkdir -p "$outdir"
chmod 700 "$outdir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dest="$outdir/atalaya-$stamp.dump"
pg_dump --dbname="$url" --format=custom --file="$dest"
chmod 600 "$dest"
find "$outdir" -name 'atalaya-*.dump' -mtime +7 -delete
echo "backup: wrote $stamp"

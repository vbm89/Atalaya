#!/bin/sh
# Hold an exclusive lock for one Watch or Paper run.
# A busy lock is a skip (exit 0). The job's own failure still exits non-zero.
set -eu
name="${1:?job name}"
shift
lockdir="/var/lib/atalaya"
mkdir -p "$lockdir"
lock="$lockdir/${name}.lock"
exec 9>"$lock"
if ! flock -n 9; then
  printf '%s %s: skipped, already running\n' "$(date -Is)" "$name" >&2
  exit 0
fi
exec "$@"

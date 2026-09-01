#!/bin/sh
# Cron externo cada 5 minutos. No es vigilancia 24/7 si solo corre en el iPhone.
# Grok App Builder NO ejecuta cron persistente.
#
# 1. En el hosting (Vercel / variables de servidor) configura:
#    WATCH_SECRET          (mínimo 16 caracteres)
#    VAPID_PUBLIC_KEY
#    VAPID_PRIVATE_KEY
#    VAPID_SUBJECT         (mailto:tu@correo)
#    DATABASE_URL          (Neon)
# 2. En cron-job.org (o similar):
#    URL:  https://TU-DOMINIO/api/watch/tick
#    Method: POST
#    Header: Authorization: Bearer <WATCH_SECRET>
#    Header: Content-Type: application/json
#    Schedule: every 5 minutes
#
# Sustituye las dos variables. NUNCA subas el secreto a git.

set -eu
BASE_URL="${ATALAYA_BASE_URL:?set ATALAYA_BASE_URL}"
SECRET="${WATCH_SECRET:?set WATCH_SECRET in the cron environment, not in this file}"

curl -sS -X POST "${BASE_URL}/api/watch/tick" \
  -H "Authorization: Bearer ${SECRET}" \
  -H "Content-Type: application/json" \
  --max-time 60

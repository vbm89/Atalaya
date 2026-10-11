# Atalaya on a single Always Free VM

Paper and shadow only. No broker orders. `liveTrading` stays false in code.

This directory does not create cloud resources. Copy it onto a VM that is already inside the Always Free allowance, then run the steps below on that machine.

## What stays free

Oracle's Always Free page allows, in the home region only: 1,500 Ampere A1 OCPU hours and 9,000 GB hours per month (2 OCPU and 12 GB), two AMD micro VMs, 200 GB of block storage, and 10 TB of outbound data. A volume created outside the home region is billed. Do not upgrade the account to paid. If creation returns `out of host capacity`, stop. Do not try another region and do not attach a payment method.

Use one A1 VM with 1 OCPU and 6 GB. Postgres listens on localhost. The Node process listens on 127.0.0.1:3000.

## Install

1. Create a Linux user `atalaya` and clone this branch to `/opt/atalaya`.
2. Install Node 22, PostgreSQL, and Caddy from the OS repositories.
3. In Postgres, create role `atalaya` and an empty database `atalaya` on localhost. Do not point `DATABASE_URL` at Neon or any existing database.
4. Copy `atalaya.env.example` to `/etc/atalaya/atalaya.env`. Mode `640`, owner `root`, group `atalaya`.
5. As `atalaya`, from `/opt/atalaya`: `npm ci && npm run build`. The build skips migrations when `DATABASE_URL` is unset. Then `npm run db:migrate` with the local URL set. Confirm the log names `127.0.0.1` or `localhost` before trusting it.
6. `sudo cp deploy/oracle/Caddyfile /etc/caddy/Caddyfile` and `sudo systemctl reload caddy`.
7. Install the units:
   `sudo cp deploy/oracle/atalaya-*.service deploy/oracle/atalaya-*.timer /etc/systemd/system/`
   `sudo systemctl daemon-reload`
   `sudo systemctl enable --now atalaya-web.service atalaya-watch.timer atalaya-paper.timer atalaya-backup.timer`

Watch and paper use separate locks. A second start of the same job logs `skipped, already running` and exits 0. A database or cycle failure still exits 1. Timers are `Persistent=false`, so a reboot does not replay every missed slot.

## HTTPS

The shipped Caddyfile is HTTP on port 80. HTTPS starts only after a domain you control points at the VM. Replace `:80` with that domain and reload Caddy. Do not invent a hostname.

## Backup and restore

`backup.sh` writes a custom-format dump under `/var/backups/atalaya` and deletes dumps older than 7 days. It exits 1 unless `DATABASE_URL` is localhost.

`restore-test.sh` loads the newest dump into `atalaya_restore_test`, counts `paper_bot_state`, and drops that database. It does not replace the live database.

## Roll back

`sudo systemctl disable --now atalaya-watch.timer atalaya-paper.timer atalaya-web.service`

The GitHub and cron-job.org schedulers stay as they are until this VM has run for 24 hours. Do not delete them from here.

## Not done in git

Dashboard paper screens are intentionally not wired. Oracle itself is not created by these files.

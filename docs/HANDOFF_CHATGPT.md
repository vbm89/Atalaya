# Handoff Atalaya → ChatGPT

Documento de continuidad. **Fuente de verdad: este repositorio GitHub**, no Grok.

Última verificación: **2026-09-01 ~19:30 Europe/Madrid**.
HEAD verificado: `63be6e23bf52913ddad37735aec1119e133172cc` (`Label XAU spot vs proxy and poll gold-api from the client`).

**No incluye secretos.** Nunca copiar `DATABASE_URL`, `WATCH_SECRET`, claves VAPID, tokens ni passwords a git.

---

## 1. Qué es Atalaya

Atalaya es un terminal de análisis de 4 activos:

- XAUUSD
- BTCUSD
- US100
- WTI

**V1 decide.** El motor (`engine.ts` / `signals.ts` / `structure.ts` / `risk.ts`) produce estados:

`ESPERAR` → `MAPA` → `TRIGGER PENDIENTE` → `ENTRADA`

No ejecuta órdenes. No es un broker.

Capas externas (no son V1):

- **Watch / OPS:** evalúa V1 en cada cierre 15M, persiste episodios, desenlace, push.
- **P5 aprendizaje:** analiza histórico. **No modifica V1.**
- **Memoria de investigación:** cinta, M15, SHA, diario, post-mortem. V1 no las lee.
- **UI live:** cotizaciones visuales (spot XAU vs proxy Bitget, etc.).

Stack: React 19 + TanStack Start/Router/Query + Tailwind v4 + Vite + Nitro (preset Vercel) + Postgres (Neon en deploy, PGLite en preview local).

---

## 2. Repositorio canónico

| Campo | Valor |
|---|---|
| GitHub | [https://github.com/vbm89/Atalaya](https://github.com/vbm89/Atalaya) |
| Owner | `vbm89` |
| Default branch | `main` |
| Visibilidad | público |
| Homepage del repo | `https://atalaya-nu.vercel.app` |
| Commits en `main` (shallow count al handoff) | 12 |
| Otro repo llamado Atalaya bajo vbm89 | **no** (solo este) |

**Grok no es fuente de verdad.** El sandbox de Grok (`/workspace`) **no es un git repo**. Código que viva solo ahí se pierde cuando acaba la sesión.

Relación GitHub → producción:

```
push a main
    → Vercel Git Integration (team atalaya2 / project atalaya)
    → dominio público https://atalaya-nu.vercel.app
```

No hacer force push. No reescribir historia.

---

## 3. Producción (la que importa)

| Qué | URL / dato |
|---|---|
| **Producción pública** | **https://atalaya-nu.vercel.app** |
| Health | https://atalaya-nu.vercel.app/api/watch/health |
| Dashboard Vercel | https://vercel.com/atalaya2/atalaya |
| Team Vercel | `atalaya2` |
| Project name | `atalaya` |
| Project id (declarado por el owner) | `prj_zrHetOcigbxNLtPQwA6JCMJDgL1l` |
| Rama de producción | `main` |
| Root directory | `/` (raíz del repo) |
| `vercel.json` | **no existe** (Nitro genera `.vercel/output` en `npm run build`) |
| Framework | Vite + TanStack Start + Nitro `vercel` / `nodejs22.x` |
| Build | `npm run build` (= `vite build` + `npm run db:migrate`) |
| Install | default npm (`package-lock.json` presente) |

### Health medido en este handoff

```
ok: true
service: atalaya-watch
persistence: ok
watchSecret: CONFIGURED
vapid: CONFIGURED
lastStatus: ok
stale: false
lastTickAt: 2026-09-01T17:15:17.272Z  (= 19:15 Europe/Madrid)
nextEvalMs: 19:30:08 Europe/Madrid
openEpisodes: 0
```

Si `stale: true` o `lastStatus: failed`, el cron o Neon están mal. No tocar V1 para “arreglarlo”.

### URLs que NO son producción

| URL | Qué es |
|---|---|
| `https://atalaya-eklkfzbwr-atalaya2.vercel.app` | Alias de un deployment Vercel con **SSO** (302 a vercel.com). GitHub lo marca como `environment_url` de Production. **No es la URL pública.** |
| `https://vbm89.github.io/Atalaya/` | GitHub Pages (`main` /). **404.** No servir la app. |
| `https://atalaya.pages.dev` | Cloudflare Pages. Es **otro producto** (“Sistema eléctrico español”). Ignorar el check “Cloudflare Pages” en commits de este repo. |

---

## 4. Vercel ↔ GitHub (verificado)

Cada push a `main` crea un GitHub Deployment `environment=Production` + status `Vercel` success.

Ejemplo HEAD `63be6e2`:

- GitHub deployment id `6203033036`
- Status context `Vercel` → `https://vercel.com/atalaya2/atalaya/3TMzhEPQzjtkrvqpyXKqWL95QKWp`

Conclusión: **el proyecto Vercel `atalaya` (team `atalaya2`) está conectado a `vbm89/Atalaya` / `main`.** No hace falta reconectar para que ChatGPT continúe, siempre que tenga acceso al team Vercel.

Este entorno **no tiene token de Vercel CLI**. No se han podido listar env vars ni confirmar el `projectId` vía API. Confirmar en el dashboard:

1. Settings → Git = `vbm89/Atalaya`, production branch `main`
2. Settings → Domains = `atalaya-nu.vercel.app` como production
3. Settings → Environment Variables (nombres en §6)

No modificar Deployment Protection en este handoff.

---

## 5. Neon

Producción usa Postgres real: health `persistence: "ok"` implica que `DATABASE_URL` está definida en Vercel y responde.

**Nombre exacto del proyecto Neon:** no es legible desde este entorno (no hay `DATABASE_URL` local ni CLI Neon). ChatGPT debe abrirlo en:

- Vercel → env `DATABASE_URL` → host `*.neon.tech`
- o dashboard Neon del mismo owner

Local / preview Grok: **PGLite** (sin Neon). Un panel vacío en preview **no** significa que producción esté vacía.

### Migraciones (`migrations/`, aplicadas en `npm run build` → `db:migrate`)

| Archivo | Tablas / cambios |
|---|---|
| `0002_watch.sql` | `watch_evals`, `watch_snapshots`, `signal_episodes`, `signal_events` |
| `0003_watch_push.sql` | `push_subscriptions`, `watch_config` |
| `0004_watch_v10.sql` | notify_* en `signal_events`, `episode_freeze`, `signal_outcomes` |
| `0005_memory.sql` | `watch_eval_versions`, `market_m15`, `episode_tape_bars`, journal/post-mortem (capa memoria) |
| `migrations/auth/0001_auth.sql` | schema Better Auth (auth está **OFF** en este app) |

Filas de vigilancia: **unowned** (sin `user_id`). No importar `authMiddleware` en funciones watch.

V1 **no** vive en la base. La base guarda resultados del tick (estados, freeze, outcomes), no reglas.

---

## 6. Variables de entorno (solo nombres)

### Obligatorias en Vercel (producción)

| Variable | Para qué | Cómo se comprueba sin ver el valor |
|---|---|---|
| `DATABASE_URL` | Neon | health `persistence: "ok"` |
| `WATCH_SECRET` | Auth del tick (`Authorization: Bearer …`, mínimo 16 chars) | health `watchSecret: "CONFIGURED"` |
| `VAPID_PUBLIC_KEY` | Web Push | health `vapid: "CONFIGURED"` |
| `VAPID_PRIVATE_KEY` | Web Push (solo servidor) | igual |
| `VAPID_SUBJECT` | `mailto:…` (hay fallback `mailto:noreply@atalaya.local`) | — |

### Opcionales

| Variable | Para qué |
|---|---|
| `ALERT_PIN` | PIN de avisos (también puede vivir hasheado en `watch_config`) |
| `TWELVEDATA_API_KEY` | feed Twelve Data (si se usa) |
| `XAI_API_KEY` | explicaciones xAI (cuota del owner; no mockear) |
| `VITE_VAPID_PUBLIC_KEY` | alternativa pública VAPID; preferir `VAPID_PUBLIC_KEY` |
| `VITE_AUTH_ENABLED` | debe permanecer `"false"` (este app no usa cuentas) |
| `VERCEL_GIT_COMMIT_SHA` | inyectada por Vercel; memoria de SHA |

**Nunca** crear `.env` en el repo.

---

## 7. Cron / vigilancia

No es Vercel Cron. No hay `vercel.json` crons.

Definición: [`scripts/ops-watch-tick.example.sh`](../scripts/ops-watch-tick.example.sh)

| Campo | Valor |
|---|---|
| Dónde | servicio externo tipo **cron-job.org** (u otro HTTP cron) |
| Endpoint | `POST https://atalaya-nu.vercel.app/api/watch/tick` |
| Auth | header `Authorization: Bearer <WATCH_SECRET>` |
| Frecuencia configurada (doc) | cada **5 minutos** |
| Qué hace el tick de verdad | evalúa V1 solo tras **cierre 15M + 8 s de gracia** (`src/lib/watch/schedule.ts`) |
| Health | `GET /api/watch/health` (público, sin secreto) |
| Stale | `SERVER_STALE_MS` = 20 min |

El tick **idempotente** por `slot` (unix del cierre 15M). Re-llamar no duplica episodios.

También hay un loop en cliente si la PWA está en primer plano; **no sustituye** al cron. El iPhone en segundo plano no vigila.

**No cambiar frecuencia ni lógica en un handoff.**

Código: `src/routes/api/watch/tick.ts` → `src/lib/watch/http.ts` → `src/lib/watch/tick.ts`.

---

## 8. Push

Cadena:

```
tick → signal_events (insert)
    → shouldPushWithPrefs (ENTRY/PENDING por defecto; MAPA/ESPERAR no)
    → listActivePushSubs (push_subscriptions.disabled_at IS NULL)
    → claimNotify
    → Web Push (VAPID)
    → notified=true / notify_status=sent   o   failed + notify_last_error
```

| Pieza | Dónde |
|---|---|
| Política dura | `src/lib/watch/policy.ts` — solo `entry` y `pending` |
| Prefs | `src/lib/watch/push-prefs.ts` — default `enabled/entry/pending=true`, `map/expired=false` |
| Dispatcher | `src/lib/watch/notify.ts` |
| Claim/retry | `src/lib/watch/store.ts` (`MAX_NOTIFY_ATTEMPTS=5`) |
| Subs | tabla `push_subscriptions` |
| Prefs persistidas | `watch_config` key `push_prefs` |

`notified=true` = el proveedor aceptó el envío. **No** prueba de que APNs lo mostró en el iPhone.

Hallazgo previo (auditoría 2026-09-01, no corregido aquí): hubo 3 transiciones PENDING con `notified=false` tras muchos ticks. Causas posibles: **0 suscripciones activas** (nunca `claimNotify`) vs **envío rechazado** (`notify_status=failed`). Distinguir exige SQL a Neon. No se tocó.

---

## 9. P5 — aprendizaje (no es V1)

P5 **lee** historial y **no escribe** en el motor.

| Módulo | Rol |
|---|---|
| `src/lib/learn/case.ts` | Deriva `LearningCase` de `signal_episodes` + freeze + outcomes. **No hay tabla `learning_cases`.** |
| `src/lib/learn/stats.ts` | Conteos, éxito = TP1 o TP2 (una operación), SL = fallo, EXPIRADA aparte |
| `src/lib/learn/patterns.ts` | Detector real. Cortes cerrados (dirección, kind, calidad, R:R, impacto, sesión Madrid) |
| `src/lib/learn/proposals.ts` | Hipótesis de investigación. `applyProposalToEngine` **lanza error** |
| `src/lib/learn/validate.ts` | Split temporal 70/30, `MIN_TEST_N=30`, `MIN_DELTA_PP=5`. `applyValidationToEngine` **lanza error** |

Trainable si no hay exclusión:

`FREEZE_MISSING` | `DATA_INVALID` | `LEVELS_INCOHERENT` | `TIMESTAMP_INVALID` | `OUTCOME_PENDING`

Umbrales de evidencia (`evidenceLevel`, n = TP1+TP2+SL):

| n | Nivel |
|---|---|
| < 20 | insufficient |
| 20–49 | observation |
| 50–79 | potential_pattern |
| ≥ 80 | stronger |

Hallazgo destacado: n ≥ 20 **y** \|Δ\| ≥ 5 pp vs baseline **del mismo activo**.

`VALIDATED` = la hipótesis se reprodujo fuera de muestra bajo esas reglas. **VALIDATED ≠ APPROVED ≠ APPLIED ≠ cambio de V1.**

**No existe “APRENDIZAJE OPERATIVO”.** No hay ruta propuesta → motor.

Historial que consume P5: `getWatchHistory()` limita a **80** episodios (`src/lib/watch/watch.fn.ts`).

UI actual en GitHub: Más → **Escuela** (`LearnPanel`): Memoria, Hallazgos, Propuestas, Validación, Conceptos.

---

## 10. Panel de evolución — NO está en GitHub

Se implementó en el sandbox de Grok (archivos `src/lib/learn/evolution.ts`, cambios en `learn-panel.tsx`, menú “Aprendizaje”, tests). **No se hizo commit ni deploy.**

En `main` **no existen**:

- `src/lib/learn/evolution.ts`
- sección Evolución / barra 20-50-80 / estados SIN MUESTRA…VALIDADOS
- el menú sigue diciendo **Escuela**, no Aprendizaje

**Este handoff no lo implementa.** Si se quiere en producción, ChatGPT debe reimplementarlo o recuperar el sandbox de Grok **antes** de que expire, con autorización explícita, sin tocar V1.

Diseño acordado (cuando se autorice, no ahora):

- Conteos reales: observados, trainable, detectados, validados
- Barra **solo** hacia umbrales 20/50/80 de evidencia (casos **decididos** TP1+TP2+SL)
- La barra **no** es “% de inteligencia aprendida”
- `APRENDIZAJE OPERATIVO` no se muestra
- Nota: el aprendizaje no modifica V1

---

## 11. Estructura de carpetas (relevante)

```
src/lib/trading/     V1 — NO TOCAR (engine, signals, structure, risk, types, indicators)
src/lib/watch/       vigilancia, freeze, outcome, tick, push, store
src/lib/learn/       P5 (case, stats, patterns, proposals, validate, explain)
src/lib/market/      feeds (xau-spot.ts es contrato V1 de spot — NO TOCAR)
src/lib/chart/       live quotes / overlay visual
src/lib/memory/      sidecar investigación
src/components/dashboard/  UI
src/routes/api/watch/      health + tick
migrations/          schema Neon
scripts/             migrate, ops-watch-tick.example.sh, with-app-env, tests de plataforma
```

---

## 12. Comandos

```bash
git clone https://github.com/vbm89/Atalaya.git
cd Atalaya
npm ci

npm run typecheck
npm run test          # ver nota PWA abajo
npm run build         # Vite + Nitro Vercel + db:migrate (sin DATABASE_URL local = skip Neon)
```

Preview local Grok usaba `npm run dev` en `0.0.0.0:8080`. ChatGPT en máquina propia: `npm run dev` y abrir el puerto que imprima Vite.

### Tests

La suite Atalaya (V1, watch, learn, chart, memory) en HEAD:

- typecheck OK
- build OK
- **302 tests Atalaya, 0 fallos** (32 + 270) en este handoff

`npm run test` también corre `scripts/**/*.test.mjs`. Los tests de `scripts/grok-pwa-plugin.test.mjs` **fallan** porque inyectan `og:title=Atalaya` desde `site.json` (esperado en este producto, no es regresión de V1). Correr los tests de `src/lib/**` si hay que aislar.

### Deploy seguro

1. No tocar archivos V1 (§13).
2. `npm run typecheck` && suite Atalaya && `npm run build`.
3. Recalcular checksums V1; deben coincidir con §13.
4. Commit en `main` (o PR). Push. Vercel despliega solo.
5. Comprobar `https://atalaya-nu.vercel.app/api/watch/health`.
6. No commitear `.env`, `.vercel/output`, ni secretos.

---

## 13. V1 — archivos congelados

No modificar, ni “de paso”:

| Archivo | SHA-256 (HEAD `63be6e2` y sandbox Grok, idénticos) |
|---|---|
| `src/lib/trading/engine.ts` | `c3d53a4f4366add2c8a284d4f068ea5d2826a36e3aa259b460d74b37c36ce618` |
| `src/lib/trading/signals.ts` | `dfb2d2cd188b18daaebed5e843bd8dbefb1e1c6672be86d2092390a8b3bc019b` |
| `src/lib/trading/structure.ts` | `e72ba478f524170c7f6c1c6916e033c3fafb418b874aa33565e32dbd01b54170` |
| `src/lib/trading/risk.ts` | `4aa406c0061149486532e9f787d20c3cc9f845362dd5497fd42b42563b5d385e` |
| `src/lib/watch/outcome.ts` | `fdad185119978866d6bec772091e2d6d0d0af49a5207a7bae061d2d840453c90` |
| `src/lib/market/xau-spot.ts` | `393d01945077190a7745ad7cabc3b87bfb170f55fad82a4189a5ee661c678068` |

También fuera de alcance salvo orden explícita: T1–T8, freeze, MAPA/PENDING/ENTRADA, SL/TP, P5 motor de decisión (P5 UI de lectura sí se puede extender), cron, OPS tick.

Comprobar:

```bash
sha256sum src/lib/trading/engine.ts src/lib/trading/signals.ts \
  src/lib/trading/structure.ts src/lib/trading/risk.ts \
  src/lib/watch/outcome.ts src/lib/market/xau-spot.ts
```

---

## 14. Decisiones ya tomadas (no reabrir sin el owner)

- Auth **OFF**. No cuentas. No `user_id` en watch.
- V1 no se toca para “mejorar” señales.
- Desenlace TP/SL se calcula por mechas 15M sobre MAPA/PENDING; **no exige ENTRADA**.
- Push solo ENTRY y PENDING (MAPA no).
- XAU visual: spot gold-api vs velas proxy Bitget XAUUSDT; no mezclar como si fueran el mismo instrumento. V1 sigue su lógica SPOT+PROXY.
- Precio canónico visual de tarjetas: ver commits `63be6e2` / `fe6aeed` (spot en tarjetas XAU; no reintroducir lastPr como spot).
- P5 no aplica patrones a V1 (`applyProposalToEngine` debe seguir lanzando).
- Historial P5 = últimos 80 episodios.
- Preview local ≠ producción (PGLite vs Neon).

---

## 15. Problemas conocidos / bloqueos para ChatGPT

1. **Secretos no viajan con git.** Hace falta acceso a: GitHub `vbm89/Atalaya`, Vercel team `atalaya2`, Neon, cron-job.org (o el HTTP cron real). Grok no puede entregar passwords.
2. **Panel de evolución no está en `main`.** Solo existió en sandbox Grok. Se perderá si no se recupera a propósito.
3. **GitHub Pages 404** en `vbm89.github.io/Atalaya`. No usar. (Se puede desactivar Pages en Settings; no se ha hecho aquí.)
4. **Cloudflare Pages** “atalaya” no es este producto.
5. Alias `*.vercel.app` con SSO. Usar siempre `atalaya-nu.vercel.app`.
6. **Neon: nombre de proyecto no confirmado** sin dashboard.
7. **Push PENDING `notified=false`:** pendiente de SQL (subs vs envío).
8. `npm run test` completo incluye tests PWA de plantilla Grok que fallan por `og:title=Atalaya`.
9. No hay `README.md` en el repo; este archivo es el onboarding.
10. Token GitHub de este agente no lista webhooks ni env de Vercel (403/sin CLI). Verificar a mano en dashboards.

---

## 16. Checklist al arrancar (ChatGPT)

- [ ] `git clone` de `vbm89/Atalaya`, rama `main`
- [ ] Acceso Vercel `atalaya2/atalaya` y dominio `atalaya-nu.vercel.app`
- [ ] Acceso Neon vía `DATABASE_URL` de Vercel (no pegar la URL en el chat/git)
- [ ] Confirmar cron HTTP contra `/api/watch/tick`
- [ ] `curl -sS https://atalaya-nu.vercel.app/api/watch/health` → `ok: true`, `stale: false`
- [ ] Checksums V1 = tabla §13
- [ ] No implementar APRENDIZAJE OPERATIVO
- [ ] No force push

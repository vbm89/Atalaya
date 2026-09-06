# HOME / app shell — independent of research

The Atalaya HOME (dark teal terminal, 2×2 markets, dock) is a **presentation
layer**. Shadow V2, causal capture, and lab integrity are **research layers**.

Visual reference: commit `9508a6f` (“ux: restyle terminal chrome, home tiles and Más”).

## Rule

Future Shadow / replay / capture / `episode_freeze` / `entryGates` / `postEntry`
/ lab-integrity work **must not** modify or replace the HOME unless there is an
**explicit UI task**. Add a Más destination or a `src/lib/*` module instead.

HOME and research stay independent. A capture fix must not resurrect
“TERMINAL / Atalaya”. A HOME polish must not touch V1 or capture writers.

## HOME files (shell)

- `src/components/dashboard/dashboard.tsx` — composer, header, dock
- `src/components/dashboard/marks.tsx` — ATALAYA mark + asset icons
- `src/components/dashboard/home-feed.tsx` — “Mercado en vigilancia”, Oportunidades
- `src/components/dashboard/asset-card.tsx` — 2×2 tiles, CERRADO/ABIERTO, badges
- `src/components/dashboard/more-panel.tsx` — Más screen
- `src/components/dashboard/market-dock.tsx`
- `src/components/dashboard/session-state.tsx`
- `src/styles.css` — `.atalaya-*` chrome

Dock (order): **Inicio · Mercados · Historial · Alertas · Más**.

Más includes **Estado del laboratorio** (`LabIntegrityPanel`) as a destination,
not as a replacement for HOME.

## Research files (must not own HOME)

- `src/lib/learn/shadow-*.ts`
- `src/lib/watch/entry-gates.ts`, `post-entry.ts`, `capture-*.ts`, `lab-integrity*.ts`
- `src/components/dashboard/lab-integrity-panel.tsx`
- `src/components/dashboard/learn-panel.tsx`

## Guard

`src/components/dashboard/home-shell.test.ts` fails if the dock, heading, mark,
or lab Más row disappear, or if HOME chrome imports Shadow/capture writers.

See also [SHADOW_V2_LAB.md](./SHADOW_V2_LAB.md).

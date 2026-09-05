import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SESSION_TZ,
  isMadridWeekendClose,
  marketSessionKind,
  marketSessionLabel,
  tileStatusChips,
  underlyingSessionOpen,
  episodeMarketView,
  pickPresentedOpportunity,
  CLOSED_PENDING_CAPTION,
  CLOSED_PENDING_EXPLAIN,
  countOperableEntries,
  setupBadgeLabel,
} from "./market-session.ts";
/** CEST (UTC+2). Saturday 5 Sep 2026 10:30 Madrid. */
const SAT = Date.UTC(2026, 8, 5, 8, 30, 0);
/** Friday 4 Sep 2026 22:59 Madrid — still open. */
const FRI_BEFORE = Date.UTC(2026, 8, 4, 20, 59, 0);
/** Friday 4 Sep 2026 23:00 Madrid — weekend close starts. */
const FRI_CLOSE = Date.UTC(2026, 8, 4, 21, 0, 0);
/** Monday 7 Sep 2026 00:00 Madrid — still closed. */
const MON_MIDNIGHT = Date.UTC(2026, 8, 6, 22, 0, 0);
/** Monday 7 Sep 2026 00:01 Madrid — open. */
const MON_OPEN = Date.UTC(2026, 8, 6, 22, 1, 0);
/** Tuesday 8 Sep 2026 12:00 Madrid — weekday. */
const TUE = Date.UTC(2026, 8, 8, 10, 0, 0);
/** Tuesday 8 Sep 2026 23:30 Madrid = 21:30 UTC CME daily halt. */
const TUE_HALT = Date.UTC(2026, 8, 8, 21, 30, 0);
/** Friday 9 Jan 2026 23:00 Madrid (CET UTC+1). */
const FRI_WINTER_CLOSE = Date.UTC(2026, 0, 9, 22, 0, 0);

describe("zona horaria de sesión", () => {
  it("uses Europe/Madrid, not UTC or the browser", () => {
    assert.equal(SESSION_TZ, "Europe/Madrid");
  });
});

describe("cierre de fin de semana (Madrid)", () => {
  it("Saturday is closed", () => {
    assert.equal(isMadridWeekendClose(SAT), true);
  });

  it("starts Friday 23:00 Madrid, not a minute before", () => {
    assert.equal(isMadridWeekendClose(FRI_BEFORE), false);
    assert.equal(isMadridWeekendClose(FRI_CLOSE), true);
  });

  it("stays closed through Monday 00:00 and opens at 00:01", () => {
    assert.equal(isMadridWeekendClose(MON_MIDNIGHT), true);
    assert.equal(isMadridWeekendClose(MON_OPEN), false);
  });

  it("winter Friday 23:00 Madrid is also closed", () => {
    assert.equal(isMadridWeekendClose(FRI_WINTER_CLOSE), true);
  });
});

describe("reloj por activo", () => {
  it("Saturday: BTC open, XAU/US100/WTI closed — last price is irrelevant", () => {
    assert.equal(underlyingSessionOpen("BTCUSD", SAT), true);
    assert.equal(underlyingSessionOpen("XAUUSD", SAT), false);
    assert.equal(underlyingSessionOpen("US100", SAT), false);
    assert.equal(underlyingSessionOpen("WTI", SAT), false);
  });

  it("Friday 23:00 Madrid closes XAU, US100 and WTI; BTC stays open", () => {
    assert.equal(underlyingSessionOpen("XAUUSD", FRI_CLOSE), false);
    assert.equal(underlyingSessionOpen("US100", FRI_CLOSE), false);
    assert.equal(underlyingSessionOpen("WTI", FRI_CLOSE), false);
    assert.equal(underlyingSessionOpen("BTCUSD", FRI_CLOSE), true);
  });

  it("weekday: gold is open even during the CME daily halt", () => {
    assert.equal(underlyingSessionOpen("XAUUSD", TUE_HALT), true);
    assert.equal(underlyingSessionOpen("US100", TUE_HALT), false);
    assert.equal(underlyingSessionOpen("WTI", TUE_HALT), false);
    assert.equal(underlyingSessionOpen("BTCUSD", TUE_HALT), true);
  });

  it("weekday midday all four are open", () => {
    assert.equal(underlyingSessionOpen("XAUUSD", TUE), true);
    assert.equal(underlyingSessionOpen("BTCUSD", TUE), true);
    assert.equal(underlyingSessionOpen("US100", TUE), true);
    assert.equal(underlyingSessionOpen("WTI", TUE), true);
  });
});

describe("estado de mercado (UI)", () => {
  it("a last price does not open a closed gold session", () => {
    assert.equal(marketSessionKind({ id: "XAUUSD", dataStatus: "ok", now: SAT }), "closed");
    assert.equal(marketSessionLabel("closed", true), "CERRADO");
  });

  it("stale while open is delayed, not closed", () => {
    assert.equal(marketSessionKind({ id: "BTCUSD", dataStatus: "stale", now: SAT }), "open");
  });

  it("feed error while the clock is open → estado no disponible", () => {
    assert.equal(marketSessionKind({ id: "BTCUSD", dataStatus: "error", now: SAT }), "unknown");
    assert.equal(marketSessionKind({ id: "XAUUSD", dataStatus: "insufficient", now: TUE }), "unknown");
    assert.equal(marketSessionLabel("unknown"), "ESTADO NO DISPONIBLE");
  });

  it("feed error while closed still reads CERRADO", () => {
    assert.equal(marketSessionKind({ id: "XAUUSD", dataStatus: "error", now: SAT }), "closed");
  });
});

describe("jerarquía visual de la tarjeta", () => {
  it("1. abierto sin señal → vigilando ahora", () => {
    const r = tileStatusChips({ id: "BTCUSD", dataStatus: "ok", setupState: "wait", now: SAT });
    assert.equal(r.hunting, true);
    assert.equal(r.dim, false);
    assert.equal(r.session.label, "ABIERTO");
    assert.deepEqual(
      r.setups.map((s) => s.label),
      ["Vigilando"],
    );
  });

  it("2. abierto con MAPA → MAPA es actual", () => {
    const r = tileStatusChips({
      id: "BTCUSD",
      dataStatus: "ok",
      setupState: "map",
      direction: "buy",
      now: SAT,
    });
    assert.equal(r.hunting, true);
    const mapa = r.setups.find((s) => s.key === "map");
    assert.equal(mapa?.current, true);
    assert.equal(mapa?.label, "MAPA");
  });

  it("3. abierto con PENDING → PENDING es actual", () => {
    const r = tileStatusChips({
      id: "XAUUSD",
      dataStatus: "stale",
      setupState: "pending",
      direction: "sell",
      now: TUE,
    });
    assert.equal(r.hunting, true);
    assert.equal(r.setups.find((s) => s.key === "pending")?.current, true);
  });

  it("4. abierto con ENTRY → ENTRY destaca y sigue actual", () => {
    const r = tileStatusChips({
      id: "BTCUSD",
      dataStatus: "ok",
      setupState: "entry",
      direction: "buy",
      now: SAT,
    });
    assert.equal(r.setups[0]?.key, "entry");
    assert.equal(r.setups[0]?.current, true);
    assert.equal(r.dim, false);
  });

  it("5. cerrado con eventos históricos → CERRADO manda; MAPA no es caza actual", () => {
    const r = tileStatusChips({
      id: "XAUUSD",
      dataStatus: "ok",
      setupState: "map",
      direction: "buy",
      now: SAT,
    });
    assert.equal(r.session.kind, "closed");
    assert.equal(r.hunting, false);
    assert.equal(r.dim, true);
    const mapa = r.setups.find((s) => s.key === "map");
    assert.equal(mapa?.label, "MAPA");
    assert.equal(mapa?.current, false);
    assert.equal(r.setups.some((s) => s.key === "wait"), false);
  });

  it("6. cerrado sin eventos → solo CERRADO, no Vigilando", () => {
    const r = tileStatusChips({ id: "US100", dataStatus: "ok", setupState: "wait", now: SAT });
    assert.equal(r.setups.length, 0);
    assert.equal(r.hunting, false);
    assert.equal(r.dim, true);
    assert.equal(r.session.label, "CERRADO");
  });

  it("7. estado no disponible no se inventa ni como abierto ni como cerrado", () => {
    const r = tileStatusChips({
      id: "BTCUSD",
      dataStatus: "error",
      setupState: "pending",
      now: SAT,
    });
    assert.equal(r.session.kind, "unknown");
    assert.equal(r.session.label, "NO DISPONIBLE");
    assert.equal(r.hunting, false);
    assert.equal(r.setups.find((s) => s.key === "pending")?.current, false);
  });

  it("ENTRY en mercado cerrado sigue siendo prioridad máxima y no se apaga", () => {
    const r = tileStatusChips({
      id: "WTI",
      dataStatus: "ok",
      setupState: "entry",
      direction: "sell",
      now: SAT,
    });
    assert.equal(r.setups[0]?.key, "entry");
    assert.equal(r.setups[0]?.current, true);
    assert.equal(r.dim, false);
    assert.equal(r.session.kind, "closed");
    assert.equal(r.operable, false);
  });
});

describe("countOperableEntries", () => {
  it("closed-market ENTRY is not an operable opportunity", () => {
    assert.equal(
      countOperableEntries(
        [
          { id: "XAUUSD", setupState: "entry", dataStatus: "ok" },
          { id: "BTCUSD", setupState: "wait", dataStatus: "ok" },
        ],
        SAT,
      ),
      0,
    );
  });

  it("open-market ENTRY counts; PENDING does not", () => {
    assert.equal(
      countOperableEntries(
        [
          { id: "BTCUSD", setupState: "entry", dataStatus: "ok" },
          { id: "XAUUSD", setupState: "pending", dataStatus: "ok" },
        ],
        SAT,
      ),
      1,
    );
  });
});

describe("setupBadgeLabel", () => {
  it("uses the same compact tokens on Inicio, Historial and Alertas", () => {
    assert.equal(setupBadgeLabel("entry"), "ENTRY");
    assert.equal(setupBadgeLabel("pending"), "PENDING");
    assert.equal(setupBadgeLabel("map"), "MAPA");
    assert.equal(setupBadgeLabel("wait"), "ESPERAR");
  });
});

describe("PENDING vs mercado cerrado (presentación)", () => {
  it("XAUUSD PENDING on Saturday is still PENDING and not operable", () => {
    const v = episodeMarketView({
      id: "XAUUSD",
      dataStatus: "ok",
      setupState: "pending",
      now: SAT,
    });
    assert.equal(v.session, "closed");
    assert.equal(v.episodeLabel, "PENDIENTE");
    assert.equal(v.operable, false);
    assert.equal(v.closedPending, true);
    assert.equal(v.caption, CLOSED_PENDING_CAPTION);
    assert.equal(v.explain, CLOSED_PENDING_EXPLAIN);
  });

  it("BTCUSD PENDING on Saturday remains operable — crypto is 24/7", () => {
    const v = episodeMarketView({
      id: "BTCUSD",
      dataStatus: "ok",
      setupState: "pending",
      now: SAT,
    });
    assert.equal(v.session, "open");
    assert.equal(v.operable, true);
    assert.equal(v.closedPending, false);
    assert.equal(v.caption, null);
  });

  it("XAUUSD PENDING becomes operable again on Monday 00:01 Madrid", () => {
    const closed = episodeMarketView({
      id: "XAUUSD",
      dataStatus: "ok",
      setupState: "pending",
      now: MON_MIDNIGHT,
    });
    const open = episodeMarketView({
      id: "XAUUSD",
      dataStatus: "ok",
      setupState: "pending",
      now: MON_OPEN,
    });
    assert.equal(closed.operable, false);
    assert.equal(open.operable, true);
    assert.equal(open.closedPending, false);
  });

  it("does not present a closed-market PENDING as the current opportunity", () => {
    const assets = [
      {
        id: "XAUUSD" as const,
        label: "XAUUSD",
        setupState: "pending" as const,
        dataStatus: "ok" as const,
        setup: { direction: "buy" as const, quality: "alta", riskReward: 2.85 },
      },
      {
        id: "BTCUSD" as const,
        label: "BTCUSD",
        setupState: "wait" as const,
        dataStatus: "ok" as const,
        setup: null,
      },
      {
        id: "US100" as const,
        label: "US100",
        setupState: "wait" as const,
        dataStatus: "ok" as const,
        setup: null,
      },
      {
        id: "WTI" as const,
        label: "WTI",
        setupState: "wait" as const,
        dataStatus: "ok" as const,
        setup: null,
      },
    ];
    const presented = pickPresentedOpportunity(assets, "XAUUSD", SAT);
    assert.equal(presented.asset, null);
    assert.equal(presented.note, "NO HAY NINGUNA ENTRADA CLARA AHORA.");
    assert.doesNotMatch(presented.note, /XAUUSD|TRIGGER PENDIENTE|2,85|2\.85/);
  });

  it("falls through to an open-market setup instead of a closed PENDING", () => {
    const assets = [
      {
        id: "XAUUSD" as const,
        label: "XAUUSD",
        setupState: "pending" as const,
        dataStatus: "ok" as const,
        setup: { direction: "buy" as const, quality: "alta", riskReward: 2.85 },
      },
      {
        id: "BTCUSD" as const,
        label: "BTCUSD",
        setupState: "map" as const,
        dataStatus: "ok" as const,
        setup: { direction: "sell" as const, quality: "media", riskReward: 1.4 },
      },
    ];
    const presented = pickPresentedOpportunity(assets, "XAUUSD", SAT);
    assert.equal(presented.asset?.id, "BTCUSD");
    assert.match(presented.note, /BTCUSD/);
    assert.doesNotMatch(presented.note, /XAUUSD/);
  });

  it("keeps V1 best when that market is actually open", () => {
    const assets = [
      {
        id: "XAUUSD" as const,
        label: "XAUUSD",
        setupState: "pending" as const,
        dataStatus: "ok" as const,
        setup: { direction: "buy" as const, quality: "alta", riskReward: 2.85 },
      },
      {
        id: "BTCUSD" as const,
        label: "BTCUSD",
        setupState: "map" as const,
        dataStatus: "ok" as const,
        setup: { direction: "sell" as const, quality: "media", riskReward: 1.4 },
      },
    ];
    const presented = pickPresentedOpportunity(assets, "XAUUSD", TUE);
    assert.equal(presented.asset?.id, "XAUUSD");
    assert.match(presented.note, /TRIGGER PENDIENTE/);
  });
});

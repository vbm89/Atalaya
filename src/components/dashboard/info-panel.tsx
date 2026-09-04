/** Visual-only copy of the analysis disclaimer. Do not change the facts. */
const DISCLAIMER_LEGAL = "No ejecuta operaciones ni es asesoramiento financiero.";
const DISCLAIMER_XAU =
  "precio SPOT (gold-api cruzado con OANDA). Velas 5m/15m/1h/4h PROXY Bitget XAUUSDT.";
const DISCLAIMER_INDEX = "proceden de PROXY.";
const DISCLAIMER_BTC = "usa BTCUSDT (PROXY).";
const DISCLAIMER_NOTE = "El comentario es estimación técnica.";

export function InfoPanel({
  disclaimer,
  source,
}: {
  disclaimer: string | null | undefined;
  source: string | null | undefined;
}) {
  const sources = source && source !== "sin fuentes" ? source.split(" · ").filter(Boolean) : [];

  return (
    <section className="mt-4 space-y-5" data-info-panel>
      <div>
        <p className="text-xs font-medium tracking-wider text-muted uppercase">Información</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Herramienta de análisis</h2>
        <p className="mt-2 text-sm leading-relaxed text-subtle">{DISCLAIMER_LEGAL}</p>
      </div>

      <div>
        <p className="text-xs font-medium tracking-wider text-muted uppercase">Datos y mercados</p>
        <dl className="mt-2 space-y-3 text-sm leading-relaxed">
          <div>
            <dt className="font-medium">XAUUSD</dt>
            <dd className="mt-0.5 text-subtle">{DISCLAIMER_XAU}</dd>
          </div>
          <div>
            <dt className="font-medium">US100 y WTI</dt>
            <dd className="mt-0.5 text-subtle">{DISCLAIMER_INDEX}</dd>
          </div>
          <div>
            <dt className="font-medium">BTCUSD</dt>
            <dd className="mt-0.5 text-subtle">{DISCLAIMER_BTC}</dd>
          </div>
        </dl>
      </div>

      <div>
        <p className="text-xs font-medium tracking-wider text-muted uppercase">Nota</p>
        <p className="mt-2 text-sm leading-relaxed text-subtle">{DISCLAIMER_NOTE}</p>
      </div>

      <div>
        <p className="text-xs font-medium tracking-wider text-muted uppercase">Fuentes</p>
        {sources.length ? (
          <ul className="mt-2 space-y-1 text-sm leading-relaxed text-subtle">
            {sources.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-subtle">—</p>
        )}
      </div>

      {disclaimer ? (
        <p className="sr-only" data-info-disclaimer>
          {disclaimer}
          {source ? ` Fuentes: ${source}` : ""}
        </p>
      ) : null}
    </section>
  );
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  const asset = (url.searchParams.get("asset") || "BTCUSD").toUpperCase();
  const tf = (url.searchParams.get("tf") || "15m").toLowerCase();

  const symbols = {
    BTCUSD: "BTC-USD",
    XAUUSD: "GC=F",
    US100: "NQ=F",
    US100CASH: "NQ=F",
    WTICASH: "CL=F",
    WTI: "CL=F",
  };

  const symbol = symbols[asset];

  if (!symbol) {
    return json(
      {
        error: "Activo no soportado",
        asset,
        candles: [],
      },
      400
    );
  }

  let interval = "15m";
  let range = "5d";
  let aggregate4h = false;

  if (tf === "1h") {
    interval = "1h";
    range = "1mo";
  } else if (tf === "4h") {
    interval = "1h";
    range = "3mo";
    aggregate4h = true;
  } else if (tf === "1d") {
    interval = "1d";
    range = "1y";
  }

  const params = new URLSearchParams({
    interval,
    range,
    events: "history",
    includePrePost: "true",
    lang: "en-US",
    region: "US",
  });

  const yahooHosts = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
  ];

  let lastError = null;

  for (const host of yahooHosts) {
    const yahooUrl =
      `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;

    try {
      const response = await fetch(yahooUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
          "Accept": "application/json,text/plain,*/*",
          "Referer": "https://finance.yahoo.com/",
          "Origin": "https://finance.yahoo.com",
        },
        cf: {
          cacheTtl: 0,
          cacheEverything: false,
        },
      });

      if (!response.ok) {
        lastError = new Error(
          `Yahoo ${host} HTTP ${response.status}`
        );
        continue;
      }

      const data = await response.json();
      const result = data?.chart?.result?.[0];

      if (!result) {
        lastError = new Error("Yahoo no devolvió datos");
        continue;
      }

      const timestamps = result.timestamp || [];
      const quote = result.indicators?.quote?.[0];

      if (!quote) {
        lastError = new Error("Formato de datos no válido");
        continue;
      }

      let candles = [];

      for (let i = 0; i < timestamps.length; i++) {
        const o = quote.open?.[i];
        const h = quote.high?.[i];
        const l = quote.low?.[i];
        const c = quote.close?.[i];
        const v = quote.volume?.[i] ?? 0;

        if (
          Number.isFinite(o) &&
          Number.isFinite(h) &&
          Number.isFinite(l) &&
          Number.isFinite(c)
        ) {
          candles.push({
            t: timestamps[i] * 1000,
            o,
            h,
            l,
            c,
            v,
          });
        }
      }

      if (!candles.length) {
        lastError = new Error("Yahoo devolvió cero velas");
        continue;
      }

      if (aggregate4h) {
        candles = aggregateCandles(candles, 4);
      }

      return json({
        ok: true,
        asset,
        symbol,
        timeframe: tf,
        source: host,
        candles,
      });
    } catch (error) {
      lastError = error;
    }
  }

  return json(
    {
      ok: false,
      error: "No se pudieron obtener datos de mercado",
      detail: String(lastError?.message || lastError),
      asset,
      symbol,
      timeframe: tf,
      candles: [],
    },
    502
  );
}

function aggregateCandles(candles, size) {
  const output = [];

  for (let i = 0; i < candles.length; i += size) {
    const group = candles.slice(i, i + size);

    if (!group.length) continue;

    output.push({
      t: group[0].t,
      o: group[0].o,
      h: Math.max(...group.map(x => x.h)),
      l: Math.min(...group.map(x => x.l)),
      c: group[group.length - 1].c,
      v: group.reduce(
        (sum, x) => sum + (Number.isFinite(x.v) ? x.v : 0),
        0
      ),
    });
  }

  return output;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
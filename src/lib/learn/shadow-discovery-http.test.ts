import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  authorizeDiscoveryExplore,
  authorizeDiscoveryWrite,
  discoveryUiOrigin,
  handleDiscoveryExplore,
  handleDiscoveryUiWrite,
  handleDiscoveryWrite,
} from "./shadow-discovery-http.ts";

const SECRET = "discovery-ui-secret-16xx";

function src(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

function req(headers?: Record<string, string>): Request {
  return new Request("http://atalaya-dev.vercel.app/api/shadow/discovery", {
    method: "POST",
    headers,
  });
}

function withSecret(fn: () => Promise<void> | void): Promise<void> | void {
  const prev = process.env.WATCH_SECRET;
  process.env.WATCH_SECRET = SECRET;
  const restore = () => {
    if (prev === undefined) delete process.env.WATCH_SECRET;
    else process.env.WATCH_SECRET = prev;
  };
  try {
    const out = fn();
    if (out && typeof (out as Promise<void>).then === "function") {
      return (out as Promise<void>).finally(restore);
    }
    restore();
    return out;
  } catch (e) {
    restore();
    throw e;
  }
}

describe("discovery UI origin + HTTP write auth", () => {
  it("A. same-origin UI request can run ingest via server-injected secret", async () => {
    await withSecret(async () => {
      let ran = 0;
      const res = await handleDiscoveryUiWrite(
        req({ "sec-fetch-site": "same-origin" }),
        async () => {
          ran += 1;
          return { ingestRan: true };
        },
      );
      assert.equal(res.status, 200);
      assert.equal(ran, 1);
      const body = await res.json() as { ok?: boolean; ingestRan?: boolean };
      assert.equal(body.ok, true);
      assert.equal(body.ingestRan, true);
      assert.equal(JSON.stringify(body).includes(SECRET), false);
    });
  });

  it("B. cross-site is 403 and does not ingest", async () => {
    await withSecret(async () => {
      let ran = 0;
      const res = await handleDiscoveryUiWrite(
        req({ "sec-fetch-site": "cross-site" }),
        async () => {
          ran += 1;
          return { ingestRan: true };
        },
      );
      assert.equal(res.status, 403);
      assert.equal(ran, 0);
    });
  });

  it("C. Sec-Fetch-Site none is 403", async () => {
    await withSecret(async () => {
      let ran = 0;
      const res = await handleDiscoveryUiWrite(
        req({ "sec-fetch-site": "none" }),
        async () => {
          ran += 1;
          return {};
        },
      );
      assert.equal(res.status, 403);
      assert.equal(ran, 0);
    });
  });

  it("D. missing Sec-Fetch-Site is 403", async () => {
    await withSecret(async () => {
      let ran = 0;
      const res = await handleDiscoveryUiWrite(req(), async () => {
        ran += 1;
        return {};
      });
      assert.equal(res.status, 403);
      assert.equal(ran, 0);
      const origin = discoveryUiOrigin(req());
      assert.equal(origin.ok, false);
    });
  });

  it("same-site is 403; only same-origin is allowed", () => {
    assert.equal(discoveryUiOrigin(req({ "sec-fetch-site": "same-site" })).ok, false);
    assert.equal(discoveryUiOrigin(req({ "sec-fetch-site": "same-origin" })).ok, true);
  });

  it("E. WATCH_SECRET is server-only: not in client sources", () => {
    const panel = readFileSync(new URL("../../components/dashboard/shadow-discovery-panel.tsx", import.meta.url), "utf8");
    const fn = src("shadow-discovery.fn.ts");
    const http = src("shadow-discovery-http.ts");
    assert.doesNotMatch(panel, /WATCH_SECRET|watchSecret/);
    assert.doesNotMatch(fn, /WATCH_SECRET|watchSecret/);
    assert.match(http, /watchSecret\(\)/);
    assert.match(fn, /handleDiscoveryUiWrite/);
    assert.doesNotMatch(fn, /ingestDiscoveryCoverage/);
    assert.match(http, /authorization: `Bearer \$\{secret\}`/);
  });

  it("F. client component files do not mention WATCH_SECRET", () => {
    const root = fileURLToPath(new URL("../../components", import.meta.url));
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${ent.name}`;
        if (ent.isDirectory()) out.push(...walk(p));
        else if (/\.(tsx|ts|jsx|js)$/.test(ent.name)) out.push(p);
      }
      return out;
    };
    for (const file of walk(root)) {
      const body = readFileSync(file, "utf8");
      assert.doesNotMatch(body, /WATCH_SECRET/);
      assert.doesNotMatch(body, /watchSecret\(/);
    }
  });

  it("G. HTTP POST with correct Bearer is authorized", async () => {
    await withSecret(async () => {
      let ran = 0;
      const res = await handleDiscoveryWrite(
        req({ authorization: `Bearer ${SECRET}` }),
        async () => {
          ran += 1;
          return { ingestRan: true };
        },
      );
      assert.equal(res.status, 200);
      assert.equal(ran, 1);
    });
  });

  it("H. HTTP POST without secret configured is 503", async () => {
    const prev = process.env.WATCH_SECRET;
    delete process.env.WATCH_SECRET;
    try {
      const missing = authorizeDiscoveryWrite(req());
      assert.equal(missing.ok, false);
      if (!missing.ok) assert.equal(missing.status, 503);
      let ran = 0;
      const res = await handleDiscoveryWrite(req({ authorization: "Bearer xxxxxxxxxxxxxxxx" }), async () => {
        ran += 1;
        return {};
      });
      assert.equal(res.status, 503);
      assert.equal(ran, 0);
    } finally {
      if (prev === undefined) delete process.env.WATCH_SECRET;
      else process.env.WATCH_SECRET = prev;
    }
  });

  it("I. HTTP POST with wrong Bearer is 401", async () => {
    await withSecret(async () => {
      let ran = 0;
      const res = await handleDiscoveryWrite(
        req({ authorization: "Bearer wrong-secret-16xx" }),
        async () => {
          ran += 1;
          return {};
        },
      );
      assert.equal(res.status, 401);
      assert.equal(ran, 0);
    });
  });

  it("J/K/L. GET remains read; lab open does not ingest; UI write is the explicit path", () => {
    const route = readFileSync(new URL("../../routes/api/shadow/discovery.ts", import.meta.url), "utf8");
    const fn = src("shadow-discovery.fn.ts");
    const lab = src("shadow-discovery.ts");
    const panel = readFileSync(new URL("../../components/dashboard/shadow-discovery-panel.tsx", import.meta.url), "utf8");
    const getBlock = route.slice(route.indexOf("GET:"), route.indexOf("POST:"));
    assert.match(getBlock, /getShadowDiscovery/);
    assert.doesNotMatch(getBlock, /handleDiscoveryWrite|handleDiscoveryUiWrite|ingestDiscoveryCoverage/);
    assert.match(fn, /getShadowDiscovery[\s\S]*readDiscoveryLab/);
    assert.doesNotMatch(
      fn.slice(fn.indexOf("getShadowDiscovery"), fn.indexOf("updateShadowDiscoveryCoverage")),
      /ingestDiscoveryCoverage|handleDiscoveryUiWrite/,
    );
    assert.match(lab, /return readDiscoveryLab\(sql, nowSec\)/);
    assert.match(panel, /updateShadowDiscoveryCoverage/);
    assert.match(fn, /handleDiscoveryUiWrite/);
  });
});

const EXPLORE_TOKEN = "discovery-explore-token-16";

function exploreReq(headers?: Record<string, string>): Request {
  return new Request("http://local/api/shadow/discovery-explore", {
    method: "POST",
    headers,
  });
}

function withExploreEnv(opts: { explore?: string | null; watch?: string | null }, fn: () => Promise<void>): Promise<void> {
  const prevE = process.env.DISCOVERY_EXPLORE_TOKEN;
  const prevW = process.env.WATCH_SECRET;
  if (opts.explore === null) delete process.env.DISCOVERY_EXPLORE_TOKEN;
  else if (opts.explore !== undefined) process.env.DISCOVERY_EXPLORE_TOKEN = opts.explore;
  if (opts.watch === null) delete process.env.WATCH_SECRET;
  else if (opts.watch !== undefined) process.env.WATCH_SECRET = opts.watch;
  return fn().finally(() => {
    if (prevE === undefined) delete process.env.DISCOVERY_EXPLORE_TOKEN;
    else process.env.DISCOVERY_EXPLORE_TOKEN = prevE;
    if (prevW === undefined) delete process.env.WATCH_SECRET;
    else process.env.WATCH_SECRET = prevW;
  });
}

function stubExploreResult() {
  return {
    journalId: 7,
    persisted: true,
    nCommon4: [],
    catalog: {
      cells: [],
      sequenceCells: [],
      sequences: [],
      catalogN: 0,
      warmupExcludedN: 0,
      warmupTaggedN: 0,
      outsideWindowN: 0,
      k1TestExcludedN: 0,
      detectedN: 0,
      report: {
        outcomesSampled: 0,
        rankingByExpectancy: false,
        eventCounts: [],
        sequenceCounts: [],
        journal: {
          universe: "COMMON_4",
          outcomeConsulted: false,
          candidates: [],
          notes: "FIRST_ONESHOT_EXPLORE stub",
        },
      },
    },
  } as unknown as import("./shadow-discovery-explore-once.ts").DiscoveryExploreOnceResult;
}

describe("discovery-explore temporary token", () => {
  it("A. POST with DISCOVERY_EXPLORE_TOKEN passes auth and does not run live detectors", async () => {
    await withExploreEnv({ explore: EXPLORE_TOKEN, watch: null }, async () => {
      let ran = 0;
      const res = await handleDiscoveryExplore(
        exploreReq({ authorization: `Bearer ${EXPLORE_TOKEN}` }),
        async () => {
          ran += 1;
          return stubExploreResult();
        },
      );
      assert.equal(authorizeDiscoveryExplore(exploreReq({ authorization: `Bearer ${EXPLORE_TOKEN}` })).ok, true);
      assert.equal(res.status, 200);
      assert.equal(ran, 1);
    });
  });

  it("B. POST without token is 401", async () => {
    await withExploreEnv({ explore: EXPLORE_TOKEN, watch: null }, async () => {
      let ran = 0;
      const auth = authorizeDiscoveryExplore(exploreReq());
      assert.equal(auth.ok, false);
      if (!auth.ok) assert.equal(auth.status, 401);
      const res = await handleDiscoveryExplore(exploreReq(), async () => {
        ran += 1;
        return stubExploreResult();
      });
      assert.equal(res.status, 401);
      assert.equal(ran, 0);
    });
  });

  it("C/I. POST with wrong token is 401 and detectors do not run", async () => {
    await withExploreEnv({ explore: EXPLORE_TOKEN, watch: null }, async () => {
      let ran = 0;
      const auth = authorizeDiscoveryExplore(exploreReq({ authorization: "Bearer wrong-explore-tokenxx" }));
      assert.equal(auth.ok, false);
      if (!auth.ok) assert.equal(auth.status, 401);
      const res = await handleDiscoveryExplore(
        exploreReq({ authorization: "Bearer wrong-explore-tokenxx" }),
        async () => {
          ran += 1;
          return stubExploreResult();
        },
      );
      assert.equal(res.status, 401);
      assert.equal(ran, 0);
    });
  });

  it("D. DISCOVERY_EXPLORE_TOKEN does not authorize ingest", async () => {
    await withExploreEnv({ explore: EXPLORE_TOKEN, watch: SECRET }, async () => {
      let ingest = 0;
      const res = await handleDiscoveryWrite(
        req({ authorization: `Bearer ${EXPLORE_TOKEN}` }),
        async () => {
          ingest += 1;
          return { ingestRan: true };
        },
      );
      assert.equal(res.status, 401);
      assert.equal(ingest, 0);
      assert.equal(authorizeDiscoveryWrite(req({ authorization: `Bearer ${EXPLORE_TOKEN}` })).ok, false);
    });
  });

  it("E. WATCH_SECRET still authorizes ingest and explore", async () => {
    await withExploreEnv({ explore: EXPLORE_TOKEN, watch: SECRET }, async () => {
      let ingest = 0;
      let explore = 0;
      const write = await handleDiscoveryWrite(
        req({ authorization: `Bearer ${SECRET}` }),
        async () => {
          ingest += 1;
          return { ingestRan: true };
        },
      );
      const exp = await handleDiscoveryExplore(
        exploreReq({ authorization: `Bearer ${SECRET}` }),
        async () => {
          explore += 1;
          return stubExploreResult();
        },
      );
      assert.equal(write.status, 200);
      assert.equal(ingest, 1);
      assert.equal(exp.status, 200);
      assert.equal(explore, 1);
    });
  });

  it("F. FIRST_ONESHOT lock remains in explore-once (not removed)", () => {
    const once = src("shadow-discovery-explore-once.ts");
    const http = src("shadow-discovery-http.ts");
    assert.match(once, /pg_advisory_xact_lock/);
    assert.match(once, /FIRST_ONESHOT_EXPLORE/);
    assert.match(http, /authorizeDiscoveryExplore/);
    assert.match(http, /ALREADY_EXECUTED/);
    const writeHttp = http.slice(
      http.indexOf("export async function handleDiscoveryWrite"),
      http.indexOf("export async function handleDiscoveryExplore"),
    );
    assert.doesNotMatch(writeHttp, /exploreDiscoveryOnce/);
  });

  it("G. GET/lab stay detectPatterns=false; token is server-only", () => {
    const lab = src("shadow-discovery.ts");
    const fn = src("shadow-discovery.fn.ts");
    const panel = readFileSync(new URL("../../components/dashboard/shadow-discovery-panel.tsx", import.meta.url), "utf8");
    const route = readFileSync(new URL("../../routes/api/shadow/discovery.ts", import.meta.url), "utf8");
    const exploreRoute = readFileSync(new URL("../../routes/api/shadow/discovery-explore.ts", import.meta.url), "utf8");
    assert.match(lab, /detectPatterns:\s*false/);
    assert.doesNotMatch(lab, /detectPatterns:\s*true/);
    assert.doesNotMatch(fn, /DISCOVERY_EXPLORE_TOKEN|authorizeDiscoveryExplore|handleDiscoveryExplore/);
    assert.doesNotMatch(panel, /DISCOVERY_EXPLORE_TOKEN|discovery-explore/);
    assert.doesNotMatch(route, /DISCOVERY_EXPLORE_TOKEN|authorizeDiscoveryExplore/);
    assert.match(exploreRoute, /handleDiscoveryExplore/);
    assert.doesNotMatch(src("shadow-discovery-http.ts"), /VITE_DISCOVERY_EXPLORE_TOKEN/);
  });

  it("H. token never appears in response or journal payload", async () => {
    await withExploreEnv({ explore: EXPLORE_TOKEN, watch: null }, async () => {
      const res = await handleDiscoveryExplore(
        exploreReq({ authorization: `Bearer ${EXPLORE_TOKEN}` }),
        async () => stubExploreResult(),
      );
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.equal(text.includes(EXPLORE_TOKEN), false);
      assert.doesNotMatch(text, /DISCOVERY_EXPLORE_TOKEN=/);
      const denied = await handleDiscoveryExplore(exploreReq({ authorization: `Bearer ${EXPLORE_TOKEN}-nope` }), async () => stubExploreResult());
      const deniedText = await denied.text();
      assert.equal(deniedText.includes(EXPLORE_TOKEN), false);
      assert.equal(deniedText.includes(`${EXPLORE_TOKEN}-nope`), false);
    });
  });

  it("J. integration auth tests never call live exploreDiscoveryOnce / Neon", () => {
    const testSrc = readFileSync(new URL("./shadow-discovery-http.test.ts", import.meta.url), "utf8");
    assert.match(testSrc, /stubExploreResult/);
    assert.doesNotMatch(testSrc, /https:\/\/atalaya-dev\.vercel\.app\/api\/shadow\/discovery-explore/);
  });
});

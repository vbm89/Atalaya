import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  authorizeDiscoveryWrite,
  discoveryUiOrigin,
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

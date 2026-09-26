import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));

function read(name: string): string {
  return readFileSync(join(here, name), "utf8");
}

describe("HOME shell contract", () => {
  it("dock is Atalaya · Gráficos · Calendario · Historial · Más", () => {
    const dash = read("dashboard.tsx");
    const nav = dash.slice(dash.indexOf("atalaya-dock"));
    const labels = [...nav.matchAll(/label="(Atalaya|Gráficos|Calendario|Historial|Más)"/g)].map((m) => m[1]);
    assert.deepEqual(labels, ["Atalaya", "Gráficos", "Calendario", "Historial", "Más"]);
    assert.doesNotMatch(dash, /TERMINAL/);
    assert.match(dash, /AtalayaMark/);
    assert.match(dash, /OperativoPill/);
    assert.match(dash, /atalaya-markets-grid/);
  });

  it("HOME shows the live opportunity card and the empty state", () => {
    const feed = read("home-feed.tsx");
    assert.match(feed, /Mejor oportunidad ahora/);
    assert.match(feed, /Sin entradas activas/);
    assert.match(feed, /Mercado en vigilancia/);
  });

  it("tiles show session CERRADO and AssetMark identity", () => {
    const card = read("asset-card.tsx");
    assert.match(card, /AssetMark/);
    assert.match(card, /CERRADO/);
  });

  it("Más stays a destination list and does not replace HOME", () => {
    const more = read("more-panel.tsx");
    const dash = read("dashboard.tsx");
    assert.match(more, /Alertas/);
    assert.match(more, /Calendario/);
    assert.match(more, /data-more-panel/);
    assert.match(dash, /MorePanel/);
    assert.doesNotMatch(dash, /tab === "lab"/);
  });

  it("Pattern Discovery states COMMON_4 / INSUFFICIENT and never ranks", () => {
    const panel = read("shadow-discovery-panel.tsx");
    assert.match(panel, /COMMON_4/);
    assert.match(panel, /ASSET_DEEP/);
    assert.match(panel, /n=/);
    assert.match(panel, /descriptivo, no validación/);
    assert.match(panel, /EXPLORE \/ INSUFFICIENT/);
    assert.match(panel, /Cobertura actual/);
    assert.match(panel, /Actualizar cobertura/);
    assert.match(panel, /getShadowDiscovery/);
    assert.match(panel, /updateShadowDiscoveryCoverage/);
    assert.doesNotMatch(panel, /win-rate|expectancy|TEST de K1|k1Seal/i);
  });

  it("lab panel imports ShadowFrequencyPanel before using it", () => {
    const lab = read("lab-integrity-panel.tsx");
    assert.match(lab, /import \{ ShadowFrequencyPanel \} from "\.\/shadow-frequency-panel"/);
    assert.match(lab, /<ShadowFrequencyPanel /);
    assert.match(lab, /data-shadow-seal/);
    assert.match(lab, /TEST 🔒/);
    assert.doesNotMatch(lab, /k1Seal\.test\./);
  });

  it("HOME chrome does not import Shadow replay or capture writers", () => {
    for (const name of ["dashboard.tsx", "home-feed.tsx", "more-panel.tsx", "asset-card.tsx", "marks.tsx"]) {
      const src = read(name);
      assert.doesNotMatch(src, /shadow-replay/);
      assert.doesNotMatch(src, /entry-gates/);
      assert.doesNotMatch(src, /post-entry/);
      assert.doesNotMatch(src, /lab-integrity-read/);
    }
  });
});

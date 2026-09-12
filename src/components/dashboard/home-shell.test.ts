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
  it("dock is Inicio · Mercados · Historial · Alertas · Más, not TERMINAL chrome", () => {
    const dash = read("dashboard.tsx");
    const nav = dash.slice(dash.indexOf("atalaya-dock"));
    const labels = [...nav.matchAll(/label="(Inicio|Mercados|Historial|Alertas|Más)"/g)].map((m) => m[1]);
    assert.deepEqual(labels, ["Inicio", "Mercados", "Historial", "Alertas", "Más"]);
    assert.doesNotMatch(dash, /TERMINAL/);
    assert.match(dash, /AtalayaMark/);
    assert.match(dash, /OperativoPill/);
    assert.match(dash, /atalaya-markets-grid/);
  });

  it("HOME heading is Mercado en vigilancia with Oportunidades", () => {
    const feed = read("home-feed.tsx");
    assert.match(feed, /Mercado en vigilancia/);
    assert.match(feed, /Oportunidades/);
    assert.match(feed, /Sin entradas activas/);
  });

  it("tiles show session CERRADO and AssetMark identity", () => {
    const card = read("asset-card.tsx");
    assert.match(card, /AssetMark/);
    assert.match(card, /CERRADO/);
  });

  it("Más keeps Estado del laboratorio as a destination, not a HOME replacement", () => {
    const more = read("more-panel.tsx");
    const dash = read("dashboard.tsx");
    assert.match(more, /Estado del laboratorio/);
    assert.match(dash, /LabIntegrityPanel/);
    assert.match(dash, /tab === "lab"/);
    assert.match(dash, /onLab=/);
  });

  it("Pattern Discovery states COMMON_4 / INSUFFICIENT and never ranks", () => {
    const panel = read("shadow-discovery-panel.tsx");
    assert.match(panel, /COMMON_4/);
    assert.match(panel, /ASSET_DEEP/);
    assert.match(panel, /descriptivo, no validación/);
    assert.match(panel, /EXPLORE \/ INSUFFICIENT/);
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

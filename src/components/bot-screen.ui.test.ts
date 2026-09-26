import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("pantalla principal del bot paper", () => {
  const src = readFileSync(new URL("./bot-screen.tsx", import.meta.url), "utf8");

  it("es el panel del bot, no un laboratorio", () => {
    assert.match(src, /ATALAYA/);
    assert.match(src, /BOT PAPER/);
    assert.match(src, /SIN EJECUCIÓN REAL/);
    assert.match(src, /SEÑALES/);
    assert.match(src, /Última evaluación/);
    assert.match(src, /Próxima evaluación/);
    assert.doesNotMatch(src, /Strategy Lab|Trend Pullback|Asset Strategies|Market Behaviour/);
    assert.doesNotMatch(src, /validatedEdge|liveTrading|TRAIN|TEST|Shadow/);
    assert.doesNotMatch(src, /marketState|tier/);
  });
});

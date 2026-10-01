import { readFileSync } from "node:fs";
import { renderStudyReport } from "../src/lib/bot-paper/study.ts";
import type { StoredSignal } from "../src/lib/bot-paper/store.ts";

const file = process.argv[2];
if (!file) {
  console.error("Uso: node --experimental-strip-types --import ./scripts/register-ts-ext.mjs scripts/paper-study.mts <signals.json>");
  process.exit(1);
}
const raw = JSON.parse(readFileSync(file, "utf8")) as { signals?: StoredSignal[] } | StoredSignal[];
const signals = Array.isArray(raw) ? raw : raw.signals ?? [];
process.stdout.write(renderStudyReport(signals));

#!/usr/bin/env node
/**
 * Fail CI / npm test if any of the six frozen V1 files changes.
 * Byte-for-byte SHA-256. Does not read or rewrite the protected sources
 * beyond hashing. Canonical pins live here — never in the V1 files.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./with-app-env.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Canonical SHA-256 (lowercase hex) of the frozen V1 sources. */
export const V1_SHA256 = Object.freeze({
  "src/lib/trading/engine.ts":
    "c3d53a4f4366add2c8a284d4f068ea5d2826a36e3aa259b460d74b37c36ce618",
  "src/lib/trading/signals.ts":
    "dfb2d2cd188b18daaebed5e843bd8dbefb1e1c6672be86d2092390a8b3bc019b",
  "src/lib/trading/structure.ts":
    "e72ba478f524170c7f6c1c6916e033c3fafb418b874aa33565e32dbd01b54170",
  "src/lib/trading/risk.ts":
    "4aa406c0061149486532e9f787d20c3cc9f845362dd5497fd42b42563b5d385e",
  "src/lib/watch/outcome.ts":
    "fdad185119978866d6bec772091e2d6d0d0af49a5207a7bae061d2d840453c90",
  "src/lib/market/xau-spot.ts":
    "393d01945077190a7745ad7cabc3b87bfb170f55fad82a4189a5ee661c678068",
});

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function checkV1Sha(root = ROOT) {
  const failures = [];
  for (const [rel, expected] of Object.entries(V1_SHA256)) {
    const abs = join(root, rel);
    let actual;
    try {
      actual = sha256File(abs);
    } catch (err) {
      failures.push({
        file: rel,
        expected,
        actual: `(unreadable: ${err instanceof Error ? err.message : String(err)})`,
      });
      continue;
    }
    if (actual !== expected) {
      failures.push({ file: rel, expected, actual });
    }
  }
  return failures;
}

function main() {
  const failures = checkV1Sha();
  if (!failures.length) {
    console.log(`V1 SHA-256 OK — ${Object.keys(V1_SHA256).length} protected files unchanged.`);
    process.exit(0);
  }
  console.error("V1 SHA-256 MISMATCH — a protected file changed:");
  for (const row of failures) {
    console.error(`  ${row.file}`);
    console.error(`    expected: ${row.expected}`);
    console.error(`    actual:   ${row.actual}`);
  }
  process.exit(1);
}

if (isMainModule(import.meta.url)) {
  main();
}

#!/usr/bin/env node
/**
 * Generate a tiny build-time module for the read-only laboratory panel.
 * The protected V1 sources are verified first by check-v1-sha.mjs, so this
 * module records only a successful build-time integrity result. It avoids
 * depending on source files being present in a Vercel serverless bundle.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { V1_SHA256 } from "./check-v1-sha.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "src/lib/watch/v1-fingerprint.generated.ts");

mkdirSync(dirname(target), { recursive: true });

const content = `/**\n * Generated during build after check-v1-sha.mjs passes.\n * Do not edit manually.\n */\nexport const V1_FINGERPRINT = ${JSON.stringify(V1_SHA256, null, 2)} as const;\nexport const V1_FINGERPRINT_STATUS = "intacta" as const;\n`;

writeFileSync(target, content, "utf8");
console.log(`Generated V1 fingerprint module: ${target}`);

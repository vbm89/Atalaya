import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function aliasFile(specifier) {
  if (!specifier.startsWith("@/")) return null;
  const base = join(root, "src", specifier.slice(2));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.js`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

export async function resolve(specifier, context, nextResolve) {
  const aliased = aliasFile(specifier);
  if (aliased) return nextResolve(pathToFileURL(aliased).href, context);
  if (
    (specifier.startsWith(".") || specifier.startsWith("/")) &&
    !/\.(ts|js|mjs|cjs|json|node|tsx)$/.test(specifier)
  ) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      return nextResolve(specifier, context);
    }
  }
  return nextResolve(specifier, context);
}

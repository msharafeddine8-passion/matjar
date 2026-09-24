// Resolve hook for scripts that import TypeScript from src/ directly.
//
// Node 22.6+ strips types from a `.ts` file it is asked to load, but it will
// not guess an extension the import omitted, and it knows nothing about the
// `@/` alias tsconfig declares. This hook fills in exactly those two gaps and
// nothing else; the type stripping itself is Node's. Registered from
// scripts/data-quality-report.mjs via `module.register`.

import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), "../src");

function withTs(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolvePath(base, "index.ts")]) {
    if (existsSync(candidate) && !candidate.endsWith(base + "/")) {
      try {
        // A directory passes existsSync; only a file may be returned.
        if (candidate === base && !/\.[cm]?[jt]sx?$/.test(candidate)) continue;
      } catch {
        continue;
      }
      return candidate;
    }
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const hit = withTs(resolvePath(SRC, specifier.slice(2)));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const hit = withTs(base);
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  return next(specifier, context);
}

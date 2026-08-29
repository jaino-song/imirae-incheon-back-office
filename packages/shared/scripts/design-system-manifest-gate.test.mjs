import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  readRepositoryManifest,
  readRepositorySources,
  validateRootComponentRequirements,
} from "./design-system-manifest-gate.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const manifest = readRepositoryManifest(repoRoot);
const sources = readRepositorySources(repoRoot);

test("accepts the registered mobile root Toaster and its single mount", () => {
  assert.deepEqual(
    validateRootComponentRequirements({ manifest, sources }),
    [],
  );
});

test("rejects a missing mobile root Toaster manifest entry", () => {
  const manifestWithoutToaster = structuredClone(manifest);
  manifestWithoutToaster.components.mobile = manifestWithoutToaster.components.mobile.filter(
    (entry) => entry.name !== "Toaster",
  );

  const errors = validateRootComponentRequirements({
    manifest: manifestWithoutToaster,
    sources,
  });

  assert.ok(
    errors.some((error) =>
      error.includes("mobile root component Toaster must have exactly one manifest entry"),
    ),
  );
});

test("rejects a missing mobile root Toaster mount", () => {
  const providersPath =
    "mobile/src/components/app/root/mobile-shell-providers.tsx";
  const sourcesWithoutMount = new Map(sources);
  sourcesWithoutMount.set(
    providersPath,
    sources.get(providersPath).replace(/<Toaster\s*\/>/, ""),
  );

  const errors = validateRootComponentRequirements({
    manifest,
    sources: sourcesWithoutMount,
  });

  assert.ok(
    errors.some((error) =>
      error.includes("mobile-shell-providers.tsx must render Toaster exactly once"),
    ),
  );
});

test("rejects an additional production Toaster mount", () => {
  const sourcesWithDuplicate = new Map(sources);
  sourcesWithDuplicate.set(
    "mobile/src/components/app/root/duplicate-toaster.tsx",
    "export function DuplicateToasterHost() { return <Toaster />; }",
  );

  const errors = validateRootComponentRequirements({
    manifest,
    sources: sourcesWithDuplicate,
  });

  assert.ok(
    errors.some((error) =>
      error.includes("Mobile production sources must render root Toaster exactly once"),
    ),
  );
});

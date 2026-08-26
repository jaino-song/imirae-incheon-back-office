#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT_COMPONENT_REQUIREMENTS = Object.freeze([
  Object.freeze({
    platform: "mobile",
    name: "Toaster",
    importPath: "@/components/ui/toaster",
    sourceFile: "mobile/src/components/ui/toaster.tsx",
    mountFile: "mobile/src/components/app/root/mobile-shell-providers.tsx",
    exportName: "Toaster",
  }),
]);

export const MANIFEST_PATH = "docs/design-system/component-manifest.json";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "../../..");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceEntries(sources) {
  if (sources instanceof Map) {
    return [...sources.entries()];
  }

  return Object.entries(sources ?? {});
}

function sourceText(sources, relativePath) {
  if (sources instanceof Map) {
    return sources.get(relativePath);
  }

  return sources?.[relativePath];
}

function countMatches(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

function isProductionSource(relativePath) {
  return (
    /\.(?:ts|tsx)$/.test(relativePath) &&
    !/\.(?:test|spec)\.(?:ts|tsx)$/.test(relativePath) &&
    !relativePath.includes("/__tests__/")
  );
}

function requiredEntryErrors(requirement, manifest) {
  const entries = manifest?.components?.[requirement.platform];
  if (!Array.isArray(entries)) {
    return [
      `${requirement.platform} component manifest is missing; cannot register root ${requirement.name}.`,
    ];
  }

  const matchingEntries = entries.filter((entry) => entry?.name === requirement.name);
  const errors = [];

  if (matchingEntries.length !== 1) {
    errors.push(
      `${requirement.platform} root component ${requirement.name} must have exactly one manifest entry (found ${matchingEntries.length}).`,
    );
    return errors;
  }

  const [entry] = matchingEntries;
  if (entry.import !== requirement.importPath) {
    errors.push(
      `${requirement.platform} root component ${requirement.name} manifest import must be ${requirement.importPath}.`,
    );
  }
  if (entry.file !== requirement.sourceFile) {
    errors.push(
      `${requirement.platform} root component ${requirement.name} manifest file must be ${requirement.sourceFile}.`,
    );
  }
  if (!Array.isArray(entry.exports) || !entry.exports.includes(requirement.exportName)) {
    errors.push(
      `${requirement.platform} root component ${requirement.name} manifest exports must include ${requirement.exportName}.`,
    );
  }

  return errors;
}

function requiredSourceErrors(requirement, sources) {
  const errors = [];
  const source = sourceText(sources, requirement.sourceFile);
  const mountSource = sourceText(sources, requirement.mountFile);

  if (typeof source !== "string") {
    errors.push(`Missing source for root component ${requirement.sourceFile}.`);
  } else {
    const exportPattern = new RegExp(
      String.raw`(?:export\s+(?:async\s+)?function|export\s+(?:const|class))\s+${escapeRegExp(requirement.exportName)}\b`,
    );
    if (!exportPattern.test(source)) {
      errors.push(
        `Root component ${requirement.name} must export ${requirement.exportName} from ${requirement.sourceFile}.`,
      );
    }
  }

  if (typeof mountSource !== "string") {
    errors.push(`Missing root mount source ${requirement.mountFile}.`);
    return errors;
  }

  const importPattern = new RegExp(
    String.raw`import\s*\{\s*${escapeRegExp(requirement.exportName)}\s*\}\s*from\s*["']${escapeRegExp(requirement.importPath)}["']`,
    "g",
  );
  const mountPattern = new RegExp(`<${escapeRegExp(requirement.name)}\\b[^>]*>`, "g");
  const importCount = countMatches(mountSource, importPattern);
  const mountCount = countMatches(mountSource, mountPattern);

  if (importCount !== 1) {
    errors.push(
      `Root mount ${requirement.mountFile} must import ${requirement.name} exactly once (found ${importCount}).`,
    );
  }
  if (mountCount !== 1) {
    errors.push(
      `Root mount ${requirement.mountFile} must render ${requirement.name} exactly once (found ${mountCount}).`,
    );
  }

  return errors;
}

function duplicateMountErrors(requirement, sources) {
  const mountPattern = new RegExp(`<${escapeRegExp(requirement.name)}\\b[^>]*>`, "g");
  const productionMounts = sourceEntries(sources)
    .filter(([relativePath]) => isProductionSource(relativePath))
    .flatMap(([relativePath, source]) =>
      Array.from(source.matchAll(mountPattern), () => relativePath),
    );

  if (productionMounts.length === 1) {
    return [];
  }

  return [
    `Mobile production sources must render root ${requirement.name} exactly once (found ${productionMounts.length}: ${productionMounts.join(", ") || "none"}).`,
  ];
}

export function validateRootComponentRequirements({ manifest, sources }) {
  const errors = [];

  for (const requirement of ROOT_COMPONENT_REQUIREMENTS) {
    errors.push(...requiredEntryErrors(requirement, manifest));
    errors.push(...requiredSourceErrors(requirement, sources));
    if (requirement.platform === "mobile") {
      errors.push(...duplicateMountErrors(requirement, sources));
    }
  }

  return errors;
}

function collectProductionSources(directory, repoRoot, sources) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      collectProductionSources(absolutePath, repoRoot, sources);
      continue;
    }

    const relativePath = absolutePath
      .slice(repoRoot.length + 1)
      .split(path.sep)
      .join("/");
    if (isProductionSource(relativePath)) {
      sources.set(relativePath, readFileSync(absolutePath, "utf8"));
    }
  }
}

export function readRepositorySources(repoRoot = defaultRepoRoot) {
  const sources = new Map();
  const mobileSourceRoot = path.join(repoRoot, "mobile/src");

  if (existsSync(mobileSourceRoot)) {
    collectProductionSources(mobileSourceRoot, repoRoot, sources);
  }

  return sources;
}

export function readRepositoryManifest(repoRoot = defaultRepoRoot) {
  const manifestPath = path.join(repoRoot, MANIFEST_PATH);
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

export function runManifestGate(repoRoot = defaultRepoRoot) {
  const errors = validateRootComponentRequirements({
    manifest: readRepositoryManifest(repoRoot),
    sources: readRepositorySources(repoRoot),
  });

  if (errors.length > 0) {
    throw new Error(`Design-system manifest/runtime completeness gate failed:\n- ${errors.join("\n- ")}`);
  }
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  try {
    runManifestGate();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

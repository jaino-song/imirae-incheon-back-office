import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CAPABILITY_INVENTORY } from "./capability-inventory";
import { discoverProviderSources } from "./provider-source-inventory";

const manifestPath = resolve(__dirname, "../../agent-manifest.json");
const providerSources = new Map(discoverProviderSources().map((entry) => [entry.name, entry]));
const catalogNames = new Set(CAPABILITY_INVENTORY.map((entry) => entry.name));
const missingProviders = [...catalogNames].filter((name) => !providerSources.has(name));
const undocumentedProviders = [...providerSources.keys()].filter((name) => !catalogNames.has(name));
if (missingProviders.length > 0 || undocumentedProviders.length > 0) {
    throw new Error(`Capability/provider coverage drift. Missing providers: ${missingProviders.join(", ") || "none"}; undocumented providers: ${undocumentedProviders.join(", ") || "none"}`);
}
const capabilities = CAPABILITY_INVENTORY
    .map((entry) => ({ ...entry, ...providerSources.get(entry.name)! }))
    .sort((left, right) => left.name.localeCompare(right.name));
const next = `${JSON.stringify({ version: 2, generatedAt: "static", capabilities }, null, 2)}\n`;
const current = (() => {
    try { return readFileSync(manifestPath, "utf8"); } catch { return ""; }
})();

if (process.argv.includes("--check")) {
    if (current !== next) {
        console.error("agent-manifest.json is stale; run pnpm --filter ./backend exec ts-node scripts/agent/generate-capability-manifest.ts");
        process.exitCode = 1;
    }
} else {
    writeFileSync(manifestPath, next);
}

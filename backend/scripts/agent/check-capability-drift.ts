import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CAPABILITY_INVENTORY } from "./capability-inventory";
import { discoverProviderSources } from "./provider-source-inventory";

type ManifestEntry = Record<string, unknown> & { name: string; renderer: string; sourceFile: string; sourceDigest: string };
const manifest = JSON.parse(readFileSync(resolve(__dirname, "../../agent-manifest.json"), "utf8")) as { version: number; capabilities: ManifestEntry[] };
if (manifest.version !== 2 || !Array.isArray(manifest.capabilities)) throw new Error("Unsupported agent manifest format");

const desktopRenderer = readFileSync(resolve(__dirname, "../../../frontend/src/components/app/chat/parts/AgentPartRegistry.tsx"), "utf8");
const mobileRenderer = readFileSync(resolve(__dirname, "../../../mobile/src/components/app/chat/MobileAgentPartRegistry.tsx"), "utf8");
const sources = new Map(discoverProviderSources().map((entry) => [entry.name, entry]));
const catalog = new Map(CAPABILITY_INVENTORY.map((entry) => [entry.name, entry]));
const actual = new Map(manifest.capabilities.map((entry) => [entry.name, entry]));

if (actual.size !== catalog.size || [...catalog.keys()].some((name) => !actual.has(name)) || [...sources.keys()].some((name) => !catalog.has(name))) {
    throw new Error("Capability manifest, provider source, and canonical catalog coverage differ");
}

for (const [name, expected] of catalog) {
    const entry = actual.get(name)!;
    const source = sources.get(name);
    if (!source) throw new Error(`Provider source missing for ${name}`);
    if (!/^\d+\.\d+\.\d+$/.test(String(entry["version"])) || !Array.isArray(entry["requiredRoles"]) || entry["requiredRoles"].length === 0) {
        throw new Error(`Invalid manifest metadata: ${name}`);
    }
    for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
        if (JSON.stringify(entry[key]) !== JSON.stringify(expected[key])) throw new Error(`Canonical metadata drift detected: ${name}.${String(key)}`);
    }
    if (entry.sourceFile !== source.sourceFile || entry.sourceDigest !== source.sourceDigest) throw new Error(`Provider implementation digest drift detected: ${name}`);
    const marker = entry.renderer === "text" ? 'part.type === "text"' : `data-${entry.renderer}`;
    if (!desktopRenderer.includes(marker)) throw new Error(`Desktop renderer coverage missing for ${name}: ${entry.renderer}`);
    if (!mobileRenderer.includes(marker)) throw new Error(`Mobile renderer coverage missing for ${name}: ${entry.renderer}`);
    if (expected.risk !== "read" && (!expected.approvalPolicy || !expected.idempotencyPolicy)) {
        throw new Error(`Write safety declaration missing for ${name}`);
    }
}

console.log(`Capability drift check passed (${actual.size} capabilities, desktop/mobile renderers, provider digests)`);

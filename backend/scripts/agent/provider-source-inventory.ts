import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

export type ProviderSourceEntry = { name: string; sourceFile: string; sourceDigest: string };

const capabilityName = /(?:name\s*:\s*|this\.(?:read|write|automationExistingRuleCapability)\(\s*(?:common\s*,\s*)?)["']([a-z][a-z0-9-]*(?:\.[A-Za-z0-9-]+)+)["']/g;

function files(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) return files(path);
        return entry.name.endsWith("agent-capabilities.provider.ts") || entry.name === "extended-read-agent-capabilities.provider.ts" ? [path] : [];
    });
}

export function discoverProviderSources(backendRoot = resolve(__dirname, "../..")): ProviderSourceEntry[] {
    const candidates = [
        ...files(resolve(backendRoot, "application/agent")),
        ...files(resolve(backendRoot, "application/usecases")),
    ];
    const result: ProviderSourceEntry[] = [];
    for (const file of candidates) {
        const source = readFileSync(file, "utf8");
        const digest = createHash("sha256").update(source).digest("hex");
        for (const match of source.matchAll(capabilityName)) {
            result.push({ name: match[1]!, sourceFile: relative(backendRoot, file), sourceDigest: digest });
        }
    }
    const duplicates = result.filter((entry, index) => result.findIndex((candidate) => candidate.name === entry.name) !== index);
    if (duplicates.length > 0) throw new Error(`Duplicate capability names in provider sources: ${[...new Set(duplicates.map((entry) => entry.name))].join(", ")}`);
    return result.sort((left, right) => left.name.localeCompare(right.name));
}

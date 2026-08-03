import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type ManifestCapability = Record<string, unknown> & { name: string };
type Manifest = { capabilities: ManifestCapability[] };

const baseSha = process.env["GITHUB_BASE_SHA"];
const headSha = process.env["GITHUB_SHA"];

function readManifest(ref?: string): Manifest | null {
    try {
        const source = ref
            ? execFileSync("git", ["show", `${ref}:backend/agent-manifest.json`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
            : readFileSync(resolve(__dirname, "../../agent-manifest.json"), "utf8");
        const parsed = JSON.parse(source) as Manifest;
        return { capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities : [] };
    } catch {
        return null;
    }
}

if (!baseSha || !headSha) throw new Error("GITHUB_BASE_SHA and GITHUB_SHA are required for capability impact reporting");
const base = readManifest(baseSha);
const head = readManifest(headSha) ?? readManifest();
const baseByName = new Map((base?.capabilities ?? []).map((capability) => [capability.name, capability]));
const headByName = new Map((head?.capabilities ?? []).map((capability) => [capability.name, capability]));
const added = [...headByName.keys()].filter((name) => !baseByName.has(name)).sort();
const removed = [...baseByName.keys()].filter((name) => !headByName.has(name)).sort();
const changed = [...headByName.keys()]
    .filter((name) => baseByName.has(name) && JSON.stringify(baseByName.get(name)) !== JSON.stringify(headByName.get(name)))
    .sort();

console.log([
    "## AI capability impact",
    "",
    `Added: ${added.length ? added.join(", ") : "none"}`,
    `Changed: ${changed.length ? changed.join(", ") : "none"}`,
    `Removed: ${removed.length ? removed.join(", ") : "none"}`,
].join("\n"));

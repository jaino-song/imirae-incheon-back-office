/**
 * Frontend feature flags. Each flag has:
 *   - a `NEXT_PUBLIC_FEATURE_<NAME>` env var that can force it on, and
 *   - a `NEXT_PUBLIC_FEATURE_DISABLE_<NAME>` env var that can force it off.
 *
 * Flags also pick up enable signals from `NEXT_PUBLIC_FEATURE_FLAGS`
 * (comma-separated list of enabled flag names).
 *
 * Important: env vars are referenced via *literal* property access below so
 * Next.js inlines them into the client bundle at build time. Dynamic
 * `process.env[someKey]` reads do not get inlined and would always resolve
 * to `undefined` in the browser.
 *
 * Flags are static for the page lifetime — toggling them requires a reload.
 */

export type FeatureFlag = "headlessDispatch" | "eformsignDocumentJobs";

const ENABLE_VALUES: Record<FeatureFlag, string | undefined> = {
    headlessDispatch: process.env.NEXT_PUBLIC_FEATURE_HEADLESS_DISPATCH,
    eformsignDocumentJobs: process.env.NEXT_PUBLIC_FEATURE_EFORMSIGN_DOCUMENT_JOBS,
};

const DISABLE_VALUES: Record<FeatureFlag, string | undefined> = {
    headlessDispatch: process.env.NEXT_PUBLIC_FEATURE_DISABLE_HEADLESS_DISPATCH,
    eformsignDocumentJobs: process.env.NEXT_PUBLIC_FEATURE_DISABLE_EFORMSIGN_DOCUMENT_JOBS,
};

/**
 * Default-on flags. The headless dispatch path is preferred — when the
 * backend can't deliver (Chromium missing, selector miss, eformsign 5xx), it
 * already returns `ok: false` and the call sites fall back to the existing
 * iframe modal automatically. Set the matching `_DISABLE_` env var to opt out
 * if a deploy needs the iframe path forced on without rebuilding.
 */
const FLAG_DEFAULTS: Record<FeatureFlag, boolean> = {
    headlessDispatch: true,
    eformsignDocumentJobs: false,
};

function parseFlagList(): Set<string> {
    const raw = process.env.NEXT_PUBLIC_FEATURE_FLAGS ?? "";
    return new Set(
        raw
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
    );
}

const ENABLED_LIST = parseFlagList();

function isTruthyEnv(value: string | undefined): boolean {
    if (!value) return false;
    return value === "1" || value.toLowerCase() === "true";
}

export function isFeatureEnabled(flag: FeatureFlag): boolean {
    // Explicit disable wins.
    if (isTruthyEnv(DISABLE_VALUES[flag])) {
        return false;
    }
    if (ENABLED_LIST.has(flag)) return true;
    if (isTruthyEnv(ENABLE_VALUES[flag])) return true;
    return FLAG_DEFAULTS[flag] ?? false;
}

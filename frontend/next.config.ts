import path from "path";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

function readPositiveInt(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

const localBuildCpus = readPositiveInt(process.env.NEXT_BUILD_CPUS) ?? (process.env.CI ? undefined : 2);
const localStaticGenerationMaxConcurrency =
    readPositiveInt(process.env.NEXT_STATIC_GENERATION_MAX_CONCURRENCY) ?? (process.env.CI ? undefined : 1);
const sentryRelease = process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA;

const nextConfig: NextConfig = {
    env: {
        NEXT_PUBLIC_SENTRY_RELEASE: sentryRelease,
    },
    // Workspace package ships TS source; Next transpiles it in-app.
    transpilePackages: ["@babyjamjam/shared"],
    turbopack: {
        root: path.resolve(__dirname, ".."),
    },
    experimental: {
        optimizePackageImports: ["lucide-react", "react-icons"],
        ...(localBuildCpus ? { cpus: localBuildCpus } : {}),
        ...(localStaticGenerationMaxConcurrency
            ? { staticGenerationMaxConcurrency: localStaticGenerationMaxConcurrency }
            : {}),
    },
};

const hasSentryBuildCredentials = Boolean(
    process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default withSentryConfig(nextConfig, {
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    silent: !process.env.CI || !hasSentryBuildCredentials,
    widenClientFileUpload: true,
    sourcemaps: {
        deleteSourcemapsAfterUpload: true,
    },
    tunnelRoute: "/monitoring",
    telemetry: false,
});

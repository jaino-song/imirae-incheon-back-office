import path from "path";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import packageJson from "./package.json";

const sentryRelease = process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA;

const nextConfig: NextConfig = {
    env: {
        NEXT_PUBLIC_APP_VERSION: packageJson.version,
        NEXT_PUBLIC_SENTRY_RELEASE: sentryRelease,
    },
    // Workspace package ships TS source; Next transpiles it in-app.
    transpilePackages: ["@babyjamjam/shared"],
    // Testing on a real phone means loading the dev server over the LAN, and Next
    // blocks dev resources from any origin it was not told about — the page renders
    // but never hydrates. Set NEXT_DEV_ALLOWED_ORIGINS to the machine's LAN IP.
    allowedDevOrigins: (process.env.NEXT_DEV_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    turbopack: {
        root: path.resolve(__dirname, ".."),
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

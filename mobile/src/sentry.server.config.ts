import * as Sentry from "@sentry/nextjs";

import { getSentryRuntimeOptions } from "./lib/observability/sentry-config";

Sentry.init({
  ...getSentryRuntimeOptions(),
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN),
});

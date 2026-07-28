import * as Sentry from "@sentry/nestjs";

import { getSentryOptions } from "./infrastructure/observability/service-record-sentry";

Sentry.init(getSentryOptions());

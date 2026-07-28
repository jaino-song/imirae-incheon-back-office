import type { Breadcrumb, ErrorEvent, Event } from "@sentry/nextjs";

type SentryTransactionEvent = Event & { type: "transaction" };

const FILTERED_VALUE = "[Filtered]";
const SENTRY_APP_TAG = "mobile";
const MAX_SANITIZE_DEPTH = 3;

export const SERVICE_RECORD_SENTRY_FEATURE = "service-records";
export const SERVICE_RECORD_SENTRY_TAG = "feature";

const SENSITIVE_FIELD_PATTERN =
  /authorization|cookie|password|token|secret|api[_-]?key|email|phone|mobile|address|birth|resident|content|message|body/i;
const URL_FIELD_PATTERN = /(^|[._-])(url|uri)([._-]|$)/i;
const QUERY_FIELD_PATTERN = /(^|[._-])query(?:_string)?([._-]|$)/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+?82[-\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g;
const BEARER_PATTERN = /(bearer\s+)[^\s,;]+/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /((?:password|token|secret|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi;
const SERVICE_RECORD_ACCESS_TOKEN_PATTERN =
  /(\/(?:api\/)?service-record\/(?:link\/)?)[^/?#\s]+/gi;
const SERVICE_RECORD_RESOURCE_ID_PATTERN =
  /(\/(?:api\/)?(?:admin\/service-records\/(?:client|schedules)|schedule-change-requests\/schedules)\/)[^/?#\s]+/gi;
const SERVICE_RECORD_SESSION_ID_PATTERN =
  /(\/(?:api\/)?service-record\/[^/?#\s]+\/sessions\/)[^/?#\s]+/gi;
const UUID_PATH_SEGMENT_PATTERN =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi;
const SERVICE_RECORD_SIGNAL_PATTERN =
  /service-record(?:s)?|service_record(?:s)?|service-feedback|service_feedback/i;

function readSampleRate(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export function getSentryEnvironment(): "dev" | "preview" | "production" {
  const value =
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT
    ?? process.env.VERCEL_ENV
    ?? process.env.NODE_ENV;

  if (value === "production") return "production";
  if (value === "preview") return "preview";
  return "dev";
}

export function sanitizeSentryText(value: string): string {
  return value
    .replace(BEARER_PATTERN, `$1${FILTERED_VALUE}`)
    .replace(SECRET_ASSIGNMENT_PATTERN, `$1${FILTERED_VALUE}`)
    .replace(EMAIL_PATTERN, "[Email]")
    .replace(PHONE_PATTERN, "[Phone]")
    .replace(SERVICE_RECORD_ACCESS_TOKEN_PATTERN, `$1${FILTERED_VALUE}`)
    .replace(SERVICE_RECORD_RESOURCE_ID_PATTERN, `$1${FILTERED_VALUE}`)
    .replace(SERVICE_RECORD_SESSION_ID_PATTERN, `$1${FILTERED_VALUE}`)
    .replace(UUID_PATH_SEGMENT_PATTERN, `/${FILTERED_VALUE}`);
}

export function sanitizeSentryUrl(value: string | undefined): string | undefined {
  if (!value) return value;

  try {
    const baseUrl = "https://sentry.local";
    const parsed = new URL(value, baseUrl);
    const path = sanitizeSentryText(parsed.pathname).replace(
      SERVICE_RECORD_ACCESS_TOKEN_PATTERN,
      `$1${FILTERED_VALUE}`,
    );
    return parsed.origin === baseUrl ? path : `${parsed.origin}${path}`;
  } catch {
    return sanitizeSentryText(value.split(/[?#]/, 1)[0] ?? value).replace(
      SERVICE_RECORD_ACCESS_TOKEN_PATTERN,
      `$1${FILTERED_VALUE}`,
    );
  }
}

export function isServiceRecordSentrySignal(value: string | undefined): boolean {
  if (!value) return false;
  return SERVICE_RECORD_SIGNAL_PATTERN.test(value.split(/[?#]/, 1)[0] ?? value);
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return sanitizeSentryText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_SANITIZE_DEPTH) return FILTERED_VALUE;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item, depth + 1));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeSentryText(value.message),
    };
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => {
      if (SENSITIVE_FIELD_PATTERN.test(key) || QUERY_FIELD_PATTERN.test(key)) {
        return [key, FILTERED_VALUE];
      }
      if (URL_FIELD_PATTERN.test(key) && typeof nestedValue === "string") {
        return [key, sanitizeSentryUrl(nestedValue)];
      }
      return [key, sanitizeUnknown(nestedValue, depth + 1)];
    }),
  );
}

function sanitizeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return headers;

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_FIELD_PATTERN.test(key) ? FILTERED_VALUE : sanitizeSentryText(value),
    ]),
  );
}

export function sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return {
    ...breadcrumb,
    message: breadcrumb.message ? sanitizeSentryText(breadcrumb.message) : breadcrumb.message,
    data: breadcrumb.data
      ? (sanitizeUnknown(breadcrumb.data) as Record<string, unknown>)
      : breadcrumb.data,
  };
}

export function sanitizeSentryEvent(event: Event): Event {
  return {
    ...event,
    message: event.message ? "Service-record error" : event.message,
    transaction: event.transaction
      ? sanitizeSentryText(event.transaction.replace(/[?#].*$/, ""))
      : event.transaction,
    user: undefined,
    request: event.request
      ? {
          ...event.request,
          url: sanitizeSentryUrl(event.request.url),
          data: undefined,
          query_string: undefined,
          cookies: undefined,
          headers: sanitizeHeaders(event.request.headers),
        }
      : event.request,
    logentry: event.logentry
      ? {
          message: event.logentry.message ? "Service-record error" : event.logentry.message,
          params: undefined,
        }
      : event.logentry,
    exception: event.exception
      ? {
          ...event.exception,
          values: event.exception.values?.map((exception) => ({
            ...exception,
            value: exception.value ? "Service-record error" : exception.value,
          })),
        }
      : event.exception,
    breadcrumbs: undefined,
    extra: event.extra ? (sanitizeUnknown(event.extra) as Record<string, unknown>) : event.extra,
    spans: event.spans?.map((span) => ({
      ...span,
      description: span.op ?? "service-record span",
      data: {},
    })),
  };
}

function hasServiceRecordStackFrame(event: Event): boolean {
  return Boolean(
    event.exception?.values?.some((exception) =>
      exception.stacktrace?.frames?.some((frame) =>
        [frame.filename, frame.function, frame.module].some((value) =>
          isServiceRecordSentrySignal(value),
        ),
      ),
    ),
  );
}

export function isServiceRecordSentryEvent(event: Event): boolean {
  if (event.tags?.[SERVICE_RECORD_SENTRY_TAG] === SERVICE_RECORD_SENTRY_FEATURE) {
    return true;
  }

  return [
    event.transaction,
    event.request?.url,
    event.message,
    event.logentry?.message,
  ].some((value) => isServiceRecordSentrySignal(value))
    || hasServiceRecordStackFrame(event);
}

function filterAndSanitizeSentryErrorEvent(event: ErrorEvent): ErrorEvent | null {
  if (!isServiceRecordSentryEvent(event)) return null;
  return sanitizeSentryEvent(event) as ErrorEvent;
}

function filterAndSanitizeSentryTransactionEvent(
  event: SentryTransactionEvent,
): SentryTransactionEvent | null {
  if (!isServiceRecordSentryEvent(event)) return null;
  return sanitizeSentryEvent(event) as SentryTransactionEvent;
}

export function getSentryRuntimeOptions() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const environment = getSentryEnvironment();
  const tracesSampleRate = readSampleRate(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    environment === "production" ? 0.1 : 1,
  );

  return {
    dsn,
    enabled: Boolean(dsn),
    environment,
    release:
      process.env.NEXT_PUBLIC_SENTRY_RELEASE
      ?? process.env.SENTRY_RELEASE
      ?? process.env.VERCEL_GIT_COMMIT_SHA,
    sampleRate: 1,
    tracesSampler: ({
      name,
      inheritOrSampleWith,
    }: {
      name: string;
      inheritOrSampleWith: (sampleRate: number) => number;
    }) => (
      isServiceRecordSentrySignal(name)
        ? inheritOrSampleWith(tracesSampleRate)
        : 0
    ),
    sendDefaultPii: false,
    attachStacktrace: true,
    initialScope: {
      tags: {
        app: SENTRY_APP_TAG,
        runtime: typeof window === "undefined" ? "server" : "browser",
      },
    },
    beforeBreadcrumb: sanitizeSentryBreadcrumb,
    beforeSend: filterAndSanitizeSentryErrorEvent,
    beforeSendTransaction: filterAndSanitizeSentryTransactionEvent,
  };
}

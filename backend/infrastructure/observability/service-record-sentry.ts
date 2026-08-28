import { HttpException } from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import type {
    ErrorEvent,
    Event,
    EventHint,
    NodeOptions,
} from "@sentry/nestjs";
import type { DatabaseConnectionMode } from "infrastructure/database/prisma-url.utils";

const FILTERED_VALUE = "[Filtered]";
const MAX_SANITIZE_DEPTH = 3;
const reportedErrors = new WeakSet<object>();
const reportedPrismaErrors = new WeakSet<object>();

export const SERVICE_RECORD_FEATURE = "service-records";
export const DATABASE_FAILOVER_FEATURE = "database-failover";

export interface PrismaSentryErrorContext {
    code: string;
    eligible: boolean;
    route: DatabaseConnectionMode;
}

export type ServiceRecordOperation =
    | "public-link"
    | "verify"
    | "context"
    | "save-header"
    | "save-session"
    | "submit-session"
    | "finalize"
    | "schedule-change"
    | "auto-finalize"
    | "snapshot-create"
    | "webhook"
    | "link-schedule";

export interface ServiceRecordErrorContext {
    operation: ServiceRecordOperation;
    handled: boolean;
    statusCode?: number;
    caseId?: string;
    scheduleId?: number;
    retryCount?: number;
    smokeTest?: boolean;
}

function normalizeDatabaseEnvironment(value: string | undefined): string | undefined {
    return value === "dev" || value === "preview" || value === "production"
        ? value
        : undefined;
}

function getDatabaseTagValue(tags: NonNullable<Event["tags"]>, key: string): string | undefined {
    const value = tags[key];
    return typeof value === "string" ? value : undefined;
}

function normalizeDatabaseRoute(value: string | undefined): DatabaseConnectionMode | undefined {
    return value === "shared" || value === "direct" ? value : undefined;
}

function normalizePrismaCode(value: string | undefined): string {
    return value && /^P\d{4}$/.test(value) ? value : "unknown";
}

function getDatabaseFailoverTags(event: Event): Record<string, string> {
    const sourceTags = event.tags ?? {};
    const tags: Record<string, string> = {
        feature: DATABASE_FAILOVER_FEATURE,
        "db.failover_eligible": getDatabaseTagValue(sourceTags, "db.failover_eligible") === "true"
            ? "true"
            : "false",
        "prisma.code": normalizePrismaCode(getDatabaseTagValue(sourceTags, "prisma.code")),
    };
    const environment = normalizeDatabaseEnvironment(getDatabaseTagValue(sourceTags, "environment"));
    const route = normalizeDatabaseRoute(getDatabaseTagValue(sourceTags, "db.route"));

    if (environment) tags["environment"] = environment;
    if (route) tags["db.route"] = route;

    return tags;
}

export function isDatabaseFailoverEvent(event: Event): boolean {
    const eligibleTag = event.tags?.["db.failover_eligible"];
    return event.tags?.["feature"] === DATABASE_FAILOVER_FEATURE
        && (eligibleTag === "true" || eligibleTag === "false");
}

const SENSITIVE_FIELD_PATTERN =
    /authorization|cookie|password|token|secret|api[_-]?key|email|phone|mobile|address|birth|resident|signature|document|content|message|body|query/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+?82[-\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g;
const BEARER_PATTERN = /(bearer\s+)[^\s,;]+/gi;
const SERVICE_RECORD_TOKEN_PATTERN =
    /(\/(?:api\/)?service-record\/link\/)[^/?#\s]+/gi;
const SERVICE_RECORD_RESOURCE_ID_PATTERN =
    /(\/(?:api\/)?(?:admin\/service-records\/(?:client|schedules)|schedule-change-requests\/schedules)\/)[^/?#\s]+/gi;
const SERVICE_RECORD_SESSION_ID_PATTERN =
    /(\/(?:api\/)?service-record\/sessions\/)[^/?#\s]+/gi;
const UUID_PATH_SEGMENT_PATTERN =
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi;
const SERVICE_RECORD_SIGNAL_PATTERN =
    /service-record(?:s)?|service_record(?:s)?|service-feedback|service_feedback/i;
const SCHEDULE_CHANGE_PATTERN =
    /\/schedule-change-requests\/schedules\/[^/]+\/(?:preview|apply)(?:\/|$)/i;

function sanitizeText(value: string): string {
    return value
        .replace(BEARER_PATTERN, `$1${FILTERED_VALUE}`)
        .replace(EMAIL_PATTERN, "[Email]")
        .replace(PHONE_PATTERN, "[Phone]")
        .replace(SERVICE_RECORD_TOKEN_PATTERN, `$1${FILTERED_VALUE}`)
        .replace(SERVICE_RECORD_RESOURCE_ID_PATTERN, `$1${FILTERED_VALUE}`)
        .replace(SERVICE_RECORD_SESSION_ID_PATTERN, `$1${FILTERED_VALUE}`)
        .replace(UUID_PATH_SEGMENT_PATTERN, `/${FILTERED_VALUE}`);
}

export function sanitizeSentryUrl(value: string | undefined): string | undefined {
    if (!value) return value;
    try {
        const baseUrl = "https://sentry.local";
        const parsed = new URL(value, baseUrl);
        const path = sanitizeText(parsed.pathname);
        return parsed.origin === baseUrl ? path : `${parsed.origin}${path}`;
    } catch {
        return sanitizeText(value.split(/[?#]/, 1)[0] ?? value);
    }
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
    if (typeof value === "string") return sanitizeText(value);
    if (value === null || typeof value !== "object") return value;
    if (depth >= MAX_SANITIZE_DEPTH) return FILTERED_VALUE;
    if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item, depth + 1));
    if (value instanceof Error) return { name: value.name, message: sanitizeText(value.message) };

    return Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [
            key,
            SENSITIVE_FIELD_PATTERN.test(key)
                ? FILTERED_VALUE
                : sanitizeUnknown(nestedValue, depth + 1),
        ]),
    );
}

function sanitizeHeaders(
    headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
    if (!headers) return headers;
    return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [
            key,
            SENSITIVE_FIELD_PATTERN.test(key) ? FILTERED_VALUE : sanitizeText(value),
        ]),
    );
}

export function sanitizeSentryEvent(event: Event): Event {
    const databaseFailoverEvent = isDatabaseFailoverEvent(event);
    const sanitizedFailureMessage = databaseFailoverEvent
        ? "Database connectivity failure"
        : "Service-record backend failure";
    const tags = databaseFailoverEvent ? getDatabaseFailoverTags(event) : event.tags;

    return {
        ...event,
        tags,
        message: event.message ? sanitizedFailureMessage : event.message,
        transaction: databaseFailoverEvent
            ? undefined
            : event.transaction
            ? sanitizeText(event.transaction.replace(/[?#].*$/, ""))
            : event.transaction,
        user: undefined,
        request: databaseFailoverEvent
            ? undefined
            : event.request
            ? {
                ...event.request,
                url: sanitizeSentryUrl(event.request.url),
                data: undefined,
                query_string: undefined,
                cookies: undefined,
                headers: sanitizeHeaders(event.request.headers),
            }
            : event.request,
        exception: event.exception
            ? {
                ...event.exception,
                values: event.exception.values?.map((exception) => ({
                    ...exception,
                    value: exception.value ? sanitizedFailureMessage : exception.value,
                })),
            }
            : event.exception,
        breadcrumbs: undefined,
        contexts: databaseFailoverEvent
            ? undefined
            : event.contexts
            ? sanitizeUnknown(event.contexts) as Event["contexts"]
            : event.contexts,
        extra: databaseFailoverEvent
            ? undefined
            : event.extra
            ? sanitizeUnknown(event.extra) as Record<string, unknown>
            : event.extra,
        spans: event.spans?.map((span) => ({
            ...span,
            description: span.op ?? "service-record span",
            data: {},
        })),
    };
}

export function isServiceRecordSignal(value: string | undefined): boolean {
    if (!value) return false;
    const path = value.split(/[?#]/, 1)[0] ?? value;
    return SERVICE_RECORD_SIGNAL_PATTERN.test(path) || SCHEDULE_CHANGE_PATTERN.test(path);
}

export function getServiceRecordOperation(path: string): ServiceRecordOperation {
    if (path.includes("/verify")) return "verify";
    if (path.includes("/context")) return "context";
    if (path.includes("/header")) return "save-header";
    if (path.includes("/schedule-change")) return "schedule-change";
    if (path.includes("/finalize")) return "finalize";
    if (path.includes("/sessions/") && path.includes("/submit")) return "submit-session";
    if (path.includes("/sessions/")) return "save-session";
    if (path.includes("/admin/service-records")) return "public-link";
    return "public-link";
}

function hasServiceRecordStack(event: Event): boolean {
    return Boolean(event.exception?.values?.some((exception) =>
        exception.stacktrace?.frames?.some((frame) =>
            [frame.filename, frame.function, frame.module].some(isServiceRecordSignal),
        ),
    ));
}

export function isServiceRecordEvent(event: Event): boolean {
    if (event.tags?.["feature"] === SERVICE_RECORD_FEATURE) return true;
    return [
        event.transaction,
        event.request?.url,
        event.message,
    ].some(isServiceRecordSignal) || hasServiceRecordStack(event);
}

function getStatusCode(event: Event, hint: EventHint): number | undefined {
    if (hint.originalException instanceof HttpException) {
        return hint.originalException.getStatus();
    }
    const taggedStatus = Number(event.tags?.["status_code"]);
    return Number.isFinite(taggedStatus) ? taggedStatus : undefined;
}

export function filterAndSanitizeSentryEvent(
    event: ErrorEvent,
    hint: EventHint = {},
): ErrorEvent | null {
    const databaseFailoverEvent = isDatabaseFailoverEvent(event);
    const serviceRecordEvent = isServiceRecordEvent(event);
    if (!serviceRecordEvent && !databaseFailoverEvent) return null;
    const statusCode = getStatusCode(event, hint);
    if (serviceRecordEvent && statusCode !== undefined && statusCode < 500) return null;
    return sanitizeSentryEvent(event) as ErrorEvent;
}

export function getSentryEnvironment(): "dev" | "preview" | "production" {
    const value = process.env["SENTRY_ENVIRONMENT"] ?? process.env["RAILWAY_ENVIRONMENT_NAME"];
    if (value === "production") return "production";
    if (value === "preview") return "preview";
    return "dev";
}

export function getSentryOptions(): NodeOptions {
    const environment = getSentryEnvironment();
    return {
        dsn: process.env["SENTRY_DSN"],
        enabled: Boolean(process.env["SENTRY_DSN"]),
        environment,
        release: process.env["SENTRY_RELEASE"] ?? process.env["RAILWAY_GIT_COMMIT_SHA"],
        sampleRate: 1,
        tracesSampler: (samplingContext) => {
            if (!isServiceRecordSignal(samplingContext.name)) return 0;
            return environment === "production" ? 0.1 : 1;
        },
        sendDefaultPii: false,
        attachStacktrace: true,
        initialScope: {
            tags: {
                app: "backend",
                runtime: "node",
            },
        },
        beforeSend: filterAndSanitizeSentryEvent,
        beforeSendTransaction: (event) => {
            if (!isServiceRecordEvent(event)) return null;
            return sanitizeSentryEvent(event) as typeof event;
        },
    };
}

export function captureServiceRecordError(
    error: unknown,
    context: ServiceRecordErrorContext,
): string | undefined {
    if (typeof error === "object" && error !== null) {
        if (reportedErrors.has(error)) return undefined;
        reportedErrors.add(error);
    }

    const sourceError = error instanceof Error ? error : new Error(String(error));
    const capturedError = Object.assign(
        new Error(`Service-record ${context.operation} failed`),
        { name: sourceError.name },
    );
    if (sourceError.stack) {
        capturedError.stack = [
            capturedError.toString(),
            ...sourceError.stack.split("\n").slice(1),
        ].join("\n");
    }
    return Sentry.withScope((scope) => {
        scope.setLevel("error");
        scope.setTag("feature", SERVICE_RECORD_FEATURE);
        scope.setTag("app", "backend");
        scope.setTag("runtime", "node");
        scope.setTag("operation", context.operation);
        scope.setTag("handled", String(context.handled));
        if (context.statusCode !== undefined) {
            scope.setTag("status_code", String(context.statusCode));
        }
        if (context.smokeTest) scope.setTag("smoke_test", "true");
        scope.setContext("serviceRecord", {
            operation: context.operation,
            caseId: context.caseId,
            scheduleId: context.scheduleId,
            retryCount: context.retryCount,
        });
        scope.setFingerprint(["{{ default }}", context.operation]);
        return Sentry.captureException(capturedError);
    });
}

export function capturePrismaError(
    error: unknown,
    context: PrismaSentryErrorContext,
): string | undefined {
    if (typeof error === "object" && error !== null) {
        if (reportedPrismaErrors.has(error)) return undefined;
        reportedPrismaErrors.add(error);
    }

    const capturedError = new Error("Database connectivity failure");
    capturedError.name = "Prisma database error";

    return Sentry.withScope((scope) => {
        scope.setLevel("error");
        scope.setTag("feature", DATABASE_FAILOVER_FEATURE);
        scope.setTag("environment", getSentryEnvironment());
        scope.setTag("db.route", normalizeDatabaseRoute(context.route) ?? "unknown");
        scope.setTag("db.failover_eligible", String(context.eligible));
        scope.setTag("prisma.code", normalizePrismaCode(context.code));
        return Sentry.captureException(capturedError);
    });
}

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
const reportedBackendErrors = new WeakSet<object>();

export const SERVICE_RECORD_FEATURE = "service-records";
export const DATABASE_FAILOVER_FEATURE = "database-failover";
export const BACKEND_FEATURE = "backend";

type ExceptionValue = NonNullable<NonNullable<Event["exception"]>["values"]>[number];
type Stacktrace = NonNullable<ExceptionValue["stacktrace"]>;
type StackFrame = NonNullable<Stacktrace["frames"]>[number];

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

export interface BackendErrorContext {
    handled: boolean;
    statusCode?: number;
    operation?: string;
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
    /authorization|cookie|password|token|secret|api[_-]?key|email|phone|mobile|address|birth|resident|signature|document|content|message|body|query|transcript|full[_-]?name|first[_-]?name|last[_-]?name|client[_-]?name|display[_-]?name|(?:^|[_-])name$/i;
const URL_FIELD_PATTERN = /(?:url|uri|href|endpoint|origin)$/i;
const CREDENTIAL_URL_PATTERN =
    /\b[a-z][a-z\d+.-]*:\/\/[^/\s:@]+:[^/\s@]+@[^\s"'<>]+/gi;
const SECRET_ASSIGNMENT_PATTERN =
    /((?:authorization|password|token|secret|api[_-]?key|client[_-]?secret)\s*[:=]\s*)[^\s,;]+/gi;
const DATABASE_CREDENTIAL_URL_PATTERN =
    /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+?82[-\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g;
const BEARER_PATTERN = /(bearer\s+)[^\s,;]+/gi;
const SERVICE_RECORD_TOKEN_PATTERN =
    /(\/(?:api\/)?service-record\/link\/)[^/?#\s]+/gi;
// Constrained to the `efr_`/`efra_` token prefix (see receipt-link-token.service.ts) rather
// than a bare `[^/?#\s]+` segment: the sibling admin route `/receipt-links/send` has no token
// segment, and a generic match would wrongly redact the literal "send" path.
const RECEIPT_LINK_TOKEN_PATTERN =
    /(\/(?:api\/)?receipt(?:-links)?\/)efra?_[^/?#\s]*/gi;
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
const SAFE_TAG_KEYS = new Set([
    "app",
    "runtime",
    "environment",
    "feature",
    "operation",
    "job",
    "job_name",
    "job.name",
    "provider",
    "provider_request_id",
    "provider.request_id",
    "outcome",
    "correlation_id",
    "correlation.id",
    "handled",
    "status_code",
    "http.method",
    "http.status_code",
    "route",
    "smoke_test",
]);
const EXPECTED_TRACE_STATUSES = new Set([
    "already_exists",
    "aborted",
    "cancelled",
    "failed_precondition",
    "invalid_argument",
    "not_found",
    "out_of_range",
    "permission_denied",
    "unauthenticated",
]);

function sanitizeText(value: string): string {
    return value
        .replace(CREDENTIAL_URL_PATTERN, FILTERED_VALUE)
        .replace(DATABASE_CREDENTIAL_URL_PATTERN, FILTERED_VALUE)
        .replace(SECRET_ASSIGNMENT_PATTERN, `$1${FILTERED_VALUE}`)
        .replace(BEARER_PATTERN, `$1${FILTERED_VALUE}`)
        .replace(EMAIL_PATTERN, "[Email]")
        .replace(PHONE_PATTERN, "[Phone]")
        .replace(SERVICE_RECORD_TOKEN_PATTERN, `$1${FILTERED_VALUE}`)
        .replace(RECEIPT_LINK_TOKEN_PATTERN, `$1${FILTERED_VALUE}`)
        .replace(SERVICE_RECORD_RESOURCE_ID_PATTERN, `$1${FILTERED_VALUE}`)
        .replace(SERVICE_RECORD_SESSION_ID_PATTERN, `$1${FILTERED_VALUE}`)
        .replace(UUID_PATH_SEGMENT_PATTERN, `/${FILTERED_VALUE}`);
}

export function sanitizeSentryUrl(value: string | undefined): string | undefined {
    if (!value) return value;
    try {
        const baseUrl = "https://sentry.local";
        const parsed = new URL(value, baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return FILTERED_VALUE;
        }
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
    if (value instanceof Error) {
        return {
            name: sanitizeText(value.name),
            message: sanitizeText(value.message),
        };
    }

    return Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [
            key,
            SENSITIVE_FIELD_PATTERN.test(key)
                ? FILTERED_VALUE
                : URL_FIELD_PATTERN.test(key) && typeof nestedValue === "string"
                ? sanitizeSentryUrl(nestedValue)
                : sanitizeUnknown(nestedValue, depth + 1),
        ]),
    );
}

function sanitizeSentryTags(
    sourceTags: Event["tags"],
    feature: string,
): Record<string, string> {
    const tags: Record<string, string> = { feature };
    for (const [key, value] of Object.entries(sourceTags ?? {})) {
        if (!SAFE_TAG_KEYS.has(key) || key === "feature") continue;
        if (typeof value === "string") {
            tags[key] = sanitizeText(value);
        } else if (typeof value === "number" || typeof value === "boolean") {
            tags[key] = String(value);
        }
    }
    return tags;
}

function sanitizeHeaders(
    headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
    if (!headers) return headers;
    return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [
            key,
            SENSITIVE_FIELD_PATTERN.test(key)
                ? FILTERED_VALUE
                : typeof value === "string"
                ? sanitizeText(value)
                : FILTERED_VALUE,
        ]),
    );
}

function sanitizeStackFrame(frame: StackFrame): StackFrame {
    return {
        filename: frame.filename ? sanitizeText(frame.filename) : frame.filename,
        function: frame.function ? sanitizeText(frame.function) : frame.function,
        module: frame.module ? sanitizeText(frame.module) : frame.module,
        platform: frame.platform ? sanitizeText(frame.platform) : frame.platform,
        lineno: frame.lineno,
        colno: frame.colno,
        abs_path: frame.abs_path ? sanitizeText(frame.abs_path) : frame.abs_path,
        in_app: frame.in_app,
        instruction_addr: frame.instruction_addr
            ? sanitizeText(frame.instruction_addr)
            : frame.instruction_addr,
        addr_mode: frame.addr_mode ? sanitizeText(frame.addr_mode) : frame.addr_mode,
        debug_id: frame.debug_id ? sanitizeText(frame.debug_id) : frame.debug_id,
        context_line: undefined,
        pre_context: undefined,
        post_context: undefined,
        vars: undefined,
        module_metadata: undefined,
    };
}

function sanitizeStacktrace(stacktrace: Stacktrace): Stacktrace {
    return {
        frames: stacktrace.frames?.map(sanitizeStackFrame),
        frames_omitted: stacktrace.frames_omitted,
    };
}

function sanitizeExceptionValue(
    exception: ExceptionValue,
    sanitizedFailureMessage: string,
): ExceptionValue {
    const mechanism = exception.mechanism
        ? {
            type: sanitizeText(exception.mechanism.type),
            handled: exception.mechanism.handled,
            synthetic: exception.mechanism.synthetic,
            source: exception.mechanism.source
                ? sanitizeText(exception.mechanism.source)
                : exception.mechanism.source,
            is_exception_group: exception.mechanism.is_exception_group,
            exception_id: exception.mechanism.exception_id,
            parent_id: exception.mechanism.parent_id,
        }
        : exception.mechanism;

    return {
        type: exception.type ? sanitizeText(exception.type) : exception.type,
        value: exception.value ? sanitizedFailureMessage : exception.value,
        mechanism,
        module: exception.module ? sanitizeText(exception.module) : exception.module,
        thread_id: typeof exception.thread_id === "string"
            ? sanitizeText(exception.thread_id)
            : exception.thread_id,
        stacktrace: exception.stacktrace
            ? sanitizeStacktrace(exception.stacktrace)
            : exception.stacktrace,
    };
}

export function sanitizeSentryEvent(event: Event): Event {
    const databaseFailoverEvent = isDatabaseFailoverEvent(event);
    const serviceRecordEvent = isServiceRecordEvent(event);
    const feature = databaseFailoverEvent
        ? DATABASE_FAILOVER_FEATURE
        : serviceRecordEvent
        ? SERVICE_RECORD_FEATURE
        : BACKEND_FEATURE;
    const sanitizedFailureMessage = databaseFailoverEvent
        ? "Database connectivity failure"
        : serviceRecordEvent
        ? "Service-record backend failure"
        : "Backend failure";
    const tags = databaseFailoverEvent
        ? getDatabaseFailoverTags(event)
        : sanitizeSentryTags(event.tags, feature);

    return {
        ...event,
        tags,
        message: event.message ? sanitizedFailureMessage : event.message,
        logentry: event.logentry
            ? { message: sanitizedFailureMessage, params: undefined }
            : event.logentry,
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
                env: undefined,
                headers: sanitizeHeaders(event.request.headers),
            }
            : event.request,
        exception: event.exception
            ? {
                ...event.exception,
                values: event.exception.values?.map((exception) =>
                    sanitizeExceptionValue(exception, sanitizedFailureMessage)),
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
            description: span.op
                ? sanitizeText(span.op)
                : serviceRecordEvent
                ? "service-record span"
                : "backend span",
            data: {},
        })),
        fingerprint: event.fingerprint?.map((value) => sanitizeText(value)),
        server_name: undefined,
        modules: undefined,
        threads: undefined,
        debug_meta: undefined,
        sdkProcessingMetadata: undefined,
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

function parseStatusCode(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
    return undefined;
}

function getStatusCode(event: Event, hint: EventHint = {}): number | undefined {
    if (hint.originalException instanceof HttpException) {
        return hint.originalException.getStatus();
    }
    return parseStatusCode(event.tags?.["status_code"])
        ?? parseStatusCode(event.tags?.["http.status_code"])
        ?? parseStatusCode(event.contexts?.response?.status_code);
}

function isExpectedEvent(event: Event, hint: EventHint = {}): boolean {
    const statusCode = getStatusCode(event, hint);
    if (statusCode !== undefined && statusCode < 500) return true;
    const traceStatus = event.contexts?.trace?.status;
    return typeof traceStatus === "string" && EXPECTED_TRACE_STATUSES.has(traceStatus);
}

export function filterAndSanitizeSentryEvent(
    event: ErrorEvent,
    hint: EventHint = {},
): ErrorEvent | null {
    const databaseFailoverEvent = isDatabaseFailoverEvent(event);
    const serviceRecordEvent = isServiceRecordEvent(event);
    if (serviceRecordEvent && isExpectedEvent(event, hint)) return null;
    if (!databaseFailoverEvent && isExpectedEvent(event, hint)) return null;
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
        tracesSampler: () => {
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
        beforeSendTransaction: (event, hint) => {
            const databaseFailoverEvent = isDatabaseFailoverEvent(event);
            const serviceRecordEvent = isServiceRecordEvent(event);
            if (!databaseFailoverEvent && !serviceRecordEvent && isExpectedEvent(event, hint)) {
                return null;
            }
            return sanitizeSentryEvent(event) as typeof event;
        },
    };
}

export function captureBackendError(
    error: unknown,
    context: BackendErrorContext,
): string | undefined {
    if (typeof error === "object" && error !== null) {
        if (reportedBackendErrors.has(error)) return undefined;
        reportedBackendErrors.add(error);
    }

    const sourceError = error instanceof Error ? error : new Error("Backend failure");
    const capturedError = Object.assign(new Error("Backend failure"), {
        name: sourceError.name ? sanitizeText(sourceError.name) : "Backend error",
    });
    if (sourceError.stack) {
        capturedError.stack = [
            capturedError.toString(),
            ...sourceError.stack.split("\n").slice(1),
        ].join("\n");
    }

    return Sentry.withScope((scope) => {
        scope.setLevel("error");
        scope.setTag("feature", BACKEND_FEATURE);
        scope.setTag("app", "backend");
        scope.setTag("runtime", "node");
        scope.setTag("operation", context.operation ?? "http");
        scope.setTag("handled", String(context.handled));
        if (context.statusCode !== undefined) {
            scope.setTag("status_code", String(context.statusCode));
        }
        scope.setFingerprint(["{{ default }}", BACKEND_FEATURE]);
        return Sentry.captureException(capturedError);
    });
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

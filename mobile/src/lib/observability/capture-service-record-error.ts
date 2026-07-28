import * as Sentry from "@sentry/nextjs";
import type { AxiosError } from "axios";

import {
  isServiceRecordSentrySignal,
  sanitizeSentryText,
  sanitizeSentryUrl,
  SERVICE_RECORD_SENTRY_FEATURE,
  SERVICE_RECORD_SENTRY_TAG,
} from "./sentry-config";

export type ServiceRecordOperation =
  | "public-link"
  | "verify"
  | "context"
  | "save-header"
  | "save-session"
  | "submit-session"
  | "finalize"
  | "schedule-change"
  | "render";

interface ServiceRecordErrorContext {
  operation: ServiceRecordOperation;
  method?: string;
  path?: string;
  status?: number;
  code?: string;
}

const reportedErrors = new WeakSet<object>();

function isAxiosErrorLike(error: unknown): error is AxiosError {
  return (
    typeof error === "object"
    && error !== null
    && "isAxiosError" in error
    && error.isAxiosError === true
  );
}

function getRequestPath(url: string | undefined): string {
  if (!url) return "unknown";

  try {
    return new URL(url, "https://api.local").pathname;
  } catch {
    return url.split(/[?#]/, 1)[0] || "unknown";
  }
}

export function getServiceRecordOperation(path: string): ServiceRecordOperation {
  if (path.includes("/verify")) return "verify";
  if (path.includes("/context")) return "context";
  if (path.includes("/header")) return "save-header";
  if (path.includes("/schedule-change")) return "schedule-change";
  if (path.includes("/finalize")) return "finalize";
  if (path.includes("/sessions/") && path.includes("/submit")) return "submit-session";
  if (path.includes("/sessions/")) return "save-session";
  return "public-link";
}

export function captureServiceRecordError(
  error: unknown,
  context?: ServiceRecordErrorContext,
): boolean {
  if (typeof error === "object" && error !== null && reportedErrors.has(error)) return false;

  const axiosError = isAxiosErrorLike(error) ? error : null;
  if (axiosError?.code === "ERR_CANCELED") return false;

  const status = context?.status ?? axiosError?.response?.status;
  if (typeof status === "number" && status < 500) return false;

  const method = (
    context?.method
    ?? axiosError?.config?.method
    ?? "unknown"
  ).toUpperCase();
  const rawPath = context?.path ?? getRequestPath(axiosError?.config?.url);
  if (!context && !isServiceRecordSentrySignal(rawPath)) return false;

  if (typeof error === "object" && error !== null) {
    reportedErrors.add(error);
  }

  const path = sanitizeSentryUrl(rawPath) ?? "unknown";
  const statusLabel = status ? String(status) : "network";
  const operation = context?.operation ?? getServiceRecordOperation(rawPath);
  const capturedError = Object.assign(
    new Error(`Service-record ${operation} failed: ${method} ${path} (${statusLabel})`),
    { name: "ServiceRecordError" },
  );
  if (error instanceof Error && error.stack) {
    capturedError.stack = [
      capturedError.toString(),
      ...sanitizeSentryText(error.stack).split("\n").slice(1),
    ].join("\n");
  }

  Sentry.withScope((scope) => {
    scope.setLevel(status && status >= 500 ? "error" : "warning");
    scope.setTag(SERVICE_RECORD_SENTRY_TAG, SERVICE_RECORD_SENTRY_FEATURE);
    scope.setTag("app", "mobile");
    scope.setTag("runtime", typeof window === "undefined" ? "server" : "browser");
    scope.setTag("operation", operation);
    scope.setTag("handled", "true");
    scope.setTag("status_code", statusLabel);
    scope.setContext("serviceRecord", {
      operation,
      method,
      path,
      status: status ?? null,
      code: context?.code ?? axiosError?.code ?? null,
      runtime: typeof window === "undefined" ? "server" : "browser",
    });
    if (method !== "RENDER") {
      scope.setFingerprint(["service-record", operation, method, path, statusLabel]);
    }
    Sentry.captureException(capturedError);
  });
  return true;
}

export async function captureAndFlushServiceRecordError(error: unknown): Promise<void> {
  if (captureServiceRecordError(error)) {
    try {
      await Sentry.flush(2_000);
    } catch {
      // Observability must never replace the original proxy failure.
    }
  }
}

export function captureServiceRecordResponseError(
  response: Pick<Response, "status">,
  context: Omit<ServiceRecordErrorContext, "status">,
): void {
  if (response.status < 500) return;

  captureServiceRecordError(
    new Error(`Service-record request returned ${response.status}`),
    { ...context, status: response.status },
  );
}

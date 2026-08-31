import {
  CONTROLLER_BIND_HOST,
  CONTROLLER_PORT,
  ControllerConfigError,
  HEALTH_PATH,
  MAX_CONNECTIONS,
  REQUEST_TIMEOUT_MS,
  WEBHOOK_PATH,
  parseControllerConfig,
} from './config.mjs';
import {
  WebhookSecurityError,
  authenticateIssueAlertWebhook,
} from './security.mjs';

export const RECEIVER_MAX_BODY_BYTES = 64 * 1024;
export const RECEIVER_BODY_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
export const RECEIVER_MAX_CONNECTIONS = MAX_CONNECTIONS;

const JSON_CONTENT_TYPE = 'application/json';
export const HTTP_STATUS = Object.freeze({
  OK: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  REQUEST_TIMEOUT: 408,
  PAYLOAD_TOO_LARGE: 413,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
});

const STATE_ERROR_CODES = new Set([
  'STATE_INVALID',
  'STATE_NOT_FOUND',
  'STATE_PATH_INVALID',
  'STATE_OWNERSHIP_INVALID',
  'STATE_LOCK_UNAVAILABLE',
  'STALE_GENERATION',
  'STATE_PHASE_MISMATCH',
  'REPLAY_FINGERPRINT_EXISTS',
  'CONDITIONAL_STATE_WRITE_FAILED',
]);

const DNS_ERROR_CODES = new Set([
  'CONFIG_INVALID',
  'IP_INVALID',
  'IP_NOT_PUBLIC',
  'RECORD_NOT_FOUND',
  'RECORD_AMBIGUOUS',
  'DNS_DRIFT',
  'MANUAL_CHECK',
  'TIMEOUT',
  'NETWORK_ERROR',
]);

export class ReceiverError extends Error {
  constructor(code, statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE) {
    super(code);
    this.name = 'ReceiverError';
    this.code = code;
    this.statusCode = statusCode;
    this.blocked = statusCode >= HTTP_STATUS.SERVICE_UNAVAILABLE;
  }
}

function publicFailure(statusCode) {
  return { accepted: false, statusCode };
}

function publicSuccess(duplicate) {
  return { accepted: true, duplicate: duplicate === true };
}

function response(res, statusCode, body) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', `${JSON_CONTENT_TYPE}; charset=utf-8`);
  res.end(JSON.stringify(body));
}

function requestUrl(req) {
  if (typeof req?.url !== 'string' || req.url.length === 0 || req.url.length > 2_048) {
    throw new ReceiverError('REQUEST_URL_INVALID', HTTP_STATUS.BAD_REQUEST);
  }
  let parsed;
  try {
    parsed = new URL(req.url, `http://${CONTROLLER_BIND_HOST}:${CONTROLLER_PORT}`);
  } catch {
    throw new ReceiverError('REQUEST_URL_INVALID', HTTP_STATUS.BAD_REQUEST);
  }
  if (parsed.origin !== `http://${CONTROLLER_BIND_HOST}:${CONTROLLER_PORT}`) {
    throw new ReceiverError('REQUEST_URL_INVALID', HTTP_STATUS.NOT_FOUND);
  }
  if (parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new ReceiverError('REQUEST_URL_INVALID', HTTP_STATUS.NOT_FOUND);
  }
  return parsed.pathname;
}

function header(req, name) {
  const value = req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? undefined : value;
}

function requireJsonContentType(req) {
  const value = header(req, 'content-type');
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ReceiverError('CONTENT_TYPE_REQUIRED', HTTP_STATUS.BAD_REQUEST);
  }
  const mediaType = value.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== JSON_CONTENT_TYPE) {
    throw new ReceiverError('CONTENT_TYPE_REQUIRED', HTTP_STATUS.BAD_REQUEST);
  }
}

function declaredBodyLength(req) {
  const value = header(req, 'content-length');
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value)) throw new ReceiverError('CONTENT_LENGTH_INVALID', HTTP_STATUS.BAD_REQUEST);
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw new ReceiverError('CONTENT_LENGTH_INVALID', HTTP_STATUS.BAD_REQUEST);
  if (length > RECEIVER_MAX_BODY_BYTES) throw new ReceiverError('BODY_TOO_LARGE', HTTP_STATUS.PAYLOAD_TOO_LARGE);
  return length;
}

function readRequestBody(req) {
  const declaredLength = declaredBodyLength(req);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.resume?.();
      reject(new ReceiverError('REQUEST_TIMEOUT', HTTP_STATUS.REQUEST_TIMEOUT));
    }, RECEIVER_BODY_TIMEOUT_MS);

    const finish = (error, body) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(body);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      total += buffer.length;
      if (total > RECEIVER_MAX_BODY_BYTES) {
        req.resume?.();
        finish(new ReceiverError('BODY_TOO_LARGE', HTTP_STATUS.PAYLOAD_TOO_LARGE));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (declaredLength !== undefined && total !== declaredLength) {
        finish(new ReceiverError('CONTENT_LENGTH_MISMATCH', HTTP_STATUS.BAD_REQUEST));
        return;
      }
      finish(null, Buffer.concat(chunks, total).toString('utf8'));
    });
    req.on('aborted', () => finish(new ReceiverError('REQUEST_ABORTED', HTTP_STATUS.REQUEST_TIMEOUT)));
    req.on('error', () => finish(new ReceiverError('REQUEST_READ_FAILED', HTTP_STATUS.BAD_REQUEST)));
  });
}

function errorStatus(error) {
  if (error instanceof WebhookSecurityError) return error.statusCode;
  if (error instanceof ControllerConfigError) return HTTP_STATUS.SERVICE_UNAVAILABLE;
  if (error instanceof ReceiverError) return error.statusCode;
  if (error?.blocked === true || error?.retryable === true) return HTTP_STATUS.SERVICE_UNAVAILABLE;
  if (STATE_ERROR_CODES.has(error?.code) || DNS_ERROR_CODES.has(error?.code)) {
    return HTTP_STATUS.SERVICE_UNAVAILABLE;
  }
  return HTTP_STATUS.INTERNAL_ERROR;
}

function acceptedOutcome(value) {
  if (value === true) return { accepted: true, duplicate: false };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReceiverError('DURABLE_ACCEPT_REQUIRED');
  }
  const duplicate = value.duplicate === true;
  if (value.accepted !== true && !duplicate) {
    throw new ReceiverError('DURABLE_ACCEPT_REQUIRED');
  }
  return { accepted: true, duplicate };
}

function routeFor(req) {
  const method = typeof req?.method === 'string' ? req.method.toUpperCase() : '';
  const pathname = requestUrl(req);
  if (method === 'GET' && pathname === HEALTH_PATH) return 'health';
  if (method === 'POST' && pathname === WEBHOOK_PATH) return 'webhook';
  if (pathname === HEALTH_PATH || pathname === WEBHOOK_PATH) {
    throw new ReceiverError('METHOD_NOT_ALLOWED', HTTP_STATUS.METHOD_NOT_ALLOWED);
  }
  throw new ReceiverError('NOT_FOUND', HTTP_STATUS.NOT_FOUND);
}

function securityConfigFromController(config) {
  return {
    installationId: config.sentryInstallationId,
    organizationId: config.sentryOrganizationId,
    projectId: config.sentryProjectId,
    alertId: config.sentryAlertId,
    monitorId: config.sentryMonitorId,
    timestampToleranceMs: config.sentryTimestampToleranceMs,
  };
}

/**
 * Build the request handler. The injected acceptAuthenticatedEvent callback
 * must durably claim the event or explicitly report an idempotent duplicate
 * before this handler returns 202. This module never mutates DNS.
 */
export function createReceiverHandler({
  config,
  env,
  authenticate = authenticateIssueAlertWebhook,
  acceptAuthenticatedEvent,
  now = Date.now,
} = {}) {
  const resolvedConfig = config ?? parseControllerConfig(env);
  if (!resolvedConfig || typeof resolvedConfig !== 'object') throw new ControllerConfigError('CONFIG_INVALID');
  if (resolvedConfig.enabled && typeof acceptAuthenticatedEvent !== 'function') {
    throw new ControllerConfigError('CONFIG_ACCEPT_CALLBACK_REQUIRED');
  }
  if (typeof now !== 'function' && !(now instanceof Date) && !(typeof now === 'number' && Number.isFinite(now))) {
    throw new TypeError('now must be a function, Date, or finite number');
  }

  const accept = typeof acceptAuthenticatedEvent === 'function'
    ? acceptAuthenticatedEvent
    : async () => ({ accepted: false, duplicate: false });

  return async function receive(req, res) {
    let route;
    try {
      route = routeFor(req);
      if (route === 'health') {
        response(res, HTTP_STATUS.OK, { status: resolvedConfig.enabled ? 'ok' : 'disabled' });
        return;
      }
      if (!resolvedConfig.enabled) {
        await readRequestBody(req);
        response(res, HTTP_STATUS.SERVICE_UNAVAILABLE, publicFailure(HTTP_STATUS.SERVICE_UNAVAILABLE));
        return;
      }

      requireJsonContentType(req);
      const rawBody = await readRequestBody(req);
      const authResult = await authenticate({
        body: rawBody,
        headers: req.headers,
        clientSecret: resolvedConfig.sentryClientSecret,
        config: securityConfigFromController(resolvedConfig),
        now: typeof now === 'function' ? now() : now,
      });
      const outcome = acceptedOutcome(await accept(authResult));
      response(res, HTTP_STATUS.ACCEPTED, publicSuccess(outcome.duplicate));
    } catch (error) {
      const statusCode = errorStatus(error);
      req.resume?.();
      if (route === 'webhook' && !res.headersSent) {
        response(res, statusCode, publicFailure(statusCode));
      } else if (!res.headersSent) {
        response(res, statusCode, publicFailure(statusCode));
      }
    }
  };
}

export const createWebhookReceiver = createReceiverHandler;

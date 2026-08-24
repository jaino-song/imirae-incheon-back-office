import { randomUUID } from 'node:crypto';

import {
  ELIGIBLE_RESOURCE,
  FAILOVER_SIGNAL_CLASS,
  RECEIVER_DEADLINE_MS,
  RECEIVER_QUEUE_TIMEOUT_MS,
  safeLog,
} from './constants.mjs';
import {
  WebhookValidationError,
  extractRawBody,
  getEventTimestamp,
  getRequestHeader,
  isAllowedSentryEvent,
  isSafeIdentifier,
  isTimestampFresh,
  normalizeSentryEvent,
  parseWebhookJson,
  readReceiverConfig,
  verifySignature,
} from './security.mjs';

function response(statusCode, body = {}) {
  return {
    statusCode,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

function defaultLogger() {
  return {
    info(fields) {
      console.info(JSON.stringify(fields));
    },
    warn(fields) {
      console.warn(JSON.stringify(fields));
    },
    error(fields) {
      console.error(JSON.stringify(fields));
    },
  };
}

class ReceiverDeadlineError extends Error {
  constructor() {
    super('receiver deadline exceeded');
    this.name = 'ReceiverDeadlineError';
    this.code = 'RECEIVER_DEADLINE_EXCEEDED';
  }
}

function withRemainingBudget(operation, { controller, remainingMs }) {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    controller.abort();
    return Promise.reject(new ReceiverDeadlineError());
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ReceiverDeadlineError());
    }, remainingMs);
  });
  const promise = Promise.resolve().then(operation);
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function secretFromValue(value) {
  if (typeof value === 'string' && value.length > 0) {
    try {
      const parsed = JSON.parse(value);
      return secretFromValue(parsed);
    } catch {
      return value;
    }
  }
  if (value && typeof value === 'object') {
    for (const key of ['client_secret', 'clientSecret', 'secret', 'value']) {
      if (typeof value[key] === 'string' && value[key].length > 0) return value[key];
    }
  }
  return null;
}

export function buildQueueMessage(event, { requestId, receivedAt }) {
  const bodyFingerprint = event.bodyFingerprint ?? event.eventId;
  return {
    eventId: bodyFingerprint,
    bodyFingerprint,
    failoverEligible: true,
    signalClass: FAILOVER_SIGNAL_CLASS,
    action: event.action,
    resource: event.resource,
    environment: event.environment,
    ruleId: event.ruleId,
    eventAt: event.eventAt ?? event.signedTimestamp ?? null,
    requestId,
    receivedAt,
  };
}

export function createReceiverHandler({
  config = readReceiverConfig(),
  getClientSecret,
  sendMessage,
  queueUrl = process.env.FAILOVER_QUEUE_URL,
  now = () => Date.now(),
  idFactory = randomUUID,
  deadlineMs = RECEIVER_DEADLINE_MS,
  monotonicNow = () => performance.now(),
  queueTimeoutMs = RECEIVER_QUEUE_TIMEOUT_MS,
  logger = defaultLogger(),
} = {}) {
  if (typeof getClientSecret !== 'function') throw new TypeError('getClientSecret is required');
  if (typeof sendMessage !== 'function') throw new TypeError('sendMessage is required');
  const defaults = readReceiverConfig();
  const effectiveConfig = {
    ...defaults,
    ...config,
    allowedResources: Array.isArray(config?.allowedResources) ? config.allowedResources : defaults.allowedResources,
    allowedActions: Array.isArray(config?.allowedActions) ? config.allowedActions : defaults.allowedActions,
    allowedRoutes: Array.isArray(config?.allowedRoutes) ? config.allowedRoutes : defaults.allowedRoutes,
    ruleIds: Array.isArray(config?.ruleIds) ? config.ruleIds : defaults.ruleIds,
  };

  return async function receiverHandler(event, context = {}) {
    const startedAt = monotonicNow();
    const deadlineController = new AbortController();
    const remainingMs = () => Math.max(0, deadlineMs - (monotonicNow() - startedAt));
    const ensureBudget = () => {
      if (remainingMs() <= 0 || deadlineController.signal.aborted) {
        deadlineController.abort();
        throw new ReceiverDeadlineError();
      }
    };
    const receivedAt = now();
    const candidateRequestId = getRequestHeader(
      event?.headers,
      'request-id',
      'sentry-hook-request-id',
      'x-request-id',
    );
    const generatedRequestId = idFactory();
    const requestId = isSafeIdentifier(candidateRequestId)
      ? candidateRequestId
      : (isSafeIdentifier(context.awsRequestId)
        ? context.awsRequestId
        : (isSafeIdentifier(generatedRequestId) ? generatedRequestId : randomUUID()));
    let rawBody;
    try {
      ensureBudget();
      rawBody = extractRawBody(event);
      ensureBudget();
    } catch (error) {
      if (error instanceof ReceiverDeadlineError) {
        safeLog(logger, 'error', 'sentry_receiver_deadline_exceeded', { requestId });
        return response(504, { accepted: false });
      }
      const statusCode = error instanceof WebhookValidationError ? error.statusCode : 400;
      safeLog(logger, 'warn', 'sentry_webhook_rejected', { requestId, reason: error.code ?? 'invalid_body' });
      return response(statusCode, { accepted: false });
    }

    const signature = getRequestHeader(event?.headers, 'sentry-hook-signature');
    let clientSecret;
    try {
      ensureBudget();
      clientSecret = secretFromValue(await withRemainingBudget(
        () => getClientSecret({
          signal: deadlineController.signal,
          remainingMs: remainingMs(),
        }),
        { controller: deadlineController, remainingMs: remainingMs() },
      ));
      ensureBudget();
    } catch (error) {
      if (error instanceof ReceiverDeadlineError) {
        safeLog(logger, 'error', 'sentry_receiver_deadline_exceeded', { requestId });
        return response(504, { accepted: false });
      }
      safeLog(logger, 'error', 'sentry_secret_unavailable', { requestId });
      return response(503, { accepted: false });
    }
    if (!clientSecret) {
      safeLog(logger, 'error', 'sentry_secret_unavailable', { requestId });
      return response(503, { accepted: false });
    }
    try {
      ensureBudget();
    } catch {
      safeLog(logger, 'error', 'sentry_receiver_deadline_exceeded', { requestId });
      return response(504, { accepted: false });
    }
    if (!verifySignature(rawBody, signature, clientSecret)) {
      safeLog(logger, 'warn', 'sentry_webhook_rejected', { requestId, reason: 'invalid_signature' });
      return response(401, { accepted: false });
    }

    let payload;
    try {
      ensureBudget();
      payload = parseWebhookJson(rawBody);
      ensureBudget();
    } catch (error) {
      if (error instanceof ReceiverDeadlineError) {
        safeLog(logger, 'error', 'sentry_receiver_deadline_exceeded', { requestId });
        return response(504, { accepted: false });
      }
      safeLog(logger, 'warn', 'sentry_webhook_rejected', { requestId, reason: error.code ?? 'invalid_json' });
      return response(error.statusCode ?? 400, { accepted: false });
    }

    const timestampHeader = getRequestHeader(event?.headers, 'sentry-hook-timestamp');
    try {
      ensureBudget();
    } catch {
      safeLog(logger, 'error', 'sentry_receiver_deadline_exceeded', { requestId });
      return response(504, { accepted: false });
    }
    if (!timestampHeader) {
      safeLog(logger, 'warn', 'sentry_webhook_rejected', { requestId, reason: 'timestamp_required' });
      return response(401, { accepted: false });
    }
    const timestampMs = getEventTimestamp(payload, event?.headers);
    try {
      ensureBudget();
    } catch {
      safeLog(logger, 'error', 'sentry_receiver_deadline_exceeded', { requestId });
      return response(504, { accepted: false });
    }
    if (!isTimestampFresh(timestampMs, receivedAt)) {
      safeLog(logger, 'warn', 'sentry_webhook_rejected', { requestId, reason: 'stale_timestamp' });
      return response(401, { accepted: false });
    }

    const normalized = normalizeSentryEvent(payload, rawBody);
    normalized.timestamp = timestampMs;
    normalized.eventAt = normalized.signedTimestamp;
    try {
      ensureBudget();
    } catch {
      safeLog(logger, 'error', 'sentry_receiver_deadline_exceeded', { requestId });
      return response(504, { accepted: false });
    }
    const hookResource = getRequestHeader(event?.headers, 'sentry-hook-resource');
    if (!hookResource || hookResource !== ELIGIBLE_RESOURCE || !effectiveConfig.allowedResources.includes(ELIGIBLE_RESOURCE)) {
      safeLog(logger, 'info', 'sentry_webhook_ignored', { requestId, reason: 'resource_not_allowed' });
      return response(202, { accepted: false });
    }
    normalized.resource = hookResource;
    const allowlist = isAllowedSentryEvent(normalized, effectiveConfig);
    try {
      ensureBudget();
    } catch {
      safeLog(logger, 'error', 'sentry_receiver_deadline_exceeded', { requestId });
      return response(504, { accepted: false });
    }
    if (!allowlist.allowed) {
      safeLog(logger, 'info', 'sentry_webhook_ignored', {
        requestId,
        reason: allowlist.reason,
      });
      return response(202, { accepted: false });
    }

    if (!effectiveConfig.enabled) {
      safeLog(logger, 'info', 'sentry_webhook_disabled', { requestId });
      return response(202, { accepted: false });
    }

    if (typeof queueUrl !== 'string' || queueUrl.length === 0) {
      safeLog(logger, 'error', 'sentry_queue_unconfigured', { requestId });
      return response(503, { accepted: false });
    }

    const queueMessage = buildQueueMessage(normalized, {
      requestId,
      receivedAt,
    });
    try {
      ensureBudget();
      const queueBudget = Math.min(
        Number.isFinite(queueTimeoutMs) && queueTimeoutMs > 0 ? queueTimeoutMs : RECEIVER_QUEUE_TIMEOUT_MS,
        remainingMs(),
      );
      await withRemainingBudget(
        () => sendMessage({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(queueMessage),
          MessageGroupId: normalized.environment,
          MessageDeduplicationId: normalized.eventId,
        }, {
          abortSignal: deadlineController.signal,
          remainingMs: queueBudget,
        }),
        { controller: deadlineController, remainingMs: queueBudget },
      );
      ensureBudget();
    } catch (error) {
      safeLog(logger, 'error', 'sentry_queue_send_failed', {
        requestId,
        reason: error instanceof ReceiverDeadlineError ? 'timeout' : 'error',
      });
      return response(error instanceof ReceiverDeadlineError ? 504 : 503, { accepted: false });
    }

    safeLog(logger, 'info', 'sentry_webhook_enqueued', {
      requestId,
      eventId: normalized.eventId,
    });
    return response(202, { accepted: true, requestId });
  };
}

async function createDefaultReceiverHandler() {
  const [{ SQSClient, SendMessageCommand }, { SecretsManagerClient, GetSecretValueCommand }] = await Promise.all([
    import('@aws-sdk/client-sqs'),
    import('@aws-sdk/client-secrets-manager'),
  ]);
  const sqs = new SQSClient({});
  const secrets = new SecretsManagerClient({});
  const secretName = process.env.SENTRY_CLIENT_SECRET_NAME;
  const queueUrl = process.env.FAILOVER_QUEUE_URL;
  let cachedSecret;
  let cachedSecretExpiresAt = 0;
  return createReceiverHandler({
    queueUrl,
    getClientSecret: async ({ signal } = {}) => {
      const now = Date.now();
      if (cachedSecret && cachedSecretExpiresAt > now) return cachedSecret;
      const result = await secrets.send(new GetSecretValueCommand({ SecretId: secretName }), { abortSignal: signal });
      const secretValue = result.SecretString
        ?? (result.SecretBinary?.transformToString ? result.SecretBinary.transformToString() : null)
        ?? (result.SecretBinary ? Buffer.from(result.SecretBinary).toString('utf8') : null);
      const normalizedSecret = secretFromValue(secretValue);
      if (normalizedSecret) {
        cachedSecret = normalizedSecret;
        cachedSecretExpiresAt = now + 60_000;
      }
      return normalizedSecret;
    },
    sendMessage: (input, { abortSignal } = {}) => sqs.send(new SendMessageCommand(input), { abortSignal }),
  });
}

let defaultHandlerPromise;

export async function handler(event, context) {
  defaultHandlerPromise ??= createDefaultReceiverHandler();
  const receiver = await defaultHandlerPromise;
  return receiver(event, context);
}

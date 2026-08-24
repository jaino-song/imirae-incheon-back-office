import { randomUUID } from 'node:crypto';

import {
  ELIGIBLE_RESOURCE,
  FAILOVER_SIGNAL_CLASS,
  RECEIVER_DEADLINE_MS,
  RECEIVER_QUEUE_TIMEOUT_MS,
  WEBHOOK_TIMESTAMP_TOLERANCE_MS,
  safeLog,
} from './constants.mjs';
import {
  WebhookValidationError,
  extractRawBody,
  getHookTimestamp,
  getRequestHeader,
  getSignedEventTimestamp,
  isAllowedSentryEvent,
  isSafeIdentifier,
  isTimestampFresh,
  normalizeSentryEvent,
  parseWebhookJson,
  readReceiverConfig,
  verifySignature,
} from './security.mjs';
import { createDynamoReplayStore } from './state-store.mjs';

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

function safeFailureReason(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : 'internal_error';
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

function createReceiverDeadline({
  deadlineMs = RECEIVER_DEADLINE_MS,
  monotonicNow = () => performance.now(),
  startedAt,
  deadlineAt,
  deadlineController,
} = {}) {
  const controller = deadlineController ?? new AbortController();
  const start = Number.isFinite(startedAt) ? startedAt : monotonicNow();
  const end = Number.isFinite(deadlineAt) ? deadlineAt : start + deadlineMs;
  const remainingMs = () => Math.max(0, end - monotonicNow());
  const ensureBudget = () => {
    if (remainingMs() <= 0 || controller.signal.aborted) {
      controller.abort();
      throw new ReceiverDeadlineError();
    }
  };
  return {
    controller,
    startedAt: start,
    deadlineAt: end,
    remainingMs,
    ensureBudget,
  };
}

function isDeadlineExceeded(error, controller) {
  return error instanceof ReceiverDeadlineError || controller.signal.aborted;
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
  replayStore,
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
  if (
    !replayStore
    || typeof replayStore.hasProcessedFingerprint !== 'function'
    || typeof replayStore.claimReplayFingerprint !== 'function'
  ) {
    throw new TypeError('replay store is required');
  }
  const defaults = readReceiverConfig();
  const effectiveConfig = {
    ...defaults,
    ...config,
    allowedResources: Array.isArray(config?.allowedResources) ? config.allowedResources : defaults.allowedResources,
    allowedActions: Array.isArray(config?.allowedActions) ? config.allowedActions : defaults.allowedActions,
    allowedRoutes: Array.isArray(config?.allowedRoutes) ? config.allowedRoutes : defaults.allowedRoutes,
    ruleIds: Array.isArray(config?.ruleIds) ? config.ruleIds : defaults.ruleIds,
  };

  const receiverHandler = async function receiverHandler(event, context = {}, invocation = {}) {
    const deadline = createReceiverDeadline({
      deadlineMs,
      monotonicNow,
      startedAt: invocation?.startedAt,
      deadlineAt: invocation?.deadlineAt,
      deadlineController: invocation?.deadlineController,
    });
    const {
      controller: deadlineController,
      remainingMs,
      ensureBudget,
    } = deadline;
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
      if (isDeadlineExceeded(error, deadlineController)) {
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
      if (isDeadlineExceeded(error, deadlineController)) {
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
    const headerTimestampMs = getHookTimestamp(event?.headers);
    try {
      ensureBudget();
    } catch {
      safeLog(logger, 'error', 'sentry_receiver_deadline_exceeded', { requestId });
      return response(504, { accepted: false });
    }
    if (!isTimestampFresh(headerTimestampMs, receivedAt)) {
      safeLog(logger, 'warn', 'sentry_webhook_rejected', { requestId, reason: 'stale_header_timestamp' });
      return response(401, { accepted: false });
    }
    const normalized = normalizeSentryEvent(payload, rawBody);
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

    const signedTimestampMs = getSignedEventTimestamp(payload);
    if (!isTimestampFresh(signedTimestampMs, receivedAt)) {
      safeLog(logger, 'warn', 'sentry_webhook_rejected', { requestId, reason: 'stale_event_timestamp' });
      return response(401, { accepted: false });
    }
    if (Math.abs(headerTimestampMs - signedTimestampMs) > WEBHOOK_TIMESTAMP_TOLERANCE_MS) {
      safeLog(logger, 'warn', 'sentry_webhook_rejected', { requestId, reason: 'timestamp_mismatch' });
      return response(401, { accepted: false });
    }
    normalized.timestamp = signedTimestampMs;

    try {
      ensureBudget();
      const replayCheckBudget = remainingMs();
      if (effectiveConfig.enabled) {
        const alreadyRecorded = await withRemainingBudget(
          () => replayStore.hasProcessedFingerprint(normalized.bodyFingerprint, {
            abortSignal: deadlineController.signal,
            remainingMs: replayCheckBudget,
          }),
          { controller: deadlineController, remainingMs: replayCheckBudget },
        );
        ensureBudget();
        if (alreadyRecorded) {
          safeLog(logger, 'info', 'sentry_webhook_ignored', { requestId, reason: 'duplicate_event' });
          return response(202, { accepted: false });
        }
      } else {
        const recorded = await withRemainingBudget(
          () => replayStore.claimReplayFingerprint(normalized.bodyFingerprint, {
            abortSignal: deadlineController.signal,
            remainingMs: replayCheckBudget,
          }),
          { controller: deadlineController, remainingMs: replayCheckBudget },
        );
        ensureBudget();
        safeLog(logger, 'info', 'sentry_webhook_disabled', {
          requestId,
          replayRecorded: recorded === true,
        });
        return response(202, { accepted: false });
      }
    } catch (error) {
      if (isDeadlineExceeded(error, deadlineController)) {
        safeLog(logger, 'error', 'sentry_receiver_deadline_exceeded', { requestId });
        return response(504, { accepted: false });
      }
      safeLog(logger, 'error', 'sentry_replay_store_failed', { requestId });
      return response(503, { accepted: false });
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
        reason: isDeadlineExceeded(error, deadlineController) ? 'timeout' : 'error',
      });
      return response(isDeadlineExceeded(error, deadlineController) ? 504 : 503, { accepted: false });
    }

    safeLog(logger, 'info', 'sentry_webhook_enqueued', {
      requestId,
      eventId: normalized.eventId,
    });
    return response(202, { accepted: true, requestId });
  };

  return async function guardedReceiverHandler(event, context = {}, invocation = {}) {
    try {
      return await receiverHandler(event, context, invocation);
    } catch (error) {
      safeLog(logger, 'error', 'sentry_receiver_failed', {
        reason: safeFailureReason(error),
      });
      return response(503, { accepted: false });
    }
  };
}

async function createDefaultReceiverHandler({ signal } = {}) {
  const [
    { SQSClient, SendMessageCommand },
    { SecretsManagerClient, GetSecretValueCommand },
    { DynamoDBClient, GetItemCommand, PutItemCommand },
  ] = await Promise.all([
    import('@aws-sdk/client-sqs'),
    import('@aws-sdk/client-secrets-manager'),
    import('@aws-sdk/client-dynamodb'),
  ]);
  if (signal?.aborted) throw new ReceiverDeadlineError();
  const sqs = new SQSClient({});
  if (signal?.aborted) throw new ReceiverDeadlineError();
  const secrets = new SecretsManagerClient({});
  if (signal?.aborted) throw new ReceiverDeadlineError();
  const replayStore = createDynamoReplayStore({
    client: new DynamoDBClient({}),
    commands: { GetItemCommand, PutItemCommand },
    tableName: process.env.FAILOVER_STATE_TABLE_NAME,
  });
  const secretName = process.env.SENTRY_CLIENT_SECRET_NAME;
  const queueUrl = process.env.FAILOVER_QUEUE_URL;
  let cachedSecret;
  let cachedSecretExpiresAt = 0;
  return createReceiverHandler({
    replayStore,
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

function getDefaultReceiverHandler({ signal } = {}) {
  if (defaultHandlerPromise) return defaultHandlerPromise;
  const initialization = createDefaultReceiverHandler({ signal });
  const trackedInitialization = initialization.catch((error) => {
    if (defaultHandlerPromise === trackedInitialization) defaultHandlerPromise = undefined;
    throw error;
  });
  defaultHandlerPromise = trackedInitialization;
  return defaultHandlerPromise;
}

export async function handler(event, context) {
  const deadline = createReceiverDeadline();
  try {
    deadline.ensureBudget();
    const receiver = await withRemainingBudget(
      () => getDefaultReceiverHandler({ signal: deadline.controller.signal }),
      {
        controller: deadline.controller,
        remainingMs: deadline.remainingMs(),
      },
    );
    deadline.ensureBudget();
    return await receiver(event, context, {
      startedAt: deadline.startedAt,
      deadlineAt: deadline.deadlineAt,
      deadlineController: deadline.controller,
    });
  } catch (error) {
    if (isDeadlineExceeded(error, deadline.controller)) {
      deadline.controller.abort();
      return response(504, { accepted: false });
    }
    return response(503, { accepted: false });
  }
}

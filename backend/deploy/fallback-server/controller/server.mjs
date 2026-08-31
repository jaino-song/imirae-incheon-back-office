import * as http from 'node:http';

import {
  CONTROLLER_BIND_HOST,
  CONTROLLER_PORT,
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  MAX_CONNECTIONS,
  REQUEST_TIMEOUT_MS,
  parseControllerConfig,
} from './config.mjs';
import { createReceiverHandler } from './receiver.mjs';

const CLOSE_TIMEOUT_MS = 5_000;

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host, port });
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      else if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    }, CLOSE_TIMEOUT_MS);
    server.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });
}

function configureServer(server, config) {
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.maxConnections = MAX_CONNECTIONS;
  server.on('connection', (socket) => {
    socket.setTimeout(REQUEST_TIMEOUT_MS);
  });
  server.on('clientError', (errorSocket) => {
    errorSocket.destroy();
  });
  server.__controllerBindHost = config.bindHost;
  server.__controllerPort = config.port;
  return server;
}

/**
 * Construct (but do not start) the loopback controller server.
 *
 * `resumePending` is a worker-owned hook. The server calls it once at startup
 * and intentionally ignores its return value; startup never promotes a route
 * or performs a DNS operation.
 */
export function createControllerServer({
  config,
  env,
  acceptAuthenticatedEvent,
  resumePending = async () => {},
  now = Date.now,
  httpModule = http,
  serverFactory,
} = {}) {
  const resolvedConfig = config ?? parseControllerConfig(env);
  if (typeof resumePending !== 'function') {
    throw new TypeError('resumePending must be a function');
  }
  if (!httpModule || typeof httpModule.createServer !== 'function') {
    throw new TypeError('httpModule.createServer is required');
  }
  if (serverFactory !== undefined && typeof serverFactory !== 'function') {
    throw new TypeError('serverFactory must be a function');
  }

  const receiver = createReceiverHandler({
    config: resolvedConfig,
    acceptAuthenticatedEvent,
    now,
  });
  const server = configureServer(
    serverFactory ? serverFactory(receiver) : httpModule.createServer(receiver),
    resolvedConfig,
  );

  let started = false;
  let starting;

  async function start() {
    if (started) return controller;
    if (starting) return starting;
    starting = (async () => {
      // This hook may inspect and enqueue a persisted incident. Its result is
      // deliberately ignored so startup cannot promote a route.
      await resumePending();
      await listen(server, resolvedConfig.bindHost, resolvedConfig.port);
      started = true;
      return controller;
    })();
    try {
      return await starting;
    } finally {
      starting = undefined;
    }
  }

  async function stop() {
    await close(server);
    started = false;
  }

  const controller = Object.freeze({
    config: resolvedConfig,
    server,
    start,
    stop,
    address: () => server.address(),
  });

  return controller;
}

export const createServer = createControllerServer;

export async function startControllerServer(options = {}) {
  const controller = createControllerServer(options);
  await controller.start();
  return controller;
}

export const startServer = startControllerServer;

export {
  CONTROLLER_BIND_HOST,
  CONTROLLER_PORT,
  REQUEST_TIMEOUT_MS,
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  MAX_CONNECTIONS,
};

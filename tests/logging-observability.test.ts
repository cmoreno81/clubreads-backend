import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import test from 'node:test';

import pino from 'pino';

import {
  classifyError,
  logAt,
} from '../src/logging/logger.js';
import {
  globalErrorHandler,
  requestObservability,
  requestMetricsSnapshot,
  resetRequestMetrics,
} from '../src/middleware/request-observability.middleware.js';

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return {
    logger: pino({ base: undefined, timestamp: false }, stream),
    records: () => lines.flatMap((line) => line.trim() ? [JSON.parse(line)] : []),
  };
}

async function runRequest(options: {
  requestId?: string;
  action?: string;
  path?: string;
  status?: number;
  delayMs?: number;
}) {
  const capture = captureLogger();
  const response = new EventEmitter() as any;
  const headers = new Map<string, unknown>();
  response.locals = {};
  response.statusCode = options.status ?? 200;
  response.setHeader = (name: string, value: unknown) => headers.set(name.toLowerCase(), value);
  response.getHeader = (name: string) => headers.get(name.toLowerCase());
  const request = {
    method: 'GET', path: options.path ?? '/api',
    query: options.action ? { action: options.action } : {},
    get: (name: string) => name.toLowerCase() === 'x-request-id' ? options.requestId : undefined,
  } as any;
  await new Promise<void>((resolve) => {
    response.once('finish', resolve);
    requestObservability(capture.logger)(request, response, async () => {
      if (options.delayMs) await new Promise((done) => setTimeout(done, options.delayMs));
      headers.set('content-length', 11);
      response.emit('finish');
    });
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { records: capture.records(), requestId: headers.get('x-request-id') };
}

test('genera y propaga request ID y conserva uno entrante seguro', async () => {
  const generated = await runRequest({ requestId: 'no válido con espacios' });
  assert.match(String(generated.requestId), /^[0-9a-f-]{36}$/);
  const propagated = await runRequest({ requestId: 'mobile-safe_123' });
  assert.equal(propagated.requestId, 'mobile-safe_123');
  assert.equal(generated.records[0].requestId, generated.requestId);
});

test('registra acción segura, status, duración, entorno y tamaño', async () => {
  const { records } = await runRequest({ action: 'dashboardGeneral', status: 201 });
  const record = records.find(({ event }) => event === 'http_request');
  assert.equal(record.method, 'GET');
  assert.equal(record.action, 'dashboardGeneral');
  assert.equal(record.status, 201);
  assert.equal(typeof record.durationMs, 'number');
  assert.equal(record.environment, process.env.NODE_ENV || 'development');
  assert.equal(typeof record.responseBytes, 'number');
  assert.doesNotMatch(JSON.stringify(record), /private@example\.com/);
});

test('redacta cabeceras, tokens, contraseñas, códigos y emails', () => {
  const capture = captureLogger();
  logAt(capture.logger, 'error', {
    authorization: 'Bearer secret-token',
    accessToken: 'access-secret', refreshToken: 'refresh-secret',
    password: 'password-secret', code: '123456',
    email: 'member@example.com',
    err: new Error('falló member@example.com con Bearer secret-token'),
  }, 'redaction test');
  const output = JSON.stringify(capture.records());
  for (const secret of ['secret-token', 'access-secret', 'refresh-secret', 'password-secret', '123456', 'member@example.com']) {
    assert.doesNotMatch(output, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(output, /\[REDACTED\]/);
});

test('clasifica 4xx esperables y errores de infraestructura', () => {
  assert.equal(classifyError(undefined, 400), 'validation');
  assert.equal(classifyError(undefined, 401), 'authentication_authorization');
  assert.equal(classifyError(undefined, 403), 'authentication_authorization');
  assert.equal(classifyError(undefined, 429), 'rate_limiting');
  assert.equal(classifyError(new Error('Prisma database unavailable'), 500), 'postgresql_prisma');
  assert.equal(classifyError(new Error('fetch timeout'), 500), 'external_dependency');
  assert.equal(classifyError(new Error('boom'), 500), 'internal');
});

test('detecta peticiones lentas y el error global no filtra detalles', async () => {
  const previous = process.env.SLOW_REQUEST_MS;
  process.env.SLOW_REQUEST_MS = '1';
  try {
    const { records } = await runRequest({ path: '/slow', delayMs: 5 });
    const slow = records.find(({ route }) => route === '/slow');
    assert.equal(slow.slow, true);
    assert.equal(slow.level, 40);

    const capture = captureLogger();
    const response: any = {
      locals: { requestId: 'request-1' }, headersSent: false, statusCode: 200,
      status(value: number) { this.statusCode = value; return this; },
      json(value: unknown) { this.payload = value; return this; },
    };
    globalErrorHandler(capture.logger)(
      new Error('secret member@example.com'), {} as any, response, () => {},
    );
    assert.equal(response.statusCode, 500);
    assert.doesNotMatch(JSON.stringify(response.payload), /secret|member@example\.com|stack/i);
    const failure = capture.records().find(({ event }) => event === 'request_error');
    assert.equal(failure.category, 'internal');
    assert.doesNotMatch(JSON.stringify(failure), /member@example\.com/);
  } finally {
    if (previous === undefined) delete process.env.SLOW_REQUEST_MS;
    else process.env.SLOW_REQUEST_MS = previous;
  }
});

test('agrega métricas básicas por acción sin datos de usuario', async () => {
  resetRequestMetrics();
  await runRequest({ action: 'notificaciones', status: 200 });
  await runRequest({ action: 'notificaciones', status: 401 });
  const metric = requestMetricsSnapshot().find(({ endpoint }) => endpoint === 'notificaciones');
  assert.equal(metric?.requests, 2);
  assert.equal(metric?.errors, 1);
  assert.equal(typeof metric?.averageDurationMs, 'number');
  assert.equal('userId' in (metric ?? {}), false);
});

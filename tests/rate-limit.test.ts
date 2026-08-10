import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import {
  createRateLimiterForTest,
  getPublicAuthRateLimitGroup,
} from '../src/middleware/rate-limit.middleware.js';

function source(relative: string) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

function mockExchange(ip: string) {
  const headers = new Map<string, unknown>();
  const responseEvents = new EventEmitter();
  let statusCode = 200;
  let body: unknown;

  const req = {
    app: { get: () => false },
    headers: {},
    ip,
    method: 'POST',
    path: '/api',
    socket: { remoteAddress: ip },
  } as unknown as Request;

  const res = Object.assign(responseEvents, {
    append(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value);
      return res;
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    setHeader(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value);
      return res;
    },
    status(value: number) {
      statusCode = value;
      return res;
    },
    json(value: unknown) {
      body = value;
      responseEvents.emit('finish');
      return res;
    },
    send(value: unknown) {
      body = value;
      responseEvents.emit('finish');
      return res;
    },
  }) as unknown as Response;

  return {
    req,
    res,
    result: () => ({ statusCode, body }),
  };
}

test('las acciones públicas usan el limitador correspondiente', () => {
  assert.equal(getPublicAuthRateLimitGroup('login'), 'credentials');
  assert.equal(getPublicAuthRateLimitGroup('refreshToken'), 'credentials');
  assert.equal(getPublicAuthRateLimitGroup('solicitarActivacion'), 'email');
  assert.equal(getPublicAuthRateLimitGroup('solicitarRegistro'), 'email');
  assert.equal(getPublicAuthRateLimitGroup('solicitarResetPassword'), 'email');
  assert.equal(getPublicAuthRateLimitGroup('activarCuenta'), 'code');
  assert.equal(getPublicAuthRateLimitGroup('completarRegistro'), 'code');
  assert.equal(getPublicAuthRateLimitGroup('resetPassword'), 'code');
});

test('una petición normal continúa y el exceso devuelve 429 RATE_LIMITED', async () => {
  const limiter = createRateLimiterForTest(1);
  const first = mockExchange('192.0.2.10');
  let firstContinued = false;
  await limiter(first.req, first.res, () => {
    firstContinued = true;
  });

  assert.equal(firstContinued, true);
  assert.equal(first.result().statusCode, 200);

  const second = mockExchange('192.0.2.10');
  let secondContinued = false;
  await limiter(second.req, second.res, () => {
    secondContinued = true;
  });

  assert.equal(secondContinued, false);
  assert.equal(second.result().statusCode, 429);
  assert.deepEqual(second.result().body, {
    ok: false,
    error: 'RATE_LIMITED',
    mensaje: 'Solicitud limitada para la prueba.',
  });
});

test('Railway confía en un salto y las rutas privadas siguen exigiendo token', () => {
  const server = source('../src/server.ts');
  const router = source('../src/routes/api.router.ts');

  assert.match(server, /NODE_ENV === 'production' \? 1 : 0/);
  assert.match(server, /app\.set\('trust proxy', proxyHops\(\)\)/);
  assert.doesNotMatch(server, /app\.set\('trust proxy', true\)/);
  assert.match(
    router,
    /!PUBLIC_AUTH_ACTIONS\.has\(action\) && !req\.auth[\s\S]*?res\.status\(401\)/,
  );
});

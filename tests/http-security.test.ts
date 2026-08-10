import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import {
  CorsPolicyError,
  corsErrorHandler,
  createCorsMiddleware,
  createCorsOptions,
  createHelmetMiddleware,
} from '../src/middleware/http-security.middleware.js';

function evaluateOrigin(origin: string | undefined, allowed: string) {
  const options = createCorsOptions({
    NODE_ENV: 'production',
    CORS_ALLOWED_ORIGINS: allowed,
  });

  return new Promise<{ error: Error | null; allowed?: boolean }>((resolve) => {
    const originOption = options.origin;
    assert.equal(typeof originOption, 'function');
    originOption!(origin, (error, result) => {
      resolve({ error, allowed: typeof result === 'boolean' ? result : undefined });
    });
  });
}

function mockExchange(method: string, headers: Record<string, string> = {}) {
  const responseHeaders = new Map<string, string | string[]>();
  let statusCode = 200;
  let body: unknown;
  let ended = false;

  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const req = {
    headers: normalizedHeaders,
    method,
    get(name: string) {
      return normalizedHeaders[name.toLowerCase()];
    },
    header(name: string) {
      return normalizedHeaders[name.toLowerCase()];
    },
  } as unknown as Request;

  const responseMock = {
    getHeader(name: string) {
      return responseHeaders.get(name.toLowerCase());
    },
    setHeader(name: string, value: string | string[]) {
      responseHeaders.set(name.toLowerCase(), value);
      return res;
    },
    removeHeader(name: string) {
      responseHeaders.delete(name.toLowerCase());
    },
    status(value: number) {
      statusCode = value;
      return res;
    },
    json(value: unknown) {
      body = value;
      ended = true;
      return res;
    },
    end() {
      ended = true;
      return res;
    },
  };
  Object.defineProperty(responseMock, 'statusCode', {
    get: () => statusCode,
    set: (value: number) => {
      statusCode = value;
    },
  });
  const res = responseMock as unknown as Response;

  return {
    req,
    res,
    state: () => ({ body, ended, responseHeaders, statusCode }),
  };
}

test('una petición móvil sin Origin está permitida', async () => {
  const result = await evaluateOrigin(undefined, 'https://app.example.com');

  assert.equal(result.error, null);
  assert.equal(result.allowed, true);
});

test('solo los orígenes configurados están permitidos en producción', async () => {
  const configured = 'https://app.example.com, https://admin.example.com';
  const allowed = await evaluateOrigin('https://admin.example.com', configured);
  const rejected = await evaluateOrigin('https://unknown.example.com', configured);

  assert.equal(allowed.error, null);
  assert.equal(allowed.allowed, true);
  assert.ok(rejected.error instanceof CorsPolicyError);
  assert.equal(rejected.allowed, undefined);
});

test('los orígenes locales solo se añaden fuera de producción', async () => {
  const development = createCorsOptions({ NODE_ENV: 'development' });
  const production = createCorsOptions({ NODE_ENV: 'production' });

  const evaluate = (options: ReturnType<typeof createCorsOptions>) =>
    new Promise<boolean | undefined>((resolve) => {
      assert.equal(typeof options.origin, 'function');
      options.origin!('http://localhost:5173', (error, allowed) => {
        resolve(error ? undefined : allowed as boolean);
      });
    });

  assert.equal(await evaluate(development), true);
  assert.equal(await evaluate(production), undefined);
});

test('un origen desconocido recibe un error controlado sin detalles internos', () => {
  const exchange = mockExchange('GET');
  let propagated = false;

  corsErrorHandler(
    new CorsPolicyError('internal detail'),
    exchange.req,
    exchange.res,
    (() => {
      propagated = true;
    }) as NextFunction,
  );

  assert.equal(propagated, false);
  assert.equal(exchange.state().statusCode, 403);
  assert.deepEqual(exchange.state().body, {
    ok: false,
    error: 'CORS_ORIGIN_DENIED',
    mensaje: 'El origen de la petición no está autorizado.',
  });
});

test('un preflight válido devuelve métodos y cabeceras limitados', () => {
  const exchange = mockExchange('OPTIONS', {
    Origin: 'https://app.example.com',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Authorization, Content-Type',
  });
  let continued = false;
  const middleware = createCorsMiddleware({
    NODE_ENV: 'production',
    CORS_ALLOWED_ORIGINS: 'https://app.example.com',
  });

  middleware(exchange.req, exchange.res, () => {
    continued = true;
  });

  const state = exchange.state();
  assert.equal(continued, false);
  assert.equal(state.ended, true);
  assert.equal(state.statusCode, 204);
  assert.equal(
    state.responseHeaders.get('access-control-allow-origin'),
    'https://app.example.com',
  );
  assert.equal(
    state.responseHeaders.get('access-control-allow-methods'),
    'GET,POST,OPTIONS',
  );
  assert.equal(
    state.responseHeaders.get('access-control-allow-headers'),
    'Authorization,Content-Type,Accept',
  );
  assert.equal(
    state.responseHeaders.has('access-control-allow-credentials'),
    false,
  );
});

test('Helmet añade las cabeceras principales a la API', () => {
  const exchange = mockExchange('GET');
  exchange.res.setHeader('X-Powered-By', 'Express');
  let continued = false;
  const middleware = createHelmetMiddleware({ NODE_ENV: 'production' });

  middleware(exchange.req, exchange.res, () => {
    continued = true;
  });

  const headers = exchange.state().responseHeaders;
  assert.equal(continued, true);
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.match(String(headers.get('strict-transport-security')), /max-age=/);
  assert.equal(headers.has('x-powered-by'), false);
});

test('las rutas privadas continúan exigiendo token y trust proxy no se duplica', () => {
  const router = readFileSync(
    new URL('../src/routes/api.router.ts', import.meta.url),
    'utf8',
  );
  const server = readFileSync(
    new URL('../src/server.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    router,
    /!PUBLIC_AUTH_ACTIONS\.has\(action\) && !req\.auth[\s\S]*?res\.status\(401\)/,
  );
  assert.equal(server.match(/app\.set\('trust proxy'/g)?.length, 1);
});

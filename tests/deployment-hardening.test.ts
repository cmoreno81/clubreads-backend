import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { Request, Response } from 'express';

import { prisma } from '../src/prisma.js';
import { healthHandler, readinessHandler } from '../src/server.js';

function mockResponse() {
  let statusCode = 200;
  let body: unknown;
  const res = {
    status(code: number) { statusCode = code; return res; },
    json(value: unknown) { body = value; return res; },
  } as unknown as Response;
  return { res, state: () => ({ statusCode, body }) };
}

test('start aplica migraciones antes de arrancar y migrate:deploy sigue disponible', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.start, 'prisma migrate deploy && node dist/server.js');
  assert.equal(pkg.scripts['migrate:deploy'], 'prisma migrate deploy');
  assert.match(pkg.scripts.start, /^prisma migrate deploy && node dist\/server\.js$/);
});

test('health es público y no revela configuración', async () => {
  const response = mockResponse();
  healthHandler({} as Request, response.res);
  assert.equal(response.state().statusCode, 200);
  assert.deepEqual(response.state().body, { ok: true, status: 'healthy' });
});

test('ready usa una consulta mínima y devuelve respuesta genérica', async () => {
  const mutablePrisma = prisma as unknown as { $queryRaw: (...args: unknown[]) => Promise<unknown> };
  const original = mutablePrisma.$queryRaw;
  let calls = 0;
  try {
    mutablePrisma.$queryRaw = async () => { calls++; return [{ '?column?': 1 }]; };
    const ready = mockResponse();
    await readinessHandler({} as Request, ready.res);
    assert.equal(ready.state().statusCode, 200);
    assert.deepEqual(ready.state().body, { ok: true, status: 'ready' });
    assert.equal(calls, 1);

    mutablePrisma.$queryRaw = async () => { throw new Error('postgresql://secret-host/private'); };
    const unavailable = mockResponse();
    await readinessHandler({} as Request, unavailable.res);
    assert.equal(unavailable.state().statusCode, 503);
    assert.deepEqual(unavailable.state().body, {
      ok: false,
      error: 'NOT_READY',
      mensaje: 'El servicio no está preparado',
    });
    assert.doesNotMatch(JSON.stringify(unavailable.state().body), /secret-host|postgresql|stack/i);
  } finally {
    mutablePrisma.$queryRaw = original;
  }
});

test('Docker excluye secretos y usa una imagen final no root', async () => {
  const [dockerfile, dockerignore, compose] = await Promise.all([
    readFile(new URL('../Dockerfile', import.meta.url), 'utf8'),
    readFile(new URL('../.dockerignore', import.meta.url), 'utf8'),
    readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8'),
  ]);
  assert.match(dockerfile, /FROM node:22-bookworm-slim AS build/);
  assert.match(dockerfile, /npm run build && npm prune --omit=dev/);
  assert.match(dockerfile, /USER node/);
  assert.doesNotMatch(dockerfile, /COPY\s+\.\s+\./);
  for (const pattern of ['.git', '.env', 'data', '**/*.csv', 'node_modules', 'tests']) {
    assert.match(dockerignore, new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
  assert.match(compose, /127\.0\.0\.1:\$\{POSTGRES_PORT:-5433\}:5432/);
  assert.match(compose, /profiles: \["tools"\]/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /internal: true/);
  assert.doesNotMatch(compose, /clublectura\s*$|PGADMIN_DEFAULT_PASSWORD:\s*admin/m);
});

test('el servidor instala cierre ordenado para SIGTERM y SIGINT', async () => {
  const source = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
  assert.match(source, /server\.closeIdleConnections/);
  assert.match(source, /server\.close\(/);
  assert.match(source, /prisma\.\$disconnect\(\)/);
  assert.match(source, /process\.once\('SIGTERM'/);
  assert.match(source, /process\.once\('SIGINT'/);
  assert.match(source, /timeoutMs = 10_000/);
  assert.match(source, /app\.get\('\/health', healthRateLimiter, healthHandler\)/);
  assert.match(source, /app\.get\('\/ready', healthRateLimiter, readinessHandler\)/);
});

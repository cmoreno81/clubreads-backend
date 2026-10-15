import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createCompressionMiddleware } from '../src/middleware/compression.middleware.js';

async function conServidor(fn: (base: string) => Promise<void>) {
  const app = express();
  app.use(createCompressionMiddleware());
  const grande = Array.from({ length: 2000 }, (_, i) => ({ libro: `Título ${i}`, autor: 'Autora', idioma: 'es' }));
  app.get('/grande', (_req, res) => res.json(grande));
  app.get('/pequena', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

test('las respuestas grandes se comprimen en gzip y se descomprimen igual', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/grande`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(res.headers.get('content-encoding'), 'gzip');
    const datos = (await res.json()) as unknown[];
    assert.equal(datos.length, 2000);
  });
});

test('las respuestas pequeñas y las que no aceptan gzip van tal cual', async () => {
  await conServidor(async (base) => {
    const peque = await fetch(`${base}/pequena`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(peque.headers.get('content-encoding'), null);
    const sin = await fetch(`${base}/grande`, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(sin.headers.get('content-encoding'), null);
  });
});

test('el servidor monta la compresión', () => {
  assert.match(readFileSync('src/server.ts', 'utf8'), /app\.use\(createCompressionMiddleware\(\)\)/);
});

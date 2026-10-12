import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('la migración fija la edición de La peste como enlace MANUAL y no pisa nada más', () => {
  const sql = readFileSync(
    'prisma/migrations/20261013180000_enlace_casa_del_libro_la_peste/migration.sql',
    'utf8',
  );
  assert.match(sql, /libro-la-peste\/9788435018814\/1767002/);
  assert.match(sql, /'MANUAL'/);
  assert.match(sql, /lower\(b\."title"\) = 'la peste'/);
  assert.match(sql, /lower\(a\."name"\) = 'albert camus'/);
  assert.match(sql, /ON CONFLICT \("bookId", "store", "format", "language"\) DO UPDATE/);
  assert.equal(/\b(DELETE\s+FROM|DROP\s|TRUNCATE\s)/i.test(sql), false);
});

test('la sincronización con el feed respeta los enlaces MANUAL', () => {
  const svc = readFileSync('src/services/store-link-sync.service.ts', 'utf8');
  assert.match(svc, /current\?\.source === 'MANUAL'\) continue/);
  // La poda solo borra filas FEED, nunca las manuales.
  assert.match(svc, /e\.source === 'FEED' && !matcher\.best\.has/);
});

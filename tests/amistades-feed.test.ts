import assert from 'node:assert/strict';
import test from 'node:test';

import { resumenResena } from '../src/services/amistades-feed.service.js';

test('resumenResena recorta sin partir palabras y limpia saltos de línea', () => {
  assert.equal(resumenResena('  Muy   bueno\n\nlo recomiendo '), 'Muy bueno lo recomiendo');
  const larga = 'palabra '.repeat(40);
  const r = resumenResena(larga, 60);
  assert.ok(r.endsWith('…'));
  assert.ok(r.length <= 60);
  assert.ok(!/palabr…$/.test(r), 'no debe cortar una palabra por la mitad');
  assert.equal(resumenResena(null), '');
});

import { readFileSync } from 'node:fs';

test('el aviso de «amiga ha terminado tu lectura» está en el catálogo y enganchado al terminar un libro', () => {
  const notis = readFileSync('src/services/notifications.service.ts', 'utf8');
  assert.match(notis, /NotificationType\.AMISTAD_LIBRO_TERMINADO,/);
  const books = readFileSync('src/services/books.service.ts', 'utf8');
  assert.match(books, /if \(recienTerminado\)/);
  assert.match(books, /notificarAmistadesLibroTerminado\(/);
  const router = readFileSync('src/routes/api.router.ts', 'utf8');
  assert.match(router, /case 'feedAmistades':/);
});

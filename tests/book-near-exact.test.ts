import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  extraTitleKeys,
  findNearExactBook,
  importTitleVariants,
} from '../src/services/goodreads-import.service.js';

type Row = { id: string; title: string; author: { name: string }; _count: { library: number } };
const libro = (id: string, title: string, library = 1, autor = 'Suzanne Collins'): Row => ({
  id,
  title,
  author: { name: autor },
  _count: { library },
});
const baseDeDatos = (rows: Row[]) =>
  ({ book: { findMany: async () => rows } }) as unknown as Parameters<typeof findNearExactBook>[0];

test('reconoce el título bilingüe como el título en español', () => {
  const variantes = importTitleVariants('Los Juegos del hambre / The Hunger Games');
  assert.ok(variantes.includes('los juegos del hambre'));
  assert.ok(variantes.includes('the hunger games'));
});

test('reconoce «Título N - Título» como el título solo', () => {
  assert.ok(importTitleVariants('Los Juegos del Hambre 1 - Los Juegos del Hambre').includes('los juegos del hambre'));
  assert.ok(importTitleVariants('Divergente 1 - Divergente').includes('divergente'));
  // Un subtítulo distinto no se recorta: «Saga 2 - Otra cosa» no es «Otra cosa».
  assert.deepEqual(extraTitleKeys('saga 2 - otra cosa'), []);
});

test('«.» y «:» como separador de subtítulo son equivalentes', () => {
  assert.ok(
    importTitleVariants('Zodiac Academy 1. El despertar. Edición especial')
      .includes('zodiac academy 1: el despertar'),
  );
});

test('un título normal no cambia sus variantes', () => {
  assert.deepEqual(importTitleVariants('Yesteryear'), ['yesteryear']);
});

test('enlaza con el libro existente aunque el título venga bilingüe', async () => {
  const bd = baseDeDatos([
    libro('es', 'Los juegos del hambre', 3),
    libro('otro', 'En llamas', 2),
  ]);
  const encontrado = await findNearExactBook(bd, {
    title: 'Los Juegos del hambre / The Hunger Games',
    authorName: 'Suzanne Collins',
  });
  assert.equal(encontrado?.id, 'es');
});

test('prefiere la edición en el idioma del título principal aunque la otra tenga más lectoras', async () => {
  const bd = baseDeDatos([
    libro('en', 'The Hunger Games', 9),
    libro('es', 'Los juegos del hambre', 2),
  ]);
  const encontrado = await findNearExactBook(bd, {
    title: 'Los Juegos del hambre / The Hunger Games',
    authorName: 'Suzanne Collins',
  });
  assert.equal(encontrado?.id, 'es');
});

test('no confunde tomos distintos de una misma saga', async () => {
  const bd = baseDeDatos([
    libro('dos', 'Heartstopper: Volume Two', 1, 'Alice Oseman'),
    libro('tres', 'Heartstopper: Volume Three', 1, 'Alice Oseman'),
  ]);
  assert.equal(
    await findNearExactBook(bd, { title: 'Heartstopper: Volume One', authorName: 'Alice Oseman' }),
    null,
  );
});

test('sin autora no se arriesga a unir libros', async () => {
  const bd = baseDeDatos([libro('es', 'Los juegos del hambre')]);
  assert.equal(await findNearExactBook(bd, { title: 'Los juegos del hambre / The Hunger Games', authorName: '' }), null);
});

test('al añadir un libro se busca primero el exacto y luego el casi exacto', async () => {
  const service = await readFile(new URL('../src/services/books.service.ts', import.meta.url), 'utf8');
  assert.match(service, /findBookByIdentity\(prisma, \{\s*title,\s*authorName: suppliedAuthorName,\s*isbn: suppliedIsbn,\s*\}\)\) \?\?\s*\(await findNearExactBook\(prisma/);
});

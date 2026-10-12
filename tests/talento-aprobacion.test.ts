import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aprobarFichaTalento,
  rechazarFichaTalento,
  retirarSelloTalento,
} from '../src/services/talento-emergente-aprobacion.service.js';
import { datosTalento } from '../src/utils/generos.utils.js';

const ficha = (extra: Record<string, unknown> = {}) => ({
  id: 'f1',
  status: 'PENDING',
  title: 'Entre dos tormentas',
  authorName: 'Lucía Marín',
  genre: 'Romance',
  extraGenres: ['Paranormal'],
  language: 'es',
  pages: 310,
  spicyLevel: 3,
  tropes: ['slow burn'],
  synopsis: 'Sinopsis larga de la novela.',
  authorNote: 'Gracias por leerme',
  buyUrl: 'https://www.amazon.es/dp/B0TEST',
  coverUrl: 'https://img/c.jpg',
  ...extra,
});

function fakeDb(opts: { ficha?: ReturnType<typeof ficha> | null; existentes?: unknown[] } = {}) {
  const llamadas: Record<string, unknown[]> = { bookCreate: [], bookUpdate: [], fichaUpdate: [] };
  const db = {
    emergingTalentSubmission: {
      findUnique: async () => (opts.ficha === undefined ? ficha() : opts.ficha),
      update: async (a: unknown) => { llamadas.fichaUpdate!.push(a); return {}; },
    },
    author: {
      findFirst: async () => null,
      create: async () => ({ id: 'a1', name: 'Lucía Marín' }),
    },
    genre: { upsert: async () => ({ id: 'g1' }) },
    book: {
      findMany: async () => opts.existentes ?? [],
      create: async (a: unknown) => { llamadas.bookCreate!.push(a); return { id: 'b1', title: 'Entre dos tormentas' }; },
      update: async (a: unknown) => { llamadas.bookUpdate!.push(a); return { id: 'b9', title: 'Entre dos tormentas' }; },
      findFirst: async () => ({ id: 'b9' }),
    },
  };
  return { db: db as never, llamadas };
}

test('aprobar una ficha crea el libro con sello, nota, enlace, picante y tropos', async () => {
  const { db, llamadas } = fakeDb();
  const r = await aprobarFichaTalento('f1', db);
  assert.deepEqual(r, { ok: true, bookId: 'b1', fusionado: false, titulo: 'Entre dos tormentas' });
  const data = (llamadas.bookCreate![0] as { data: Record<string, unknown> }).data;
  assert.equal(data.emergingTalent, true);
  assert.equal(data.authorLinkUrl, 'https://www.amazon.es/dp/B0TEST');
  assert.equal(data.authorSpicyLevel, 3);
  assert.deepEqual(data.extraGenres, ['Paranormal']);
  assert.equal(data.coverUrl, 'https://img/c.jpg');
  const estado = (llamadas.fichaUpdate![0] as { data: Record<string, unknown> }).data;
  assert.equal(estado.status, 'APPROVED');
  assert.equal(estado.approvedBookId, 'b1');
});

test('si el libro ya existe no se duplica: se marca y solo se rellena lo que faltaba', async () => {
  const existente = {
    id: 'b9', title: 'Entre dos tormentas', authorId: 'a1', extraGenres: [], coverUrl: 'https://ya/tiene.jpg',
    synopsis: null, totalPages: 300, language: 'es', author: { name: 'Lucía Marín' }, _count: { library: 2 },
  };
  const { db, llamadas } = fakeDb({ existentes: [existente] });
  const r = await aprobarFichaTalento('f1', db);
  assert.equal(r.ok && r.fusionado, true);
  assert.equal(llamadas.bookCreate!.length, 0);
  const data = (llamadas.bookUpdate![0] as { data: Record<string, unknown> }).data;
  assert.equal(data.emergingTalent, true);
  assert.equal('coverUrl' in data, false); // conserva la portada que ya tenía
  assert.equal('totalPages' in data, false);
  assert.equal(data.synopsis, 'Sinopsis larga de la novela.');
});

test('no se aprueba dos veces ni una ficha que no existe', async () => {
  assert.equal((await aprobarFichaTalento('f1', fakeDb({ ficha: ficha({ status: 'APPROVED' }) }).db)).ok, false);
  assert.equal((await aprobarFichaTalento('nada', fakeDb({ ficha: null }).db)).ok, false);
});

test('rechazar guarda el motivo y retirar quita el sello', async () => {
  const a = fakeDb();
  assert.deepEqual(await rechazarFichaTalento('f1', ' no encaja ', a.db), { ok: true });
  assert.equal((a.llamadas.fichaUpdate![0] as { data: Record<string, unknown> }).data.reviewNote, 'no encaja');
  const b = fakeDb();
  assert.deepEqual(await retirarSelloTalento('b9', b.db), { ok: true });
  assert.equal((b.llamadas.bookUpdate![0] as { data: Record<string, unknown> }).data.emergingTalent, false);
});

test('datosTalento solo añade los datos de la autora si el libro tiene sello', () => {
  assert.deepEqual(
    datosTalento({ emergingTalent: false, authorNote: 'x', authorLinkUrl: 'y', authorSpicyLevel: 1, authorTropes: [] }),
    { talentoEmergente: false },
  );
  assert.equal(
    datosTalento({ emergingTalent: true, authorNote: 'x', authorLinkUrl: 'y', authorSpicyLevel: 1, authorTropes: ['a'] }).notaAutora,
    'x',
  );
});

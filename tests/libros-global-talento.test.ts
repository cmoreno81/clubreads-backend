import assert from 'node:assert/strict';
import test from 'node:test';

import { prisma } from '../src/prisma.js';
import { getLibrosGlobal } from '../src/services/books.service.js';

function falso(modelo: string, metodos: Record<string, (...a: never[]) => unknown>) {
  const original = Object.getOwnPropertyDescriptor(prisma, modelo);
  Object.defineProperty(prisma, modelo, { value: metodos, configurable: true });
  return () => {
    if (original) Object.defineProperty(prisma, modelo, original);
    else delete (prisma as Record<string, unknown>)[modelo];
  };
}

const talento = {
  id: 'b1', title: 'Entre dos tormentas', author: { name: 'Lucía Marín' }, genre: { name: 'Romance' },
  extraGenres: ['Paranormal'], series: null, seriesOrder: null, standalone: true,
  goodreadsUrl: null, coverUrl: 'https://img/c.jpg', language: 'es', totalPages: 310,
  createdAt: new Date('2026-10-12T10:00:00Z'),
  emergingTalent: true, authorNote: 'Hola', authorLinkUrl: null, authorWebUrl: null,
  authorSpicyLevel: 3, authorTropes: ['slow burn'],
};

test('la vista ClubReads añade los libros de Talento emergente sin lectoras solo si la app lo pide', async () => {
  const restaurar = [
    falso('user', { findUnique: async () => null }),
    falso('library', { findMany: async () => [] }),
    falso('book', { findMany: async () => [talento] }),
  ];
  try {
    const sin = (await getLibrosGlobal('nadie-sin-flag')) as Array<Record<string, any>>;
    assert.equal(sin.length, 0); // apps antiguas: no lo ven

    const con = (await getLibrosGlobal('nadie-con-flag', true)) as Array<Record<string, any>>;
    assert.equal(con.length, 1);
    assert.equal(con[0]!.soloCatalogo, true);
    assert.equal(con[0]!.usuario, '');
    assert.equal(con[0]!.talentoEmergente, true);
    assert.deepEqual(con[0]!.generos, ['Romance', 'Paranormal']);
    assert.equal(con[0]!.estado, 'CATALOGO');
    assert.equal(con[0]!.yaLoTengo, false);
  } finally {
    restaurar.forEach((r) => r());
  }
});

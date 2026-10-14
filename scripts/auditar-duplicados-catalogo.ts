// Busca fichas de libro que parecen la misma obra. SOLO LEE: no cambia nada.
//
//   DATABASE_URL=<la de producción> npx tsx scripts/auditar-duplicados-catalogo.ts
//
// Tres listas:
//   A. mismo ISBN
//   B. misma autoría y título equivalente («Serie 2 - Título» = «Título», «Título / Title»…):
//      son los que el servidor ya une al añadir; si salen aquí es que se colaron antes.
//   C. mismo título base y autoría: ojo, aquí salen falsos avisos (tomos de una serie «Serie: Vol. 1»,
//      «Serie: Vol. 2»…). Revísalos a mano antes de fusionar nada.
// Para fusionar: scripts/merge-books.ts (ver docs/operaciones.md).
import 'dotenv/config';

import { prisma } from '../src/prisma.js';
import {
  baseTitleNormalized,
  normalizeBookIdentityText,
  normalizeBookIsbn,
} from '../src/services/book-identity.service.js';
import { canonicalBookTitle } from '../src/services/catalog.service.js';
import { extraTitleKeys } from '../src/services/goodreads-import.service.js';

const libros = await prisma.book.findMany({
  where: { deletedAt: null },
  select: {
    id: true, title: true, isbn: true, createdAt: true,
    author: { select: { name: true } },
    _count: { select: { library: true, reviews: true, readings: true } },
  },
});
type L = (typeof libros)[number];
const palabrasAutor = (l: L) =>
  normalizeBookIdentityText(l.author?.name ?? '').split(' ').filter((w) => w.length > 1).sort().join(' ');
const linea = (l: L) =>
  `   [${l.id}] «${l.title}» — ${l.author?.name ?? '(sin autoría)'} · ${l._count.library} bibl. · ${l._count.reviews} reseñas · ${l._count.readings} lecturas conj. · ${l.createdAt.toISOString().slice(0, 10)}`;

function grupos(clave: (l: L) => string[] | string | null) {
  const m = new Map<string, L[]>();
  for (const l of libros) {
    const claves = clave(l);
    for (const k of (Array.isArray(claves) ? claves : [claves]).filter(Boolean) as string[]) {
      m.set(k, [...(m.get(k) ?? []), l]);
    }
  }
  const vistos = new Set<string>();
  return [...m.values()]
    .filter((g) => g.length > 1)
    .filter((g) => { const k = g.map((l) => l.id).sort().join('|'); if (vistos.has(k)) return false; vistos.add(k); return true; });
}
function imprimir(titulo: string, gs: L[][]) {
  console.log(`\n### ${titulo}: ${gs.length}`);
  for (const g of gs) { console.log(''); g.forEach((l) => console.log(linea(l))); }
}

console.log('Libros activos:', libros.length);
imprimir('A. Mismo ISBN', grupos((l) => normalizeBookIsbn(l.isbn)));
imprimir('B. Misma autoría y título equivalente', grupos((l) => {
  const a = palabrasAutor(l);
  if (!a) return [];
  const c = canonicalBookTitle(l.title);
  return [c, ...extraTitleKeys(c)].filter((k) => k.length >= 4).map((k) => `${a}::${k}`);
}));
imprimir('C. Mismo título base y autoría (revisar a mano: salen tomos de una serie)', grupos((l) => {
  const b = baseTitleNormalized(l.title);
  const a = palabrasAutor(l);
  return b.length >= 4 && a ? `${a}::${b}` : null;
}));
await prisma.$disconnect();

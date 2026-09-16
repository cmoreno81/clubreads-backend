import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { prisma } from '../prisma.js';

type Database = Prisma.TransactionClient | PrismaClient;

export function normalizeBookIdentityText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeBookIsbn(value: unknown) {
  const normalized = String(value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return normalized.length === 10 || normalized.length === 13 ? normalized : null;
}

export function canonicalBookKey(title: unknown, author: unknown) {
  return `${normalizeBookIdentityText(title)}::${normalizeBookIdentityText(author)}`;
}

export async function resolveCanonicalBookId(database: Database, requestedId: string) {
  let currentId = requestedId.trim();
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const redirect = await database.bookRedirect.findUnique({
      where: { oldBookId: currentId },
      select: { canonicalBookId: true },
    });
    if (!redirect) return currentId;
    currentId = redirect.canonicalBookId;
  }
  throw new Error('BOOK_REDIRECT_CYCLE');
}

export async function findBookByIdentity(
  database: Database,
  identity: { title: string; authorName?: string | null; isbn?: string | null; excludeBookId?: string },
) {
  const normalizedIsbn = normalizeBookIsbn(identity.isbn);
  const canonicalKey = canonicalBookKey(identity.title, identity.authorName ?? '');
  return database.book.findFirst({
    where: {
      deletedAt: null,
      ...(identity.excludeBookId ? { id: { not: identity.excludeBookId } } : {}),
      OR: [
        ...(normalizedIsbn ? [{ normalizedIsbn }] : []),
        { canonicalKey },
      ],
    },
    include: { author: true },
  });
}

export async function lockBookIdentity(
  tx: Prisma.TransactionClient,
  identity: { title: string; authorName?: string | null; isbn?: string | null },
) {
  const keys = [
    `canonical:${canonicalBookKey(identity.title, identity.authorName ?? '')}`,
    ...(normalizeBookIsbn(identity.isbn) ? [`isbn:${normalizeBookIsbn(identity.isbn)}`] : []),
  ].sort();
  for (const key of keys) {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`book:${key}`}, 0))::text
    `;
  }
}

/**
 * Vincula dos ediciones del mismo libro (p. ej. la ficha en español y la
 * ficha en inglés) que se ha decidido dejar SEPARADAS — cada una conserva
 * su propio idioma, carátula, lectoras y estadísticas — pero que deben
 * compartir la lectura conjunta y su conversación por capítulo cuando el
 * club la lea en grupo. A diferencia de `mergeBooks`, esto no mueve ni
 * borra ningún dato: solo asigna un `workId` común (nuevo o ya existente en
 * cualquiera de los dos) a ambos libros, y a cualquier otra edición que ya
 * compartiera `workId` con alguno de ellos.
 */
export async function linkBookEditions(bookIdAValue: string, bookIdBValue: string) {
  return prisma.$transaction(async (tx) => {
    const bookIdA = await resolveCanonicalBookId(tx, bookIdAValue);
    const bookIdB = await resolveCanonicalBookId(tx, bookIdBValue);

    if (bookIdA === bookIdB) {
      const book = await tx.book.findUnique({ where: { id: bookIdA }, select: { workId: true } });
      return { ok: true as const, workId: book?.workId ?? null, sameBook: true as const };
    }

    const orderedIds = [bookIdA, bookIdB].sort();
    await tx.$queryRaw`
      SELECT "id" FROM "Book"
      WHERE "id" IN (${Prisma.join(orderedIds)})
      ORDER BY "id" FOR UPDATE
    `;

    const [bookA, bookB] = await Promise.all([
      tx.book.findUnique({ where: { id: bookIdA }, select: { id: true, workId: true, deletedAt: true } }),
      tx.book.findUnique({ where: { id: bookIdB }, select: { id: true, workId: true, deletedAt: true } }),
    ]);
    if (!bookA || bookA.deletedAt) return { ok: false as const, mensaje: 'Libro no encontrado' };
    if (!bookB || bookB.deletedAt) return { ok: false as const, mensaje: 'Libro no encontrado' };

    const workId = bookA.workId ?? bookB.workId ?? randomUUID();

    // Si cada libro ya pertenecía a un grupo distinto, se fusionan los dos
    // grupos bajo el mismo workId en vez de dejar uno huérfano.
    const staleWorkIds = [bookA.workId, bookB.workId].filter(
      (id): id is string => Boolean(id) && id !== workId,
    );
    if (staleWorkIds.length > 0) {
      await tx.book.updateMany({
        where: { workId: { in: staleWorkIds } },
        data: { workId },
      });
    }

    await tx.book.updateMany({
      where: { id: { in: [bookIdA, bookIdB] } },
      data: { workId },
    });

    return { ok: true as const, workId, sameBook: false as const };
  });
}

export function isUniqueBookIdentityError(error: unknown) {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === 'P2002',
  );
}

/**
 * Extrae el "título base" quitando subtítulos entre paréntesis o después de ':'
 * Ej: "Hasta que caiga la luna (La Caída Lunar 1)" → "hasta que caiga la luna"
 */
export function baseTitleNormalized(title: string): string {
  const stripped = title
    .replace(/\s*[\(\[（【].*?[\)\]）】]\s*/g, '')   // quita (…) y [...]
    .replace(/\s*:.*$/, '')                            // quita todo tras ':'
    .trim();
  return normalizeBookIdentityText(stripped || title);
}

/**
 * Busca libros con título similar al dado (para detectar duplicados antes de crear).
 * Estrategia: el título base normalizado del candidato contiene o está contenido
 * en el título base del libro que se quiere crear, y tienen al menos 4 palabras en común.
 *
 * Devuelve hasta `limit` candidatos ordenados por similitud descendente.
 */
export async function findSimilarBooks(
  database: Database,
  title: string,
  options: { authorName?: string | null; excludeBookId?: string; limit?: number } = {},
): Promise<Array<{ id: string; title: string; authorName: string | null; coverUrl: string | null; genreName: string }>> {
  const { authorName, excludeBookId, limit = 5 } = options;

  const baseNorm = baseTitleNormalized(title);
  if (baseNorm.length < 4) return [];

  // Palabras significativas del título base (≥4 letras)
  const words = baseNorm.split(' ').filter((w) => w.length >= 4);
  if (words.length === 0) return [];

  // Buscar libros cuyo título normalizado contenga alguna de las palabras clave
  // Se hace en JS porque Prisma no tiene ILIKE dinámico sobre campo computado;
  // la tabla Book no es grande, así que la consulta es manejable.
  const candidates = await database.book.findMany({
    where: {
      deletedAt: null,
      ...(excludeBookId ? { id: { not: excludeBookId } } : {}),
      // Al menos una palabra significativa debe aparecer en el título (case-insensitive)
      OR: words.map((w) => ({ title: { contains: w, mode: 'insensitive' as const } })),
    },
    select: {
      id: true,
      title: true,
      coverUrl: true,
      author: { select: { name: true } },
      genre: { select: { name: true } },
    },
    take: 50, // pool amplio para luego filtrar
  });

  // Puntuar por solapamiento de palabras entre el título base de cada candidato y el buscado
  const queryWords = new Set(words);
  let scored = candidates
    .map((book) => {
      const candBase = baseTitleNormalized(book.title);
      const candWords = new Set(candBase.split(' ').filter((w) => w.length >= 4));
      const overlap = [...queryWords].filter((w) => candWords.has(w)).length;
      const maxPossible = Math.max(queryWords.size, candWords.size);
      const score = overlap / maxPossible;
      return { book, score, overlap, candWordsSize: candWords.size };
    })
    .filter(({ score, overlap, candWordsSize }) => {
      if (score < 0.5) return false;
      // Con títulos de dos palabras significativas, compartir una sola palabra
      // genérica (p. ej. "hija" en "La mala hija" y "Hija del cielo") ya basta
      // para llegar al 50 % y disparaba fusiones entre libros distintos.
      // Exigimos al menos 2 palabras en común, salvo que alguno de los dos
      // títulos solo tenga una palabra significativa (ahí "1 de 1" ya es 100 %).
      if (queryWords.size <= 1 || candWordsSize <= 1) return overlap >= 1;
      return overlap >= 2;
    });

  // Si se pasa autor y el candidato tiene autor registrado distinto, lo
  // descartamos: no basta con reordenar, porque con limit bajo (como en los
  // sync automáticos) un único candidato con autor equivocado se devolvía
  // igualmente y acababa fusionando libros de autoras distintas. Comparamos
  // por conjunto de palabras (no por string exacto) para que "Rowling, J.K."
  // y "J.K. Rowling" (mismo orden invertido, típico de exportaciones de
  // Goodreads) sigan reconociéndose como la misma autora.
  if (authorName) {
    const queryAuthorWords = new Set(
      normalizeBookIdentityText(authorName).split(' ').filter(Boolean),
    );
    scored = scored.filter(({ book }) => {
      const candAuthorName = book.author?.name;
      if (!candAuthorName) return true;
      const candAuthorWords = new Set(
        normalizeBookIdentityText(candAuthorName).split(' ').filter(Boolean),
      );
      return (
        candAuthorWords.size === queryAuthorWords.size &&
        [...candAuthorWords].every((w) => queryAuthorWords.has(w))
      );
    });
  }

  // Un único slice final: el filtro de autor ya se aplicó sobre todos los
  // candidatos ordenados por puntuación, así que no hace falta un margen
  // arbitrario (limit * N) que podía descartar un candidato legítimo con el
  // autor correcto si quedaba fuera de ese margen antes de filtrar.
  scored = scored.sort((a, b) => b.score - a.score).slice(0, limit);

  return scored.map(({ book }) => ({
    id: book.id,
    title: book.title,
    authorName: book.author?.name ?? null,
    coverUrl: book.coverUrl ?? null,
    genreName: book.genre?.name ?? '',
  }));
}

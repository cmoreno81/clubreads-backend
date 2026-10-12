import { prisma } from '../prisma.js';
import { findNearExactBook } from './goodreads-import.service.js';
import { invalidateAllLibraryCaches } from './books.service.js';

export type ResultadoRevision =
  | { ok: true; bookId: string; fusionado: boolean; titulo: string }
  | { ok: false; mensaje: string };

type Database = typeof prisma;

/// Aprueba una ficha pendiente: la convierte en un libro del catálogo con el
/// sello de Talento emergente. Si el libro ya existía (mismo título y autora),
/// no se duplica: se marca el existente y se rellenan solo los datos que le
/// faltaban, para no pisar lo que ya tienen las lectoras.
export async function aprobarFichaTalento(
  id: string,
  db: Database = prisma,
): Promise<ResultadoRevision> {
  const ficha = await db.emergingTalentSubmission.findUnique({ where: { id } });
  if (!ficha) return { ok: false, mensaje: 'No existe esa ficha.' };
  if (ficha.status !== 'PENDING') {
    return { ok: false, mensaje: `La ficha ya está ${ficha.status === 'APPROVED' ? 'aprobada' : 'rechazada'}.` };
  }

  const autora =
    (await db.author.findFirst({
      where: { name: { equals: ficha.authorName, mode: 'insensitive' } },
    })) ?? (await db.author.create({ data: { name: ficha.authorName } }));

  const genero = await db.genre.upsert({
    where: { name: ficha.genre },
    update: {},
    create: { name: ficha.genre },
  });

  const talento = {
    emergingTalent: true,
    authorNote: ficha.authorNote,
    authorLinkUrl: ficha.buyUrl,
    authorSpicyLevel: ficha.spicyLevel,
    authorTropes: ficha.tropes,
  };

  const existente = await findNearExactBook(db, {
    title: ficha.title,
    authorName: ficha.authorName,
  });

  let bookId: string;
  let titulo: string;
  if (existente) {
    const actualizado = await db.book.update({
      where: { id: existente.id },
      data: {
        ...talento,
        ...(existente.extraGenres.length === 0 ? { extraGenres: ficha.extraGenres } : {}),
        ...(existente.coverUrl ? {} : { coverUrl: ficha.coverUrl }),
        ...(existente.synopsis ? {} : { synopsis: ficha.synopsis }),
        ...(existente.totalPages || !ficha.pages ? {} : { totalPages: ficha.pages }),
        ...(existente.language ? {} : { language: ficha.language }),
      },
      select: { id: true, title: true },
    });
    bookId = actualizado.id;
    titulo = actualizado.title;
  } else {
    const creado = await db.book.create({
      data: {
        title: ficha.title,
        authorId: autora.id,
        genreId: genero.id,
        extraGenres: ficha.extraGenres,
        standalone: true,
        coverUrl: ficha.coverUrl,
        synopsis: ficha.synopsis,
        totalPages: ficha.pages,
        language: ficha.language,
        ...talento,
      },
      select: { id: true, title: true },
    });
    bookId = creado.id;
    titulo = creado.title;
  }

  await db.emergingTalentSubmission.update({
    where: { id: ficha.id },
    data: { status: 'APPROVED', approvedBookId: bookId, reviewedAt: new Date() },
  });
  invalidateAllLibraryCaches();

  return { ok: true, bookId, fusionado: Boolean(existente), titulo };
}

export async function rechazarFichaTalento(
  id: string,
  motivo: string,
  db: Database = prisma,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const ficha = await db.emergingTalentSubmission.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!ficha) return { ok: false, mensaje: 'No existe esa ficha.' };
  if (ficha.status !== 'PENDING') {
    return { ok: false, mensaje: 'La ficha ya estaba revisada.' };
  }
  await db.emergingTalentSubmission.update({
    where: { id },
    data: { status: 'REJECTED', reviewNote: motivo.trim() || null, reviewedAt: new Date() },
  });
  return { ok: true };
}

/// Quita el sello de Talento emergente de un libro (p. ej. si la autora pide
/// retirarlo). El libro y las lecturas de la gente se conservan.
export async function retirarSelloTalento(
  bookId: string,
  db: Database = prisma,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const libro = await db.book.findFirst({
    where: { id: bookId, emergingTalent: true },
    select: { id: true },
  });
  if (!libro) return { ok: false, mensaje: 'Ese libro no tiene el sello de Talento emergente.' };
  await db.book.update({
    where: { id: libro.id },
    data: {
      emergingTalent: false,
      authorNote: null,
      authorLinkUrl: null,
      authorSpicyLevel: null,
      authorTropes: [],
    },
  });
  invalidateAllLibraryCaches();
  return { ok: true };
}

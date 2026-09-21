/**
 * Club Wrapped: el resumen anual del "Wrapped" individual pero del CLUB
 * entero — libro del año, favoritos del club, libros terminados y
 * comentarios de todas sus miembros, racha del club. Pensado para generar
 * una tarjeta compartible, como el Wrapped personal pero a nivel de grupo:
 * algo que Mistbook no puede ofrecer porque no tiene clubes.
 *
 * Reutiliza exactamente los mismos helpers de fecha (`yearStart`/`yearEnd`)
 * que el Wrapped individual, y la misma definición de "favorito" (bandera
 * `isFavorite` en `Library`) que ya usa `getFavoritosDelClub`.
 */

import { prisma } from '../prisma.js';
import { yearEnd, yearStart } from './checkin.service.js';
import { getClubStreak } from './club-streak.service.js';

export type ClubWrapped = {
  ok: true;
  clubId: string;
  clubNombre: string;
  year: number;
  miembros: number;
  totalLibros: number;
  totalPaginas: number;
  totalComentarios: number;
  generoMasLeido: { nombre: string; veces: number } | null;
  librosPorPersona: { userId: string; nombre: string; avatarUrl: string | null; libros: number }[];
  libroDelAnio: {
    titulo: string;
    coverUrl: string | null;
    autor: string | null;
  } | null;
  favoritoDelClub: {
    titulo: string;
    coverUrl: string | null;
    autor: string | null;
    votos: number;
  } | null;
  racha: number;
};

export async function getClubWrapped(
  clubId: string,
  year: number,
): Promise<ClubWrapped> {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, name: true },
  });
  if (!club) {
    throw new Error(`Club no encontrado: ${clubId}`);
  }

  const miembros = await prisma.clubMember.findMany({
    where: { clubId },
    select: { userId: true, user: { select: { name: true, avatarUrl: true } } },
  });
  const memberIds = miembros.map((m) => m.userId);
  const start = yearStart(year);
  const end = yearEnd(year);

  const [completions, totalComentarios, edicionLibroDelAnio, favoritos, racha] =
    await Promise.all([
      memberIds.length === 0
        ? Promise.resolve([])
        : prisma.readingCompletion.findMany({
            where: { userId: { in: memberIds }, finishedAt: { gte: start, lt: end } },
            include: { book: { include: { genre: true } } },
          }),
      memberIds.length === 0
        ? Promise.resolve(0)
        : prisma.comment.count({
            where: {
              userId: { in: memberIds },
              createdAt: { gte: start, lt: end },
              conversation: { reading: { clubId } },
            },
          }),
      prisma.clubBookOfYearEdition.findUnique({
        where: { clubId_year: { clubId, year } },
        include: { winnerCandidate: true },
      }),
      memberIds.length === 0
        ? Promise.resolve([])
        : prisma.library.findMany({
            where: { userId: { in: memberIds }, isFavorite: true },
            include: { book: { include: { author: true } } },
          }),
      getClubStreak(clubId),
    ]);

  const totalLibros = completions.length;
  const totalPaginas = completions.reduce(
    (sum, c) => sum + (c.book.totalPages ?? 0),
    0,
  );

  const generoCounts = new Map<string, number>();
  for (const c of completions) {
    const nombre = c.book.genre.name;
    generoCounts.set(nombre, (generoCounts.get(nombre) ?? 0) + 1);
  }
  const generoMasLeido = [...generoCounts.entries()]
    .map(([nombre, veces]) => ({ nombre, veces }))
    .sort((a, b) => b.veces - a.veces)[0] ?? null;

  const librosPorMiembro = new Map<string, number>();
  for (const c of completions) {
    librosPorMiembro.set(c.userId, (librosPorMiembro.get(c.userId) ?? 0) + 1);
  }
  const librosPorPersona = miembros
    .map((m) => ({
      userId: m.userId,
      nombre: m.user.name,
      avatarUrl: m.user.avatarUrl,
      libros: librosPorMiembro.get(m.userId) ?? 0,
    }))
    .filter((m) => m.libros > 0)
    .sort((a, b) => b.libros - a.libros);

  const libroDelAnio = edicionLibroDelAnio?.winnerCandidate
    ? {
        titulo: edicionLibroDelAnio.winnerCandidate.titleSnapshot,
        coverUrl: edicionLibroDelAnio.winnerCandidate.coverUrlSnapshot,
        autor: edicionLibroDelAnio.winnerCandidate.authorNameSnapshot,
      }
    : null;

  const favoritoCounts = new Map<
    string,
    { titulo: string; coverUrl: string | null; autor: string | null; votos: number }
  >();
  for (const f of favoritos) {
    const key = f.bookId;
    const actual = favoritoCounts.get(key);
    if (actual) {
      actual.votos += 1;
    } else {
      favoritoCounts.set(key, {
        titulo: f.book.title,
        coverUrl: f.book.coverUrl ?? null,
        autor: f.book.author?.name ?? null,
        votos: 1,
      });
    }
  }
  const favoritoDelClub =
    [...favoritoCounts.values()].sort((a, b) => b.votos - a.votos)[0] ?? null;

  return {
    ok: true,
    clubId: club.id,
    clubNombre: club.name,
    year,
    miembros: miembros.length,
    totalLibros,
    totalPaginas,
    totalComentarios,
    generoMasLeido,
    librosPorPersona,
    libroDelAnio,
    favoritoDelClub,
    racha: racha.racha,
  };
}

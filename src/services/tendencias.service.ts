import { prisma } from '../prisma.js';
import { getCurrentClubContext } from './club-context.service.js';

function top<T>(items: T[], limit = 5) {
  return items.slice(0, limit);
}

export async function getTendenciasClub(usuario = '') {
  const { club } = await getCurrentClubContext(usuario);
  const leyendoAhora = await prisma.library.findMany({
    where: {
      status: { in: ['READING', 'REREADING'] },
      user: { clubMemberships: { some: { clubId: club.id } } },
    },
    include: {
      user: true,
      book: {
        include: {
          genre: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  const generos = new Map<string, number>();
  const libros = new Map<
    string,
    {
      id: string;
      nombre: string;
      total: number;
      coverUrl: string;
    }
  >();
  const lectores = new Map<
    string,
    {
      id: string;
      nombre: string;
      total: number;
      avatarUrl: string;
    }
  >();

  for (const item of leyendoAhora) {
    const genero = item.book.genre?.name ?? 'Sin género';
    const libro = libros.get(item.book.id);
    const lector = lectores.get(item.user.id);

    generos.set(genero, (generos.get(genero) ?? 0) + 1);
    libros.set(item.book.id, {
      id: item.book.id,
      nombre: item.book.title,
      total: (libro?.total ?? 0) + 1,
      coverUrl: item.book.coverUrl ?? '',
    });
    lectores.set(item.user.id, {
      id: item.user.id,
      nombre: item.user.name,
      total: (lector?.total ?? 0) + 1,
      avatarUrl: item.user.avatarUrl ?? '',
    });
  }

  const generosTop = top(
    Array.from(generos.entries())
      .map(([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total),
  );

  const librosTop = top(
    Array.from(libros.values())
      .sort((a, b) => b.total - a.total),
  );

  const lectoresTop = top(
    Array.from(lectores.values())
      .sort((a, b) => b.total - a.total),
  );

  const generoPrincipal = generosTop[0];

  const titular = generoPrincipal
    ? `${generoPrincipal.nombre} domina las lecturas actuales del club.`
    : 'El club está repartido entre varias lecturas.';

  const narrador = generoPrincipal
    ? `Ahora mismo ${generoPrincipal.total} ${generoPrincipal.total === 1 ? 'persona está' : 'personas están'} leyendo ${generoPrincipal.nombre}. Parece que este género está marcando el ritmo del club.`
    : 'No hay una tendencia clara todavía. El club está explorando lecturas distintas.';

  const comparativa = await getClubVsComunidadStats(club.id);

  return {
    titular,
    narrador,
    generos: generosTop,
    libros: librosTop,
    lectoras: lectoresTop,
    totalLeyendo: leyendoAhora.length,
    comparativa,
  };
}

// ── Comparativa: tu club frente a toda la comunidad ──────────────────────────
//
// A diferencia de "leyendo ahora" (arriba), esto mira TODA la biblioteca de
// cada persona (cualquier estado), igual que "Cómo lee la comunidad" en el
// dashboard global — es la foto real de qué lee el club, no solo ahora mismo.

function toRankedList(map: Map<string, number>) {
  return Array.from(map.entries())
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total);
}

function withComunidad(
  clubTop: { nombre: string; total: number }[],
  comunidadMap: Map<string, number>,
  totalClub: number,
  totalComunidad: number,
) {
  return clubTop.map((item) => ({
    nombre: item.nombre,
    club: item.total,
    porcentajeClub: totalClub > 0 ? (item.total / totalClub) * 100 : 0,
    porcentajeComunidad:
      totalComunidad > 0
        ? ((comunidadMap.get(item.nombre) ?? 0) / totalComunidad) * 100
        : 0,
  }));
}

async function getClubVsComunidadStats(clubId: string) {
  const [clubRows, generoComunidadRows, idiomaComunidadRows, formatoComunidadRows] =
    await Promise.all([
      prisma.library.findMany({
        where: {
          user: { clubMemberships: { some: { clubId } } },
          book: { deletedAt: null },
        },
        select: {
          readingFormat: true,
          book: { select: { language: true, genre: { select: { name: true } } } },
        },
      }),
      prisma.$queryRaw<{ genero: string; count: bigint }[]>`
        SELECT g."name" AS genero, COUNT(*)::bigint AS count
        FROM "Library" l
        JOIN "Book" b ON b.id = l."bookId"
        JOIN "Genre" g ON g.id = b."genreId"
        WHERE b."deletedAt" IS NULL
        GROUP BY g."name"
      `,
      prisma.$queryRaw<{ idioma: string; count: bigint }[]>`
        SELECT b."language" AS idioma, COUNT(*)::bigint AS count
        FROM "Library" l
        JOIN "Book" b ON b.id = l."bookId"
        WHERE b."language" IS NOT NULL AND b."deletedAt" IS NULL
        GROUP BY b."language"
      `,
      prisma.library.groupBy({
        by: ['readingFormat'],
        where: { readingFormat: { not: null }, book: { deletedAt: null } },
        _count: { id: true },
      }),
    ]);

  const clubGeneros = new Map<string, number>();
  const clubIdiomas = new Map<string, number>();
  const clubFormatos = new Map<string, number>();
  for (const row of clubRows) {
    const genero = row.book.genre?.name ?? 'Sin género';
    clubGeneros.set(genero, (clubGeneros.get(genero) ?? 0) + 1);
    if (row.book.language) {
      clubIdiomas.set(row.book.language, (clubIdiomas.get(row.book.language) ?? 0) + 1);
    }
    if (row.readingFormat) {
      clubFormatos.set(row.readingFormat, (clubFormatos.get(row.readingFormat) ?? 0) + 1);
    }
  }

  const generoComunidadMap = new Map(
    generoComunidadRows.map((r) => [r.genero, Number(r.count)]),
  );
  const idiomaComunidadMap = new Map(
    idiomaComunidadRows.map((r) => [r.idioma, Number(r.count)]),
  );
  const formatoComunidadMap = new Map(
    formatoComunidadRows.map((r) => [r.readingFormat as string, Number(r._count.id)]),
  );

  const totalClubLibros = clubRows.length;
  const totalClubIdiomas = Array.from(clubIdiomas.values()).reduce((s, v) => s + v, 0);
  const totalClubFormatos = Array.from(clubFormatos.values()).reduce((s, v) => s + v, 0);
  const totalComunidadGeneros = generoComunidadRows.reduce((s, r) => s + Number(r.count), 0);
  const totalComunidadIdiomas = idiomaComunidadRows.reduce((s, r) => s + Number(r.count), 0);
  const totalComunidadFormatos = formatoComunidadRows.reduce(
    (s, r) => s + r._count.id,
    0,
  );

  return {
    generos: {
      items: withComunidad(
        top(toRankedList(clubGeneros)),
        generoComunidadMap,
        totalClubLibros,
        totalComunidadGeneros,
      ),
      totalClub: totalClubLibros,
      totalComunidad: totalComunidadGeneros,
    },
    idiomas: {
      items: withComunidad(
        top(toRankedList(clubIdiomas)),
        idiomaComunidadMap,
        totalClubIdiomas,
        totalComunidadIdiomas,
      ),
      totalClub: totalClubIdiomas,
      totalComunidad: totalComunidadIdiomas,
    },
    formatos: {
      items: withComunidad(
        top(toRankedList(clubFormatos)),
        formatoComunidadMap,
        totalClubFormatos,
        totalComunidadFormatos,
      ),
      totalClub: totalClubFormatos,
      totalComunidad: totalComunidadFormatos,
    },
  };
}

import { ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';
import { normalizeBookIdentityText } from './book-identity.service.js';
import { getClubvisionNoticeMomentFor } from '../utils/clubvision-calendar.js';
import { canonicalBookTitle } from './catalog.service.js';

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(
    date.getUTCMonth() + 1,
  ).padStart(2, '0')}`;
}

function currentMonthRange(now = new Date()) {
  // Calculamos el mes actual en Europe/Madrid para que coincida con
  // la hora local española (evita que a las 22h-00h UTC cambie de mes).
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const year  = Number(v.year);
  const month = Number(v.month) - 1; // 0-based for Date.UTC
  const start = new Date(Date.UTC(year, month, 1));
  const end   = new Date(Date.UTC(year, month + 1, 1));
  return { start, end };
}

export function isCanonicalActiveReading(status: ReadingStatus) {
  return status === ReadingStatus.READING || status === ReadingStatus.REREADING;
}

type CalendarCompletion = {
  id: string;
  bookId: string;
  startedAt: Date | null;
  finishedAt: Date;
  isReread: boolean;
  book: { id: string; title: string; coverUrl: string | null };
};

type CalendarLibraryReading = {
  id: string;
  bookId: string;
  status: ReadingStatus;
  startedAt: Date | null;
  book: { id: string; title: string; coverUrl: string | null };
};

export function buildCalendarReadings(
  completions: CalendarCompletion[],
  library: CalendarLibraryReading[],
  now: Date,
) {
  const completedPeriods = new Set(
    completions.map(({ bookId, startedAt, finishedAt, isReread }) =>
      `${bookId}:${isReread ? ReadingStatus.REREADING : ReadingStatus.READING}:${(startedAt ?? finishedAt).toISOString()}`,
    ),
  );
  // libraryId por bookId — sirve para que Flutter pueda editar fechas de completions
  const libraryIdByBookId = new Map(library.map((item) => [item.bookId, item.id]));
  return [
    ...completions.map(({ id, book, startedAt, finishedAt }) => ({
      id: `completion:${id}`,
      libraryId: libraryIdByBookId.get(book.id) ?? '',
      bookId: book.id,
      titulo: book.title,
      coverUrl: book.coverUrl ?? '',
      fechaInicio: (startedAt ?? finishedAt).toISOString(),
      fechaFin: finishedAt.toISOString(),
    })),
    ...library
      .filter(({ bookId, status, startedAt }) =>
        isCanonicalActiveReading(status) &&
        !completedPeriods.has(
          `${bookId}:${status}:${(startedAt ?? now).toISOString()}`,
        ),
      )
      .map(({ id, book, startedAt }) => ({
        id: `library:${id}`,
        libraryId: id,
        bookId: book.id,
        titulo: book.title,
        coverUrl: book.coverUrl ?? '',
        fechaInicio: (startedAt ?? now).toISOString(),
        fechaFin: now.toISOString(),
      })),
  ];
}

export function completedRating(rating: number | null | undefined) {
  return rating ?? null;
}

type ContinueSeriesContract = {
  id: string;
  nombre: string;
  estado: 'EN_CURSO' | 'PENDIENTE';
  siguiente: unknown | null;
  hasAbandonedVolume?: boolean;
};

export function shouldShowContinueSeries(series: ContinueSeriesContract) {
  return !series.hasAbandonedVolume && series.siguiente !== null;
}

export function compareContinueSeries(
  left: ContinueSeriesContract,
  right: ContinueSeriesContract,
) {
  // Contrato estable: estado, nombre localizado en español y series.id como
  // desempate final cuando dos registros comparten el mismo nombre visible.
  const priority = { EN_CURSO: 0, PENDIENTE: 1 } as const;
  const byStatus = priority[left.estado] - priority[right.estado];
  if (byStatus !== 0) return byStatus;
  const byName = left.nombre.localeCompare(right.nombre, 'es');
  return byName !== 0 ? byName : left.id.localeCompare(right.id);
}

type DashboardClub = {
  id: string;
  name: string;
};

async function eligibleClubvisionCandidates(clubId: string) {
  const previousWinners = await prisma.clubvisionResult.findMany({
    where: {
      clubId,
      winnerBookId: { not: null },
    },
    select: { winnerBookId: true },
    distinct: ['winnerBookId'],
  });
  const excludedBookIds = previousWinners.flatMap((result) =>
    result.winnerBookId ? [result.winnerBookId] : [],
  );
  const candidates = await prisma.library.groupBy({
    by: ['bookId'],
    where: {
      status: ReadingStatus.PENDING,
      user: {
        clubMemberships: {
          some: { clubId },
        },
      },
      ...(excludedBookIds.length > 0
        ? { bookId: { notIn: excludedBookIds } }
        : {}),
    },
    _count: { userId: true },
    having: {
      userId: {
        _count: { gte: 2 },
      },
    },
  });
  return candidates.length;
}

async function getClubvisionNotice(clubs: DashboardClub[], now: Date) {
  const moment = getClubvisionNoticeMomentFor(now);
  if (!moment || clubs.length === 0) return null;

  const existingEditions = await prisma.clubvision.findMany({
    where: {
      clubId: { in: clubs.map(({ id }) => id) },
      edition: moment.edition,
    },
    select: {
      clubId: true,
      _count: { select: { candidates: true } },
    },
  });
  const candidatesByClub = new Map(
    existingEditions.map(({ clubId, _count }) => [clubId, _count.candidates]),
  );

  const readyClubs = (
    await Promise.all(
      clubs.map(async (club) => {
        const candidates =
          candidatesByClub.get(club.id) ??
          (moment.type === 'GALA'
            ? 0
            : await eligibleClubvisionCandidates(club.id));
        return candidates >= 5
          ? {
              id: club.id,
              nombre: club.name,
              candidatas: candidates,
            }
          : null;
      }),
    )
  ).filter((club) => club !== null);

  if (readyClubs.length === 0) return null;
  return {
    tipo: moment.type,
    edicion: moment.edition,
    clubesPreparados: readyClubs.length,
    clubes: readyClubs,
  };
}

export async function getGeneralDashboard(userId: string) {
    const t0 = Date.now();

  const now = new Date();
  // Usamos Europe/Madrid para que el mes del dashboard coincida con la
  // hora local española, igual que el calendario de Clubvisión.
  const madridParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const madridValues = Object.fromEntries(madridParts.map((p) => [p.type, p.value]));
  const madridYear  = Number(madridValues.year);
  const madridMonth = Number(madridValues.month); // 1-12
  const { start, end } = currentMonthRange(now);

  // Limita las finalizaciones a los últimos 2 años:
  // cubre el streak (máx ~24 meses) y la estantería anual sin traer historial completo.
  const completionsWindowStart = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));

  const [
    user,
    completions,
    finishedLibrary,
    monthLibrary,
    popularGroups,
    totals,
    personalLibrary,
    seriesLibrary,
    communityFormats,
    latestBooks,
    hiddenSeries,
    trendingAuthorsRaw,
  ] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        include: {
          clubMemberships: {
            orderBy: { joinedAt: 'asc' },
            include: {
              club: {
                include: {
                  _count: {
                    select: { members: true },
                  },
                  readings: {
                    where: { status: 'ACTIVE' },
                    select: { id: true },
                  },
                },
              },
            },
          },
          library: {
            where: {
              status: {
                in: [ReadingStatus.READING, ReadingStatus.REREADING],
              },
            },
            orderBy: { updatedAt: 'desc' },
            take: 4,
            include: { book: { include: { genre: true } } },
          },
        },
      }),
      // Solo últimos 2 años y campos mínimos necesarios
      prisma.readingCompletion.findMany({
        where: {
          userId,
          finishedAt: { gte: completionsWindowStart },
        },
        orderBy: { finishedAt: 'desc' },
        select: {
          id: true,
          finishedAt: true,
          startedAt: true,
          isReread: true,
          rating: true,
          bookId: true,
          book: {
            select: {
              id: true,
              title: true,
              coverUrl: true,
              totalPages: true,
            },
          },
        },
      }),
      prisma.library.findMany({
        where: { userId, status: ReadingStatus.FINISHED },
        select: {
          bookId: true,
          book: { select: { totalPages: true } },
        },
      }),
      prisma.library.findMany({
        where: {
          userId,
          startedAt: { lt: end },
          OR: [
            { finishedAt: { gte: start } },
            {
              status: {
                in: [ReadingStatus.READING, ReadingStatus.REREADING],
              },
            },
          ],
        },
        include: { book: true },
      }),
      prisma.library.groupBy({
        by: ['bookId'],
        where: {
          status: {
            in: [ReadingStatus.READING, ReadingStatus.REREADING],
          },
        },
        _count: { userId: true },
        orderBy: { _count: { userId: 'desc' } },
        take: 6,
      }),
      Promise.all([
        prisma.club.count(),
        prisma.user.count({
          where: {
            OR: [
              { passwordHash: { not: null } },
              { clubMemberships: { some: {} } },
            ],
          },
        }),
        prisma.library.count({
          where: {
            status: {
              in: [ReadingStatus.READING, ReadingStatus.REREADING],
            },
          },
        }),
      ]),
      prisma.library.findMany({
        where: {
          userId,
          status: ReadingStatus.PENDING,
        },
        include: {
          book: {
            include: { genre: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.library.findMany({
        where: {
          userId,
          book: { seriesId: { not: null } },
        },
        include: {
          book: {
            include: {
              series: {
                include: {
                  books: {
                    where: { deletedAt: null },
                    orderBy: { seriesOrder: 'asc' },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.library.groupBy({
        by: ['readingFormat'],
        where: { readingFormat: { not: null } },
        _count: { id: true },
      }),
      // Las incorporaciones son altas reales en bibliotecas personales. El
      // catálogo también recibe libros desde sincronizadores externos y esos
      // deben mostrarse en «Próximos lanzamientos», no en este bloque.
      // La exclusión de importados se hace en un segundo paso (ver más abajo)
      // porque Prisma no admite filtros correlacionados entre Library.userId
      // e ImportRowReceipt.userId en un solo where.
      //
      // IMPORTANTE: ordenar por book.createdAt (fecha de alta del libro en el
      // catálogo), NO por Library.createdAt (fecha en que un usuario lo añadió
      // a su propia biblioteca). Así, añadir a tu lista un libro que ya llevaba
      // meses en el catálogo no lo hace aparecer como «nueva incorporación».
      prisma.library.findMany({
        where: { book: { deletedAt: null } },
        orderBy: { book: { createdAt: 'desc' } },
        // Traemos margen para poder colapsar ediciones equivalentes y seguir
        // mostrando hasta 10 obras distintas.
        take: 60,
        select: {
          userId: true,  // necesario para identificar imports por (userId, bookId)
          book: {
            select: {
              id: true,
              title: true,
              coverUrl: true,
              createdAt: true,  // fecha real de alta en el catálogo
              author: { select: { name: true } },
              genre: { select: { name: true } },
            },
          },
        },
      }),
      prisma.hiddenUserSeries.findMany({
        where: { userId },
        select: { seriesId: true },
      }),

      // Autoras trending: groupBy en PostgreSQL, sin escanear Library global en Node
      prisma.book.groupBy({
        by: ['authorId'],
        where: {
          authorId: { not: null },
          deletedAt: null,
          library: { some: {} },
          author: { deletedAt: null },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ]);
  console.log(`[dashboard] Promise.all: ${Date.now() - t0}ms`);
  if (!user) return null;

  // Excluir de «Últimas incorporaciones» las entradas que llegaron vía
  // importación externa (Goodreads, Bookmory…).
  // ImportRowReceipt guarda el par (userId, bookId) de cada import; cruzamos
  // con las 40 entradas recientes para hacer la exclusión por (userId, bookId)
  // específico: así si Paula importa un libro y María lo añade manualmente,
  // el de Paula se oculta pero el de María sigue apareciendo en el feed global.
  const importedKeys: Set<string> = latestBooks.length > 0
    ? new Set(
        (
          await prisma.importRowReceipt.findMany({
            where: {
              OR: latestBooks.map((e) => ({
                userId: e.userId,
                bookId: e.book.id,
              })),
            },
            select: { userId: true, bookId: true },
          })
        ).map((r) => `${r.userId}:${r.bookId}`),
      )
    : new Set();

  const filteredLatestBooks = latestBooks.filter(
    (e) => !importedKeys.has(`${e.userId}:${e.book.id}`),
  );

  // Resolver nombres y fotos de las autoras trending en una sola query IN
  const trendingAuthorIds = trendingAuthorsRaw
    .map((r) => r.authorId)
    .filter((id): id is string => id !== null);

  const trendingAuthorDetails = trendingAuthorIds.length > 0
    ? await prisma.author.findMany({
        where: { id: { in: trendingAuthorIds } },
        select: { id: true, name: true, photoUrl: true },
      })
    : [];

  const authorDetailsById = new Map(
    trendingAuthorDetails.map((a) => [a.id, a]),
  );

  const trendingAuthors = trendingAuthorsRaw
    .map((r) => {
      const author = r.authorId ? authorDetailsById.get(r.authorId) : null;
      if (!author) return null;
      return {
        id: author.id,
        nombre: author.name,
        photoUrl: author.photoUrl ?? '',
        libros: r._count.id,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const clubvisionNotice = await getClubvisionNotice(
    user.clubMemberships.map(({ club }) => ({
      id: club.id,
      name: club.name,
    })),
    now,
  );

  const popularBooks = await prisma.book.findMany({
    where: { id: { in: popularGroups.map((item) => item.bookId) } },
  });
  const popularById = new Map(
    popularGroups.map((item) => [item.bookId, item._count.userId]),
  );
  const monthCompletions = completions.filter(
    ({ finishedAt }) => finishedAt >= start && finishedAt < end,
  );
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const yearEnd = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
  const yearCompletions = completions.filter(
    ({ finishedAt }) => finishedAt >= yearStart && finishedAt < yearEnd,
  );
  const monthLibraryByBookId = new Map(
    monthLibrary.map((item) => [item.bookId, item]),
  );
  const completedBookIds = new Set([
    ...completions.map((item) => item.bookId),
    ...finishedLibrary.map((item) => item.bookId),
  ]);
  const pagesByCompletedBook = new Map<string, number>();
  for (const item of completions) {
    pagesByCompletedBook.set(item.bookId, item.book.totalPages ?? 0);
  }
  for (const item of finishedLibrary) {
    if (!pagesByCompletedBook.has(item.bookId)) {
      pagesByCompletedBook.set(item.bookId, item.book.totalPages ?? 0);
    }
  }
  const pagesForBook = (bookId: string, totalPages: number | null) => {
    if (totalPages != null && totalPages > 0) return totalPages;
    const currentPage = monthLibraryByBookId.get(bookId)?.currentPage;
    return currentPage != null && currentPage > 0 ? currentPage : 0;
  };
  const calendarReadings = buildCalendarReadings(
    monthCompletions,
    monthLibrary,
    now,
  );
  const months = new Set(completions.map(({ finishedAt }) => monthKey(finishedAt)));
  const libraryByBookId = new Map(
    seriesLibrary.map((item) => [item.bookId, item]),
  );
  type PersonalSeries = NonNullable<
    (typeof seriesLibrary)[number]['book']['series']
  >;
  const personalSeries = new Map<string, PersonalSeries>();
  const hiddenSeriesIds = new Set(hiddenSeries.map(({ seriesId }) => seriesId));
  const abandonedSeriesIds = new Set(
    seriesLibrary
      .filter(({ status }) => status === ReadingStatus.ABANDONED)
      .flatMap(({ book }) => book.series ? [book.series.id] : []),
  );
  for (const item of seriesLibrary) {
    if (
      item.book.series &&
      !hiddenSeriesIds.has(item.book.series.id) &&
      !abandonedSeriesIds.has(item.book.series.id)
    ) {
      const key = canonicalBookTitle(item.book.series.name);
      const current = personalSeries.get(key);
      if (!current) {
        personalSeries.set(key, {
          ...item.book.series,
          books: [...item.book.series.books],
        });
        continue;
      }
      const books = new Map(current.books.map((book) => [book.id, book]));
      for (const book of item.book.series.books) {
        books.set(book.id, book);
      }
      personalSeries.set(key, {
        ...current,
        publicationStatus:
          current.publicationStatus === 'COMPLETED' ||
          item.book.series.publicationStatus === 'COMPLETED'
            ? 'COMPLETED'
            : current.publicationStatus === 'ONGOING' ||
                item.book.series.publicationStatus === 'ONGOING'
              ? 'ONGOING'
              : 'UNKNOWN',
        totalBooks: Math.max(
          current.totalBooks ?? 0,
          item.book.series.totalBooks ?? 0,
        ) || null,
        books: [...books.values()],
      });
    }
  }
  const seriesNumber = (value: string | null) => {
    const text = value?.trim().replace(',', '.') ?? '';
    const fraction = /^(\d+)\s*(?:\/|de)\s*(\d+)$/i.exec(text);
    const position = Number.parseFloat(fraction?.[1] ?? text);
    const total = fraction ? Number(fraction[2]) : null;
    return {
      position: Number.isFinite(position)
        ? position
        : Number.MAX_SAFE_INTEGER,
      total,
    };
  };
  const openSeries = [...personalSeries.values()]
    .map((series) => {
      const byPosition = new Map<number, (typeof series.books)[number]>();
      for (const book of series.books) {
        const position = seriesNumber(book.seriesOrder).position;
        const current = byPosition.get(position);
        if (
          !current ||
          (libraryByBookId.has(book.id) && !libraryByBookId.has(current.id)) ||
          (!current.coverUrl && Boolean(book.coverUrl))
        ) {
          byPosition.set(position, book);
        }
      }
      const books = [...byPosition.values()].sort(
        (left, right) =>
          seriesNumber(left.seriesOrder).position -
          seriesNumber(right.seriesOrder).position,
      );
      const read = books.filter((book) => completedBookIds.has(book.id)).length;
      const declaredTotal = books.reduce(
        (highest, book) =>
          Math.max(highest, seriesNumber(book.seriesOrder).total ?? 0),
        0,
      );
      const total = Math.max(
        series.totalBooks ?? 0,
        books.length,
        declaredTotal,
        ...books.map((book) =>
          Math.ceil(seriesNumber(book.seriesOrder).position ===
              Number.MAX_SAFE_INTEGER
            ? 0
            : seriesNumber(book.seriesOrder).position),
        ),
      );
      const next = books.find((book) => !completedBookIds.has(book.id)) ?? null;
      const hasActiveReading = books.some((book) => {
        const status = libraryByBookId.get(book.id)?.status;
        return (
          status === ReadingStatus.READING ||
          status === ReadingStatus.REREADING
        );
      });
      const representativeCover =
        next?.coverUrl?.trim() ||
        [...books]
          .reverse()
          .find(
            (book) =>
              completedBookIds.has(book.id) && Boolean(book.coverUrl?.trim()),
          )
          ?.coverUrl?.trim() ||
        books.find((book) => Boolean(book.coverUrl?.trim()))?.coverUrl?.trim() ||
        '';
      const estado = (read > 0 || hasActiveReading
        ? 'EN_CURSO'
        : 'PENDIENTE') as 'EN_CURSO' | 'PENDIENTE';
      return {
        id: series.id,
        nombre: series.name,
        leidos: read,
        total,
        estado,
        estadoEditorial: series.publicationStatus,
        iniciada: read > 0 || hasActiveReading,
        coverUrl: representativeCover,
        siguiente: next
          ? {
              id: next.id,
              titulo: next.title,
              coverUrl: next.coverUrl?.trim() || representativeCover,
              enMiBiblioteca: libraryByBookId.has(next.id),
            }
          : null,
        hasAbandonedVolume: abandonedSeriesIds.has(series.id),
      };
    })
    .filter(shouldShowContinueSeries)
    .sort(compareContinueSeries)
    .slice(0, 6);
  let streak = 0;
  const cursor = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  while (months.has(monthKey(cursor))) {
    streak += 1;
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }

  const events = new Map<
    string,
    { dia: number; tipos: Set<string>; libros: Set<string> }
  >();
  const addEvent = (
    date: Date | null,
    type: string,
    book: string,
  ) => {
    if (!date || date < start || date >= end) return;
    const key = date.toISOString().slice(0, 10);
    const event = events.get(key) ?? {
      dia: date.getUTCDate(),
      tipos: new Set<string>(),
      libros: new Set<string>(),
    };
    event.tipos.add(type);
    event.libros.add(book);
    events.set(key, event);
  };
  for (const item of monthLibrary) {
    addEvent(item.startedAt, 'INICIO', item.book.title);
    addEvent(item.progressUpdatedAt, 'PROGRESO', item.book.title);
    addEvent(item.finishedAt, 'FIN', item.book.title);
  }

  return {
    ok: true,
    usuario: {
      nombre: user.name,
      avatarUrl: user.avatarUrl ?? '',
    },
    resumen: {
      clubes: user.clubMemberships.length,
      leyendo: user.library.length,
      terminados: completedBookIds.size,
      terminadosMes: monthCompletions.length,
      paginasMes: monthCompletions.reduce(
        (total, item) => total + pagesForBook(item.book.id, item.book.totalPages),
        0,
      ),
      paginasLeidas: [...pagesByCompletedBook.values()].reduce(
        (total, pages) => total + pages,
        0,
      ),
      rachaMeses: streak,
    },
    clubes: user.clubMemberships.map(({ role, club }) => ({
      id: club.id,
      nombre: club.name,
      descripcion: club.description ?? '',
      avatarUrl: club.avatarUrl ?? '',
      rol: role,
      tipo: club.tipo,
      activo: user.activeClubId === club.id,
      miembros: club._count.members,
      lecturasActivas: club.readings.length,
    })),
    leyendoAhora: user.library.map(({ book, lastProgress, currentPage }) => ({
      id: book.id,
      titulo: book.title,
      genero: book.genre.name,
      coverUrl: book.coverUrl ?? '',
      progreso: lastProgress ?? 0,
      paginaActual: currentPage,
      paginas: book.totalPages,
    })),
    miBiblioteca: personalLibrary
      .sort((left, right) => {
        const priority = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
        const byPriority =
          priority[left.priority] - priority[right.priority];
        if (byPriority !== 0) return byPriority;
        return right.updatedAt.getTime() - left.updatedAt.getTime();
      })
      .slice(0, 16)
      .map(({ book, priority, readingFormat, status }) => ({
        id: book.id,
        titulo: book.title,
        genero: book.genre.name,
        coverUrl: book.coverUrl ?? '',
        estado:
          status === ReadingStatus.READING
            ? 'LEYENDO'
            : status === ReadingStatus.REREADING
              ? 'RELECTURA'
              : 'PENDIENTE',
        formato:
          readingFormat === 'PHYSICAL'
            ? 'FISICO'
            : readingFormat === 'AUDIOBOOK'
              ? 'AUDIOLIBRO'
              : readingFormat === 'DIGITAL'
                ? 'DIGITAL'
                : '',
        prioridad:
          priority === 'HIGH'
            ? 'ALTA'
            : priority === 'LOW'
              ? 'BAJA'
              : 'MEDIA',
      })),
    ultimasIncorporaciones: deduplicateLatestBooks(
      // book.createdAt = fecha de alta del libro en el catálogo global,
      // independientemente de cuándo cada usuario lo añadió a su biblioteca.
      filteredLatestBooks.map(({ book }) => ({ ...book, createdAt: book.createdAt })),
      10,
    ).map((book) => ({
      id: book.id,
      titulo: book.title,
      autor: book.author?.name ?? '',
      genero: book.genre.name,
      coverUrl: book.coverUrl ?? '',
      fechaAlta: book.createdAt.toISOString(),
    })),
    clubvisionAviso: clubvisionNotice,
    sagasAbiertas: openSeries,
    estanteriaAnual: yearCompletions.map(
      ({ id, book, finishedAt, isReread }) => ({
        id,
        bookId: book.id,
        titulo: book.title,
        coverUrl: book.coverUrl ?? '',
        fechaFin: finishedAt.toISOString(),
        relectura: isReread,
      }),
    ),
    calendario: {
      anio: madridYear,
      mes: madridMonth,
      librosLeidos: monthCompletions.map(({ id, book, finishedAt, rating }) => ({
        id: `${id}:${book.id}`,
        bookId: book.id,
        titulo: book.title,
        coverUrl: book.coverUrl ?? '',
        fechaFin: finishedAt.toISOString(),
        paginas: pagesForBook(book.id, book.totalPages),
        valoracion: completedRating(rating),
      })),
      lecturasCalendario: calendarReadings,
      eventos: [...events.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([fecha, event]) => ({
          fecha,
          dia: event.dia,
          tipos: [...event.tipos],
          libros: [...event.libros],
        })),
    },
    tendencias: popularBooks
      .map((book) => ({
        id: book.id,
        titulo: book.title,
        coverUrl: book.coverUrl ?? '',
        lectoras: popularById.get(book.id) ?? 0,
      }))
      .sort((left, right) => right.lectoras - left.lectoras),
    autoresTendencia: trendingAuthors,
    comunidad: {
      clubes: totals[0],
      lectoras: totals[1],
      lecturasActivas: totals[2],
      formatos: {
        fisico:
          communityFormats.find(
            ({ readingFormat }) => readingFormat === 'PHYSICAL',
          )?._count.id ?? 0,
        digital:
          communityFormats.find(
            ({ readingFormat }) => readingFormat === 'DIGITAL',
          )?._count.id ?? 0,
        audiolibro:
          communityFormats.find(
            ({ readingFormat }) => readingFormat === 'AUDIOBOOK',
          )?._count.id ?? 0,
        total: communityFormats.reduce(
          (sum, item) => sum + item._count.id,
          0,
        ),
      },
    },
  };
}

type LatestBookCandidate = {
  title: string;
  coverUrl: string | null;
  author?: { name: string } | null;
};

export function deduplicateLatestBooks<T extends LatestBookCandidate>(books: T[], limit = 10) {
  const grouped: Array<{ title: string; authorTokens: Set<string>; book: T }> = [];
  for (const book of books) {
    const title = normalizeBookIdentityText(book.title);
    const authorTokens = new Set(normalizeBookIdentityText(book.author?.name).split(' ').filter(Boolean));
    const current = grouped.find((item) => {
      if (item.title !== title || item.authorTokens.size === 0 || authorTokens.size === 0) return false;
      const smaller = item.authorTokens.size <= authorTokens.size ? item.authorTokens : authorTokens;
      const larger = smaller === item.authorTokens ? authorTokens : item.authorTokens;
      return [...smaller].every((token) => larger.has(token));
    });
    if (!current) {
      grouped.push({ title, authorTokens, book });
    } else if (!current.book.coverUrl?.trim() && book.coverUrl?.trim()) {
      current.book = book;
    }
  }
  return grouped.map(({ book }) => book).slice(0, limit);
}

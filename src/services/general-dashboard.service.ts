import { ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(
    date.getUTCMonth() + 1,
  ).padStart(2, '0')}`;
}

function currentMonthRange(now = new Date()) {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return { start, end };
}

export async function getGeneralDashboard(userId: string) {
  const now = new Date();
  const { start, end } = currentMonthRange(now);
  const [
    user,
    completions,
    monthLibrary,
    popularGroups,
    totals,
    personalLibrary,
    seriesLibrary,
    communityFormats,
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
      prisma.readingCompletion.findMany({
        where: { userId },
        orderBy: { finishedAt: 'desc' },
        include: { book: true },
      }),
      prisma.library.findMany({
        where: {
          userId,
          startedAt: { lt: end },
          OR: [
            { finishedAt: { gte: start } },
            {
              status: {
                in: [
                  ReadingStatus.READING,
                  ReadingStatus.REREADING,
                  ReadingStatus.PAUSED,
                ],
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
    ]);

  if (!user) return null;

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
  const pagesForBook = (bookId: string, totalPages: number | null) => {
    if (totalPages != null && totalPages > 0) return totalPages;
    const currentPage = monthLibraryByBookId.get(bookId)?.currentPage;
    return currentPage != null && currentPage > 0 ? currentPage : 0;
  };
  const calendarReadings = [
    ...monthCompletions.map(({ id, book, startedAt, finishedAt }) => ({
      id: `completion:${id}`,
      bookId: book.id,
      titulo: book.title,
      coverUrl: book.coverUrl ?? '',
      fechaInicio: (startedAt ?? finishedAt).toISOString(),
      fechaFin: finishedAt.toISOString(),
    })),
    ...monthLibrary
      .filter(
        ({ status }) =>
          status === ReadingStatus.READING ||
          status === ReadingStatus.REREADING ||
          status === ReadingStatus.PAUSED,
      )
      .map(({ id, book, startedAt }) => ({
        id: `library:${id}`,
        bookId: book.id,
        titulo: book.title,
        coverUrl: book.coverUrl ?? '',
        fechaInicio: (startedAt ?? now).toISOString(),
        fechaFin: now.toISOString(),
      })),
  ];
  const months = new Set(completions.map(({ finishedAt }) => monthKey(finishedAt)));
  const completedBookIds = new Set(completions.map((item) => item.bookId));
  const libraryByBookId = new Map(
    seriesLibrary.map((item) => [item.bookId, item]),
  );
  const personalSeries = new Map<
    string,
    NonNullable<(typeof seriesLibrary)[number]['book']['series']>
  >();
  for (const item of seriesLibrary) {
    if (item.book.series) {
      personalSeries.set(item.book.series.id, item.book.series);
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
      return {
        id: series.id,
        nombre: series.name,
        leidos: read,
        total,
        siguiente: next
          ? {
              id: next.id,
              titulo: next.title,
              coverUrl: next.coverUrl ?? '',
              enMiBiblioteca: libraryByBookId.has(next.id),
            }
          : null,
      };
    })
    .filter((series) => series.leidos > 0 && series.leidos < series.total)
    .sort((left, right) => right.leidos - left.leidos)
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
      terminados: completions.length,
      terminadosMes: monthCompletions.length,
      paginasLeidas: completions.reduce(
        (total, item) => total + (item.book.totalPages ?? 0),
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
      anio: now.getUTCFullYear(),
      mes: now.getUTCMonth() + 1,
      librosLeidos: monthCompletions.map(({ id, book, finishedAt }) => ({
        id: `${id}:${book.id}`,
        bookId: book.id,
        titulo: book.title,
        coverUrl: book.coverUrl ?? '',
        fechaFin: finishedAt.toISOString(),
        paginas: pagesForBook(book.id, book.totalPages),
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

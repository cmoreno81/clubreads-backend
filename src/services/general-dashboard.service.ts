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
          OR: [
            { startedAt: { gte: start, lt: end } },
            { finishedAt: { gte: start, lt: end } },
            { progressUpdatedAt: { gte: start, lt: end } },
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
    ]);

  if (!user) return null;

  const popularBooks = await prisma.book.findMany({
    where: { id: { in: popularGroups.map((item) => item.bookId) } },
  });
  const popularById = new Map(
    popularGroups.map((item) => [item.bookId, item._count.userId]),
  );
  const months = new Set(completions.map(({ finishedAt }) => monthKey(finishedAt)));
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
      terminadosMes: completions.filter(
        ({ finishedAt }) => finishedAt >= start && finishedAt < end,
      ).length,
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
      .map(({ book, priority }) => ({
        id: book.id,
        titulo: book.title,
        genero: book.genre.name,
        coverUrl: book.coverUrl ?? '',
        prioridad:
          priority === 'HIGH'
            ? 'ALTA'
            : priority === 'LOW'
              ? 'BAJA'
              : 'MEDIA',
      })),
    calendario: {
      anio: now.getUTCFullYear(),
      mes: now.getUTCMonth() + 1,
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
    },
  };
}

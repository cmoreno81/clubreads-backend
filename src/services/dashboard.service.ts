import { prisma } from '../prisma.js';
import { getClubvisionSnapshot } from './clubvision.service.js';
import { ratingToFlutter } from '../utils/rating.utils.js';
import { activityTimestamp } from '../utils/activity-timestamp.js';
import { getCurrentClubContext } from './club-context.service.js';
import { logger } from '../logging/logger.js';

function ratingAverage(ratings: number[]) {
  if (ratings.length === 0) return '0';

  const total = ratings.reduce((sum, rating) => sum + rating, 0);
  return (total / ratings.length).toFixed(2);
}

export function madridMonthRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const year = Number(v.year);
  const monthIndex = Number(v.month) - 1;
  const zonedMonthStart = (targetYear: number, targetMonth: number) => {
    const guess = new Date(Date.UTC(targetYear, targetMonth, 1));
    const offsetName = new Intl.DateTimeFormat('en', {
      timeZone: 'Europe/Madrid',
      timeZoneName: 'longOffset',
    }).formatToParts(guess).find(({ type }) => type === 'timeZoneName')?.value ?? 'GMT+00:00';
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offsetName);
    const offsetMinutes = match
      ? (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]))
      : 0;
    return new Date(guess.getTime() - offsetMinutes * 60_000);
  };
  return {
    start: zonedMonthStart(year, monthIndex),
    end: zonedMonthStart(year, monthIndex + 1),
  };
}

async function dashboardBlock<T>(
  block: string,
  operation: () => Promise<T>,
  rows: (result: T) => number,
) {
  const started = process.hrtime.bigint();
  try {
    const result = await operation();
    logger.info({
      event: 'dashboard_block',
      block,
      durationMs: Math.round(Number(process.hrtime.bigint() - started) / 10_000) / 100,
      rows: rows(result),
    }, 'dashboard block completed');
    return result;
  } catch (error) {
    logger.warn({
      event: 'dashboard_block',
      block,
      durationMs: Math.round(Number(process.hrtime.bigint() - started) / 10_000) / 100,
      outcome: 'error',
    }, 'dashboard block failed');
    throw error;
  }
}

function getMood(valoracionMedia: string) {
  const media = Number(valoracionMedia);

  if (media >= 4.4) return 'El club está enamorado de las últimas lecturas 💜';
  if (media >= 4) return 'Las últimas lecturas están gustando mucho 📚';
  if (media >= 3.5) return 'Hay opiniones para todos los gustos 🤔';
  if (media > 0) return 'Necesitamos una lectura que nos reconcilie con el club 😅';

  return 'El club está preparando nuevas lecturas.';
}

function contarReaccionesProgreso(
  reactions: Array<{ reaction: string }>,
) {
  return Object.fromEntries(
    ['LIKE', 'AGREE', 'ANGRY', 'FUNNY', 'THUMBS_UP', 'CRY', 'WOW', 'SWEAR', 'CLAP'].map(
      (reaction) => [
        reaction,
        reactions.filter((item) => item.reaction === reaction).length,
      ],
    ),
  );
}

type AffinityMember = {
  userId: string;
  user: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
};

type AffinityCompletion = {
  userId?: string;
  bookId: string;
};

type AffinityDataSource = {
  clubMember: {
    findMany(args: unknown): Promise<AffinityMember[]>;
  };
  readingCompletion: {
    findMany(args: unknown): Promise<AffinityCompletion[]>;
  };
};

export async function getAnnualAffinityRanking(
  clubId: string,
  userId: string,
  yearStart: Date,
  dataSource = prisma as unknown as AffinityDataSource,
) {
  const nextYearStart = new Date(
    Date.UTC(yearStart.getUTCFullYear() + 1, 0, 1),
  );
  const myCompletions = await dataSource.readingCompletion.findMany({
    where: {
      userId,
      finishedAt: { gte: yearStart, lt: nextYearStart },
    },
    select: { bookId: true },
  });
  const myBookIds = myCompletions.map((completion) => completion.bookId);

  if (myBookIds.length === 0) return [];

  const members = await dataSource.clubMember.findMany({
    where: { clubId, userId: { not: userId } },
    select: {
      userId: true,
      user: {
        select: { id: true, name: true, avatarUrl: true },
      },
    },
  });

  if (members.length === 0) return [];

  const memberIds = members.map((member) => member.userId);
  const otherCompletions = await dataSource.readingCompletion.findMany({
    where: {
      userId: { in: memberIds },
      finishedAt: { gte: yearStart, lt: nextYearStart },
      bookId: { in: myBookIds },
    },
    select: { userId: true, bookId: true },
  });

  const commonBooksByUser = new Map<string, number>();
  for (const completion of otherCompletions) {
    if (!completion.userId) continue;
    commonBooksByUser.set(
      completion.userId,
      (commonBooksByUser.get(completion.userId) ?? 0) + 1,
    );
  }

  return members
    .map((member) => ({
      id: member.user.id,
      nombre: member.user.name,
      avatarUrl: member.user.avatarUrl ?? '',
      librosComunes: commonBooksByUser.get(member.userId) ?? 0,
    }))
    .filter((affinity) => affinity.librosComunes > 0)
    .sort((a, b) => b.librosComunes - a.librosComunes)
    .slice(0, 5);
}


type DashboardRuntime = {
  client?: typeof prisma;
  getContext?: typeof getCurrentClubContext;
  clubvisionSnapshot?: typeof getClubvisionSnapshot;
  affinity?: typeof getAnnualAffinityRanking;
};

export async function getDashboard(usuario = '', runtime: DashboardRuntime = {}) {
  const client = runtime.client ?? prisma;
  const getContext = runtime.getContext ?? getCurrentClubContext;
  const clubvisionSnapshot = runtime.clubvisionSnapshot ?? getClubvisionSnapshot;
  const affinity = runtime.affinity ?? getAnnualAffinityRanking;
  const context = await dashboardBlock(
    'context', () => getContext(usuario), () => 1,
  );
  const { club, user } = context;
  const { start: monthStart, end: monthEnd } = madridMonthRange();
  const yearStart = new Date(Date.UTC(new Date().getFullYear(), 0, 1));

  const [monthlyCompletionsRaw, reviewAggregate, leyendoAhora, clubvision, rankingAfinidad] = await Promise.all([
    dashboardBlock('monthly_completions', () => client.readingCompletion.findMany({
      where: {
        finishedAt: { gte: monthStart, lt: monthEnd },
        user: { clubMemberships: { some: { clubId: club.id } } },
      },
      select: { userId: true, bookId: true },
    }), (rows) => rows.length),
    dashboardBlock('review_average', () => client.review.aggregate({
      where: {
        rating: { gt: 0 },
        user: { clubMemberships: { some: { clubId: club.id } } },
      },
      _avg: { rating: true },
    }), (result) => result._avg.rating === null ? 0 : 1),
    dashboardBlock('currently_reading', () => client.library.findMany({
      where: {
        status: { in: ['READING', 'REREADING'] },
        user: { clubMemberships: { some: { clubId: club.id } } },
      },
      select: {
        id: true,
        lastProgress: true,
        currentPage: true,
        progressNote: true,
        progressUpdatedAt: true,
        user: { select: { name: true, avatarUrl: true } },
        book: {
          select: {
            id: true, title: true, coverUrl: true, totalPages: true,
            genre: { select: { name: true } },
          },
        },
        progressReactions: { select: { userId: true, reaction: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }), (rows) => rows.length),
    dashboardBlock(
      'clubvision_snapshot',
      () => clubvisionSnapshot(usuario, context),
      (result) => result.totalCandidatas,
    ),
    user
      ? dashboardBlock(
          'affinity',
          () => affinity(
            club.id,
            user.id,
            yearStart,
            client as unknown as AffinityDataSource,
          ),
          (rows) => rows.length,
        )
      : Promise.resolve([]),
  ]);

  // Excluir libros importados de Goodreads/Bookmory del ranking mensual
  const importedRankingKeys: Set<string> = monthlyCompletionsRaw.length > 0
    ? new Set(
        (await prisma.importRowReceipt.findMany({
          where: { OR: monthlyCompletionsRaw.map(c => ({ userId: c.userId, bookId: c.bookId })) },
          select: { userId: true, bookId: true },
        })).map(r => `${r.userId}:${r.bookId}`)
      )
    : new Set();

  const genuineCompletions = monthlyCompletionsRaw.filter(
    c => !importedRankingKeys.has(`${c.userId}:${c.bookId}`)
  );

  // Reconstruir monthlyGroups con el mismo shape que el antiguo groupBy
  const rawCountByUser = new Map<string, number>();
  for (const c of genuineCompletions) {
    rawCountByUser.set(c.userId, (rawCountByUser.get(c.userId) ?? 0) + 1);
  }
  const monthlyGroups = [...rawCountByUser.entries()].map(([userId, count]) => ({
    userId,
    _count: { id: count },
  }));

  const monthlyUsers = monthlyGroups.length === 0
    ? []
    : await dashboardBlock('monthly_readers', () => client.user.findMany({
        where: { id: { in: monthlyGroups.map(({ userId }) => userId) } },
        select: { id: true, name: true, avatarUrl: true },
      }), (rows) => rows.length);

  const contadorUsuarios = new Map<string, number>();
  const monthlyCountByUser = new Map(
    monthlyGroups.map((item) => [item.userId, item._count.id]),
  );
  for (const item of monthlyUsers) {
    contadorUsuarios.set(
      item.name,
      monthlyCountByUser.get(item.id) ?? 0,
    );
  }

  const topUsuario = Array.from(contadorUsuarios.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'),
  )[0];
  const avatarPorUsuario = new Map(
    monthlyUsers.map((item) => [item.name, item.avatarUrl ?? '']),
  );
  const topLectorasMes = Array.from(contadorUsuarios.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    .slice(0, 3)
    .map(([usuario, total]) => ({
      usuario,
      nombre: usuario,
      avatarUrl: avatarPorUsuario.get(usuario) ?? '',
      total,
    }));

  const leyendoPorUsuario = new Map<
    string,
    {
      libros: string[];
      lecturas: Array<{
        bookId: string;
        titulo: string;
        coverUrl: string;
        progreso: number;
        paginaActual: number | null;
        paginasTotales: number | null;
        comentario: string;
        actualizadoEn: string;
        libraryId: string;
        reacciones: Record<string, number>;
        miReaccion: string | null;
      }>;
      avatarUrl: string;
    }
  >();
  for (const item of leyendoAhora) {
    const actual = leyendoPorUsuario.get(item.user.name) ?? {
      libros: [],
      lecturas: [],
      avatarUrl: item.user.avatarUrl ?? '',
    };

    actual.libros.push(item.book.title);
    actual.lecturas.push({
      bookId: item.book.id,
      titulo: item.book.title,
      coverUrl: item.book.coverUrl ?? '',
      progreso: item.lastProgress ?? 0,
      paginaActual: item.currentPage,
      paginasTotales: item.book.totalPages,
      comentario: item.progressNote ?? '',
      actualizadoEn: item.progressUpdatedAt?.toISOString() ?? '',
      libraryId: item.id,
      reacciones: contarReaccionesProgreso(item.progressReactions),
      miReaccion:
        item.progressReactions.find(
          (reaction) => reaction.userId === user?.id,
        )?.reaction ?? null,
    });

    leyendoPorUsuario.set(item.user.name, actual);
  }

  const leyendoAhoraResponse = Array.from(leyendoPorUsuario.entries()).map(
    ([usuario, datos]) => ({
      usuario,
      libros: datos.libros,
      lecturas: datos.lecturas,
      total: datos.libros.length,
      avatarUrl: datos.avatarUrl,
    }),
  );

  let ganador = clubvision.ganador || '';
  let winnerBookId = clubvision.ganadorBookId || '';
  let ganadorCoverUrl = clubvision.ganadorCoverUrl || '';

  // Un club de ≤5 miembros nunca puede abrir una votación real (ver
  // sinCandidatas en getClubvision): para esos siempre priorizamos "Proponer
  // lectura" en vez de buscar una lectura de respaldo, aunque tengan alguna
  // marcada ACTIVE en la base de datos de cuando sí la tuvieron (p. ej. una
  // lectura de hace semanas que ya nadie sigue) — proponer una nueva es lo
  // correcto ahí, no resucitar la antigua.
  if (!ganador && clubvision.totalUsuarios > 5) {
    // Esta edición de Clubvisión puede no tener ganadora (sin candidatas
    // suficientes este mes) y aun así el club sigue leyendo oficialmente un
    // libro elegido en una edición anterior, o configurado a mano. Sin este
    // respaldo, la tarjeta de "lectura actual" desaparecía del dashboard
    // aunque el club siguiera leyendo algo en curso.
    const lecturaActiva = await dashboardBlock(
      'active_official_reading',
      () => client.reading.findFirst({
        // Sin filtrar por type: una lectura configurada a mano o aceptada
        // por propuesta (sin pasar por una votación de Clubvisión) se marca
        // como FREE, no CLUBVISION — y sigue siendo la lectura activa del
        // club igualmente.
        where: { clubId: club.id, status: 'ACTIVE' },
        select: { bookId: true, book: { select: { title: true, coverUrl: true } } },
        orderBy: { startedAt: 'desc' },
      }),
      (result) => result ? 1 : 0,
    );
    if (lecturaActiva) {
      ganador = lecturaActiva.book.title;
      winnerBookId = lecturaActiva.bookId;
      ganadorCoverUrl = lecturaActiva.book.coverUrl ?? '';
    }
  }

  const leyendoLecturaActual = ganador
    ? leyendoAhora
        .filter((item) => winnerBookId
          ? item.book.id === winnerBookId
          : item.book.title === ganador)
        .map((item) => item.user.name)
    : [];

  const [finalizadosLecturaActual, reviewsLecturaActual, lecturaOficial] = ganador
    ? await Promise.all([
      dashboardBlock('official_finished', () => client.library.findMany({
        where: {
          status: 'FINISHED',
          user: { clubMemberships: { some: { clubId: club.id } } },
          ...(winnerBookId ? { bookId: winnerBookId } : { book: { title: ganador } }),
        },
        select: { userId: true, user: { select: { name: true } } },
        orderBy: { finishedAt: 'desc' },
      }), (rows) => rows.length),
      dashboardBlock('official_reviews', () => client.review.findMany({
        where: {
          ...(winnerBookId ? { bookId: winnerBookId } : { book: { title: ganador } }),
          user: { clubMemberships: { some: { clubId: club.id } } },
        },
        select: { userId: true, rating: true },
      }), (rows) => rows.length),
      dashboardBlock('official_reading', () => client.reading.findFirst({
        where: {
          type: 'CLUBVISION',
          clubId: club.id,
          ...(winnerBookId ? { bookId: winnerBookId } : { book: { title: ganador } }),
        },
        select: { id: true },
        orderBy: { startedAt: 'desc' },
      }), (result) => result ? 1 : 0),
    ])
    : [[], [], null] as const;

  let comentariosLecturaActual = 0;
  let likesLecturaActual = 0;
  let ultimaFechaLecturaActual: Date | null = null;

  if (lecturaOficial) {
    const activityWhere = {
      deletedAt: null,
      conversation: { readingId: lecturaOficial.id },
    };
    const [commentCount, likeCount, latest] = await Promise.all([
      dashboardBlock(
        'official_comment_count',
        () => client.comment.count({ where: activityWhere }),
        (count) => count,
      ),
      dashboardBlock(
        'official_like_count',
        () => client.like.count({ where: { comment: activityWhere } }),
        (count) => count,
      ),
      dashboardBlock('official_latest_activity', () => client.comment.findFirst({
        where: activityWhere,
        select: {
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }), (result) => result ? 1 : 0),
    ]);
    comentariosLecturaActual = commentCount;
    likesLecturaActual = likeCount;
    if (latest) {
      ultimaFechaLecturaActual = latest.createdAt;
    }
  }

  const valoracionMedia = reviewAggregate._avg.rating === null
    ? '0'
    : reviewAggregate._avg.rating.toFixed(2);

  const genreCounter = new Map<string, number>();

  for (const item of leyendoAhora) {
    const genreName = item.book.genre?.name ?? '';

    if (!genreName) continue;

    genreCounter.set(genreName, (genreCounter.get(genreName) ?? 0) + 1);
  }

  const topGenre = Array.from(genreCounter.entries()).sort(
    (a, b) => b[1] - a[1],
  )[0];

  const tendencia = topGenre
    ? `${topGenre[0]} domina las lecturas actuales del club.`
    : 'El club está repartido entre varios géneros.';

  const reviewByUser = new Map(
    reviewsLecturaActual.map((review) => [review.userId, review.rating]),
  );

  return {
    usuarioActual: {
      nombre: user?.name ?? '',
      avatarUrl: user?.avatarUrl ?? '',
    },
    resumen: {
      usuarioMes: topUsuario?.[0] ?? '',
      librosUsuarioMes: topUsuario?.[1] ?? 0,
      actividadMes: Array.from(contadorUsuarios.values()).reduce(
        (sum, total) => sum + total,
        0,
      ),
      valoracionMedia,
    },

    leyendoAhora: leyendoAhoraResponse,

    tendencia,
    rankingAfinidad,
    mood: getMood(valoracionMedia),
    libroMes: [],
    clubvision,
    topLectorasMes,

    lecturaActual: {
      ok: Boolean(ganador),
      titulo: ganador || clubvision.mensaje || '',
      comentarios: comentariosLecturaActual,
      likes: likesLecturaActual,
      ultimaActividad: ultimaFechaLecturaActual
        ? activityTimestamp(ultimaFechaLecturaActual)
        : null,
      totalLeyendo: leyendoLecturaActual.length,
      totalFinalizado: finalizadosLecturaActual.length,
      leyendo: leyendoLecturaActual,
      coverUrl: ganadorCoverUrl,
      finalizado: finalizadosLecturaActual.map((item) => {
        return {
          usuario: item.user.name,
          valoracion: ratingToFlutter(reviewByUser.get(item.userId)),
        };
      }),
    },
  };
}

// ─────────────────────────────────────────────
// Detalle de afinidad con una miembro concreta
// ─────────────────────────────────────────────

export async function getAfinidadDetalle(userId: string, miembroId: string) {
  const yearStart = new Date(Date.UTC(new Date().getFullYear(), 0, 1));

  // El otro miembro debe compartir al menos un club con quien pregunta — si
  // no, cualquier persona autenticada podría leer el historial de lectura de
  // cualquier otra usuaria de la app con solo adivinar/enumerar su id.
  const [caller, miembro] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { clubMemberships: { select: { clubId: true } } },
    }),
    prisma.user.findUnique({
      where: { id: miembroId },
      select: {
        name: true,
        avatarUrl: true,
        clubMemberships: { select: { clubId: true } },
      },
    }),
  ]);
  const callerClubIds = new Set(caller?.clubMemberships.map((m) => m.clubId) ?? []);
  const comparten = miembro?.clubMemberships.some((m) => callerClubIds.has(m.clubId));
  if (!comparten) {
    return { miembro: { id: miembroId, nombre: '', avatarUrl: '' }, librosComunes: [] };
  }

  const [misLibros, susLibros] = await Promise.all([
    prisma.readingCompletion.findMany({
      where: { userId, finishedAt: { gte: yearStart } },
      select: { bookId: true },
    }),
    prisma.readingCompletion.findMany({
      where: { userId: miembroId, finishedAt: { gte: yearStart } },
      select: { bookId: true },
    }),
  ]);

  const misIds = new Set(misLibros.map((r) => r.bookId));
  const comunes = susLibros.filter((r) => misIds.has(r.bookId)).map((r) => r.bookId);

  const libros = await prisma.book.findMany({
    where: { id: { in: comunes } },
    include: { genre: true },
    orderBy: { title: 'asc' },
  });

  return {
    miembro: {
      id: miembroId,
      nombre: miembro?.name ?? '',
      avatarUrl: miembro?.avatarUrl ?? '',
    },
    librosComunes: libros.map((b) => ({
      id: b.id,
      titulo: b.title,
      coverUrl: b.coverUrl ?? '',
      genero: b.genre?.name ?? '',
    })),
  };
}

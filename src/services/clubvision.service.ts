import type { Club, Clubvision, Prisma } from '@prisma/client';
import { ClubRole, Priority, ReadingStatus, ReadingType } from '@prisma/client';
import {
  notifyClubvisionAbierta,
  notifyClubvisionResultados,
  notifyLecturaNueva,
} from './notifications.service.js';
import { prisma } from '../prisma.js';
import {
  getCurrentClubContext,
  requireClubMember,
  requireClubRole,
} from './club-context.service.js';
import {
  getClubvisionCalendarFor,
  getClubvisionStage,
  getTimedClubvisionStage,
  fitsBeforeNextClubvisionEdition,
} from '../utils/clubvision-calendar.js';
import {
  descendingCursorFilter,
  pageFromRows,
  type PaginationRequest,
} from '../utils/cursor-pagination.js';
import { syncAchievementsForUser } from './achievements.service.js';
import { backgroundError, logger } from '../logging/logger.js';

const POINTS_BY_POSITION = [12, 10, 8, 7, 6] as const;
const WELCOME_VOTING_HOURS = 48;
const WELCOME_RESULTS_HOURS = 24;
const WELCOME_MAX_CLUB_AGE_DAYS = 45;
const WELCOME_MIN_MEMBERS = 3;
const WELCOME_MIN_CANDIDATES = 5;
const WELCOME_MIN_INTERESTED = 2;

function isWelcomeClubvision(clubvision: Pick<Clubvision, 'kind'>) {
  return clubvision.kind === 'WELCOME';
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function getWelcomeStage(
  clubvision: Pick<Clubvision, 'openedAt' | 'votingEndsAt' | 'resultsEndsAt'>,
  allMembersVoted: boolean,
) {
  const now = getNow();
  const votingEndsAt = clubvision.votingEndsAt ?? addHours(clubvision.openedAt ?? now, WELCOME_VOTING_HOURS);
  const resultsEndsAt = clubvision.resultsEndsAt ?? addHours(votingEndsAt, WELCOME_RESULTS_HOURS);
  return getTimedClubvisionStage(now, votingEndsAt, resultsEndsAt, allMembersVoted);
}

async function findRelevantClubvision(club: Club, includeWelcomeFallback = true) {
  const activeWelcome = await prisma.clubvision.findFirst({
    where: { clubId: club.id, kind: 'WELCOME', status: { in: ['VOTACION', 'RESULTADOS'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (activeWelcome) return activeWelcome;

  const monthly = await prisma.clubvision.findUnique({
    where: { clubId_edition: { clubId: club.id, edition: getCurrentEdition() } },
  });
  if (monthly) return monthly;

  if (!includeWelcomeFallback) return null;

  return prisma.clubvision.findFirst({
    where: { clubId: club.id, kind: 'WELCOME' },
    orderBy: { createdAt: 'desc' },
  });
}

async function getWelcomeCandidateIds(clubId: string) {
  const entries = await prisma.library.findMany({
    where: {
      status: ReadingStatus.PENDING,
      user: { clubMemberships: { some: { clubId } } },
      book: { OR: [{ publicationDate: null }, { publicationDate: { lte: getNow() } }] },
    },
    select: { userId: true, bookId: true, priority: true },
  });
  const imported = entries.length === 0 ? [] : await prisma.importRowReceipt.findMany({
    where: { OR: entries.map(({ userId, bookId }) => ({ userId, bookId })) },
    select: { userId: true, bookId: true },
  });
  const importedKeys = new Set(imported.map(({ userId, bookId }) => `${userId}:${bookId}`));
  const counts = new Map<string, number>();
  const highCounts = new Map<string, number>();
  for (const entry of entries) {
    if (importedKeys.has(`${entry.userId}:${entry.bookId}`)) continue;
    counts.set(entry.bookId, (counts.get(entry.bookId) ?? 0) + 1);
    if (entry.priority === Priority.HIGH) highCounts.set(entry.bookId, (highCounts.get(entry.bookId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= WELCOME_MIN_INTERESTED)
    .sort(([a, countA], [b, countB]) =>
      (highCounts.get(b) ?? 0) - (highCounts.get(a) ?? 0) || countB - countA,
    )
    .map(([bookId]) => bookId);
}

export async function getWelcomeClubvisionEligibility(usuario: string) {
  const { club, membership } = await requireClubMember(usuario);
  const esAdmin = membership.role === ClubRole.OWNER || membership.role === ClubRole.ADMIN;
  const [members, previousWelcome, activeMonthly, candidateIds] = await Promise.all([
    prisma.clubMember.count({ where: { clubId: club.id } }),
    prisma.clubvision.findFirst({ where: { clubId: club.id, kind: 'WELCOME' }, select: { id: true } }),
    prisma.clubvision.findFirst({
      where: {
        clubId: club.id,
        kind: 'MONTHLY',
        edition: getCurrentEdition(),
        status: { in: ['VOTACION', 'RESULTADOS'] },
      },
      select: { id: true },
    }),
    getWelcomeCandidateIds(club.id),
  ]);
  const ageDays = Math.floor((getNow().getTime() - club.createdAt.getTime()) / 86_400_000);
  const reasons: string[] = [];
  if (!esAdmin) reasons.push('Solo una administradora puede iniciarla');
  if (ageDays > WELCOME_MAX_CLUB_AGE_DAYS) reasons.push('La bienvenida solo está disponible durante los primeros 45 días');
  if (previousWelcome) reasons.push('Este club ya tuvo su Clubvisión de bienvenida');
  if (activeMonthly) reasons.push('Ya hay otra Clubvisión activa');
  if (getClubvisionCalendar().day <= 3) {
    reasons.push('El ciclo mensual de Clubvisión está en curso');
  }
  if (!fitsBeforeNextClubvisionEdition(
    getNow(),
    WELCOME_VOTING_HOURS + WELCOME_RESULTS_HOURS,
  )) reasons.push('La próxima Clubvisión mensual está demasiado cerca');
  if (members < WELCOME_MIN_MEMBERS) reasons.push(`Necesitáis al menos ${WELCOME_MIN_MEMBERS} miembros`);
  if (candidateIds.length < WELCOME_MIN_CANDIDATES) reasons.push(`Necesitáis al menos ${WELCOME_MIN_CANDIDATES} libros compartidos por dos miembros`);
  return {
    disponible: reasons.length === 0,
    esAdmin,
    miembros: members,
    candidatas: candidateIds.length,
    minimoMiembros: WELCOME_MIN_MEMBERS,
    minimoCandidatas: WELCOME_MIN_CANDIDATES,
    motivo: reasons[0] ?? '',
  };
}

export async function startWelcomeClubvision(usuario: string) {
  const { club } = await requireClubRole(usuario, [ClubRole.OWNER, ClubRole.ADMIN]);
  const eligibility = await getWelcomeClubvisionEligibility(usuario);
  if (!eligibility.disponible) return { ok: false, mensaje: eligibility.motivo };
  const candidateIds = await getWelcomeCandidateIds(club.id);
  const openedAt = getNow();
  const votingEndsAt = addHours(openedAt, WELCOME_VOTING_HOURS);
  const resultsEndsAt = addHours(votingEndsAt, WELCOME_RESULTS_HOURS);
  const edition = `WELCOME-${openedAt.toISOString()}`;
  const created = await prisma.$transaction(async (tx) => {
    const clubvision = await tx.clubvision.create({ data: {
      clubId: club.id, edition, kind: 'WELCOME', status: 'VOTACION',
      title: '✨ Clubvisión de bienvenida', message: '🗳️ Ya podéis votar',
      openedAt, votingEndsAt, resultsEndsAt,
    } });
    await tx.clubvisionCandidate.createMany({
      data: candidateIds.map((bookId) => ({ clubvisionId: clubvision.id, bookId })),
      skipDuplicates: true,
    });
    return clubvision;
  }, { maxWait: 5_000, timeout: 15_000 });
  void notifyClubvisionAbierta(club.id).catch(backgroundError('welcome_clubvision_notification_failed'));
  return { ok: true, idVotacion: created.edition };
}

function getNow() {
  const isProduction = process.env.NODE_ENV === 'production';
  const simulatedDate = process.env.SIMULATED_DATE?.trim();

  if (isProduction || !simulatedDate) {
    return new Date();
  }

  const parsedDate = new Date(simulatedDate);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(
      `SIMULATED_DATE no es una fecha válida: ${simulatedDate}`,
    );
  }

  return parsedDate;
}

function getClubvisionCalendar() {
  return getClubvisionCalendarFor(getNow());
}

function getCurrentEdition() {
  return getClubvisionCalendar().edition;
}

async function getOrCreateCurrentClubvision(
  usuario = '',
  clubOverride?: Club,
) {
  const club =
    clubOverride ?? (await getCurrentClubContext(usuario)).club;
  const { edition, day } = getClubvisionCalendar();
  const existing = await prisma.clubvision.findUnique({
    where: {
      clubId_edition: {
        clubId: club.id,
        edition,
      },
    },
  });

  if (existing || day > 2) return existing;

  const created = await prisma.$transaction(async (tx) => {
    // Calculamos los candidatos ANTES de crear el registro de Clubvisión:
    // si no hay suficientes, no debe quedar ni rastro en la base de datos.
    // Antes se creaba el registro (status VOTACION) primero y solo después
    // se comprobaba si había candidatos — al devolver null sin lanzar, la
    // transacción igualmente hacía commit y dejaba un Clubvisión vacío y
    // "abierto" para siempre en esa edición, porque la siguiente llamada
    // encontraría ese `existing` y ni siquiera reintentaría generar
    // candidatos. Ese club se quedaba sin poder votar hasta la edición
    // siguiente.
    // Excluir solo los libros que han ganado en ediciones anteriores
    const previousWinners = await tx.clubvisionResult.findMany({
      where: {
        clubId: club.id,
        edition: { not: edition },
        winnerBookId: { not: null },
      },
      select: { winnerBookId: true },
      distinct: ['winnerBookId'],
    });

    const excludedBookIds = previousWinners.flatMap((result) =>
      result.winnerBookId ? [result.winnerBookId] : [],
    );
    // Libros que ya han terminado MÁS de 3 miembros del club → excluir
    const tooManyFinished = await tx.library.groupBy({
      by: ['bookId'],
      where: {
        status: ReadingStatus.FINISHED,
        user: { clubMemberships: { some: { clubId: club.id } } },
      },
      _count: { userId: true },
      having: { userId: { _count: { gt: 3 } } },
    });
    const tooManyFinishedBookIds = tooManyFinished.map((r) => r.bookId);

    // Candidatas base: PENDING, >= 3 miembros genuinos (sin importaciones),
    // sin ganadores previos ni muy leídas
    const allExcluded = [
      ...excludedBookIds,
      ...tooManyFinishedBookIds,
    ];
    const pendingEntries = await tx.library.findMany({
      where: {
        status: ReadingStatus.PENDING,
        user: { clubMemberships: { some: { clubId: club.id } } },
        ...(allExcluded.length > 0 ? { bookId: { notIn: allExcluded } } : {}),
        // Excluir libros aún no publicados (fecha de publicación futura)
        book: {
          OR: [
            { publicationDate: null },
            { publicationDate: { lte: getNow() } },
          ],
        },
      },
      select: { userId: true, bookId: true, priority: true },
    });

    // Excluir entradas importadas de Goodreads/Bookmory
    const importedKeys: Set<string> = pendingEntries.length > 0
      ? new Set(
          (await tx.importRowReceipt.findMany({
            where: { OR: pendingEntries.map(e => ({ userId: e.userId, bookId: e.bookId })) },
            select: { userId: true, bookId: true },
          })).map(r => `${r.userId}:${r.bookId}`)
        )
      : new Set();

    const genuinePending = pendingEntries.filter(
      e => !importedKeys.has(`${e.userId}:${e.bookId}`)
    );

    // Contar interesados genuinos por libro y prioridad alta
    const countByBook = new Map<string, number>();
    const highCountByBook = new Map<string, number>();
    for (const entry of genuinePending) {
      countByBook.set(entry.bookId, (countByBook.get(entry.bookId) ?? 0) + 1);
      if (entry.priority === Priority.HIGH) {
        highCountByBook.set(entry.bookId, (highCountByBook.get(entry.bookId) ?? 0) + 1);
      }
    }

    const eligibleBookIds = [...countByBook.entries()]
      .filter(([, count]) => count >= 3)
      .map(([bookId]) => bookId);

    if (eligibleBookIds.length === 0) return null;

    const sortedCandidates = [...eligibleBookIds].sort((a, b) => {
      const highDiff = (highCountByBook.get(b) ?? 0) - (highCountByBook.get(a) ?? 0);
      if (highDiff !== 0) return highDiff;
      return (countByBook.get(b) ?? 0) - (countByBook.get(a) ?? 0);
    });

    // Ya sabemos que hay candidatos suficientes: ahora sí creamos (o
    // recuperamos, por si una llamada concurrente se adelantó) el registro
    // de Clubvisión.
    const clubvision = await tx.clubvision.upsert({
      where: {
        clubId_edition: {
          clubId: club.id,
          edition,
        },
      },
      update: {},
      create: {
        clubId: club.id,
        edition,
        status: 'VOTACION',
        title: '🎤 Clubvisión abierta',
        message: '🗳️ Ya puedes votar',
        openedAt: getNow(),
      },
    });

    await tx.clubvisionCandidate.createMany({
      data: sortedCandidates.map((bookId) => ({
        clubvisionId: clubvision.id,
        bookId,
      })),
      skipDuplicates: true,
    });

    return clubvision;
  }, { maxWait: 5_000, timeout: 15_000 });
  if (created) void notifyClubvisionAbierta(club.id).catch(backgroundError('clubvision_open_notification_failed'));
  return created;
}

export async function openScheduledClubvision() {
  const clubs = await prisma.club.findMany();
  const synchronized = [];

  for (const club of clubs) {
    const calendar = getClubvisionCalendar();
    try {
      synchronized.push(await synchronizeCurrentClubvision('', club));
    } catch {
      logger.error({
        event: 'clubvision_cron_failed',
        clubId: club.id,
        edition: calendar.edition,
        phase: getClubvisionStage(calendar.day, false),
      }, 'Clubvision cron failed');
    }
  }

  return synchronized;
}

async function calculateClubvisionResult(clubvision: {
  id: string;
  clubId: string;
  edition: string;
}) {
  const existing = await prisma.clubvisionResult.findUnique({
    where: {
      clubId_edition: {
        clubId: clubvision.clubId,
        edition: clubvision.edition,
      },
    },
  });

  if (existing) return existing;

  const votes = await prisma.clubvisionVote.findMany({
    where: { clubvisionId: clubvision.id },
    include: {
      candidate: {
        include: { book: true },
      },
    },
  });

  if (votes.length === 0) return null;

  const ranking = new Map<
    string,
    {
      bookId: string;
      title: string;
      points: number;
      positions: number[];
    }
  >();

  for (const vote of votes) {
    const current = ranking.get(vote.candidateId) ?? {
      bookId: vote.candidate.bookId,
      title: vote.candidate.book.title,
      points: 0,
      positions: [0, 0, 0, 0, 0],
    };

    current.points += vote.points;
    if (vote.position >= 1 && vote.position <= 5) {
      current.positions[vote.position - 1]++;
    }
    ranking.set(vote.candidateId, current);
  }

  const sorted = Array.from(ranking.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;

    for (let index = 0; index < a.positions.length; index++) {
      if (b.positions[index] !== a.positions[index]) {
        return b.positions[index] - a.positions[index];
      }
    }

    return a.title.localeCompare(b.title, 'es');
  });

  const winner = sorted[0];
  if (!winner) return null;

  const result = await prisma.$transaction(async (tx) => {
    const result = await tx.clubvisionResult.upsert({
      where: {
        clubId_edition: {
          clubId: clubvision.clubId,
          edition: clubvision.edition,
        },
      },
      update: {},
      create: {
        clubId: clubvision.clubId,
        edition: clubvision.edition,
        winnerBookId: winner.bookId,
        winnerTitle: winner.title,
        points: winner.points,
        secondTitle: sorted[1]?.title ?? null,
        thirdTitle: sorted[2]?.title ?? null,
      },
    });

    await tx.clubvision.update({
      where: { id: clubvision.id },
      data: {
        status: 'RESULTADOS',
        winnerBookId: result.winnerBookId,
        closedAt: getNow(),
      },
    });
    return result;
  }, { maxWait: 5_000, timeout: 15_000 });
  void notifyClubvisionResultados(
    clubvision.clubId,
    result.winnerTitle,
  ).catch(backgroundError('clubvision_results_notification_failed'));
  return result;
}

export async function transitionClubvisionToReading(
  tx: Prisma.TransactionClient,
  params: {
    clubvisionId: string;
    clubId: string;
    edition: string;
    winnerBookId: string;
  },
) {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`clubvision:reading:${params.clubId}:${params.edition}`}, 0)
    )::text
  `;
  const current = await tx.clubvision.findUnique({
    where: { id: params.clubvisionId },
    select: { status: true },
  });
  if (current?.status !== 'RESULTADOS') {
    return { transitioned: false, officialReadingId: null };
  }

  const winnerReading = await tx.reading.findFirst({
    where: {
      clubId: params.clubId,
      bookId: params.winnerBookId,
      status: 'ACTIVE',
    },
    orderBy: { startedAt: 'desc' },
  });
  await tx.reading.updateMany({
    where: {
      clubId: params.clubId,
      type: ReadingType.CLUBVISION,
      status: 'ACTIVE',
      ...(winnerReading ? { id: { not: winnerReading.id } } : {}),
    },
    data: { type: ReadingType.FREE },
  });
  if (winnerReading && winnerReading.type !== ReadingType.CLUBVISION) {
    await tx.reading.update({
      where: { id: winnerReading.id },
      data: { type: ReadingType.CLUBVISION },
    });
  }
  await tx.clubvision.update({
    where: { id: params.clubvisionId },
    data: {
      status: 'LECTURA',
      winnerBookId: params.winnerBookId,
    },
  });
  return {
    transitioned: true,
    officialReadingId: winnerReading?.id ?? null,
  };
}

export async function synchronizeCurrentClubvision(
  usuario = '',
  clubOverride?: Club,
) {
  const club =
    clubOverride ?? (await getCurrentClubContext(usuario)).club;
  const clubvision = (await findRelevantClubvision(club, false)) ??
    (await getOrCreateCurrentClubvision(usuario, club)) ??
    (await findRelevantClubvision(club));
  if (!clubvision) return null;

  if (clubvision.status === 'FINALIZADA') return clubvision;

  // Si la Clubvisión fue marcada como LECTURA por una propuesta de club,
  // no recalculamos ni transitamos — el estado manual tiene prioridad.
  if (clubvision.status === 'LECTURA') return clubvision;

  const totalUsuarios = await prisma.clubMember.count({
    where: { clubId: club.id },
  });
  const voters = await prisma.clubvisionVote.groupBy({
    by: ['userId'],
    where: { clubvisionId: clubvision.id },
  });
  const todasHanVotado = totalUsuarios > 0 && voters.length >= totalUsuarios;
  const stage = isWelcomeClubvision(clubvision)
    ? getWelcomeStage(clubvision, todasHanVotado)
    : getClubvisionStage(getClubvisionCalendar().day, todasHanVotado);

  let result = await prisma.clubvisionResult.findUnique({
    where: {
      clubId_edition: {
        clubId: club.id,
        edition: clubvision.edition,
      },
    },
  });

  if (stage !== 'VOTACION') {
    result = await calculateClubvisionResult(clubvision);
    if (!result && isWelcomeClubvision(clubvision) && stage === 'LECTURA') {
      return prisma.clubvision.update({
        where: { id: clubvision.id },
        data: { status: 'FINALIZADA', finishedAt: getNow() },
      });
    }
  }

  if (stage === 'LECTURA' && result?.winnerBookId) {
    const transition = await prisma.$transaction(
      (tx) => transitionClubvisionToReading(tx, {
        clubvisionId: clubvision.id,
        clubId: club.id,
        edition: clubvision.edition,
        winnerBookId: result!.winnerBookId!,
      }),
      { maxWait: 5_000, timeout: 15_000 },
    );
    if (transition.transitioned && result.winnerTitle) {
      void notifyLecturaNueva(
        clubvision.clubId,
        result.winnerTitle,
        result.winnerBookId,
      ).catch(backgroundError('clubvision_reading_notification_failed'));
    }
  }

  return clubvision;
}

async function getCalculatedClubvisionStatus(
  clubvision: Clubvision,
  clubId: string,
) {
  const totalUsuarios = await prisma.clubMember.count({
    where: { clubId },
  });

  const votosUsuarios = await prisma.clubvisionVote.groupBy({
    by: ['userId'],
    where: {
      clubvisionId: clubvision.id,
    },
  });

  const votosRecibidos = votosUsuarios.length;
  const todasHanVotado = totalUsuarios > 0 && votosRecibidos >= totalUsuarios;

  return isWelcomeClubvision(clubvision)
    ? getWelcomeStage(clubvision, todasHanVotado)
    : getClubvisionStage(getClubvisionCalendar().day, todasHanVotado);
}

type ClubvisionReadOptions = {
  synchronize?: boolean;
  context?: Awaited<ReturnType<typeof getCurrentClubContext>>;
};

export async function getClubvision(
  usuario: string,
  options: ClubvisionReadOptions = {},
) {
  const { club, user: contextUser, membership } = options.context ?? await getCurrentClubContext(usuario);
  const esAdmin = membership?.role === 'OWNER' || membership?.role === 'ADMIN';

  const clubvision = options.synchronize === false
    ? await findRelevantClubvision(club)
    : await synchronizeCurrentClubvision(usuario, club);
  const idVotacion = clubvision?.edition ?? getCurrentEdition();

  const totalUsuarios = await prisma.clubMember.count({
    where: { clubId: club.id },
  });

  if (!clubvision) {
    // Un club de hasta 5 miembros nunca puede llegar al mínimo real para
    // abrir votación (se necesitan al menos 3 personas coincidiendo en un
    // mismo libro y 5 libros candidatos) — así que siempre le ofrecemos
    // proponer una lectura directamente en vez de esperar a algo que nunca
    // va a pasar. En clubes más grandes sí es realista que se alcance el
    // umbral con más tiempo, así que no mostramos nada mientras tanto (antes
    // esto se decidía mirando si algún libro ya tenía ≥2 interesadas, lo
    // cual ocultaba la tarjeta justo cuando más sentido tenía mostrarla:
    // cuanto más de acuerdo estaba un club pequeño en un libro, menos
    // probable era que viera la opción de proponerlo).
    const sinCandidatas = totalUsuarios > 0 && totalUsuarios <= 5;

    return {
      abierta: false,
      estado: sinCandidatas ? 'SIN_CANDIDATAS' : 'SIN_DATOS',
      idVotacion,
      haVotado: false,
      candidatas: [],
      votosRecibidos: 0,
      totalUsuarios,
      votosPendientes: totalUsuarios,
      porcentaje: 0,
      titulo: sinCandidatas ? '📚 Sin candidatas' : 'Clubvisión',
      mensaje: sinCandidatas
        ? 'Aún no hay libros con suficiente interés para votar'
        : '',
      ganador: '',
      ganadorCoverUrl: '',
      lecturaConfigurada: false,
      lectoras: [],
      totalCandidatas: 0,
      portadasCandidatas: [],
      comentarios: 0,
      likes: 0,
      ultimaActividad: '',
      esAdmin,
      bienvenida: await getWelcomeClubvisionEligibility(usuario),
    };
  }

  const votosUsuarios = await prisma.clubvisionVote.groupBy({
    by: ['userId'],
    where: {
      clubvisionId: clubvision.id,
    },
  });

  const votosRecibidos = votosUsuarios.length;
  const todasHanVotado = totalUsuarios > 0 && votosRecibidos >= totalUsuarios;
  // Si la Clubvisión fue activada directamente por propuesta de club, respetar
  // el estado almacenado en lugar de recalcular desde el calendario.
  const storedStatus = clubvision?.status;
  const estado = storedStatus === 'LECTURA' || storedStatus === 'FINALIZADA'
    ? storedStatus
    : isWelcomeClubvision(clubvision)
      ? getWelcomeStage(clubvision, todasHanVotado)
      : getClubvisionStage(getClubvisionCalendar().day, todasHanVotado);
  const votosPendientes = Math.max(totalUsuarios - votosRecibidos, 0);

  const porcentaje =
    totalUsuarios === 0
      ? 0
      : Math.round((votosRecibidos / totalUsuarios) * 100);

  const user = usuario.trim() ? contextUser : null;

  const [userVoteCount, candidates, winner] = await Promise.all([
    user
      ? prisma.clubvisionVote.count({
          where: { clubvisionId: clubvision.id, userId: user.id },
        })
      : Promise.resolve(0),
    prisma.clubvisionCandidate.findMany({
    where: {
      clubvisionId: clubvision.id,
    },
    select: {
      book: {
        select: {
          title: true,
          coverUrl: true,
          genre: { select: { name: true } },
          library: {
            where: {
              status: ReadingStatus.PENDING,
              user: {
                clubMemberships: {
                  some: { clubId: club.id },
                },
              },
            },
            select: { user: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    }),
    prisma.clubvisionResult.findUnique({
      where: {
        clubId_edition: { clubId: club.id, edition: clubvision.edition },
      },
      select: {
        winnerTitle: true,
        winnerBookId: true,
        points: true,
        winnerBook: { select: { coverUrl: true } },
      },
    }),
  ]);
  const haVotado = userVoteCount > 0;

  const candidatas = candidates.map((candidate) => ({
    libro: candidate.book.title,
    genero: candidate.book.genre.name,
    coverUrl: candidate.book.coverUrl ?? '',
    interesadas: candidate.book.library.length,
    usuarias: candidate.book.library.map((entry) => entry.user.name),
  }));

  const ganador = winner?.winnerTitle ?? '';
  const puntosGanador = winner?.points ?? 0;
  const ganadorCoverUrl = winner?.winnerBook?.coverUrl ?? '';
  const [lectoras, officialReadingCount] = winner?.winnerBookId
    ? await Promise.all([
      prisma.library.findMany({
        where: {
          bookId: winner.winnerBookId,
          status: ReadingStatus.FINISHED,
          user: {
            clubMemberships: {
              some: { clubId: club.id },
            },
          },
        },
        select: { user: { select: { name: true } } },
      }),
      prisma.reading.count({
        where: {
          bookId: winner.winnerBookId,
          clubId: club.id,
          type: 'CLUBVISION',
          status: 'ACTIVE',
        },
      }),
    ])
    : [[], 0] as const;
  // Si llegamos por propuesta (sin bookId) buscamos cualquier lectura CLUBVISION activa
  const fallbackReadingCount = !winner?.winnerBookId && winner?.winnerTitle
    ? await prisma.reading.count({
        where: { clubId: club.id, type: 'CLUBVISION', status: 'ACTIVE' },
      })
    : 0;
  const lecturaConfigurada = officialReadingCount > 0 || fallbackReadingCount > 0;

  return {
    abierta: estado === 'VOTACION',
    estado,
    idVotacion,
    haVotado,

    candidatas,

    votosRecibidos,
    totalUsuarios,
    votosPendientes,
    porcentaje,

    titulo:
      isWelcomeClubvision(clubvision) && estado === 'VOTACION'
        ? '✨ Clubvisión de bienvenida'
        : estado === 'VOTACION'
        ? '🎤 Clubvisión abierta'
        : estado === 'RESULTADOS'
          ? '🏆 Próxima lectura'
          : estado === 'LECTURA'
            ? '📖 Estamos leyendo'
            : 'Clubvisión',

    mensaje:
      isWelcomeClubvision(clubvision) && estado === 'VOTACION'
        ? 'Vuestra primera votación ya está abierta'
        : estado === 'VOTACION'
        ? '🗳️ Ya puedes votar'
        : estado === 'RESULTADOS'
          ? 'Ya tenemos una nueva lectura.'
          : estado === 'LECTURA' && ganador
            ? ganador
            : '',

    ganador,
    ganadorBookId: winner?.winnerBookId ?? '',
    ganadorCoverUrl,
    lecturaConfigurada,
    lectoras: lectoras.map((entry) => entry.user.name),

    totalCandidatas: candidatas.length,
    // Primeras portadas para el collage animado en la card del club
    portadasCandidatas: [...candidatas]
      .sort(() => Math.random() - 0.5)
      .slice(0, 40)
      .map((c) => c.coverUrl)
      .filter((url) => url && url.length > 0),

    comentarios: 0,
    likes: 0,
    ultimaActividad: '',
    esAdmin,
    tipo: isWelcomeClubvision(clubvision) ? 'WELCOME' : 'MONTHLY',
    bienvenida: await getWelcomeClubvisionEligibility(usuario),
  };
}

export function getClubvisionSnapshot(
  usuario: string,
  context: Awaited<ReturnType<typeof getCurrentClubContext>>,
) {
  return getClubvision(usuario, { synchronize: false, context });
}

export async function enviarVotacion(usuario: string, votos: string[]) {
  const { club, user } = await requireClubMember(usuario);

  const clubvision = await synchronizeCurrentClubvision(usuario);

  if (!clubvision) {
    return {
      ok: false,
      mensaje: 'No hay votación abierta',
    };
  }

  const estado = await getCalculatedClubvisionStatus(
    clubvision,
    club.id,
  );

  if (estado !== 'VOTACION') {
    return {
      ok: false,
      mensaje: 'La votación no está abierta',
    };
  }

  const alreadyVoted = await prisma.clubvisionVote.count({
    where: {
      clubvisionId: clubvision.id,
      userId: user.id,
    },
  });

  if (alreadyVoted > 0) {
    return {
      ok: false,
      mensaje: 'Ya has votado en esta Clubvisión',
    };
  }

  const normalizedVotes = votos.map((vote) => vote.trim()).filter(Boolean);
  const uniqueVotes = new Set(normalizedVotes);

  if (normalizedVotes.length !== 5 || uniqueVotes.size !== 5) {
    return {
      ok: false,
      mensaje: 'Debes ordenar exactamente cinco libros diferentes',
    };
  }

  // Las papeletas llegan como títulos, no como ids de libro (limitación del
  // cliente actual). Para no emparejar un voto con el candidato equivocado
  // si dos candidatos de esta misma edición comparten título exacto (dos
  // libros distintos con el mismo nombre), comprobamos toda la lista de
  // candidatos de la edición — no solo los votados — antes de emparejar.
  const allCandidates = await prisma.clubvisionCandidate.findMany({
    where: { clubvisionId: clubvision.id },
    include: { book: true },
  });

  const titleCounts = new Map<string, number>();
  for (const candidate of allCandidates) {
    titleCounts.set(
      candidate.book.title,
      (titleCounts.get(candidate.book.title) ?? 0) + 1,
    );
  }
  const ambiguousVotes = normalizedVotes.filter(
    (title) => (titleCounts.get(title) ?? 0) > 1,
  );
  if (ambiguousVotes.length > 0) {
    backgroundError('clubvision_ambiguous_candidate_title')(
      new Error(
        `Clubvision ${clubvision.id}: título de candidato ambiguo (${ambiguousVotes.join(', ')})`,
      ),
    );
    return {
      ok: false,
      mensaje:
        'No se ha podido procesar la papeleta porque hay libros candidatos con el mismo título. Contacta con soporte.',
    };
  }

  const candidatesByTitle = new Map(
    allCandidates.map((candidate) => [candidate.book.title, candidate]),
  );

  if (
    normalizedVotes.some((title) => !candidatesByTitle.has(title))
  ) {
    return {
      ok: false,
      mensaje: 'La papeleta contiene libros que no son candidatos',
    };
  }

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < normalizedVotes.length; i++) {
      const points = POINTS_BY_POSITION[i];
      const title = normalizedVotes[i];
      if (points === undefined || !title) break;

      const candidate = candidatesByTitle.get(title)!;

      await tx.clubvisionVote.create({
        data: {
          clubvisionId: clubvision.id,
          userId: user.id,
          candidateId: candidate.id,
          position: i + 1,
          points,
        },
      });
    }
  });

  await synchronizeCurrentClubvision(usuario);

  // Sincronizar logros al votar
  void syncAchievementsForUser(user.id, user.name, club.id).catch(() => {});

  return {
    ok: true,
  };
}

export async function getMiVoto(usuario: string) {
  const { club, user } = await requireClubMember(usuario);

  const clubvision = await findRelevantClubvision(club);

  if (!clubvision) {
    return { encontrado: false };
  }

  const votos = await prisma.clubvisionVote.findMany({
    where: {
      clubvisionId: clubvision.id,
      userId: user.id,
    },
    include: {
      candidate: {
        include: {
          book: true,
        },
      },
    },
    orderBy: {
      position: 'asc',
    },
  });

  if (votos.length === 0) {
    return { encontrado: false };
  }

  const totalUsuarios = await prisma.clubMember.count({
    where: { clubId: club.id },
  });

  const votosUsuarios = await prisma.clubvisionVote.groupBy({
    by: ['userId'],
    where: {
      clubvisionId: clubvision.id,
    },
  });

  const votosRecibidos = votosUsuarios.length;
  const votosPendientes = Math.max(totalUsuarios - votosRecibidos, 0);

  const porcentaje =
    totalUsuarios === 0
      ? 0
      : Math.round((votosRecibidos / totalUsuarios) * 100);

  return {
    encontrado: true,
    usuario: user.name,
    votos: votos.map((voto) => ({ titulo: voto.candidate.book.title, coverUrl: voto.candidate.book.coverUrl ?? '' })),
    votosRecibidos,
    totalUsuarios,
    votosPendientes,
    porcentaje,
  };
}

export async function getComoVotaron(usuario = '') {
  const { club } = await getCurrentClubContext(usuario);
  const clubvision = await synchronizeCurrentClubvision(usuario);

  if (!clubvision) {
    return [];
  }

  const estado = await getCalculatedClubvisionStatus(
    clubvision,
    club.id,
  );
  if (estado === 'VOTACION') return [];

  const votos = await prisma.clubvisionVote.findMany({
    where: {
      clubvisionId: clubvision.id,
    },
    include: {
      user: true,
      candidate: {
        include: {
          book: true,
        },
      },
    },
    orderBy: [
      { user: { name: 'asc' } },
      { position: 'asc' },
    ],
  });

  const grouped = new Map<
    string,
    {
      usuaria: string;
      avatarUrl: string;
      votos: {
        puntos: number;
        libro: string;
      }[];
    }
  >();

  for (const voto of votos) {
    if (!grouped.has(voto.userId)) {
        grouped.set(voto.userId, {
          usuaria: voto.user.name,
          avatarUrl: voto.user.avatarUrl ?? '',
          votos: [],
        });
    }

    grouped.get(voto.userId)!.votos.push({
      puntos: voto.points,
      libro: voto.candidate.book.title,
    });
  }

  return Array.from(grouped.values());
}

type ClubvisionHistoryRow = {
  edition: string;
  winnerTitle: string;
  winnerBookId: string | null;
  winnerBook: { id: string; coverUrl: string | null } | null;
  points: number;
  secondTitle: string | null;
  thirdTitle: string | null;
};

type HistoryBook = {
  id: string;
  title: string;
  coverUrl: string | null;
  deletedAt: Date | null;
};

function normalizeHistoryTitle(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`´]/g, "'")
    .toLocaleLowerCase('es')
    .trim()
    .replace(/\s+/g, ' ');
}

function unambiguousHistoryBook(candidates: HistoryBook[]) {
  const active = candidates.filter(({ deletedAt }) => deletedAt === null);
  const preferred = active.length > 0 ? active : candidates;
  if (preferred.length === 1) return preferred[0];

  // Una portada no basta para desambiguar dos obras activas homónimas.
  if (active.length > 1) return null;
  const withCover = preferred.filter(({ coverUrl }) => Boolean(coverUrl));
  return withCover.length === 1 ? withCover[0] : null;
}

export async function enrichClubvisionHistoryRows(
  rows: ClubvisionHistoryRow[],
  client: Pick<typeof prisma, 'book'> = prisma,
) {
  const titles = Array.from(new Set(rows.flatMap((row) => [
    row.winnerBookId || row.winnerBook ? null : row.winnerTitle,
    row.secondTitle,
    row.thirdTitle,
  ]).filter((title): title is string => Boolean(title?.trim()))));

  const books: HistoryBook[] = titles.length === 0
    ? []
    : await client.book.findMany({
        where: {
          OR: titles.map((title) => ({
            title: { equals: title, mode: 'insensitive' as const },
          })),
        },
        select: { id: true, title: true, coverUrl: true, deletedAt: true },
      });
  const candidatesByTitle = new Map<string, HistoryBook[]>();
  for (const book of books) {
    const key = normalizeHistoryTitle(book.title);
    candidatesByTitle.set(key, [...(candidatesByTitle.get(key) ?? []), book]);
  }
  const resolveTitle = (title: string | null) => {
    if (!title?.trim()) return null;
    return unambiguousHistoryBook(
      candidatesByTitle.get(normalizeHistoryTitle(title)) ?? [],
    );
  };

  return rows.map((result) => {
    const winner = result.winnerBook ?? resolveTitle(result.winnerTitle);
    const second = resolveTitle(result.secondTitle);
    const third = resolveTitle(result.thirdTitle);
    return {
      mes: result.edition,
      ganadora: result.winnerTitle,
      puntos: result.points,
      segunda: result.secondTitle ?? '',
      tercera: result.thirdTitle ?? '',
      ganadoraBookId: winner?.id ?? '',
      ganadoraCoverUrl: winner?.coverUrl ?? '',
      segundaBookId: second?.id ?? '',
      segundaCoverUrl: second?.coverUrl ?? '',
      terceraBookId: third?.id ?? '',
      terceraCoverUrl: third?.coverUrl ?? '',
    };
  });
}

export async function getHistorialClubvision(usuario = '') {
  const { club } = await getCurrentClubContext(usuario);
  const results = await prisma.clubvisionResult.findMany({
    where: { clubId: club.id },
    select: {
      edition: true,
      winnerTitle: true,
      winnerBookId: true,
      winnerBook: { select: { id: true, coverUrl: true } },
      points: true,
      secondTitle: true,
      thirdTitle: true,
    },
    orderBy: {
      edition: 'desc',
    },
  });
  return enrichClubvisionHistoryRows(results);
}

export async function getHistorialClubvisionPage(
  usuario: string,
  pagination: PaginationRequest,
) {
  const { club } = await getCurrentClubContext(usuario);
  const rows = await prisma.clubvisionResult.findMany({
    where: {
      clubId: club.id,
      ...descendingCursorFilter('createdAt', pagination.cursor),
    },
    select: {
      id: true,
      edition: true,
      winnerTitle: true,
      winnerBookId: true,
      winnerBook: { select: { id: true, coverUrl: true } },
      points: true,
      secondTitle: true,
      thirdTitle: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pagination.limit + 1,
  });
  const page = pageFromRows(rows, pagination.limit, (row) => ({
    value: row.createdAt.toISOString(),
    id: row.id,
  }));
  return {
    ...page,
    items: await enrichClubvisionHistoryRows(page.items),
  };
}
// ─────────────────────────────────────────────────────────────────────────────
// Estadísticas de Clubvisión
// ─────────────────────────────────────────────────────────────────────────────

export async function getClubvisionEstadisticas(userId: string) {
  const { club } = await requireClubMember(userId);

  // Total miembros actuales del club
  const totalMiembros = await prisma.clubMember.count({ where: { clubId: club.id } });

  // Todas las ediciones con ganador
  const resultados = await prisma.clubvisionResult.findMany({
    where: { clubId: club.id, winnerBookId: { not: null } },
    select: {
      edition: true,
      winnerTitle: true,
      winnerBookId: true,
      points: true,
      winnerBook: { select: { id: true, coverUrl: true } },
    },
    orderBy: { edition: 'desc' },
  });

  if (resultados.length === 0) {
    return { ok: true, totalEdiciones: 0, participacionMedia: 0, totalMiembros, ganadores: [] };
  }

  const bookIds = resultados
    .map((r) => r.winnerBookId)
    .filter((id): id is string => id !== null);

  // Lectoras que terminaron cada libro ganador
  const lecturasPorLibro = await prisma.library.groupBy({
    by: ['bookId'],
    where: {
      bookId: { in: bookIds },
      status: ReadingStatus.FINISHED,
      user: { clubMemberships: { some: { clubId: club.id } } },
    },
    _count: { userId: true },
  });
  const lecturasMap = new Map(lecturasPorLibro.map((l) => [l.bookId, l._count.userId]));

  // Valoración media por libro (de completions de miembros del club)
  const completions = await prisma.readingCompletion.findMany({
    where: {
      bookId: { in: bookIds },
      rating: { not: null },
      user: { clubMemberships: { some: { clubId: club.id } } },
    },
    select: { bookId: true, rating: true },
  });
  const ratingsMap = new Map<string, { sum: number; count: number }>();
  for (const c of completions) {
    const r = ratingsMap.get(c.bookId) ?? { sum: 0, count: 0 };
    r.sum += c.rating!;
    r.count += 1;
    ratingsMap.set(c.bookId, r);
  }

  // Comentarios en cualquier lectura del club para cada libro ganador
  // (sin filtrar por tipo para incluir lecturas creadas como FREE o CLUBVISION)
  const lecturas = await prisma.reading.findMany({
    where: {
      clubId: club.id,
      bookId: { in: bookIds },
    },
    select: {
      bookId: true,
      conversations: {
        select: { _count: { select: { comments: { where: { deletedAt: null } } } } },
      },
    },
  });
  const comentariosMap = new Map<string, number>();
  for (const l of lecturas) {
    const prev = comentariosMap.get(l.bookId) ?? 0;
    const total = l.conversations.reduce((sum, c) => sum + c._count.comments, 0);
    comentariosMap.set(l.bookId, prev + total);
  }

  // Participación media en votaciones (votantes únicos por edición)
  const ediciones = resultados.map((r) => r.edition);
  const votaciones = await prisma.clubvision.findMany({
    where: { clubId: club.id, edition: { in: ediciones } },
    select: {
      edition: true,
      _count: { select: { votes: true } },
      votes: { select: { userId: true }, distinct: ['userId'] },
    },
  });
  const votantesMap = new Map<string, number>();
  for (const v of votaciones) {
    votantesMap.set(v.edition, v.votes.length);
  }
  const totalVotantes = [...votantesMap.values()].reduce((s, n) => s + n, 0);
  const participacionMedia = votantesMap.size > 0
    ? Math.round(totalVotantes / votantesMap.size)
    : 0;

  const ganadores = resultados.map((r) => {
    const bookId = r.winnerBookId!;
    const ratings = ratingsMap.get(bookId);
    return {
      titulo: r.winnerTitle,
      bookId,
      coverUrl: r.winnerBook?.coverUrl ?? '',
      edition: r.edition,
      puntos: r.points,
      lectoras: lecturasMap.get(bookId) ?? 0,
      totalMiembros,
      valoracionMedia: ratings
        ? Math.round((ratings.sum / ratings.count) * 10) / 10
        : null,
      totalComentarios: comentariosMap.get(bookId) ?? 0,
      votantes: votantesMap.get(r.edition) ?? 0,
    };
  });

  return {
    ok: true,
    totalEdiciones: resultados.length,
    participacionMedia,
    totalMiembros,
    ganadores,
  };
}

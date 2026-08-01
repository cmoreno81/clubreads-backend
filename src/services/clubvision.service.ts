import type { Club } from '@prisma/client';
import { ReadingStatus } from '@prisma/client';
import {
  notifyClubvisionAbierta,
  notifyClubvisionResultados,
  notifyLecturaNueva,
} from './notifications.service.js';
import { prisma } from '../prisma.js';
import {
  getCurrentClubContext,
  requireClubMember,
} from './club-context.service.js';
import {
  getClubvisionCalendarFor,
  getClubvisionStage,
} from '../utils/clubvision-calendar.js';

const POINTS_BY_POSITION = [12, 10, 8, 7, 6] as const;

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

  return prisma.$transaction(async (tx) => {
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
    // Notificar apertura de votación
    notifyClubvisionAbierta(club.id).catch(console.error);

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
    const eligibleCandidates = await tx.library.groupBy({
      by: ['bookId'],
      where: {
        status: ReadingStatus.PENDING,
        user: {
          clubMemberships: {
            some: { clubId: club.id },
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
      orderBy: {
        _count: {
          userId: 'desc',
        },
      },
    });

    await tx.clubvisionCandidate.createMany({
      data: eligibleCandidates.map((candidate) => ({
        clubvisionId: clubvision.id,
        bookId: candidate.bookId,
      })),
      skipDuplicates: true,
    });

    return clubvision;
  });
}

export async function openScheduledClubvision() {
  const clubs = await prisma.club.findMany();
  const synchronized = [];

  for (const club of clubs) {
    synchronized.push(
      await synchronizeCurrentClubvision('', club),
    );
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

  return prisma.$transaction(async (tx) => {
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
    // Notificar resultados
    notifyClubvisionResultados(
      clubvision.clubId,
      result.winnerTitle,
    ).catch(console.error);

    return result;
  });
}

export async function synchronizeCurrentClubvision(
  usuario = '',
  clubOverride?: Club,
) {
  const club =
    clubOverride ?? (await getCurrentClubContext(usuario)).club;
  const clubvision = await getOrCreateCurrentClubvision(
    usuario,
    club,
  );
  if (!clubvision) return null;

  const { day } = getClubvisionCalendar();
  const totalUsuarios = await prisma.clubMember.count({
    where: { clubId: club.id },
  });
  const voters = await prisma.clubvisionVote.groupBy({
    by: ['userId'],
    where: { clubvisionId: clubvision.id },
  });
  const todasHanVotado = totalUsuarios > 0 && voters.length >= totalUsuarios;
  const stage = getClubvisionStage(day, todasHanVotado);

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
  }

  if (stage === 'LECTURA' && result) {
    await prisma.clubvision.update({
      where: { id: clubvision.id },
      data: {
        status: 'LECTURA',
        winnerBookId: result.winnerBookId,
      },
    });
    // Notificar inicio de lectura
    if (result.winnerBookId && result.winnerTitle) {
      notifyLecturaNueva(
        clubvision.clubId,
        result.winnerTitle,
        result.winnerBookId,
      ).catch(console.error);
    }
  }

  return clubvision;
}

async function getCalculatedClubvisionStatus(
  clubvisionId: string,
  clubId: string,
) {
  const { day } = getClubvisionCalendar();
  const totalUsuarios = await prisma.clubMember.count({
    where: { clubId },
  });

  const votosUsuarios = await prisma.clubvisionVote.groupBy({
    by: ['userId'],
    where: {
      clubvisionId,
    },
  });

  const votosRecibidos = votosUsuarios.length;
  const todasHanVotado = totalUsuarios > 0 && votosRecibidos >= totalUsuarios;

  return getClubvisionStage(day, todasHanVotado);
}

export async function getClubvision(usuario: string) {
  const { club } = await getCurrentClubContext(usuario);
  const idVotacion = getCurrentEdition();

  const clubvision = await synchronizeCurrentClubvision(usuario);

  const totalUsuarios = await prisma.clubMember.count({
    where: { clubId: club.id },
  });

  if (!clubvision) {
    return {
      abierta: false,
      estado: 'SIN_DATOS',
      idVotacion,
      haVotado: false,
      candidatas: [],
      votosRecibidos: 0,
      totalUsuarios,
      votosPendientes: totalUsuarios,
      porcentaje: 0,
      titulo: 'Clubvisión',
      mensaje: 'Sin información',
      ganador: '',
      lectoras: [],
      totalCandidatas: 0,
      comentarios: 0,
      likes: 0,
      ultimaActividad: '',
    };
  }

  const estado = await getCalculatedClubvisionStatus(
    clubvision.id,
    club.id,
  );

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

  const user = usuario.trim()
    ? (await getCurrentClubContext(usuario)).user
    : null;

  const haVotado =
    !!user &&
    (await prisma.clubvisionVote.count({
      where: {
        clubvisionId: clubvision.id,
        userId: user.id,
      },
    })) > 0;

  const candidates = await prisma.clubvisionCandidate.findMany({
    where: {
      clubvisionId: clubvision.id,
    },
    include: {
      book: {
        include: {
          genre: true,
          library: {
            where: {
              status: ReadingStatus.PENDING,
              user: {
                clubMemberships: {
                  some: { clubId: club.id },
                },
              },
            },
            include: {
              user: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  const candidatas = candidates.map((candidate) => ({
    libro: candidate.book.title,
    genero: candidate.book.genre.name,
    coverUrl: candidate.book.coverUrl ?? '',
    interesadas: candidate.book.library.length,
    usuarias: candidate.book.library.map((entry) => entry.user.name),
  }));

  const winner = await prisma.clubvisionResult.findUnique({
    where: {
      clubId_edition: {
        clubId: club.id,
        edition: getCurrentEdition(),
      },
    },
  });

  const ganador = winner?.winnerTitle ?? '';
  const puntosGanador = winner?.points ?? 0;
  const ganadorCoverUrl = winner?.winnerBookId
    ? (await prisma.book.findUnique({
        where: { id: winner.winnerBookId },
        select: { coverUrl: true },
      }))?.coverUrl ?? ''
    : '';
  const lectoras = winner?.winnerBookId
    ? await prisma.library.findMany({
        where: {
          bookId: winner.winnerBookId,
          status: ReadingStatus.FINISHED,
          user: {
            clubMemberships: {
              some: { clubId: club.id },
            },
          },
        },
        include: { user: true },
      })
    : [];
  const lecturaConfigurada = winner?.winnerBookId
    ? (await prisma.reading.count({
        where: {
          bookId: winner.winnerBookId,
          clubId: club.id,
          type: 'CLUBVISION',
          status: 'ACTIVE',
        },
      })) > 0
    : false;

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
      estado === 'VOTACION'
        ? '🎤 Clubvisión abierta'
        : estado === 'RESULTADOS'
          ? '🏆 Próxima lectura'
          : estado === 'LECTURA'
            ? '📖 Estamos leyendo'
            : 'Clubvisión',

    mensaje:
      estado === 'VOTACION'
        ? '🗳️ Ya puedes votar'
        : estado === 'RESULTADOS'
          ? 'Ya tenemos una nueva lectura.'
          : estado === 'LECTURA' && ganador
            ? ganador
            : '',

    ganador,
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
  };
}

export async function enviarVotacion(usuario: string, votos: string[]) {
  const { club, user } = await requireClubMember(usuario);

  const clubvision = await getOrCreateCurrentClubvision(usuario);

  if (!clubvision) {
    return {
      ok: false,
      mensaje: 'No hay votación abierta',
    };
  }

  const estado = await getCalculatedClubvisionStatus(
    clubvision.id,
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

  const candidates = await prisma.clubvisionCandidate.findMany({
    where: {
      clubvisionId: clubvision.id,
      book: {
        title: { in: normalizedVotes },
      },
    },
    include: { book: true },
  });

  const candidatesByTitle = new Map(
    candidates.map((candidate) => [candidate.book.title, candidate]),
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

  return {
    ok: true,
  };
}

export async function getMiVoto(usuario: string) {
  const { club, user } = await requireClubMember(usuario);

  const clubvision = await prisma.clubvision.findUnique({
    where: {
      clubId_edition: {
        clubId: club.id,
        edition: getCurrentEdition(),
      },
    },
  });

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
    votos: votos.map((voto) => voto.candidate.book.title),
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
    clubvision.id,
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

export async function getHistorialClubvision(usuario = '') {
  const { club } = await getCurrentClubContext(usuario);
  const results = await prisma.clubvisionResult.findMany({
    where: { clubId: club.id },
    orderBy: {
      edition: 'desc',
    },
  });

  return results.map((result) => ({
    mes: result.edition,
    ganadora: result.winnerTitle,
    puntos: result.points,
    segunda: result.secondTitle ?? '',
    tercera: result.thirdTitle ?? '',
  }));
}
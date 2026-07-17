import { ReadingStatus } from '@prisma/client';
import { prisma } from '../prisma.js';

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
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(getNow());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    edition: `${values.year}-${values.month}`,
    day: Number(values.day),
  };
}

function getCurrentEdition() {
  return getClubvisionCalendar().edition;
}

async function getOrCreateCurrentClubvision() {
  const { edition, day } = getClubvisionCalendar();
  const existing = await prisma.clubvision.findUnique({
    where: { edition },
  });

  if (existing || day > 2) return existing;

  return prisma.$transaction(async (tx) => {
    const clubvision = await tx.clubvision.upsert({
      where: { edition },
      update: {},
      create: {
        edition,
        status: 'VOTACION',
        title: '🎤 Clubvisión abierta',
        message: '🗳️ Ya puedes votar',
        openedAt: getNow(),
      },
    });

    const previousWinners = await tx.clubvisionResult.findMany({
      where: {
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
  return synchronizeCurrentClubvision();
}

async function calculateClubvisionResult(clubvision: {
  id: string;
  edition: string;
}) {
  const existing = await prisma.clubvisionResult.findUnique({
    where: { edition: clubvision.edition },
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
      where: { edition: clubvision.edition },
      update: {},
      create: {
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
  });
}

export async function synchronizeCurrentClubvision() {
  const clubvision = await getOrCreateCurrentClubvision();
  if (!clubvision) return null;

  const { day } = getClubvisionCalendar();
  const totalUsuarios = await prisma.user.count();
  const voters = await prisma.clubvisionVote.groupBy({
    by: ['userId'],
    where: { clubvisionId: clubvision.id },
  });
  const todasHanVotado = totalUsuarios > 0 && voters.length >= totalUsuarios;

  let result = await prisma.clubvisionResult.findUnique({
    where: { edition: clubvision.edition },
  });

  if (day >= 3 || todasHanVotado) {
    result = await calculateClubvisionResult(clubvision);
  }

  if (day >= 4 && result) {
    await prisma.clubvision.update({
      where: { id: clubvision.id },
      data: {
        status: 'LECTURA',
        winnerBookId: result.winnerBookId,
      },
    });
  }

  return clubvision;
}

async function getCalculatedClubvisionStatus(clubvisionId: string) {
  const { day } = getClubvisionCalendar();
  const totalUsuarios = await prisma.user.count();

  const votosUsuarios = await prisma.clubvisionVote.groupBy({
    by: ['userId'],
    where: {
      clubvisionId,
    },
  });

  const votosRecibidos = votosUsuarios.length;
  const todasHanVotado = totalUsuarios > 0 && votosRecibidos >= totalUsuarios;

  if (day >= 4) return 'LECTURA';
  if (day >= 3 || todasHanVotado) return 'RESULTADOS';

  return 'VOTACION';
}

export async function getClubvision(usuario: string) {
  const idVotacion = getCurrentEdition();

  const clubvision = await synchronizeCurrentClubvision();

  const totalUsuarios = await prisma.user.count();

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

  const estado = await getCalculatedClubvisionStatus(clubvision.id);

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
    ? await prisma.user.findUnique({
        where: {
          name: usuario.trim(),
        },
      })
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
    interesadas: candidate.book.library.length,
    usuarias: candidate.book.library.map((entry) => entry.user.name),
  }));

  const winner = await prisma.clubvisionResult.findUnique({
    where: {
      edition: getCurrentEdition(),
    },
  });

  const ganador = winner?.winnerTitle ?? '';
  const puntosGanador = winner?.points ?? 0;
  const lectoras = winner?.winnerBookId
    ? await prisma.library.findMany({
        where: {
          bookId: winner.winnerBookId,
          status: ReadingStatus.FINISHED,
        },
        include: { user: true },
      })
    : [];
  const lecturaConfigurada = winner?.winnerBookId
    ? (await prisma.reading.count({
        where: {
          bookId: winner.winnerBookId,
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
        : ganador
          ? `${ganador}${puntosGanador ? ` (${puntosGanador} puntos)` : ''}`
          : '',

    ganador,
    lecturaConfigurada,
    lectoras: lectoras.map((entry) => entry.user.name),

    totalCandidatas: candidatas.length,

    comentarios: 0,
    likes: 0,
    ultimaActividad: '',
  };
}

export async function enviarVotacion(usuario: string, votos: string[]) {
  const user = await prisma.user.findUnique({
    where: {
      name: usuario.trim(),
    },
  });

  if (!user) {
    return {
      ok: false,
      mensaje: 'Usuaria no encontrada',
    };
  }

  const clubvision = await getOrCreateCurrentClubvision();

  if (!clubvision) {
    return {
      ok: false,
      mensaje: 'No hay votación abierta',
    };
  }

  const estado = await getCalculatedClubvisionStatus(clubvision.id);

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
      mensaje: 'Debes votar exactamente cinco libros diferentes',
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
    candidates.length !== 5 ||
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

  await synchronizeCurrentClubvision();

  return {
    ok: true,
  };
}

export async function getMiVoto(usuario: string) {
  const user = await prisma.user.findUnique({
    where: { name: usuario.trim() },
  });

  if (!user) {
    return { encontrado: false };
  }

  const clubvision = await prisma.clubvision.findUnique({
    where: {
      edition: getCurrentEdition(),
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

  const totalUsuarios = await prisma.user.count();

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

export async function getComoVotaron() {
  const clubvision = await synchronizeCurrentClubvision();

  if (!clubvision) {
    return [];
  }

  const estado = await getCalculatedClubvisionStatus(clubvision.id);
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

export async function getHistorialClubvision() {
  const results = await prisma.clubvisionResult.findMany({
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

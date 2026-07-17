import { prisma } from '../prisma.js';

const POINTS_BY_POSITION = [12, 10, 8, 7, 6] as const;

function getNow() {
  const simulatedDate = process.env.SIMULATED_DATE?.trim();

  if (!simulatedDate) {
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

function getCurrentEdition() {
  const now = getNow();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function getCalculatedClubvisionStatus(clubvisionId: string) {
  const day = getNow().getDate();
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

  const clubvision = await prisma.clubvision.findUnique({
    where: {
      edition: getCurrentEdition(),
    },
  });

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

  const winner = await prisma.clubvisionResult.findFirst({
    orderBy: {
      edition: 'desc',
    },
  });

  const ganador = winner?.winnerTitle ?? '';
  const puntosGanador = winner?.points ?? 0;

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
    lectoras: [],

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

  const clubvision = await prisma.clubvision.findUnique({
    where: {
      edition: getCurrentEdition(),
    },
  });

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

  for (let i = 0; i < votos.length; i++) {
    const points = POINTS_BY_POSITION[i];
    if (points === undefined) break;

    const title = votos[i]?.trim() ?? '';
    if (!title) continue;

    const candidate = await prisma.clubvisionCandidate.findFirst({
      where: {
        clubvisionId: clubvision.id,
        book: {
          title,
        },
      },
    });

    if (!candidate) continue;

    await prisma.clubvisionVote.create({
      data: {
        clubvisionId: clubvision.id,
        userId: user.id,
        candidateId: candidate.id,
        position: i + 1,
        points,
      },
    });
  }

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
  const clubvision = await prisma.clubvision.findUnique({
    where: {
      edition: getCurrentEdition(),
    },
  });

  if (!clubvision) {
    return [];
  }

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
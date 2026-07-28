import {
  ClubRole,
  Prisma,
  ReadingSessionStatus,
  ReadingType,
  ReadingStatus,
} from '@prisma/client';
import { prisma } from '../prisma.js';
import { synchronizeCurrentClubvision } from './clubvision.service.js';
import {
  getCurrentClubContext,
  requireClubMember,
} from './club-context.service.js';

function tipoFromFlutter(tipo: string): ReadingType {
  return tipo === 'OFICIAL' ? ReadingType.CLUBVISION : ReadingType.FREE;
}

function tipoToFlutter(tipo: ReadingType) {
  return tipo === ReadingType.CLUBVISION ? 'OFICIAL' : 'LIBRE';
}

function legacyApkEnabled() {
  return process.env.AUTH_REQUIRE_ACCESS_TOKEN !== 'true';
}

function tiempoRelativo(fecha: Date) {
  const diffMin = Math.floor((Date.now() - fecha.getTime()) / 60000);

  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;

  const horas = Math.floor(diffMin / 60);
  if (horas < 24) return `hace ${horas} h`;
  if (horas < 48) return 'ayer';

  return fecha.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
  });
}

function buildChapters(
  reading: {
    conversations: {
      title: string;
      order: number;
      reads: {
        lastSeenAt: Date;
      }[];
      comments: {
        deletedAt: Date | null;
        createdAt: Date;
        userId: string;
        user: { name: string };
        likes: { id: string }[];
        replies: {
          deletedAt: Date | null;
          createdAt: Date;
          userId: string;
          user: { name: string };
          likes: { id: string }[];
        }[];
      }[];
    }[];
  },
  userId: string | null,
) {
  return reading.conversations
    .sort((a, b) => a.order - b.order)
    .map((conversation) => {
      let comentarios = 0;
      let respuestas = 0;
      let likes = 0;

      let nuevosComentarios = 0;
      let nuevasRespuestas = 0;
      let ultimaFecha: Date | null = null;
      let ultimoUsuario = '';

      const lastSeenAt = conversation.reads[0]?.lastSeenAt ?? null;

      for (const comment of conversation.comments) {
        if (comment.deletedAt) continue;

          comentarios++;
          likes += comment.likes.length;

          const esNuevo =
            userId !== null &&
            comment.userId !== userId &&
            (!lastSeenAt || comment.createdAt > lastSeenAt);

          if (esNuevo) {
            nuevosComentarios++;
}

        if (!ultimaFecha || comment.createdAt > ultimaFecha) {
          ultimaFecha = comment.createdAt;
          ultimoUsuario = comment.user.name;
        }

        for (const reply of comment.replies) {
          if (reply.deletedAt) continue;

            respuestas++;
            likes += reply.likes.length;

            const respuestaNueva =
              userId !== null &&
              reply.userId !== userId &&
              (!lastSeenAt || reply.createdAt > lastSeenAt);

            if (respuestaNueva) {
              nuevasRespuestas++;
            }

          if (!ultimaFecha || reply.createdAt > ultimaFecha) {
            ultimaFecha = reply.createdAt;
            ultimoUsuario = reply.user.name;
          }
        }
      }

      return {
        nombre: conversation.title,
        comentarios,
        respuestas,
        likes,
        nuevosComentarios,
        nuevasRespuestas,
        nuevosTotal: nuevosComentarios + nuevasRespuestas,
        tieneNovedades: nuevosComentarios + nuevasRespuestas > 0,
        ultimaActividad: ultimaFecha
          ? `💬 ${ultimoUsuario} comentó ${tiempoRelativo(ultimaFecha)}`
          : '',
      };
    });
}
export async function getLecturasActivas(usuario = '') {
  const { club } = await getCurrentClubContext(usuario);
  await synchronizeCurrentClubvision(usuario);
  const readingBooks = await prisma.library.groupBy({
    by: ['bookId'],
    where: {
      status: ReadingStatus.READING,
      user: { clubMemberships: { some: { clubId: club.id } } },
    },
    _count: {
      userId: true,
    },
  });

  const lectorasByBook = new Map(
    readingBooks.map((item) => [item.bookId, item._count.userId]),
  );

  const readings = await prisma.reading.findMany({
    where: {
      status: ReadingSessionStatus.ACTIVE,
      clubId: club.id,
    },
    include: {
      book: true,
      conversations: {
        include: {
          comments: {
            include: {
              user: true,
              likes: true,
              replies: {
                include: {
                  user: true,
                  likes: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: {
      startedAt: 'desc',
    },
  });

  const resultado: {
    libro: string;
    coverUrl: string;
    lectoras: number;
    configurada: boolean;
    comentarios: number;
    ultimaActividad: string;
    tipo: string;
    estado: string;
  }[] = [];

  for (const reading of readings) {
    const lectoras = lectorasByBook.get(reading.bookId) ?? 0;

    if (reading.type === ReadingType.FREE && lectoras < 2) {
      continue;
    }

    let comentarios = 0;
    let ultimaFecha: Date | null = null;
    let ultimaActividad = '';

    for (const conversation of reading.conversations) {
      for (const comment of conversation.comments) {
        if (comment.deletedAt) continue;

        comentarios++;

        if (!ultimaFecha || comment.createdAt > ultimaFecha) {
          ultimaFecha = comment.createdAt;
          ultimaActividad = `💬 ${comment.user.name} comentó`;
        }

        for (const reply of comment.replies) {
          if (reply.deletedAt) continue;

          comentarios++;

          if (!ultimaFecha || reply.createdAt > ultimaFecha) {
            ultimaFecha = reply.createdAt;
            ultimaActividad = `↩️ ${reply.user.name} respondió`;
          }
        }
      }
    }

    resultado.push({
      libro: reading.book.title,
      coverUrl: reading.book.coverUrl ?? '',
      lectoras,
      configurada: true,
      comentarios,
      ultimaActividad: ultimaFecha
        ? `${ultimaActividad} ${tiempoRelativo(ultimaFecha)}`
        : '',
      tipo: tipoToFlutter(reading.type),
      estado: 'ACTIVA',
    });
  }

  const compartidas = await prisma.library.groupBy({
    by: ['bookId'],
    where: {
      status: ReadingStatus.READING,
      user: { clubMemberships: { some: { clubId: club.id } } },
    },
    _count: {
      userId: true,
    },
    having: {
      userId: {
        _count: {
          gte: 2,
        },
      },
    },
  });

  for (const lectura of compartidas) {
    const book = await prisma.book.findUnique({
      where: { id: lectura.bookId },
    });

    if (!book) continue;

    const yaExiste = resultado.some(
      (item) =>
        item.libro.trim().toLowerCase() === book.title.trim().toLowerCase(),
    );

    if (yaExiste) continue;

    resultado.push({
      libro: book.title,
      coverUrl: book.coverUrl ?? '',
      lectoras: lectura._count.userId,
      configurada: false,
      comentarios: 0,
      ultimaActividad: '',
      tipo: 'LIBRE',
      estado: 'ACTIVA',
    });
  }

  const latestResult = await prisma.clubvisionResult.findFirst({
    where: { clubId: club.id },
    orderBy: {
      edition: 'desc',
    },
  });

  const resultClubvision = latestResult
    ? await prisma.clubvision.findUnique({
        where: {
          clubId_edition: {
            clubId: club.id,
            edition: latestResult.edition,
          },
        },
        select: { status: true, clubId: true },
      })
    : null;

  if (
    latestResult?.winnerTitle &&
    resultClubvision?.status === 'LECTURA' &&
    resultClubvision.clubId === club.id
  ) {
    const yaExiste = resultado.some(
      (item) =>
        item.libro.trim().toLowerCase() ===
        latestResult.winnerTitle.trim().toLowerCase(),
    );

    if (!yaExiste) {
      const book = await prisma.book.findFirst({
        where: {
          title: latestResult.winnerTitle,
        },
      });

      const lectoras = book ? lectorasByBook.get(book.id) ?? 0 : 0;

      resultado.unshift({
        libro: latestResult.winnerTitle,
        coverUrl: book?.coverUrl ?? '',
        lectoras,
        configurada: false,
        comentarios: 0,
        ultimaActividad: '',
        tipo: 'OFICIAL',
        estado: 'ACTIVA',
      });
    }
  }

  return resultado.sort((a, b) => {
    if (a.tipo === 'OFICIAL' && b.tipo !== 'OFICIAL') return -1;
    if (a.tipo !== 'OFICIAL' && b.tipo === 'OFICIAL') return 1;
    return b.lectoras - a.lectoras;
  });
}

export async function crearLectura(data: {
  usuario?: string;
  libro: string;
  capitulos: number;
  prologo: boolean;
  epilogo: boolean;
  paginas?: number;
  tipo: string;
}) {
  const requestedType = tipoFromFlutter(data.tipo);
  const legacyRequest = !data.usuario?.trim() && legacyApkEnabled();
  const { club } = legacyRequest
    ? await getCurrentClubContext()
    : await requireClubMember(data.usuario);
  const title = String(data.libro || '').trim();
  const capitulos = Number(data.capitulos || 0);
  const paginas = data.paginas === undefined ? undefined : Number(data.paginas);

  if (!title) return { ok: false, mensaje: 'Falta el libro' };
  if (!capitulos || capitulos <= 0) {
    return { ok: false, mensaje: 'Número de capítulos no válido' };
  }
  if (paginas !== undefined && (!Number.isInteger(paginas) || paginas <= 0)) {
    return { ok: false, mensaje: 'Número de páginas no válido' };
  }

  const book = await prisma.book.findFirst({
    where: { title },
  });

  if (!book) return { ok: false, mensaje: 'Libro no encontrado' };

  const existing = await prisma.reading.findFirst({
    where: {
      bookId: book.id,
      clubId: club.id,
      status: ReadingSessionStatus.ACTIVE,
    },
  });

  if (existing) return { ok: false, mensaje: 'La lectura ya existe' };

  try {
    await prisma.$transaction(async (tx) => {
      if (paginas !== undefined) {
        await tx.book.update({
          where: { id: book.id },
          data: { totalPages: paginas },
        });
      }

      const reading = await tx.reading.create({
        data: {
          bookId: book.id,
          clubId: club.id,
          type: requestedType,
          status: ReadingSessionStatus.ACTIVE,
          chapters: capitulos,
          hasPrologue: data.prologo,
          hasEpilogue: data.epilogo,
        },
      });

      const conversations: Array<{
        readingId: string;
        title: string;
        order: number;
      }> = [];
      let order = 0;

      if (data.prologo) {
        conversations.push({
          readingId: reading.id,
          title: 'Prólogo',
          order: order++,
        });
      }

      for (let i = 1; i <= capitulos; i++) {
        conversations.push({
          readingId: reading.id,
          title: `Capítulo ${i}`,
          order: order++,
        });
      }

      if (data.epilogo) {
        conversations.push({
          readingId: reading.id,
          title: 'Epílogo',
          order: order++,
        });
      }

      conversations.push({
        readingId: reading.id,
        title: '💭 Reflexión final',
        order,
      });

      await tx.conversation.createMany({ data: conversations });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return { ok: false, mensaje: 'La lectura ya existe' };
    }

    throw error;
  }

  return { ok: true };
}

export async function getConfiguracionLectura(
  libro: string,
  usuarioActual: string,
) {
  const title = libro.trim();
  const nombreUsuario = usuarioActual.trim();
  const { club, user } = await getCurrentClubContext(nombreUsuario);

  const reading = await prisma.reading.findFirst({
    where: {
      book: { title },
      clubId: club.id,
      status: ReadingSessionStatus.ACTIVE,
    },
    include: {
      book: true,
      conversations: {
        include: {
          reads: {
            where: user
              ? {
                  userId: user.id,
                }
              : {
                  id: '__sin_usuario__',
                },
            select: {
              lastSeenAt: true,
            },
          },
          comments: {
            include: {
              user: true,
              likes: true,
              replies: {
                include: {
                  user: true,
                  likes: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!reading) {
    return {
      capitulos: 0,
      prologo: false,
      epilogo: false,
      capitulosDisponibles: [],
      coverUrl: '',
    };
  }

  return {
    capitulos: reading.chapters,
    prologo: reading.hasPrologue,
    epilogo: reading.hasEpilogue,
    capitulosDisponibles: buildChapters(reading, user?.id ?? null),
    coverUrl: reading.book.coverUrl ?? '',
  };
}

export async function marcarConversacionVista(data: {
  libro: string;
  capitulo: string;
  usuario: string;
}) {
  const libro = data.libro.trim();
  const capitulo = data.capitulo.trim();
  const usuario = data.usuario.trim();

  if (!libro || !capitulo || !usuario) {
    return {
      ok: false,
      mensaje: 'Faltan datos',
    };
  }

  const { club, user } = await requireClubMember(usuario);

  if (!user) {
    return {
      ok: false,
      mensaje: 'Usuaria no encontrada',
    };
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      title: capitulo,
      reading: {
        clubId: club.id,
        status: ReadingSessionStatus.ACTIVE,
        book: {
          title: libro,
        },
      },
    },
    select: {
      id: true,
    },
  });

  if (!conversation) {
    return {
      ok: false,
      mensaje: 'Capítulo no encontrado',
    };
  }

  await prisma.conversationRead.upsert({
    where: {
      userId_conversationId: {
        userId: user.id,
        conversationId: conversation.id,
      },
    },
    update: {
      lastSeenAt: new Date(),
    },
    create: {
      userId: user.id,
      conversationId: conversation.id,
      lastSeenAt: new Date(),
    },
  });

  return {
    ok: true,
  };
}

export async function getComentariosLectura(
  libro: string,
  capitulo: string,
  usuarioActual: string,
) {
  const { club } = await getCurrentClubContext(usuarioActual);
  const conversation = await prisma.conversation.findFirst({
    where: {
      title: capitulo,
      reading: {
        clubId: club.id,
        book: { title: libro },
        status: ReadingSessionStatus.ACTIVE,
      },
    },
    include: {
      comments: {
        where: {
          parentId: null,
          deletedAt: null,
        },
        include: {
          user: true,
          likes: true,
          replies: {
            where: {
              deletedAt: null,
            },
            include: {
              user: true,
              likes: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!conversation) {
    return {
      ok: true,
      capitulo,
      comentarios: [],
    };
  }
  const usuario = usuarioActual.trim();
  let usuarioId = '';

if (usuario) {
  const user = await prisma.user.findUnique({
    where: { name: usuario },
    select: { id: true },
  });

  if (user) {
    usuarioId = user.id;
    await prisma.conversationRead.upsert({
      where: {
        userId_conversationId: {
          userId: user.id,
          conversationId: conversation.id,
        },
      },
      update: {
        lastSeenAt: new Date(),
      },
      create: {
        userId: user.id,
        conversationId: conversation.id,
        lastSeenAt: new Date(),
      },
    });
  }
}
  return {
    ok: true,
    capitulo,
    comentarios: conversation.comments.map((comment) => ({
      id: comment.id,
      libro,
      capitulo,
      usuario: comment.user.name,
      fecha: comment.createdAt.toLocaleString('es-ES'),
      comentario: comment.text,
      likes: comment.likes.length,
      reacciones: contarReacciones(comment.likes),
      miReaccion: comment.likes.find((like) => like.userId === usuarioId)?.reaction ?? null,
      editado: comment.edited,
      eliminado: false,
      miLike: comment.likes.some((like) => like.userId === usuarioId),
      esMio: comment.user.name === usuarioActual,
      avatarUrl: comment.user.avatarUrl ?? '',
      respuestas: comment.replies.map((reply) => ({
        id: reply.id,
        comentarioId: comment.id,
        usuario: reply.user.name,
        fecha: reply.createdAt.toLocaleString('es-ES'),
        respuesta: reply.text,
        likes: reply.likes.length,
        reacciones: contarReacciones(reply.likes),
        miReaccion: reply.likes.find((like) => like.userId === usuarioId)?.reaction ?? null,
        miLike: reply.likes.some((like) => like.userId === usuarioId),
        editado: reply.edited,
        eliminado: false,
        esMia: reply.user.name === usuarioActual,
        avatarUrl: reply.user.avatarUrl ?? '',
      })),
    })),
  };
}

export async function enviarComentarioLectura(data: {
  libro: string;
  capitulo: string;
  usuario: string;
  comentario: string;
}) {
  const libro = data.libro.trim();
  const capitulo = data.capitulo.trim();
  const usuario = data.usuario.trim();
  const comentario = data.comentario.trim();

  if (!libro || !capitulo || !usuario || !comentario) {
    return { ok: false, mensaje: 'Faltan datos' };
  }

  const { club, user } = await requireClubMember(usuario);

  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const conversation = await prisma.conversation.findFirst({
    where: {
      title: capitulo,
      reading: {
        clubId: club.id,
        status: ReadingSessionStatus.ACTIVE,
        book: {
          title: libro,
        },
      },
    },
  });

  if (!conversation) return { ok: false, mensaje: 'Capítulo no encontrado' };

  await prisma.comment.create({
    data: {
      conversationId: conversation.id,
      userId: user.id,
      text: comentario,
    },
  });

  return { ok: true };
}

export async function responderComentarioLectura(data: {
  comentarioId: string;
  usuario: string;
  respuesta: string;
}) {
  const comentarioId = data.comentarioId.trim();
  const usuario = data.usuario.trim();
  const respuesta = data.respuesta.trim();

  if (!comentarioId || !usuario || !respuesta) {
    return { ok: false, mensaje: 'Faltan datos' };
  }

  const { club, user } = await requireClubMember(usuario);

  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const parent = await prisma.comment.findFirst({
    where: {
      id: comentarioId,
      conversation: { reading: { clubId: club.id } },
    },
  });

  if (!parent) return { ok: false, mensaje: 'Comentario no encontrado' };

  await prisma.comment.create({
    data: {
      conversationId: parent.conversationId,
      parentId: parent.id,
      userId: user.id,
      text: respuesta,
    },
  });

  return { ok: true };
}

export async function toggleLikeComentario(
  comentarioId: string,
  usuario: string,
  reaccion: string = 'LIKE',
) {
  const idComentario = comentarioId.trim();

  const { club, user } = await requireClubMember(usuario);

  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const comment = await prisma.comment.findFirst({
    where: {
      id: idComentario,
      conversation: { reading: { clubId: club.id } },
    },
  });

  if (!comment || comment.deletedAt) {
    return { ok: false, mensaje: 'Comentario no encontrado' };
  }

  const existing = await prisma.like.findUnique({
    where: {
      commentId_userId: {
        commentId: idComentario,
        userId: user.id,
      },
    },
  });

  const reaction = normalizarReaccion(reaccion);

  if (existing?.reaction === reaction) {
    await prisma.like.delete({
      where: { id: existing.id },
    });
  } else if (existing) {
    await prisma.like.update({
      where: { id: existing.id },
      data: { reaction },
    });
  } else {
    await prisma.like.create({
      data: {
        commentId: idComentario,
        userId: user.id,
        reaction,
      },
    });
  }

  const reactions = await prisma.like.findMany({
    where: {
      commentId: idComentario,
    },
  });

  return {
    ok: true,
    miLike: existing?.reaction !== reaction,
    miReaccion: existing?.reaction === reaction ? null : reaction,
    likes: reactions.length,
    reacciones: contarReacciones(reactions),
  };
}

function normalizarReaccion(reaccion: string) {
  const permitidas = [
    'LIKE',
    'AGREE',
    'ANGRY',
    'FUNNY',
    'THUMBS_UP',
    'CRY',
    'WOW',
    'SWEAR',
    'CLAP',
  ] as const;
  const valor = reaccion.trim().toUpperCase();
  return permitidas.find((tipo) => tipo === valor) ?? 'LIKE';
}

function contarReacciones(reacciones: Array<{ reaction: string }>) {
  return reacciones.reduce<Record<string, number>>((totales, item) => {
    totales[item.reaction] = (totales[item.reaction] ?? 0) + 1;
    return totales;
  }, {
    LIKE: 0,
    AGREE: 0,
    ANGRY: 0,
    FUNNY: 0,
    THUMBS_UP: 0,
    CRY: 0,
    WOW: 0,
    SWEAR: 0,
    CLAP: 0,
  });
}

export async function editarComentarioLectura(
  comentarioId: string,
  comentario: string,
  usuario = '',
) {
  const text = comentario.trim();

  if (!comentarioId || !text) {
    return { ok: false, mensaje: 'Faltan datos' };
  }

  const legacyRequest = !usuario.trim() && legacyApkEnabled();
  const context = legacyRequest
    ? await getCurrentClubContext()
    : await requireClubMember(usuario);
  const { club, user, membership } = context;
  const canModerate =
    legacyRequest ||
    membership?.role === ClubRole.OWNER ||
    membership?.role === ClubRole.ADMIN;
  const existing = await prisma.comment.findFirst({
    where: {
      id: comentarioId,
      conversation: { reading: { clubId: club.id } },
      ...(canModerate ? {} : { userId: user!.id }),
    },
  });

  if (!existing || existing.deletedAt) {
    return { ok: false, mensaje: 'Comentario no encontrado' };
  }

  await prisma.comment.update({
    where: { id: comentarioId },
    data: {
      text,
      edited: true,
    },
  });

  return { ok: true };
}

export async function eliminarComentarioLectura(
  comentarioId: string,
  usuario = '',
) {
  if (!comentarioId) {
    return { ok: false, mensaje: 'Falta comentarioId' };
  }

  const legacyRequest = !usuario.trim() && legacyApkEnabled();
  const context = legacyRequest
    ? await getCurrentClubContext()
    : await requireClubMember(usuario);
  const { club, user, membership } = context;
  const canModerate =
    legacyRequest ||
    membership?.role === ClubRole.OWNER ||
    membership?.role === ClubRole.ADMIN;
  const existing = await prisma.comment.findFirst({
    where: {
      id: comentarioId,
      conversation: { reading: { clubId: club.id } },
      ...(canModerate ? {} : { userId: user!.id }),
    },
  });

  if (!existing || existing.deletedAt) {
    return { ok: false, mensaje: 'Comentario no encontrado' };
  }

  await prisma.comment.update({
    where: { id: comentarioId },
    data: {
      deletedAt: new Date(),
    },
  });

  return { ok: true };
}

export async function editarRespuestaLectura(
  respuestaId: string,
  respuesta: string,
  usuario = '',
) {
  return editarComentarioLectura(respuestaId, respuesta, usuario);
}

export async function eliminarRespuestaLectura(
  respuestaId: string,
  usuario = '',
) {
  return eliminarComentarioLectura(respuestaId, usuario);
}

export async function getConversacionesLibro(libro: string, usuario = '') {
  const { club } = await getCurrentClubContext(usuario);
  const readings = await prisma.reading.findMany({
    where: {
      clubId: club.id,
      book: {
        title: libro.trim(),
      },
    },
    include: {
      conversations: {
        include: {
          comments: {
            include: {
              likes: true,
              replies: {
                include: {
                  likes: true,
                },
              },
            },
          },
        },
      },
      book: true,
    },
    orderBy: {
      startedAt: 'desc',
    },
  });

  return readings.map((reading) => {
    let comentarios = 0;
    let likes = 0;
    let ultimaFecha: Date | null = null;

    for (const conversation of reading.conversations) {
      for (const comment of conversation.comments) {
        if (comment.deletedAt) continue;

        comentarios++;
        likes += comment.likes.length;

        if (!ultimaFecha || comment.createdAt > ultimaFecha) {
          ultimaFecha = comment.createdAt;
        }

        for (const reply of comment.replies) {
          if (reply.deletedAt) continue;

          comentarios++;
          likes += reply.likes.length;

          if (!ultimaFecha || reply.createdAt > ultimaFecha) {
            ultimaFecha = reply.createdAt;
          }
        }
      }
    }

    return {
      libro: reading.book.title,
      tipo: tipoToFlutter(reading.type),
      estado:
        reading.status === ReadingSessionStatus.ACTIVE
          ? 'ACTIVA'
          : 'FINALIZADA',
      comentarios,
      likes,
      ultimaActividad: ultimaFecha
        ? `Última actividad ${tiempoRelativo(ultimaFecha)}`
        : '',
    };
  });
}

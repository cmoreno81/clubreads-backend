import {
  ClubRole,
  Prisma,
  ReadingSessionStatus,
  ReadingType,
  ReadingStatus,
} from '@prisma/client';
import { prisma } from '../prisma.js';
import {
  notifyComentarioLectura,
  notifyLecturaCompartida,
} from './notifications.service.js';
import { synchronizeCurrentClubvision } from './clubvision.service.js';
import {
  getCurrentClubContext,
  requireClubMember,
} from './club-context.service.js';
import {
  ascendingCursorFilter,
  descendingCursorFilter,
  pageFromRows,
  type PaginationRequest,
} from '../utils/cursor-pagination.js';
import { backgroundError } from '../logging/logger.js';
import { normalizeReadingType } from '../validation/api-enums.js';
import { activityTimestamp } from '../utils/activity-timestamp.js';

function tipoFromFlutter(tipo: string): ReadingType {
  return normalizeReadingType(tipo) === 'CLUBVISION'
    ? ReadingType.CLUBVISION
    : ReadingType.FREE;
}

function tipoToFlutter(tipo: ReadingType) {
  return tipo === ReadingType.CLUBVISION ? 'OFICIAL' : 'LIBRE';
}

export function shouldShowActiveReading(type: ReadingType, readers: number) {
  return type !== ReadingType.FREE || readers >= 2;
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
        ultimaActividad: activityTimestamp(ultimaFecha),
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
    ultimaActividad: string | null;
    tipo: string;
    estado: string;
  }[] = [];

  for (const reading of readings) {
    const lectoras = lectorasByBook.get(reading.bookId) ?? 0;

    if (!shouldShowActiveReading(reading.type, lectoras)) {
      continue;
    }

    let comentarios = 0;
    let ultimaFecha: Date | null = null;

    for (const conversation of reading.conversations) {
      for (const comment of conversation.comments) {
        if (comment.deletedAt) continue;

        comentarios++;

        if (!ultimaFecha || comment.createdAt > ultimaFecha) {
          ultimaFecha = comment.createdAt;
        }

        for (const reply of comment.replies) {
          if (reply.deletedAt) continue;

          comentarios++;

          if (!ultimaFecha || reply.createdAt > ultimaFecha) {
            ultimaFecha = reply.createdAt;
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
      ultimaActividad: activityTimestamp(ultimaFecha),
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
      ultimaActividad: null,
      tipo: 'LIBRE',
      estado: 'ACTIVA',
    });
  }

  const latestResult = await prisma.clubvisionResult.findFirst({
    where: { clubId: club.id },
    orderBy: {
      edition: 'desc',
    },
    include: {
      winnerBook: { select: { id: true, title: true, coverUrl: true } },
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

  const winnerTitle = latestResult?.winnerBook?.title ?? latestResult?.winnerTitle ?? null;

  if (
    winnerTitle &&
    resultClubvision?.status === 'LECTURA' &&
    resultClubvision.clubId === club.id
  ) {
    const yaExiste = resultado.some(
      (item) =>
        item.libro.trim().toLowerCase() === winnerTitle.trim().toLowerCase(),
    );

    if (!yaExiste) {
      const book =
        latestResult?.winnerBook ??
        (await prisma.book.findFirst({
          where: { title: winnerTitle },
          select: { id: true, title: true, coverUrl: true },
        }));

      const lectoras = book ? lectorasByBook.get(book.id) ?? 0 : 0;

      resultado.unshift({
        libro: winnerTitle,
        coverUrl: book?.coverUrl ?? '',
        lectoras,
        configurada: false,
        comentarios: 0,
        ultimaActividad: null,
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
  const { club, user } = await requireClubMember(data.usuario);
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

  let created = false;
  let notificationReadingId: string | undefined;
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`reading:active:${club.id}:${book.id}`}, 0)
        )::text
      `;
      if (requestedType === ReadingType.CLUBVISION) {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`reading:official:${club.id}`}, 0)
          )::text
        `;
      }
      const existing = await tx.reading.findFirst({
        where: {
          bookId: book.id,
          clubId: club.id,
          status: ReadingSessionStatus.ACTIVE,
        },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      });
      if (existing) {
        if (requestedType !== ReadingType.CLUBVISION) {
          return { alreadyExists: true, created: false };
        }
        await tx.reading.updateMany({
          where: {
            clubId: club.id,
            status: ReadingSessionStatus.ACTIVE,
            type: ReadingType.CLUBVISION,
            id: { not: existing.id },
          },
          data: { type: ReadingType.FREE },
        });
        if (existing.type !== ReadingType.CLUBVISION) {
          await tx.reading.update({
            where: { id: existing.id },
            data: { type: ReadingType.CLUBVISION },
          });
        }
        return { alreadyExists: false, created: false };
      }

      if (requestedType === ReadingType.CLUBVISION) {
        await tx.reading.updateMany({
          where: {
            clubId: club.id,
            status: ReadingSessionStatus.ACTIVE,
            type: ReadingType.CLUBVISION,
          },
          data: { type: ReadingType.FREE },
        });
      }
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
      return { alreadyExists: false, created: true, readingId: reading.id };
    });
    if (outcome.alreadyExists) {
      return { ok: false, mensaje: 'La lectura ya existe' };
    }
    created = outcome.created;
    notificationReadingId = outcome.readingId;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return { ok: false, mensaje: 'La lectura ya existe' };
    }

    throw error;
  }

  if (user && created) {
    void notifyLecturaCompartida({
      clubId: club.id,
      creadoraUserId: user.id,
      bookTitle: book.title,
      bookId: book.id,
      readingId: notificationReadingId,
    }).catch(backgroundError('shared_reading_notification_failed'));
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
      bookId: '',
    };
  }

  return {
    capitulos: reading.chapters,
    prologo: reading.hasPrologue,
    epilogo: reading.hasEpilogue,
    capitulosDisponibles: buildChapters(reading, user?.id ?? null),
    coverUrl: reading.book.coverUrl ?? '',
    bookId: reading.book.id,
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
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
      fecha: comment.createdAt.toISOString(),
      comentario: comment.text,
      tipo: comment.type,
      color: comment.color ?? '',
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
        fecha: reply.createdAt.toISOString(),
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

export async function getComentariosLecturaPage(
  libro: string,
  capitulo: string,
  usuarioActual: string,
  pagination: PaginationRequest,
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
    select: { id: true },
  });
  if (!conversation) return { items: [], nextCursor: null, hasMore: false };

  const user = await prisma.user.findUnique({
    where: { name: usuarioActual.trim() },
    select: { id: true },
  });
  const usuarioId = user?.id ?? '';
  if (user) {
    await prisma.conversationRead.upsert({
      where: {
        userId_conversationId: {
          userId: user.id,
          conversationId: conversation.id,
        },
      },
      update: { lastSeenAt: new Date() },
      create: { userId: user.id, conversationId: conversation.id },
    });
  }

  const comments = await prisma.comment.findMany({
    where: {
      conversationId: conversation.id,
      parentId: null,
      deletedAt: null,
      ...ascendingCursorFilter('createdAt', pagination.cursor),
    },
    select: {
      id: true,
      text: true,
      type: true,
      color: true,
      edited: true,
      createdAt: true,
      user: { select: { name: true, avatarUrl: true } },
      likes: { select: { userId: true, reaction: true } },
      replies: {
        where: { deletedAt: null },
        select: {
          id: true,
          text: true,
          edited: true,
          createdAt: true,
          user: { select: { name: true, avatarUrl: true } },
          likes: { select: { userId: true, reaction: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: pagination.limit + 1,
  });
  const page = pageFromRows(comments, pagination.limit, (comment) => ({
    value: comment.createdAt.toISOString(),
    id: comment.id,
  }));
  return {
    ...page,
    items: page.items.map((comment) => ({
      id: comment.id,
      libro,
      capitulo,
      usuario: comment.user.name,
      fecha: comment.createdAt.toISOString(),
      comentario: comment.text,
      tipo: comment.type,
      color: comment.color ?? '',
      likes: comment.likes.length,
      reacciones: contarReacciones(comment.likes),
      miReaccion: comment.likes.find(({ userId }) => userId === usuarioId)?.reaction ?? null,
      editado: comment.edited,
      eliminado: false,
      miLike: comment.likes.some(({ userId }) => userId === usuarioId),
      esMio: comment.user.name === usuarioActual,
      avatarUrl: comment.user.avatarUrl ?? '',
      respuestas: comment.replies.map((reply) => ({
        id: reply.id,
        comentarioId: comment.id,
        usuario: reply.user.name,
        fecha: reply.createdAt.toISOString(),
        respuesta: reply.text,
        likes: reply.likes.length,
        reacciones: contarReacciones(reply.likes),
        miReaccion: reply.likes.find(({ userId }) => userId === usuarioId)?.reaction ?? null,
        miLike: reply.likes.some(({ userId }) => userId === usuarioId),
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
  tipo?: string;
  color?: string;
}) {
  const libro = data.libro.trim();
  const capitulo = data.capitulo.trim();
  const usuario = data.usuario.trim();
  const comentario = data.comentario.trim();
  const tipo = data.tipo?.trim().toUpperCase() === 'QUOTE' ? 'QUOTE' : 'COMMENT';
  const color = /^#[0-9A-F]{6}$/i.test(data.color?.trim() ?? '')
    ? data.color!.trim().toUpperCase()
    : null;

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
    include: { reading: { select: { id: true, bookId: true } } },
  });

  if (!conversation) return { ok: false, mensaje: 'Capítulo no encontrado' };

  const created = await prisma.comment.create({
    data: {
      conversationId: conversation.id,
      userId: user.id,
      text: comentario,
      type: tipo,
      color: tipo === 'QUOTE' ? color : null,
    },
    select: {
      id: true,
      text: true,
      type: true,
      color: true,
      edited: true,
      createdAt: true,
      user: { select: { name: true, avatarUrl: true } },
    },
  });

  // Notificar a otros participantes del hilo
  const miembros = await prisma.clubMember.findMany({
    where: { clubId: club.id },
    select: { userId: true },
  });
  notifyComentarioLectura({
    clubId: club.id,
    autorNombre: user.name,
    autorUserId: user.id,
    bookTitle: libro,
    bookId: conversation.reading?.bookId ?? '',
    readingId: conversation.reading?.id,
    participantes: miembros.map((m) => m.userId),
  }).catch(backgroundError('comment_notification_failed'));

  return {
    ok: true,
    comentario: {
      id: created.id,
      libro,
      capitulo,
      usuario: created.user.name,
      avatarUrl: created.user.avatarUrl ?? '',
      fecha: created.createdAt.toISOString(),
      comentario: created.text,
      tipo: created.type,
      color: created.color ?? '',
      likes: 0,
      reacciones: contarReacciones([]),
      miReaccion: null,
      miLike: false,
      esMio: true,
      editado: created.edited,
      eliminado: false,
      respuestas: [],
    },
  };
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

  const conversacionConLectura = await prisma.conversation.findUnique({
  where: { id: parent.conversationId },
  include: { reading: { select: { id: true, bookId: true, book: { select: { title: true } } } } },
});
if (conversacionConLectura?.reading) {
  const miembros = await prisma.clubMember.findMany({
    where: { clubId: club.id },
    select: { userId: true },
  });
  notifyComentarioLectura({
    clubId: club.id,
    autorNombre: user.name,
    autorUserId: user.id,
    bookTitle: conversacionConLectura.reading.book?.title ?? '',
    bookId: conversacionConLectura.reading.bookId ?? '',
    readingId: conversacionConLectura.reading.id,
    participantes: miembros.map((m) => m.userId),
  }).catch(backgroundError('reply_notification_failed'));
}

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

  const { club, user, membership } = await requireClubMember(usuario);
  const canModerate =
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

  const { club, user, membership } = await requireClubMember(usuario);
  const canModerate =
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
      ultimaActividad: activityTimestamp(ultimaFecha),
    };
  });
}

export async function getConversacionesLibroPage(
  libro: string,
  usuario: string,
  pagination: PaginationRequest,
) {
  const { club } = await getCurrentClubContext(usuario);
  const readings = await prisma.reading.findMany({
    where: {
      clubId: club.id,
      book: { title: libro.trim() },
      ...descendingCursorFilter('startedAt', pagination.cursor),
    },
    select: {
      id: true,
      type: true,
      status: true,
      startedAt: true,
      book: { select: { title: true } },
      conversations: {
        select: {
          comments: {
            select: {
              deletedAt: true,
              createdAt: true,
              likes: { select: { id: true } },
              replies: {
                select: {
                  deletedAt: true,
                  createdAt: true,
                  likes: { select: { id: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: pagination.limit + 1,
  });
  const page = pageFromRows(readings, pagination.limit, (reading) => ({
    value: reading.startedAt.toISOString(),
    id: reading.id,
  }));
  return {
    ...page,
    items: page.items.map((reading) => {
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
        estado: reading.status === ReadingSessionStatus.ACTIVE
          ? 'ACTIVA'
          : 'FINALIZADA',
        comentarios,
        likes,
        ultimaActividad: activityTimestamp(ultimaFecha),
      };
    }),
  };
}
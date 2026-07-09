import { ReadingSessionStatus, ReadingType, ReadingStatus } from '@prisma/client';
import { prisma } from '../prisma.js';

function tipoFromFlutter(tipo: string): ReadingType {
  return tipo === 'OFICIAL' ? ReadingType.CLUBVISION : ReadingType.FREE;
}

function tipoToFlutter(tipo: ReadingType) {
  return tipo === ReadingType.CLUBVISION ? 'OFICIAL' : 'LIBRE';
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

function buildChapters(reading: {
  conversations: {
    title: string;
    order: number;
    comments: {
      deletedAt: Date | null;
      createdAt: Date;
      user: { name: string };
      likes: { id: string }[];
      replies: {
        deletedAt: Date | null;
        createdAt: Date;
        user: { name: string };
        likes: { id: string }[];
      }[];
    }[];
  }[];
}) {
  return reading.conversations
    .sort((a, b) => a.order - b.order)
    .map((conversation) => {
      let comentarios = 0;
      let likes = 0;
      let ultimaFecha: Date | null = null;
      let ultimoUsuario = '';

      for (const comment of conversation.comments) {
        if (comment.deletedAt) continue;

        comentarios++;
        likes += comment.likes.length;

        if (!ultimaFecha || comment.createdAt > ultimaFecha) {
          ultimaFecha = comment.createdAt;
          ultimoUsuario = comment.user.name;
        }

        for (const reply of comment.replies) {
          if (reply.deletedAt) continue;

          comentarios++;
          likes += reply.likes.length;

          if (!ultimaFecha || reply.createdAt > ultimaFecha) {
            ultimaFecha = reply.createdAt;
            ultimoUsuario = reply.user.name;
          }
        }
      }

      return {
        nombre: conversation.title,
        comentarios,
        likes,
        ultimaActividad: ultimaFecha
          ? `💬 ${ultimoUsuario} comentó ${tiempoRelativo(ultimaFecha)}`
          : '',
      };
    });
}

export async function getLecturasActivas() {
  const readingBooks = await prisma.library.groupBy({
    by: ['bookId'],
    where: {
      status: ReadingStatus.READING,
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
      lectoras: lectura._count.userId,
      configurada: false,
      comentarios: 0,
      ultimaActividad: '',
      tipo: 'LIBRE',
      estado: 'ACTIVA',
    });
  }

  const latestResult = await prisma.clubvisionResult.findFirst({
    orderBy: {
      edition: 'desc',
    },
  });

  if (latestResult?.winnerTitle) {
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
  libro: string;
  capitulos: number;
  prologo: boolean;
  epilogo: boolean;
  tipo: string;
}) {
  const title = String(data.libro || '').trim();
  const capitulos = Number(data.capitulos || 0);

  if (!title) return { ok: false, mensaje: 'Falta el libro' };
  if (!capitulos || capitulos <= 0) {
    return { ok: false, mensaje: 'Número de capítulos no válido' };
  }

  const book = await prisma.book.findFirst({
    where: { title },
  });

  if (!book) return { ok: false, mensaje: 'Libro no encontrado' };

  const existing = await prisma.reading.findFirst({
    where: {
      bookId: book.id,
      status: ReadingSessionStatus.ACTIVE,
    },
  });

  if (existing) return { ok: false, mensaje: 'La lectura ya existe' };

  const reading = await prisma.reading.create({
    data: {
      bookId: book.id,
      type: tipoFromFlutter(data.tipo),
      status: ReadingSessionStatus.ACTIVE,
      chapters: capitulos,
      hasPrologue: data.prologo,
      hasEpilogue: data.epilogo,
    },
  });

  let order = 0;

  if (data.prologo) {
    await prisma.conversation.create({
      data: {
        readingId: reading.id,
        title: 'Prólogo',
        order: order++,
      },
    });
  }

  for (let i = 1; i <= capitulos; i++) {
    await prisma.conversation.create({
      data: {
        readingId: reading.id,
        title: `Capítulo ${i}`,
        order: order++,
      },
    });
  }

  if (data.epilogo) {
    await prisma.conversation.create({
      data: {
        readingId: reading.id,
        title: 'Epílogo',
        order: order++,
      },
    });
  }

  await prisma.conversation.create({
    data: {
      readingId: reading.id,
      title: '💭 Reflexión final',
      order: order++,
    },
  });

  return { ok: true };
}

export async function getConfiguracionLectura(libro: string) {
  const title = libro.trim();

  const reading = await prisma.reading.findFirst({
    where: {
      book: { title },
      status: ReadingSessionStatus.ACTIVE,
    },
    include: {
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
  });

  if (!reading) {
    return {
      capitulos: 0,
      prologo: false,
      epilogo: false,
      capitulosDisponibles: [],
    };
  }

  return {
    capitulos: reading.chapters,
    prologo: reading.hasPrologue,
    epilogo: reading.hasEpilogue,
    capitulosDisponibles: buildChapters(reading),
  };
}

export async function getComentariosLectura(
  libro: string,
  capitulo: string,
  usuarioActual: string,
) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      title: capitulo,
      reading: {
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
      editado: comment.edited,
      eliminado: false,
      miLike: comment.likes.some((like) => like.userId === usuarioActual),
      esMio: comment.user.name === usuarioActual,
      respuestas: comment.replies.map((reply) => ({
        id: reply.id,
        comentarioId: comment.id,
        usuario: reply.user.name,
        fecha: reply.createdAt.toLocaleString('es-ES'),
        respuesta: reply.text,
        likes: reply.likes.length,
        miLike: reply.likes.some((like) => like.userId === usuarioActual),
        editado: reply.edited,
        eliminado: false,
        esMia: reply.user.name === usuarioActual,
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

  const user = await prisma.user.findUnique({
    where: { name: usuario },
  });

  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const conversation = await prisma.conversation.findFirst({
    where: {
      title: capitulo,
      reading: {
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

  const user = await prisma.user.findUnique({
    where: { name: usuario },
  });

  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const parent = await prisma.comment.findUnique({
    where: { id: comentarioId },
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
) {
  const idComentario = comentarioId.trim();

  const user = await prisma.user.findUnique({
    where: { name: usuario.trim() },
  });

  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const comment = await prisma.comment.findUnique({
    where: { id: idComentario },
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

  if (existing) {
    await prisma.like.delete({
      where: { id: existing.id },
    });
  } else {
    await prisma.like.create({
      data: {
        commentId: idComentario,
        userId: user.id,
      },
    });
  }

  const totalLikes = await prisma.like.count({
    where: {
      commentId: idComentario,
    },
  });

  return {
    ok: true,
    miLike: !existing,
    likes: totalLikes,
  };
}

export async function editarComentarioLectura(
  comentarioId: string,
  comentario: string,
) {
  const text = comentario.trim();

  if (!comentarioId || !text) {
    return { ok: false, mensaje: 'Faltan datos' };
  }

  const existing = await prisma.comment.findUnique({
    where: { id: comentarioId },
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

export async function eliminarComentarioLectura(comentarioId: string) {
  if (!comentarioId) {
    return { ok: false, mensaje: 'Falta comentarioId' };
  }

  const existing = await prisma.comment.findUnique({
    where: { id: comentarioId },
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
) {
  return editarComentarioLectura(respuestaId, respuesta);
}

export async function eliminarRespuestaLectura(respuestaId: string) {
  return eliminarComentarioLectura(respuestaId);
}

export async function getConversacionesLibro(libro: string) {
  const readings = await prisma.reading.findMany({
    where: {
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
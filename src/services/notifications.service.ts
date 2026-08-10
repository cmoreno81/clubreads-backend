import { NotificationType } from '@prisma/client';
import { prisma } from '../prisma.js';
import {
  descendingCursorFilter,
  pageFromRows,
  type PaginationRequest,
} from '../utils/cursor-pagination.js';

// ─────────────────────────────────────────────
// Crear notificaciones
// ─────────────────────────────────────────────

/** Crea una notificación para un usuario */
async function createNotification({
  userId,
  tipo,
  titulo,
  mensaje,
  clubId,
  bookId,
  extra,
}: {
  userId: string;
  tipo: NotificationType;
  titulo: string;
  mensaje: string;
  clubId?: string;
  bookId?: string;
  extra?: Record<string, unknown>;
}) {
  return prisma.notification.create({
    data: {
      userId,
      tipo,
      titulo,
      mensaje,
      clubId,
      bookId,
      extra: extra ? JSON.stringify(extra) : null,
    },
  });
}

/** Crea notificaciones para todos los miembros de un club (excepto el que origina) */
async function notifyClubMembers({
  clubId,
  excludeUserId,
  tipo,
  titulo,
  mensaje,
  bookId,
  extra,
}: {
  clubId: string;
  excludeUserId?: string;
  tipo: NotificationType;
  titulo: string;
  mensaje: string;
  bookId?: string;
  extra?: Record<string, unknown>;
}) {
  const members = await prisma.clubMember.findMany({
    where: {
      clubId,
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
    select: { userId: true },
  });

  await prisma.notification.createMany({
    data: members.map((m) => ({
      userId: m.userId,
      tipo,
      titulo,
      mensaje,
      clubId,
      bookId,
      extra: extra ? JSON.stringify(extra) : null,
    })),
  });
}

// ─────────────────────────────────────────────
// Helpers por tipo de evento
// ─────────────────────────────────────────────

export async function notifyClubvisionAbierta(clubId: string) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  await notifyClubMembers({
    clubId,
    tipo: NotificationType.CLUBVISION_ABIERTA,
    titulo: '🗳️ Clubvisión abierta',
    mensaje: `La votación de ${club.name} ha comenzado. ¡Elige tu próxima lectura!`,
  });
}

export async function notifyClubvisionResultados(clubId: string, ganador: string) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  await notifyClubMembers({
    clubId,
    tipo: NotificationType.CLUBVISION_RESULTADOS,
    titulo: '🏆 Ya hay ganadora',
    mensaje: `La Gala de ${club.name} tiene resultado. Entra a descubrir quién ha ganado.`,
  });
}

export async function notifyLecturaNueva(
  clubId: string,
  bookTitle: string,
  bookId: string,
  readingId?: string | null,
) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  await notifyClubMembers({
    clubId,
    tipo: NotificationType.LECTURA_NUEVA,
    titulo: '📖 Nueva lectura oficial',
    mensaje: `${club.name} empieza "${bookTitle}". ¡Prepárate para leer!`,
    bookId,
    extra: { bookTitle, ...(readingId ? { readingId } : {}) },
  });
}

export async function notifyLecturaCompartida({
  clubId,
  creadoraUserId,
  bookTitle,
  bookId,
  readingId,
}: {
  clubId: string;
  creadoraUserId: string;
  bookTitle: string;
  bookId: string;
  readingId?: string;
}) {
  await notifyClubMembers({
    clubId,
    excludeUserId: creadoraUserId,
    tipo: NotificationType.LECTURA_NUEVA,
    titulo: '📖 Nueva lectura compartida',
    mensaje: `Se ha abierto "${bookTitle}" en Lecturas compartidas.`,
    bookId,
    extra: { bookTitle, ...(readingId ? { readingId } : {}) },
  });
}

export async function notifyComentarioLectura({
  clubId,
  autorNombre,
  autorUserId,
  bookTitle,
  bookId,
  participantes,
  readingId,
}: {
  clubId: string;
  autorNombre: string;
  autorUserId: string;
  bookTitle: string;
  bookId: string;
  participantes: string[]; // userIds que han comentado en ese hilo
  readingId?: string;
}) {
  // Solo notificar a participantes del hilo, no a todos
  const destinatarios = participantes.filter((id) => id !== autorUserId);
  if (destinatarios.length === 0) return;

  await prisma.notification.createMany({
    data: destinatarios.map((userId) => ({
      userId,
      tipo: NotificationType.COMENTARIO_LECTURA,
      titulo: '💬 Nuevo comentario',
      mensaje: `${autorNombre} ha comentado en "${bookTitle}"`,
      clubId,
      bookId,
      extra: JSON.stringify({
        bookTitle,
        ...(readingId ? { readingId } : {}),
      }),
    })),
  });
}

export async function notifyLibroTerminado({
  clubId,
  lectoraNombre,
  lectoraUserId,
  bookTitle,
  bookId,
}: {
  clubId: string;
  lectoraNombre: string;
  lectoraUserId: string;
  bookTitle: string;
  bookId: string;
}) {
  await notifyClubMembers({
    clubId,
    excludeUserId: lectoraUserId,
    tipo: NotificationType.LIBRO_TERMINADO,
    titulo: '✅ Libro terminado',
    mensaje: `${lectoraNombre} ha terminado "${bookTitle}"`,
    bookId,
    extra: { bookTitle },
  });
}

export async function notifyLibroEmpezado({
  clubId,
  lectoraNombre,
  lectoraUserId,
  bookTitle,
  bookId,
}: {
  clubId: string;
  lectoraNombre: string;
  lectoraUserId: string;
  bookTitle: string;
  bookId: string;
}) {
  await notifyClubMembers({
    clubId,
    excludeUserId: lectoraUserId,
    tipo: NotificationType.LIBRO_EMPEZADO,
    titulo: '📖 Nueva lectura personal',
    mensaje: `${lectoraNombre} ha empezado a leer "${bookTitle}"`,
    bookId,
    extra: { bookTitle },
  });
}

export async function notifyLibroNuevoBiblioteca({
  clubId,
  autoraNombre,
  autoraUserId,
  libros,
}: {
  clubId: string;
  autoraNombre: string;
  autoraUserId: string;
  libros: Array<{ id: string; title: string }>;
}) {
  const titulo = libros.length === 1
    ? '✨ Libro nuevo en la biblioteca'
    : `✨ ${libros.length} libros nuevos en la biblioteca`;
  const mensaje = libros.length === 1
    ? `${autoraNombre} ha añadido "${libros[0]?.title}"`
    : `${autoraNombre} ha añadido ${libros.length} libros: ${libros.slice(0, 2).map(({ title }) => title).join(', ')}${libros.length > 2 ? ` y ${libros.length - 2} más` : ''}`;

  await notifyClubMembers({
    clubId,
    excludeUserId: autoraUserId,
    tipo: NotificationType.LIBRO_NUEVO_BIBLIOTECA,
    titulo,
    mensaje,
    bookId: libros.length === 1 ? libros[0]?.id : undefined,
    extra: libros.length === 1
      ? { bookTitle: libros[0]?.title }
      : {
          destination: 'BIBLIOTECA',
          bookIds: libros.map(({ id }) => id),
          bookTitles: libros.map(({ title }) => title),
        },
  });
}

export async function notifyNuevaMiembro({
  clubId,
  nuevaMiembroNombre,
  nuevaMiembroUserId,
}: {
  clubId: string;
  nuevaMiembroNombre: string;
  nuevaMiembroUserId: string;
}) {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { name: true },
  });
  if (!club) return;
  await notifyClubMembers({
    clubId,
    excludeUserId: nuevaMiembroUserId,
    tipo: NotificationType.NUEVA_MIEMBRO,
    titulo: '👋 Nueva lectora',
    mensaje: `${nuevaMiembroNombre} se ha unido a ${club.name}`,
    extra: { userId: nuevaMiembroUserId },
  });
}

// ─────────────────────────────────────────────
// Leer y gestionar notificaciones
// ─────────────────────────────────────────────

export async function getNotificaciones(userId: string) {
  const notificaciones = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const noLeidas = notificaciones.filter((n) => !n.leida).length;

  return {
    notificaciones: notificaciones.map((n) => ({
      id: n.id,
      tipo: n.tipo,
      titulo: n.titulo,
      mensaje: n.mensaje,
      leida: n.leida,
      clubId: n.clubId,
      bookId: n.bookId,
      extra: n.extra ? JSON.parse(n.extra) : null,
      fecha: n.createdAt.toISOString(),
    })),
    noLeidas,
  };
}

type NotificationPageRow = {
  id: string;
  tipo: NotificationType;
  titulo: string;
  mensaje: string;
  leida: boolean;
  clubId: string | null;
  bookId: string | null;
  extra: string | null;
  createdAt: Date;
};

type NotificationPageClient = {
  notification: {
    findMany(args: any): Promise<NotificationPageRow[]>;
  };
};

export async function getNotificacionesPage(
  userId: string,
  pagination: PaginationRequest,
  client: NotificationPageClient = prisma,
) {
  const rows = await client.notification.findMany({
    where: {
      userId,
      ...descendingCursorFilter('createdAt', pagination.cursor),
    },
    select: {
      id: true,
      tipo: true,
      titulo: true,
      mensaje: true,
      leida: true,
      clubId: true,
      bookId: true,
      extra: true,
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
    items: page.items.map((notification) => ({
      id: notification.id,
      tipo: notification.tipo,
      titulo: notification.titulo,
      mensaje: notification.mensaje,
      leida: notification.leida,
      clubId: notification.clubId,
      bookId: notification.bookId,
      extra: notification.extra ? JSON.parse(notification.extra) : null,
      fecha: notification.createdAt.toISOString(),
    })),
  };
}

export async function marcarLeida(userId: string, notificacionId: string) {
  await prisma.notification.updateMany({
    where: { id: notificacionId, userId },
    data: { leida: true },
  });
  return { ok: true };
}

export async function marcarTodasLeidas(userId: string) {
  await prisma.notification.updateMany({
    where: { userId, leida: false },
    data: { leida: true },
  });
  return { ok: true };
}

export async function eliminarNotificacion(
  userId: string,
  notificacionId: string,
) {
  return deleteNotificationForUser(prisma, userId, notificacionId);
}

type NotificationDeleteClient = {
  notification: {
    deleteMany(args: {
      where: { id: string; userId: string };
    }): Promise<{ count: number }>;
  };
};

export async function deleteNotificationForUser(
  client: NotificationDeleteClient,
  userId: string,
  notificacionId: string,
) {
  await client.notification.deleteMany({
    where: { id: notificacionId, userId },
  });
  return { ok: true };
}

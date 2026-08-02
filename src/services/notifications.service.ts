import { NotificationType } from '@prisma/client';
import { prisma } from '../prisma.js';

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

export async function notifyLecturaNueva(clubId: string, bookTitle: string, bookId: string) {
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
  });
}

export async function notifyLecturaCompartida({
  clubId,
  creadoraUserId,
  bookTitle,
  bookId,
}: {
  clubId: string;
  creadoraUserId: string;
  bookTitle: string;
  bookId: string;
}) {
  await notifyClubMembers({
    clubId,
    excludeUserId: creadoraUserId,
    tipo: NotificationType.LECTURA_NUEVA,
    titulo: '📖 Nueva lectura compartida',
    mensaje: `Se ha abierto "${bookTitle}" en Lecturas compartidas.`,
    bookId,
  });
}

export async function notifyComentarioLectura({
  clubId,
  autorNombre,
  autorUserId,
  bookTitle,
  bookId,
  participantes,
}: {
  clubId: string;
  autorNombre: string;
  autorUserId: string;
  bookTitle: string;
  bookId: string;
  participantes: string[]; // userIds que han comentado en ese hilo
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
  });
}

export async function notifyLibroNuevoBiblioteca({
  clubId,
  autoraNombre,
  autoraUserId,
  libros, // títulos
}: {
  clubId: string;
  autoraNombre: string;
  autoraUserId: string;
  libros: string[];
}) {
  const titulo = libros.length === 1
    ? '✨ Libro nuevo en la biblioteca'
    : `✨ ${libros.length} libros nuevos en la biblioteca`;
  const mensaje = libros.length === 1
    ? `${autoraNombre} ha añadido "${libros[0]}"`
    : `${autoraNombre} ha añadido ${libros.length} libros: ${libros.slice(0, 2).join(', ')}${libros.length > 2 ? ` y ${libros.length - 2} más` : ''}`;

  await notifyClubMembers({
    clubId,
    excludeUserId: autoraUserId,
    tipo: NotificationType.LIBRO_NUEVO_BIBLIOTECA,
    titulo,
    mensaje,
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
